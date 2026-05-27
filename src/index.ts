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
  .get("/", () => adminPage(), { detail: { summary: "Admin UI" } })
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
    "/ui/providers/:providerTypeId/templates",
    async ({ params, body }) => store.saveTemplate({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: templateSchema },
  )
  .post(
    "/ui/providers/:providerTypeId/apis",
    async ({ params, body }) => store.saveApi({ ...body, providerTypeId: params.providerTypeId }),
    { params: t.Object({ providerTypeId: idSchema }), body: apiSchema },
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
  <link rel="icon" href="data:," />
  <title>Terraform Platform</title>
  <style>
    :root {
      --color-ink: #17201d;
      --color-muted: #6b756f;
      --color-canvas: #f2efe5;
      --color-panel: #fffaf0;
      --color-panel-strong: #fff4d8;
      --color-border: #d8cfb8;
      --color-border-strong: #17201d;
      --color-accent: #d9562b;
      --color-accent-soft: #ffe0c8;
      --color-success: #27735e;
      --color-danger: #a9392e;
      --color-code: #211f1a;
      --color-ink-rgb: 23 32 29;
      --color-panel-rgb: 255 250 240;
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
      --space-8: 32px;
      --space-10: 40px;
      --space-12: 48px;
      --radius-sm: 10px;
      --radius-md: 16px;
      --radius-lg: 24px;
      --radius-pill: 999px;
      --shadow-soft: 0 18px 60px rgb(var(--color-ink-rgb) / 12%);
      --shadow-tight: 0 8px 24px rgb(var(--color-ink-rgb) / 10%);
      --font-display: "Iowan Old Style", "Palatino", "Book Antiqua", serif;
      --font-body: "Avenir Next", "Gill Sans", "Trebuchet MS", sans-serif;
      --font-mono: "SFMono-Regular", "Menlo", "Consolas", monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--color-ink);
      font-family: var(--font-body);
      background:
        radial-gradient(circle at top left, var(--color-accent-soft), transparent 32rem),
        radial-gradient(circle at bottom right, var(--color-panel-strong), transparent 30rem),
        var(--color-canvas);
    }
    body::before {
      position: fixed;
      inset: 0;
      pointer-events: none;
      content: "";
      opacity: .34;
      background-image: linear-gradient(90deg, rgb(var(--color-ink-rgb) / 6%) 1px, transparent 1px), linear-gradient(rgb(var(--color-ink-rgb) / 5%) 1px, transparent 1px);
      background-size: var(--space-8) var(--space-8);
      mask-image: linear-gradient(to bottom, var(--color-ink), transparent 78%);
    }
    main {
      position: relative;
      width: min(1440px, calc(100vw - var(--space-8)));
      margin: 0 auto;
      padding: var(--space-8) 0 var(--space-12);
    }
    header.hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-6);
      align-items: end;
      padding: var(--space-10);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--color-panel), var(--color-panel-strong));
      box-shadow: var(--shadow-soft);
    }
    h1, h2, h3 { margin: 0; font-family: var(--font-display); line-height: 1; }
    h1 { max-width: 780px; font-size: clamp(3rem, 8vw, 7.2rem); letter-spacing: -.07em; }
    h2 { font-size: 1.45rem; letter-spacing: -.02em; }
    h3 { font-size: 1.05rem; }
    p { color: var(--color-muted); line-height: 1.65; }
    button, input, select, textarea { font: inherit; }
    button, select, input, textarea {
      width: 100%;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-panel);
      color: var(--color-ink);
      padding: var(--space-3) var(--space-4);
    }
    textarea { min-height: 160px; resize: vertical; font-family: var(--font-mono); font-size: .88rem; line-height: 1.5; }
    label { display: grid; gap: var(--space-2); color: var(--color-muted); font-size: .9rem; }
    button {
      border-color: var(--color-border-strong);
      background: var(--color-ink);
      color: var(--color-panel);
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
    }
    button:hover { transform: translateY(-1px); box-shadow: var(--shadow-tight); }
    button.secondary { background: var(--color-panel); color: var(--color-ink); }
    button.danger { background: var(--color-danger); color: var(--color-panel); }
    button:disabled { cursor: not-allowed; opacity: .52; transform: none; box-shadow: none; }
    pre {
      min-height: 180px;
      margin: 0;
      overflow: auto;
      border-radius: var(--radius-sm);
      background: var(--color-code);
      color: var(--color-panel);
      padding: var(--space-4);
      font-family: var(--font-mono);
      font-size: .84rem;
      line-height: 1.55;
      white-space: pre-wrap;
    }
    .hero-copy { display: grid; gap: var(--space-4); }
    .eyebrow { margin: 0; color: var(--color-accent); font-weight: 800; letter-spacing: .2em; text-transform: uppercase; }
    .hero-copy p:last-child { max-width: 760px; margin: 0; }
    .toolbar { display: grid; gap: var(--space-3); min-width: 220px; }
    .status-bar {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(280px, 2fr);
      gap: var(--space-4);
      margin: var(--space-6) 0;
    }
    .panel {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: rgb(var(--color-panel-rgb) / 86%);
      box-shadow: var(--shadow-tight);
      padding: var(--space-5);
      backdrop-filter: blur(16px);
    }
    .panel-header { display: grid; gap: var(--space-2); margin-bottom: var(--space-4); }
    .panel-header p { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--space-4); }
    .span-4 { grid-column: span 4; }
    .span-5 { grid-column: span 5; }
    .span-6 { grid-column: span 6; }
    .span-7 { grid-column: span 7; }
    .span-12 { grid-column: span 12; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
    .summary-card {
      min-height: 118px;
      display: grid;
      align-content: space-between;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-4);
      background: linear-gradient(150deg, var(--color-panel), var(--color-panel-strong));
    }
    .summary-card strong { font-family: var(--font-display); font-size: 2.4rem; line-height: 1; }
    .summary-card span { color: var(--color-muted); font-size: .88rem; }
    .form-grid { display: grid; gap: var(--space-4); }
    .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .actions button { width: auto; min-width: 150px; }
    .checks { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .check {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      width: auto;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-panel);
      color: var(--color-ink);
    }
    .check input { width: auto; padding: 0; }
    .toast {
      min-height: 100%;
      display: grid;
      align-content: center;
      border-left: var(--space-1) solid var(--color-accent);
    }
    .toast[data-tone="success"] { border-left-color: var(--color-success); }
    .toast[data-tone="error"] { border-left-color: var(--color-danger); }
    .toast strong { display: block; margin-bottom: var(--space-1); }
    .muted { color: var(--color-muted); }
    @media (max-width: 1100px) {
      .span-4, .span-5, .span-6, .span-7 { grid-column: span 12; }
      .summary-grid, .status-bar, header.hero { grid-template-columns: 1fr; }
      .toolbar { min-width: 0; }
    }
    @media (max-width: 720px) {
      main { width: min(100vw - var(--space-4), 1440px); padding-top: var(--space-4); }
      header.hero { padding: var(--space-6); }
      .two-col, .summary-grid { grid-template-columns: 1fr; }
      .actions button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Config driven control room</p>
        <h1>Terraform Platform</h1>
        <p>用瀏覽器完成 provider、key、template、API 發布與 runtime 操作；瀏覽器只使用登入 session 呼叫 UI endpoints，不需要也不保存任何命令列 API token。</p>
      </div>
      <form class="toolbar" method="post" action="/logout">
        <button type="submit">Logout</button>
      </form>
    </header>

    <section class="status-bar">
      <div class="panel">
        <label for="providerSelect">Provider</label>
        <select id="providerSelect"></select>
        <p id="providerDetails" class="muted"></p>
      </div>
      <div id="toast" class="panel toast" data-tone="info" role="status" aria-live="polite">
        <strong>Loading workspace</strong>
        <span>正在讀取可用 provider 與資源清單。</span>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2>Resource Summary</h2>
        <p>以下數字會跟著選取的 provider 更新，方便確認目前工作範圍。</p>
      </div>
      <div class="summary-grid">
        <div class="summary-card"><span>Provider Types</span><strong id="providerCount">0</strong></div>
        <div class="summary-card"><span>Keys</span><strong id="keyCount">0</strong></div>
        <div class="summary-card"><span>Templates</span><strong id="templateCount">0</strong></div>
        <div class="summary-card"><span>Published APIs</span><strong id="apiCount">0</strong></div>
      </div>
    </section>

    <div class="grid">
      <section class="panel span-4">
        <div class="panel-header">
          <h2>Create Key</h2>
          <p>依 provider.requiredEnv 產生欄位；儲存後列表只顯示 env key 名稱。</p>
        </div>
        <form id="keyForm" class="form-grid">
          <label>ID<input id="keyId" name="id" required pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-)*" placeholder="demo-key" /></label>
          <label>Name<input id="keyName" name="name" required placeholder="Demo key" /></label>
          <label>Description<input id="keyDescription" name="description" placeholder="Optional note" /></label>
          <div id="keyEnvFields" class="form-grid"></div>
          <button type="submit">Save Key</button>
        </form>
      </section>

      <section class="panel span-4">
        <div class="panel-header">
          <h2>Create Template</h2>
          <p>預填可安全通過 allowlist 的 terraform_data 範例與 name 變數。</p>
        </div>
        <form id="templateForm" class="form-grid">
          <div class="two-col">
            <label>ID<input id="templateId" name="id" required pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-)*" placeholder="sample-template" /></label>
            <label>Version<input id="templateVersion" name="version" required value="1.0.0" /></label>
          </div>
          <label>Name<input id="templateName" name="name" required placeholder="Sample template" /></label>
          <label>Description<input id="templateDescription" name="description" placeholder="Optional note" /></label>
          <label>Variables JSON<textarea id="templateVariables" required></textarea></label>
          <label>Files JSON<textarea id="templateFiles" required></textarea></label>
          <button type="submit">Save Template</button>
        </form>
      </section>

      <section class="panel span-4">
        <div class="panel-header">
          <h2>Publish API</h2>
          <p>把目前 provider 的 key 與 template 組成可部署 API。</p>
        </div>
        <form id="apiForm" class="form-grid">
          <label>ID<input id="apiId" name="id" required pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-)*" placeholder="sample-api" /></label>
          <label>Name<input id="apiName" name="name" required placeholder="Sample API" /></label>
          <label>Key<select id="apiKeySelect" name="keyId" required></select></label>
          <label>Template<select id="apiTemplateSelect" name="templateId" required></select></label>
          <div>
            <span class="muted">Allowed Actions</span>
            <div id="apiActionChecks" class="checks"></div>
          </div>
          <button type="submit">Publish API</button>
        </form>
      </section>

      <section class="panel span-5">
        <div class="panel-header">
          <h2>Runtime</h2>
          <p>選擇 API 後會由 template variables 產生 vars JSON，可部署、刪除、刷新狀態與輸出，或用 run id 查詢細節。</p>
        </div>
        <form id="runtimeForm" class="form-grid">
          <label>API<select id="runtimeApiSelect" required></select></label>
          <label>Vars JSON<textarea id="runtimeVars" required></textarea></label>
          <div class="actions">
            <button id="deployButton" type="button">Deploy</button>
            <button id="deleteButton" class="danger" type="button">Terraform Delete</button>
            <button id="statusButton" class="secondary" type="button">Refresh Status</button>
            <button id="outputButton" class="secondary" type="button">Refresh Output</button>
          </div>
          <div class="two-col">
            <label>Run ID<input id="runIdInput" placeholder="paste run id" /></label>
            <button id="runButton" class="secondary" type="button">View Run</button>
          </div>
        </form>
      </section>

      <section class="panel span-7">
        <div class="panel-header">
          <h2>Latest Run</h2>
          <p>部署或刪除後會顯示伺服器回傳的 run JSON；敏感變數由後端決定遮罩。</p>
        </div>
        <pre id="latestRunPanel">No run yet.</pre>
      </section>

      <section class="panel span-6">
        <div class="panel-header"><h2>Status</h2></div>
        <pre id="statusPanel">No status loaded.</pre>
      </section>
      <section class="panel span-6">
        <div class="panel-header"><h2>Output</h2></div>
        <pre id="outputPanel">No output loaded.</pre>
      </section>
      <section class="panel span-12">
        <div class="panel-header"><h2>Run Detail</h2></div>
        <pre id="runPanel">No run detail loaded.</pre>
      </section>
    </div>
  </main>
  <script>
    const state = {
      providerTypes: [],
      keys: [],
      templates: [],
      apis: [],
      selectedProviderId: ""
    };

    const elements = {
      providerSelect: document.getElementById("providerSelect"),
      providerDetails: document.getElementById("providerDetails"),
      toast: document.getElementById("toast"),
      providerCount: document.getElementById("providerCount"),
      keyCount: document.getElementById("keyCount"),
      templateCount: document.getElementById("templateCount"),
      apiCount: document.getElementById("apiCount"),
      keyForm: document.getElementById("keyForm"),
      keyEnvFields: document.getElementById("keyEnvFields"),
      templateForm: document.getElementById("templateForm"),
      templateVariables: document.getElementById("templateVariables"),
      templateFiles: document.getElementById("templateFiles"),
      apiForm: document.getElementById("apiForm"),
      apiKeySelect: document.getElementById("apiKeySelect"),
      apiTemplateSelect: document.getElementById("apiTemplateSelect"),
      apiActionChecks: document.getElementById("apiActionChecks"),
      runtimeApiSelect: document.getElementById("runtimeApiSelect"),
      runtimeVars: document.getElementById("runtimeVars"),
      deployButton: document.getElementById("deployButton"),
      deleteButton: document.getElementById("deleteButton"),
      statusButton: document.getElementById("statusButton"),
      outputButton: document.getElementById("outputButton"),
      runButton: document.getElementById("runButton"),
      runIdInput: document.getElementById("runIdInput"),
      latestRunPanel: document.getElementById("latestRunPanel"),
      statusPanel: document.getElementById("statusPanel"),
      outputPanel: document.getElementById("outputPanel"),
      runPanel: document.getElementById("runPanel")
    };

    const sampleVariables = [
      { name: "name", required: true, sensitive: false, defaultValue: "demo" }
    ];
    const sampleTemplate = [
      "variable \\\"name\\\" {",
      "  type = string",
      "}",
      "",
      "resource \\\"terraform_data\\\" \\\"sample\\\" {",
      "  input = var.name",
      "}",
      "",
      "output \\\"name\\\" {",
      "  value = terraform_data.sample.output",
      "}"
    ].join("\\n");

    function setToast(title, message, tone) {
      elements.toast.dataset.tone = tone;
      elements.toast.replaceChildren();
      const strong = document.createElement("strong");
      const span = document.createElement("span");
      strong.textContent = title;
      span.textContent = message;
      elements.toast.append(strong, span);
    }

    function selectedProvider() {
      return state.providerTypes.find((provider) => provider.id === state.selectedProviderId);
    }

    function byProvider(items) {
      return items.filter((item) => item.providerTypeId === state.selectedProviderId);
    }

    async function requestJson(path, options) {
      const init = options || {};
      const response = await fetch(path, {
        ...init,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(init.headers || {})
        }
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const message = data && typeof data.error === "string" ? data.error : response.statusText;
        throw new Error(message);
      }
      return data;
    }

    async function loadBootstrap() {
      const data = await requestJson("/ui/bootstrap");
      state.providerTypes = data.providerTypes;
      state.keys = data.keys;
      state.templates = data.templates;
      state.apis = data.apis;
      if (!state.selectedProviderId && state.providerTypes[0]) {
        state.selectedProviderId = state.providerTypes[0].id;
      }
      renderAll();
    }

    function renderAll() {
      renderProviderSelect();
      renderSummary();
      renderKeyEnvFields();
      renderApiFormOptions();
      renderRuntimeOptions();
    }

    function renderProviderSelect() {
      const options = state.providerTypes.map((provider) => new Option(provider.name + " (" + provider.id + ")", provider.id));
      elements.providerSelect.replaceChildren(...options);
      elements.providerSelect.value = state.selectedProviderId;
      const provider = selectedProvider();
      elements.providerDetails.textContent = provider
        ? "Source " + provider.sourceAddress + " " + provider.versionConstraint + "; env: " + provider.requiredEnv.join(", ")
        : "No provider types configured.";
    }

    function renderSummary() {
      elements.providerCount.textContent = String(state.providerTypes.length);
      elements.keyCount.textContent = String(byProvider(state.keys).length);
      elements.templateCount.textContent = String(byProvider(state.templates).length);
      elements.apiCount.textContent = String(byProvider(state.apis).length);
    }

    function renderKeyEnvFields() {
      const provider = selectedProvider();
      elements.keyEnvFields.replaceChildren();
      if (!provider) {
        return;
      }
      for (const envName of provider.requiredEnv) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.required = true;
        input.type = "password";
        input.name = "env:" + envName;
        input.autocomplete = "off";
        label.textContent = envName;
        label.append(input);
        elements.keyEnvFields.append(label);
      }
    }

    function renderApiFormOptions() {
      const provider = selectedProvider();
      elements.apiKeySelect.replaceChildren(...byProvider(state.keys).map((key) => new Option(key.name + " (" + key.id + ")", key.id)));
      elements.apiTemplateSelect.replaceChildren(...byProvider(state.templates).map((template) => new Option(template.name + " (" + template.id + ")", template.id)));
      elements.apiActionChecks.replaceChildren();
      if (!provider) {
        return;
      }
      for (const action of provider.supportedActions) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "allowedActions";
        checkbox.value = action;
        checkbox.checked = true;
        label.className = "check";
        label.append(checkbox, document.createTextNode(action));
        elements.apiActionChecks.append(label);
      }
    }

    function renderRuntimeOptions() {
      const previousValue = elements.runtimeApiSelect.value;
      elements.runtimeApiSelect.replaceChildren(...byProvider(state.apis).map((api) => new Option(api.name + " (" + api.id + ")", api.id)));
      if (previousValue) {
        elements.runtimeApiSelect.value = previousValue;
      }
      refreshRuntimeVars();
    }

    function selectedApi() {
      return state.apis.find((api) => api.id === elements.runtimeApiSelect.value);
    }

    function selectedRuntimeTemplate() {
      const api = selectedApi();
      return api ? state.templates.find((template) => template.id === api.templateId && template.providerTypeId === api.providerTypeId) : undefined;
    }

    function refreshRuntimeVars() {
      const api = selectedApi();
      const template = selectedRuntimeTemplate();
      elements.deployButton.disabled = !api || !api.allowedActions.includes("deploy");
      elements.deleteButton.disabled = !api || !api.allowedActions.includes("delete");
      elements.statusButton.disabled = !api;
      elements.outputButton.disabled = !api;
      elements.runButton.disabled = !api;
      if (!template) {
        elements.runtimeVars.value = "{}";
        return;
      }
      const vars = {};
      for (const variable of template.variables) {
        vars[variable.name] = variable.sensitive ? "" : variable.defaultValue || "";
      }
      elements.runtimeVars.value = JSON.stringify(vars, null, 2);
    }

    function parseJsonTextarea(textarea, label) {
      try {
        return JSON.parse(textarea.value);
      } catch (error) {
        throw new Error(label + " must be valid JSON");
      }
    }

    function formString(formData, name) {
      const value = formData.get(name);
      return typeof value === "string" ? value : "";
    }

    function renderJson(target, value, emptyText) {
      target.textContent = value === undefined || value === null ? emptyText : JSON.stringify(value, null, 2);
    }

    async function submitKey(event) {
      event.preventDefault();
      const provider = selectedProvider();
      if (!provider) {
        throw new Error("Select a provider first");
      }
      const formData = new FormData(elements.keyForm);
      const env = {};
      for (const envName of provider.requiredEnv) {
        env[envName] = formString(formData, "env:" + envName);
      }
      await requestJson("/ui/providers/" + encodeURIComponent(provider.id) + "/keys", {
        method: "POST",
        body: JSON.stringify({
          id: formString(formData, "id"),
          name: formString(formData, "name"),
          description: formString(formData, "description") || undefined,
          env
        })
      });
      elements.keyForm.reset();
      await loadBootstrap();
      setToast("Key saved", "Key secret values were accepted by the server and are not returned to the browser.", "success");
    }

    async function submitTemplate(event) {
      event.preventDefault();
      const provider = selectedProvider();
      if (!provider) {
        throw new Error("Select a provider first");
      }
      const formData = new FormData(elements.templateForm);
      await requestJson("/ui/providers/" + encodeURIComponent(provider.id) + "/templates", {
        method: "POST",
        body: JSON.stringify({
          id: formString(formData, "id"),
          name: formString(formData, "name"),
          version: formString(formData, "version"),
          description: formString(formData, "description") || undefined,
          variables: parseJsonTextarea(elements.templateVariables, "Variables JSON"),
          files: parseJsonTextarea(elements.templateFiles, "Files JSON")
        })
      });
      await loadBootstrap();
      setToast("Template saved", "Template files passed the server allowlist and are ready for publishing.", "success");
    }

    async function submitApi(event) {
      event.preventDefault();
      const provider = selectedProvider();
      if (!provider) {
        throw new Error("Select a provider first");
      }
      const formData = new FormData(elements.apiForm);
      const allowedActions = Array.from(elements.apiActionChecks.querySelectorAll("input:checked")).map((input) => input.value);
      if (allowedActions.length === 0) {
        throw new Error("Select at least one allowed action");
      }
      await requestJson("/ui/providers/" + encodeURIComponent(provider.id) + "/apis", {
        method: "POST",
        body: JSON.stringify({
          id: formString(formData, "id"),
          name: formString(formData, "name"),
          keyId: formString(formData, "keyId"),
          templateId: formString(formData, "templateId"),
          allowedActions
        })
      });
      await loadBootstrap();
      setToast("API published", "The runtime panel can now deploy or delete this API.", "success");
    }

    function runtimeVars() {
      const value = parseJsonTextarea(elements.runtimeVars, "Vars JSON");
      return { vars: value };
    }

    async function runtimeRequest(action) {
      const api = selectedApi();
      if (!api) {
        throw new Error("Select a published API first");
      }
      const result = await requestJson("/ui/deployments/" + encodeURIComponent(api.id) + "/" + action, {
        method: "POST",
        body: JSON.stringify(runtimeVars())
      });
      renderJson(elements.latestRunPanel, result, "No run yet.");
      elements.runIdInput.value = result.id || "";
      setToast("Run finished", action + " returned status " + result.status + ".", result.status === "succeeded" ? "success" : "error");
    }

    async function refreshStatus() {
      const api = selectedApi();
      if (!api) {
        throw new Error("Select a published API first");
      }
      const result = await requestJson("/ui/deployments/" + encodeURIComponent(api.id) + "/status");
      renderJson(elements.statusPanel, result, "No status loaded.");
      renderJson(elements.latestRunPanel, result.latestRun, "No run yet.");
      setToast("Status refreshed", "Latest run status loaded for " + api.id + ".", "success");
    }

    async function refreshOutput() {
      const api = selectedApi();
      if (!api) {
        throw new Error("Select a published API first");
      }
      const result = await requestJson("/ui/deployments/" + encodeURIComponent(api.id) + "/output");
      renderJson(elements.outputPanel, result, "No output loaded.");
      setToast("Output refreshed", "Terraform output loaded for " + api.id + ".", "success");
    }

    async function viewRun() {
      const api = selectedApi();
      const runId = elements.runIdInput.value.trim();
      if (!api || !runId) {
        throw new Error("Select an API and enter a run id");
      }
      const result = await requestJson("/ui/deployments/" + encodeURIComponent(api.id) + "/runs/" + encodeURIComponent(runId));
      renderJson(elements.runPanel, result, "No run detail loaded.");
      setToast("Run loaded", "Run detail is visible in the panel below.", "success");
    }

    function bindAsync(element, eventName, handler) {
      element.addEventListener(eventName, (event) => {
        Promise.resolve(handler(event)).catch((error) => {
          setToast("Action failed", error instanceof Error ? error.message : String(error), "error");
        });
      });
    }

    function prefillTemplate() {
      elements.templateVariables.value = JSON.stringify(sampleVariables, null, 2);
      elements.templateFiles.value = JSON.stringify({ "main.tf": sampleTemplate }, null, 2);
    }

    elements.providerSelect.addEventListener("change", () => {
      state.selectedProviderId = elements.providerSelect.value;
      renderAll();
      setToast("Provider selected", "Forms now target " + state.selectedProviderId + ".", "success");
    });
    elements.runtimeApiSelect.addEventListener("change", refreshRuntimeVars);
    bindAsync(elements.keyForm, "submit", submitKey);
    bindAsync(elements.templateForm, "submit", submitTemplate);
    bindAsync(elements.apiForm, "submit", submitApi);
    bindAsync(elements.deployButton, "click", () => runtimeRequest("deploy"));
    bindAsync(elements.deleteButton, "click", () => runtimeRequest("delete"));
    bindAsync(elements.statusButton, "click", refreshStatus);
    bindAsync(elements.outputButton, "click", refreshOutput);
    bindAsync(elements.runButton, "click", viewRun);

    prefillTemplate();
    loadBootstrap()
      .then(() => setToast("Workspace ready", "Create resources or run a deployment from this browser session.", "success"))
      .catch((error) => setToast("Bootstrap failed", error instanceof Error ? error.message : String(error), "error"));
  </script>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
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
