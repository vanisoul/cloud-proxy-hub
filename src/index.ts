import { Elysia, t } from "elysia";

import { appConfig } from "@/config";
import { createLogger, redact } from "@/logger";
import { PlatformStore } from "@/storage";
import { TerraformService } from "@/terraform";

const logger = createLogger("terraform-platform");
const store = new PlatformStore();
const terraform = new TerraformService(store);

if (!appConfig.apiKey) {
  throw new Error("ADMIN_API_KEY is required for this admin-only service");
}

await store.initialize();

const sessionCookieSecret = await deriveSessionCookieSecret();
const idSchema = t.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" });
const stringRecord = t.Record(t.String(), t.String());
const sessionCookieName = "terraform_platform_session";
const sessionCookieMaxAgeSeconds = 60 * 60 * 24 * 7;

const keySchema = t.Object({
  id: t.Optional(idSchema),
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  env: stringRecord,
});

const templateSchema = t.Object({
  id: t.Optional(idSchema),
  name: t.String({ minLength: 1 }),
  version: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  variables: t.Array(
    t.Object({
      name: idSchema,
      required: t.Boolean(),
      sensitive: t.Boolean(),
      defaultValue: t.Optional(t.String()),
    }),
  ),
  mainTf: t.Optional(t.String({ minLength: 1 })),
  files: t.Optional(stringRecord),
});

const apiSchema = t.Object({
  id: t.Optional(idSchema),
  name: t.String({ minLength: 1 }),
  keyId: idSchema,
  templateId: idSchema,
  allowedActions: t.Array(t.Union([t.Literal("deploy"), t.Literal("delete")])),
});

const runSchema = t.Object({
  vars: stringRecord,
});

