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

const credentialSchema = t.Object({
  id: idSchema,
  providerTypeId: idSchema,
  name: t.String({ minLength: 1 }),
  env: stringRecord,
  allowedWorkspaceIds: t.Array(idSchema),
});

const providerInstanceSchema = t.Object({
  id: idSchema,
  providerTypeId: idSchema,
  credentialId: idSchema,
  name: t.String({ minLength: 1 }),
  defaults: stringRecord,
});

const workspaceSchema = t.Object({
  id: idSchema,
  name: t.String({ minLength: 1 }),
  allowedTemplateIds: t.Array(idSchema),
  currentStateId: t.Optional(idSchema),
});

const templateSchema = t.Object({
  id: idSchema,
  name: t.String({ minLength: 1 }),
  providerTypeId: idSchema,
  version: t.String({ minLength: 1 }),
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
  workspaceId: idSchema,
  templateId: idSchema,
  providerInstanceId: idSchema,
  allowedActions: t.Array(t.Union([t.Literal("plan"), t.Literal("apply"), t.Literal("destroy"), t.Literal("refresh")])),
});

const runSchema = t.Object({
  action: t.Union([t.Literal("plan"), t.Literal("apply"), t.Literal("destroy"), t.Literal("refresh")]),
  vars: stringRecord,
});

const app = new Elysia()
  .onBeforeHandle(({ headers, path, request }) => {
    if (path === "/" || path.startsWith("/assets")) {
      return;
    }

    const providedKey = headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (providedKey !== appConfig.apiKey) {
      logger.warn("拒絕未授權請求", { path, method: request.method });
      return new Response("Unauthorized", { status: 401 });
    }
  })
  .onError(({ error, code }) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("請求處理失敗", { code, error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: code === "VALIDATION" || isClientInputError(message) ? 400 : 500,
      headers: { "content-type": "application/json" },
    });
  })
  .get("/", () => adminPage(), { detail: { summary: "Admin UI" } })
  .get("/health", () => ({ ok: true, service: "terraform-platform" }))
  .get("/api/provider-types", async () => store.listProviderTypes())
  .get("/api/credentials", async () => store.listCredentials())
  .post("/api/credentials", async ({ body }) => store.saveCredential(body), { body: credentialSchema })
  .get("/api/provider-instances", async () => store.listProviderInstances())
  .post("/api/provider-instances", async ({ body }) => store.saveProviderInstance(body), {
    body: providerInstanceSchema,
  })
  .post("/api/provider-instances/:id/test", async ({ params }) => terraform.testProviderInstance(params.id), {
    params: t.Object({ id: idSchema }),
  })
  .get("/api/workspaces", async () => store.listWorkspaces())
  .post("/api/workspaces", async ({ body }) => store.saveWorkspace(body), { body: workspaceSchema })
  .get("/api/templates", async () => store.listTemplates())
  .post("/api/templates", async ({ body }) => store.saveTemplate(body), { body: templateSchema })
  .get("/api/apis", async () => store.listApis())
  .post("/api/apis", async ({ body }) => store.saveApi(body), { body: apiSchema })
  .post("/api/apis/:id/runs", async ({ params, body }) => terraform.createRun(await store.getApi(params.id), body), {
    params: t.Object({ id: idSchema }),
    body: runSchema,
  })
  .get("/api/apis/:apiId/runs/:runId", async ({ params }) => store.getRun(params.apiId, params.runId), {
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
    <p>Admin-only config-driven Terraform 管理工具。設定存在 <code>/config</code>，執行狀態存在 <code>/data</code>。</p>
    <div class="grid">
      <section><h2>1. Provider</h2><p>建立 credential、provider instance，並用 test endpoint 檢查必要環境變數。</p></section>
      <section><h2>2. Template</h2><p>新增受 allowlist 限制的 Terraform template；禁止 backend、provisioner、local-exec。</p></section>
      <section><h2>3. Publish API</h2><p>把 workspace、template、provider instance 綁成可呼叫 API。</p></section>
      <section><h2>4. Run</h2><p>呼叫 API 建立 run，系統會產生 workspace、執行 init/validate/plan 並保存 artifact。</p></section>
    </div>
    <section>
      <h2>API quick links</h2>
      <pre>GET  /api/provider-types
POST /api/credentials
POST /api/provider-instances
POST /api/provider-instances/:id/test
POST /api/workspaces
POST /api/templates
POST /api/apis
POST /api/apis/:id/runs
GET  /api/apis/:apiId/runs/:runId</pre>
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
    message.startsWith("Variable ")
  );
}

export type App = typeof app;
