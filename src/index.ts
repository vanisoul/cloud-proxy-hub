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

const idSchema = t.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" });
const stringRecord = t.Record(t.String(), t.String());

const keySchema = t.Object({
  id: idSchema,
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  env: stringRecord,
});

const templateSchema = t.Object({
  id: idSchema,
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
  files: stringRecord,
});

const apiSchema = t.Object({
  id: idSchema,
  name: t.String({ minLength: 1 }),
  keyId: idSchema,
  templateId: idSchema,
  allowedActions: t.Array(t.Union([t.Literal("deploy"), t.Literal("delete")])),
});

const runSchema = t.Object({
  vars: stringRecord,
});

const app = new Elysia()
  .onBeforeHandle(({ headers, path, request }) => {
    if (path.startsWith("/assets")) {
      return;
    }

    const providedKey = headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (providedKey !== appConfig.apiKey) {
      logger.warn("拒絕未授權請求", { path, method: request.method });
      return new Response("Unauthorized", { status: 401 });
    }
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
  .get("/", () => adminPage(), { detail: { summary: "Admin UI" } })
  .get("/health", () => ({ ok: true, service: "terraform-platform" }))
  .get("/api/provider-types", async () => store.listProviderTypes())
  .get("/api/providers/:providerTypeId/keys", async ({ params }) => store.listKeys(params.providerTypeId), {
    params: t.Object({ providerTypeId: idSchema }),
  })
  .post(
    "/api/providers/:providerTypeId/keys",
    async ({ params, body }) => store.saveKey({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: keySchema },
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
    async ({ params, body }) => store.saveTemplate({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: templateSchema },
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

function adminPage() {
  return new Response(
    `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Terraform Platform</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f4; color: #1e2428; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; }
    section { background: white; border: 1px solid #ddd8cc; border-radius: 16px; padding: 20px; margin: 18px 0; }
    h1 { margin-bottom: 4px; }
    code, pre { background: #efede7; border-radius: 8px; padding: 2px 6px; }
    pre { padding: 14px; overflow: auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  </style>
</head>
<body>
  <main>
    <h1>Terraform Platform</h1>
    <p>Admin-only config-driven Terraform 管理工具。Key、Template、API 都存在 <code>/config</code>，部署執行狀態存在 <code>/data</code>。</p>
    <div class="grid">
      <section><h2>1. Provider</h2><p>選擇 Terraform provider type，例如 aliyun/alicloud 或 hashicorp/google。</p></section>
      <section><h2>2. Key</h2><p>在 provider 底下建立多組 key；key secret 存在 config，API response 只回 envKeys。</p></section>
      <section><h2>3. Template</h2><p>在 provider 底下建立 Terraform template；禁止 backend、provider declarations 與 provisioner。</p></section>
      <section><h2>4. API</h2><p>選擇 provider + key + template 發布 API，再用 API UUID 呼叫 deploy/delete/status/output。</p></section>
    </div>
    <section>
      <h2>API quick links</h2>
      <pre>GET  /api/provider-types
POST /api/providers/:providerTypeId/keys
POST /api/providers/:providerTypeId/templates
POST /api/providers/:providerTypeId/apis
POST /api/deployments/:apiId/deploy
POST /api/deployments/:apiId/delete
GET  /api/deployments/:apiId/status
GET  /api/deployments/:apiId/output
GET  /api/deployments/:apiId/runs/:runId</pre>
    </section>
  </main>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
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