const app = new Elysia()
  .onBeforeHandle(async ({ headers, path, request }) => {
    if (path.startsWith("/assets") || path === "/login") {
      return;
    }

    if (isCrossOriginUiMutation(path, request)) {
      logger.warn("拒絕跨來源 UI 請求", { path, method: request.method });
      return new Response("Forbidden", { status: 403 });
    }

    const bearerAuthorized = headers.authorization?.replace(/^Bearer\s+/i, "") === appConfig.apiKey;
    if (path.startsWith("/api/")) {
      if (!bearerAuthorized) {
        logger.warn("拒絕未授權請求", { path, method: request.method });
        return new Response("Unauthorized", { status: 401 });
      }

      return;
    }

    const cookieAuthorized = await hasValidSessionCookie(request);
    if (bearerAuthorized || cookieAuthorized) {
      return;
    }

    if (path === "/" && request.method === "GET") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/login",
        },
      });
    }

    logger.warn("拒絕未授權請求", { path, method: request.method });
    return new Response("Unauthorized", { status: 401 });
  })
  .onError(({ error, code, set }) => {
    const message = error instanceof Error ? error.message : String(error);
    if (code === "VALIDATION") {
      logger.error("請求處理失敗", { code });
      set.status = 400;
      return { error: "Invalid request" };
    }

    logger.error("請求處理失敗", { code, error: message });
    set.status = isNotFoundError(message) ? 404 : isClientInputError(message) ? 400 : 500;
    return { error: message };
  })
  .get("/", () => serveSpaIndex(), { detail: { summary: "Admin UI" } })
  .get("/assets/:file", async ({ params }) => serveSpaAsset(params.file), { detail: { summary: "Admin UI asset" } })
  .get("/login", () => loginPage(), { detail: { summary: "Login page" } })
  .post("/login", async ({ request }) => {
    const formData = await request.formData();
    const adminKeyEntry = formData.get("adminKey");
    const adminKey = typeof adminKeyEntry === "string" ? adminKeyEntry : "";
    const keyMatches = await constantTimeEqualText(adminKey, appConfig.apiKey);

    if (!keyMatches) {
      return unauthorizedLoginPage();
    }

    const expiresAt = Date.now() + sessionCookieMaxAgeSeconds * 1000;
    const sessionCookieValue = await buildSessionCookieValue(expiresAt);

    return new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "set-cookie": buildSessionCookieHeader(request.url, sessionCookieValue),
      },
    });
  })
  .post(
    "/logout",
    async ({ request }) =>
      new Response(null, {
        status: 303,
        headers: {
          location: "/login",
          "set-cookie": buildClearedSessionCookieHeader(request.url),
        },
      }),
  )
  .get("/health", () => ({ ok: true, service: "terraform-platform" }))
  .get("/ui/bootstrap", async () => ({
    providerTypes: await store.listProviderTypes(),
    keys: await store.listKeys(),
    templates: await store.listTemplates(),
    apis: await store.listApis(),
  }))
  .post(
    "/ui/providers/:providerTypeId/keys",
    async ({ params, body }) => store.saveKey({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: keySchema },
  )
  .post(
    "/ui/providers/:providerTypeId/keys/:keyId",
    async ({ params, body }) => store.saveKey({ ...body, id: params.keyId, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }), body: keySchema },
  )
  .get(
    "/ui/providers/:providerTypeId/keys/:keyId",
    async ({ params }) => store.getPublicKey(params.providerTypeId, params.keyId),
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }) },
  )
  .delete(
    "/ui/providers/:providerTypeId/keys/:keyId",
    async ({ params }) => {
      await store.deleteKey(params.providerTypeId, params.keyId);
      return { ok: true };
    },
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }) },
  )
  .post(
    "/ui/providers/:providerTypeId/templates",
    async ({ params, body }) => {
      const input = { ...body, providerTypeId: params.providerTypeId };
      await terraform.validateTemplate(input);
      return store.saveTemplate(input);
    },
    { params: t.Object({ providerTypeId: idSchema }), body: templateSchema },
  )
  .post(
    "/ui/providers/:providerTypeId/templates/:templateId",
    async ({ params, body }) => {
      const input = { ...body, id: params.templateId, providerTypeId: params.providerTypeId };
      await terraform.validateTemplate(input);
      return store.saveTemplate(input);
    },
    { params: t.Object({ providerTypeId: idSchema, templateId: idSchema }), body: templateSchema },
  )
  .get(
    "/ui/providers/:providerTypeId/templates/:templateId",
    async ({ params }) => store.getTemplate(params.providerTypeId, params.templateId),
    { params: t.Object({ providerTypeId: idSchema, templateId: idSchema }) },
  )
  .delete(
    "/ui/providers/:providerTypeId/templates/:templateId",
    async ({ params }) => {
      await store.deleteTemplate(params.providerTypeId, params.templateId);
      return { ok: true };
    },
    { params: t.Object({ providerTypeId: idSchema, templateId: idSchema }) },
  )
  .post(
    "/ui/providers/:providerTypeId/apis",
    async ({ params, body }) => store.saveApi({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: apiSchema },
  )
  .post(
    "/ui/providers/:providerTypeId/apis/:apiId",
    async ({ params, body }) => store.saveApi({ ...body, id: params.apiId, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema, apiId: idSchema }), body: apiSchema },
  )
  .get("/ui/apis/:apiId", async ({ params }) => store.getApi(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .delete(
    "/ui/apis/:apiId",
    async ({ params }) => {
      await store.deleteApi(params.apiId);
      return { ok: true };
    },
    { params: t.Object({ apiId: idSchema }) },
  )
  .post(
    "/ui/deployments/:apiId/deploy",
    async ({ params, body }) => terraform.deploy(await store.getApi(params.apiId), body),
    { params: t.Object({ apiId: idSchema }), body: runSchema },
  )
  .post(
    "/ui/deployments/:apiId/delete",
    async ({ params, body }) => terraform.delete(await store.getApi(params.apiId), body),
    { params: t.Object({ apiId: idSchema }), body: runSchema },
  )
  .get("/ui/deployments/:apiId/status", async ({ params }) => terraform.status(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/ui/deployments/:apiId/output", async ({ params }) => terraform.output(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/ui/deployments/:apiId/runs", async ({ params }) => store.listRuns(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/ui/deployments/:apiId/examples", async ({ params }) => store.getRuntimeCallExample(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/ui/deployments/:apiId/runs/:runId", async ({ params }) => store.getRun(params.apiId, params.runId), {
    params: t.Object({ apiId: idSchema, runId: t.String({ minLength: 1 }) }),
  })
  .get("/api/provider-types", async () => store.listProviderTypes())
  .get("/api/providers/:providerTypeId/keys", async ({ params }) => store.listKeys(params.providerTypeId), {
    params: t.Object({ providerTypeId: idSchema }),
  })
  .post(
    "/api/providers/:providerTypeId/keys",
    async ({ params, body }) => store.saveKey({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: keySchema },
  )
  .put(
    "/api/providers/:providerTypeId/keys/:keyId",
    async ({ params, body }) => store.saveKey({ ...body, id: params.keyId, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }), body: keySchema },
  )
  .get(
    "/api/providers/:providerTypeId/keys/:keyId",
    async ({ params }) => store.getPublicKey(params.providerTypeId, params.keyId),
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }) },
  )
  .delete(
    "/api/providers/:providerTypeId/keys/:keyId",
    async ({ params }) => {
      await store.deleteKey(params.providerTypeId, params.keyId);
      return { ok: true };
    },
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }) },
  )
  .post(
    "/api/providers/:providerTypeId/keys/:keyId/test",
    async ({ params }) => terraform.testKey(params.providerTypeId, params.keyId),
    { params: t.Object({ providerTypeId: idSchema, keyId: idSchema }) },
  )
  .get("/api/providers/:providerTypeId/templates", async ({ params }) => store.listTemplates(params.providerTypeId), {
    params: t.Object({ providerTypeId: idSchema }),
  })
  .post(
    "/api/providers/:providerTypeId/templates",
    async ({ params, body }) => {
      const input = { ...body, providerTypeId: params.providerTypeId };
      await terraform.validateTemplate(input);
      return store.saveTemplate(input);
    },
    { params: t.Object({ providerTypeId: idSchema }), body: templateSchema },
  )
  .put(
    "/api/providers/:providerTypeId/templates/:templateId",
    async ({ params, body }) => {
      const input = { ...body, id: params.templateId, providerTypeId: params.providerTypeId };
      await terraform.validateTemplate(input);
      return store.saveTemplate(input);
    },
    { params: t.Object({ providerTypeId: idSchema, templateId: idSchema }), body: templateSchema },
  )
  .get(
    "/api/providers/:providerTypeId/templates/:templateId",
    async ({ params }) => store.getTemplate(params.providerTypeId, params.templateId),
    { params: t.Object({ providerTypeId: idSchema, templateId: idSchema }) },
  )
  .delete(
    "/api/providers/:providerTypeId/templates/:templateId",
    async ({ params }) => {
      await store.deleteTemplate(params.providerTypeId, params.templateId);
      return { ok: true };
    },
    { params: t.Object({ providerTypeId: idSchema, templateId: idSchema }) },
  )
  .get("/api/providers/:providerTypeId/apis", async ({ params }) => store.listApis(params.providerTypeId), {
    params: t.Object({ providerTypeId: idSchema }),
  })
  .post(
    "/api/providers/:providerTypeId/apis",
    async ({ params, body }) => store.saveApi({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: apiSchema },
  )
  .put(
    "/api/providers/:providerTypeId/apis/:apiId",
    async ({ params, body }) => store.saveApi({ ...body, id: params.apiId, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema, apiId: idSchema }), body: apiSchema },
  )
  .get("/api/apis/:apiId", async ({ params }) => store.getApi(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .delete(
    "/api/apis/:apiId",
    async ({ params }) => {
      await store.deleteApi(params.apiId);
      return { ok: true };
    },
    { params: t.Object({ apiId: idSchema }) },
  )
  .post(
    "/api/deployments/:apiId/deploy",
    async ({ params, body }) => terraform.deploy(await store.getApi(params.apiId), body),
    {
      params: t.Object({ apiId: idSchema }),
      body: runSchema,
    },
  )
  .post(
    "/api/deployments/:apiId/delete",
    async ({ params, body }) => terraform.delete(await store.getApi(params.apiId), body),
    {
      params: t.Object({ apiId: idSchema }),
      body: runSchema,
    },
  )
  .get("/api/deployments/:apiId/status", async ({ params }) => terraform.status(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/api/deployments/:apiId/output", async ({ params }) => terraform.output(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/api/deployments/:apiId/runs", async ({ params }) => store.listRuns(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/api/deployments/:apiId/examples", async ({ params }) => store.getRuntimeCallExample(params.apiId), {
    params: t.Object({ apiId: idSchema }),
  })
  .get("/api/deployments/:apiId/runs/:runId", async ({ params }) => store.getRun(params.apiId, params.runId), {
    params: t.Object({ apiId: idSchema, runId: t.String({ minLength: 1 }) }),
  })
  .listen(appConfig.port);

logger.info(
  "Terraform 管理平台啟動完成",
  redact({ port: appConfig.port, configDir: appConfig.configDir, dataDir: appConfig.dataDir }) as Record<
    string,
    unknown
  >,
);

const spaDistDirectory = new URL("../web/dist/", import.meta.url);

async function serveSpaIndex() {
  const file = Bun.file(new URL("index.html", spaDistDirectory));
  if (!(await file.exists())) {
    return new Response("Admin UI has not been built. Run bun run build.", { status: 503 });
  }

  return new Response(file, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function serveSpaAsset(fileName: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(new URL(`assets/${fileName}`, spaDistDirectory));
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file, {
    headers: {
      "content-type": assetContentType(fileName),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

function assetContentType(fileName: string) {
  if (fileName.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (fileName.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (fileName.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (fileName.endsWith(".png")) {
    return "image/png";
  }
  if (fileName.endsWith(".woff2")) {
    return "font/woff2";
  }
  return "application/octet-stream";
}

function loginPage() {
  return new Response(loginPageHtml(), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function unauthorizedLoginPage() {
  return new Response(loginPageHtml("Invalid admin key."), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function loginPageHtml(message?: string) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:," />
  <title>Login - Terraform Platform</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f4; color: #1e2428; }
    main { width: min(420px, calc(100vw - 32px)); background: white; border: 1px solid #ddd8cc; border-radius: 16px; padding: 28px; box-sizing: border-box; }
    label { display: block; margin: 16px 0 8px; }
    input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #cfc8ba; border-radius: 10px; font: inherit; }
    button { margin-top: 18px; width: 100%; border: 0; background: #1e2428; color: white; border-radius: 10px; padding: 12px 14px; font: inherit; cursor: pointer; }
    .error { margin: 0 0 12px; color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1>Terraform Platform Login</h1>
    ${message ? `<p class="error">${message}</p>` : ""}
    <form method="post" action="/login">
      <label for="adminKey">Admin Key</label>
      <input id="adminKey" name="adminKey" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}

function buildSessionCookieHeader(requestUrl: string, cookieValue: string) {
  return buildCookieHeader(requestUrl, cookieValue, sessionCookieMaxAgeSeconds);
}

function buildClearedSessionCookieHeader(requestUrl: string) {
  return buildCookieHeader(requestUrl, "", 0);
}

function buildCookieHeader(requestUrl: string, cookieValue: string, maxAgeSeconds: number) {
  const secureAttribute = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName}=${cookieValue}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureAttribute}`;
}

function isCrossOriginUiMutation(path: string, request: Request) {
  if (!path.startsWith("/ui/") || request.method === "GET") {
    return false;
  }

  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

async function hasValidSessionCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const sessionCookie = getCookieValue(cookieHeader, sessionCookieName);
  if (!sessionCookie) {
    return false;
  }

  const [expiresAtText, providedSignature, ...rest] = sessionCookie.split(".");
  if (!expiresAtText || !providedSignature || rest.length > 0 || !/^\d+$/.test(expiresAtText)) {
    return false;
  }

  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  const expectedSignature = await signSessionCookie(expiresAt);
  return constantTimeEqualText(providedSignature, expectedSignature);
}

function getCookieValue(cookieHeader: string | null, cookieName: string) {
  if (!cookieHeader) {
    return "";
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) {
      return rest.join("=");
    }
  }

  return "";
}

async function constantTimeEqualText(left: string, right: string) {
  const [leftBytes, rightBytes] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  return constantTimeEqualBytes(new Uint8Array(leftBytes), new Uint8Array(rightBytes));
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }

  return mismatch === 0;
}

async function buildSessionCookieValue(expiresAt: number) {
  return `${expiresAt}.${await signSessionCookie(expiresAt)}`;
}

async function signSessionCookie(expiresAt: number) {
  return sha256Hex(`${expiresAt}:${sessionCookieSecret}`);
}

async function deriveSessionCookieSecret() {
  return sha256Hex(`terraform-platform-session-secret:${appConfig.apiKey}`);
}

async function sha256Hex(value: string) {
  const bytes = await sha256Bytes(value);
  return bytesToHex(new Uint8Array(bytes));
}

async function sha256Bytes(value: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isClientInputError(message: string) {
  return (
    message.startsWith("Template file ") ||
    message.startsWith("Action ") ||
    message.startsWith("Missing variables: ") ||
    message.startsWith("Variable ") ||
    message.includes("not supported") ||
    message.includes("referenced by API")
  );
}

function isNotFoundError(message: string) {
  return message.startsWith("API ") && message.endsWith("not found");
}

export type App = typeof app;
