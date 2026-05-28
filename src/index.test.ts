import { afterEach, describe, expect, it } from "bun:test";

const spawnedProcesses: Bun.Subprocess[] = [];

afterEach(async () => {
  while (spawnedProcesses.length > 0) {
    const process = spawnedProcesses.pop();
    if (!process) {
      continue;
    }
    process.kill();
    await process.exited.catch(() => undefined);
  }
});

describe("Admin SPA contract", () => {
  it("keeps the backend login page and replaces the inline admin page with SPA serving", async () => {
    const source = await Bun.file("src/index.ts").text();

    expect(source).toContain("Terraform Platform Login");
    expect(source).toContain("serveSpaIndex");
    expect(source).toContain("serveSpaAsset");
    expect(source).not.toContain("function adminPage()");
  });

  it("defines the Vite Vue Element Plus admin shell and workbenches", async () => {
    const html = await Bun.file("web/index.html").text();
    const app = await Bun.file("web/src/App.vue").text();
    const main = await Bun.file("web/src/main.ts").text();
    const i18n = await Bun.file("web/src/i18n.ts").text();

    expect(html).toContain('<div id="app"></div>');
    expect(main).toContain('import ElementPlus from "element-plus"');
    expect(app).toContain('dashboard: "page.dashboard"');
    expect(app).toContain('keys: "page.keys"');
    expect(app).toContain('templates: "page.templates"');
    expect(app).toContain('apis: "page.apis"');
    expect(app).toContain('runtime: "page.runtime"');
    expect(app).toContain("t('runtime.unlock')");
    expect(app).toContain("t('form.mainTf')");
    expect(app).toContain("mainTf");
    expect(i18n).toContain("Operations Dashboard");
    expect(i18n).toContain("憑證設定檔");
  });

  it("adds dependency-free SPA i18n and Element Plus locale switching", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const i18n = await Bun.file("web/src/i18n.ts").text();

    expect(i18n).toContain("export type LocaleKey");
    expect(i18n).toContain("localeOptions");
    expect(i18n).toContain('key: "en"');
    expect(i18n).toContain('key: "zh-Hant"');
    expect(i18n).toContain('element-plus/es/locale/lang/en');
    expect(i18n).toContain('element-plus/es/locale/lang/zh-tw');
    expect(i18n).toContain("elementPlusLocales");
    expect(i18n).toContain("localeStorageKey");
    expect(i18n).toContain("function normalizeLocale");
    expect(i18n).toContain("function loadSavedLocale");
    expect(i18n).toContain("function saveLocale");
    expect(app).toContain('<el-config-provider :locale="elementLocale">');
    expect(app).toContain('v-model="selectedLocale"');
    expect(app).toContain('class="language-selector"');
    expect(app).toContain("localeOptions");
    expect(app).toContain("loadSavedLocale()");
    expect(app).toContain("saveLocale(locale)");
  });

  it("guards SPA operation validation errors behind localized Element Plus messages", async () => {
    const app = await Bun.file("web/src/App.vue").text();

    expect(app).toContain("async function saveKey() {\n  await runAction(async () => {\n    const provider = requireProvider();");
    expect(app).toContain("async function refreshStatus() {\n  await runAction(async () => {\n    const api = requireRuntimeApi();");
    expect(app).toContain("async function refreshOutput() {\n  await runAction(async () => {\n    const api = requireRuntimeApi();");
    expect(app).toContain("async function refreshRuns(showMessage = true) {\n  await runAction(async () => {\n    const api = requireRuntimeApi();");
    expect(app).toContain("async function viewRun() {\n  await runAction(async () => {\n    const api = requireRuntimeApi();");
    expect(app).toContain('throw new Error(t("error.allowedActionRequired"))');
    expect(app).toContain('throw new Error(t("error.runIdRequired"))');
    expect(app).toContain('throw new Error(t("error.selectProvider"))');
    expect(app).toContain('throw new Error(t("error.selectRuntimeApi"))');
    expect(app).toContain('parseStringRecord(runtimeVarsJson.value, t("form.varsJson"))');
    expect(app).toContain('return JSON.parse(text);');
    expect(app).toContain('throw new Error(t("error.invalidJson", { label }));');
    expect(app).toContain("const confirmed = await confirmDelete(item.name);");
    expect(app).toContain("} catch (error) {");
    expect(app).toContain("ElMessage.error(error instanceof Error ? error.message : String(error));");
  });

  it("uses backend-generated resource ids and preserves full template file editing in the SPA", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const i18n = await Bun.file("web/src/i18n.ts").text();

    expect(app).toContain("editingKeyId");
    expect(app).toContain("editingTemplateId");
    expect(app).toContain("editingApiId");
    expect(app).not.toContain("optionalText(keyForm.id)");
    expect(app).not.toContain("optionalText(templateForm.id)");
    expect(app).not.toContain("optionalText(apiForm.id)");
    expect(app).not.toContain("t('form.resourceId')");
    expect(i18n).not.toContain("Resource ID");
    expect(i18n).not.toContain("資源 ID");
    expect(await Bun.file("web/src/types.ts").text()).toContain('files: Record<string, string>');
    expect(app).toContain('fullTemplate.files');
    expect(app).toContain('templateFiles.value = fullTemplate.files');
    expect(app).toContain('const files = { ...templateFiles.value, "main.tf": templateForm.mainTf };');
    expect(app).not.toContain('filesJson');
  });

  it("uses only same-origin UI calls from the browser client", async () => {
    const apiClient = await Bun.file("web/src/api.ts").text();
    const webSource = `${apiClient}
${await Bun.file("web/src/App.vue").text()}`;

    expect(apiClient).toContain('credentials: "same-origin"');
    expect(webSource).toContain("/ui/bootstrap");
    expect(webSource).toContain("/ui/providers/");
    expect(webSource).toContain("/ui/deployments/");
    expect(webSource).not.toContain("ADMIN_API_KEY");
    expect(webSource).not.toContain("authorization");
  });

  it("redirects unauthenticated root requests to login", async () => {
    const server = await startTestServer();
    const response = await fetch(server.origin, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("serves the built SPA shell and hashed assets after login while keeping login text", async () => {
    const server = await startTestServer();
    const loginPage = await fetch(`${server.origin}/login`);
    const cookie = await login(server.origin);
    const response = await fetch(server.origin, { headers: { cookie } });
    const html = await response.text();
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];

    expect(await loginPage.text()).toContain("Terraform Platform Login");
    expect(response.status).toBe(200);
    expect(html).toContain('<div id="app"></div>');
    expect(html).toContain('/assets/');
    expect(assetPath).toBeString();

    if (!assetPath) {
      throw new Error("Expected built JS asset path");
    }

    const assetResponse = await fetch(`${server.origin}${assetPath}`);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
  });

  it("preserves backend route auth guarantees for UI and API routes", async () => {
    const server = await startTestServer();
    const cookie = await login(server.origin);

    const unauthorizedApi = await fetch(`${server.origin}/api/provider-types`);
    const authorizedApi = await fetch(`${server.origin}/api/provider-types`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const uiBootstrap = await fetch(`${server.origin}/ui/bootstrap`, { headers: { cookie } });
    const crossOriginMutation = await fetch(`${server.origin}/ui/providers/aliyun-alicloud/keys`, {
      method: "POST",
      headers: { cookie, origin: "https://example.invalid", "content-type": "application/json" },
      body: JSON.stringify({ name: "blocked", env: {} }),
    });

    expect(unauthorizedApi.status).toBe(401);
    expect(authorizedApi.status).toBe(200);
    expect(uiBootstrap.status).toBe(200);
    expect(crossOriginMutation.status).toBe(403);
  });
});

async function startTestServer() {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const testRoot = `/tmp/cloud-proxy-hub-ui-${crypto.randomUUID()}`;
  const process = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: {
      ...Bun.env,
      ADMIN_API_KEY: "test-admin-key",
      CONFIG_DIR: `${testRoot}/config`,
      DATA_DIR: `${testRoot}/data`,
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  spawnedProcesses.push(process);
  const origin = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`, {
        headers: { authorization: "Bearer test-admin-key" },
      });
      if (response.ok) {
        return { origin };
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("Test server did not become ready");
}

async function login(origin: string) {
  const response = await fetch(`${origin}/login`, {
    method: "POST",
    body: new URLSearchParams({ adminKey: "test-admin-key" }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie");

  expect(response.status).toBe(303);
  expect(cookie).toContain("terraform_platform_session=");

  if (!cookie) {
    throw new Error("Expected login cookie");
  }

  return cookie;
}
