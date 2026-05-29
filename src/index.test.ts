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
    expect(app).toContain('shells: "page.shells"');
    expect(app).toContain('apis: "page.apis"');
    expect(app).toContain('runtime: "page.runtime"');
    expect(app).toContain("t('runtime.unlock')");
    expect(app).toContain("t('form.mainTf')");
    expect(app).toContain("t('form.inlineCommands')");
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
    expect(app).toContain("async function runtimeAction(action: DeploymentAction) {\n  await runAction(async () => {\n    const api = requireRuntimeApi();");
    expect(app).toContain("async function viewRun(runId: string) {\n  await runAction(async () => {\n    const api = requireRuntimeApi();");
    expect(app).toContain('throw new Error(t("error.allowedActionRequired"))');
    expect(app).toContain('throw new Error(t("error.selectProvider"))');
    expect(app).toContain('throw new Error(t("error.selectRuntimeApi"))');
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
    expect(app).toContain("editingShellId");
    expect(app).toContain("editingApiId");
    expect(app).not.toContain("optionalText(keyForm.id)");
    expect(app).not.toContain("optionalText(templateForm.id)");
    expect(app).not.toContain("optionalText(apiForm.id)");
    expect(app).not.toContain("t('form.resourceId')");
    expect(i18n).not.toContain("Resource ID");
    expect(i18n).not.toContain("資源 ID");
    expect(await Bun.file("web/src/types.ts").text()).toContain('files: Record<string, string>');
    expect(await Bun.file("web/src/types.ts").text()).toContain("export type ShellResource");
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

  it("exposes shell CRUD and optional API shell binding in the SPA contract", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const i18n = await Bun.file("web/src/i18n.ts").text();
    const server = await Bun.file("src/index.ts").text();

    expect(app).toContain('type PageKey = "dashboard" | "keys" | "templates" | "shells" | "apis" | "runtime"');
    expect(app).toContain("const providerShells = computed");
    expect(app).toContain("const shellExecutionHintKey = computed");
    expect(app).toContain("function openShellDialog(shell?: ShellResource)");
    expect(app).toContain("async function saveShell()");
    expect(app).toContain("/shells");
    expect(app).toContain("const shellBinding = apiForm.shellId");
    expect(app).toContain('v-model="apiForm.shellId"');
    expect(app).toContain("shellExecutionHintKey");
    expect(i18n).toContain("Shell Library");
    expect(i18n).toContain("Shell 資料庫");
    expect(i18n).toContain("dialog.shellExecutionAliyun");
    expect(i18n).toContain("alicloud_instance.user_data");
    expect(i18n).toContain("google_compute_instance.metadata_startup_script");
    expect(server).toContain('shells: await store.listShells()');
    expect(server).toContain('"/ui/providers/:providerTypeId/shells"');
    expect(server).toContain('"/api/providers/:providerTypeId/shells"');
    expect(server).toContain("const shellBindingSchema");
    expect(server).toContain("shellId: idSchema");
  });

  it("defines focused runtime history, live events, and redacted event routes", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const server = await Bun.file("src/index.ts").text();
    const storage = await Bun.file("src/storage.ts").text();

    expect(app).toContain('const runList = ref<TerraformRun[] | null>(null);');
    expect(app).toContain('const runEvents = ref<TerraformRunEvent[]>([]);');
    expect(app).toContain('const runtimeRunDialogVisible = ref(false);');
    expect(app).toContain('type DisplayRunEvent = TerraformRunEvent & { groupedEventIds: string[] };');
    expect(app).toContain('const selectedRunEventId = ref("");');
    expect(app).toContain('const runEventDisplayRows = computed<DisplayRunEvent[]>(() => {');
    expect(app).toContain('groupedEventIds: [...previous.groupedEventIds, event.id]');
    expect(app).toContain('output: `${previous.output ?? ""}${event.output ?? ""}`');
    expect(app).toContain('const selectedRunEvent = computed(');
    expect(app).toContain('selectedRunEventId.value = "";\n    return;');
    expect(app).toContain('const activeRunLoading = computed(');
    expect(app).toContain('let runtimeRequestSeq = 0;');
    expect(app).toContain('function isCurrentRuntimeRequest(seq: number, api: ApiPublication)');
    expect(app).toContain('if (!isCurrentRuntimeRequest(seq, api))');
    expect(app).toContain('const runtimeHistoryItems = computed(() => runList.value ?? []);');
    expect(app).toContain('<el-timeline v-else class="history-timeline">');
    expect(app).toContain('v-for="run in runtimeHistoryItems"');
    expect(app).toContain('@click="viewRun(run.id)"');
    expect(app).not.toContain('RuntimeHistoryTreeNode');
    expect(app).not.toContain('<el-tree');
    expect(app).not.toContain('runHistoryTree');
    expect(app).toContain('t("panel.runHistory")');
    expect(app).toContain('<el-dialog v-model="runtimeRunDialogVisible"');
    expect(app).not.toContain('v-loading="activeRunLoading"');
    expect(app).not.toContain('@row-click="selectRunEvent"');
    expect(app).toContain(':data="runEventDisplayRows"');
    expect(app).toContain('@click.stop="selectRunEvent(row)"');
    expect(app).toContain('selectedRunEvent.output');
    expect(app).toContain('openRunEventsStream(api, runId, seq);');
    expect(app).toContain('"command_output"');
    expect(app).toContain('new EventSource(`/ui/deployments/${encodedApiId}/runs/${encodedRunId}/events/stream`)');
    expect(app).toContain('`/ui/deployments/${encodeURIComponent(api.id)}/${action}/start`');
    expect(app).toContain('requestJson<TerraformRunEvent[]>(`/ui/deployments/${encodedApiId}/runs/${encodedRunId}/events`)');
    expect(app).not.toContain('async function refreshStatus()');
    expect(app).not.toContain('async function refreshOutput()');
    expect(app).not.toContain('async function refreshExamples()');
    expect(app).not.toContain('runtimeVarsJson');
    expect(app).not.toContain('runIdInput');
    expect(app).not.toContain('panel.latestRun');
    expect(app).not.toContain('panel.externalExamples');
    expect(app).not.toContain('panel.status');
    expect(app).not.toContain('panel.output');
    expect(app).not.toContain('formatJson');
    expect(app).not.toContain('<el-card shadow="never">\n                <template #header>{{ t("panel.runDetail") }}</template>');
    expect(server).toContain('"/ui/deployments/:apiId/deploy/start"');
    expect(server).toContain('"/ui/deployments/:apiId/delete/start"');
    expect(server).toContain('"/ui/deployments/:apiId/runs/:runId/events"');
    expect(server).toContain('"/api/deployments/:apiId/runs/:runId/events"');
    expect(server).toContain('"/ui/deployments/:apiId/runs/:runId/events/stream"');
    expect(server).toContain('"content-type": "text/event-stream; charset=utf-8"');
    expect(storage).toContain('events.redacted.ndjson');
  });

  it("keeps API deploy routes synchronous while adding UI async start routes", async () => {
    const server = await Bun.file("src/index.ts").text();

    expect(server).toContain('"/ui/deployments/:apiId/deploy/start"');
    expect(server).toContain('terraform.startDeploy(await store.getApi(params.apiId), body)');
    expect(server).toContain('"/ui/deployments/:apiId/delete/start"');
    expect(server).toContain('terraform.startDelete(await store.getApi(params.apiId), body)');
    expect(server).toContain('"/api/deployments/:apiId/deploy"');
    expect(server).toContain('terraform.deploy(await store.getApi(params.apiId), body)');
    expect(server).toContain('"/api/deployments/:apiId/delete"');
    expect(server).toContain('terraform.delete(await store.getApi(params.apiId), body)');
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
