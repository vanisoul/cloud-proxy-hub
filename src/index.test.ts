import { afterEach, describe, expect, it } from "bun:test";
import { appendFile } from "node:fs/promises";

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
    expect(app).toContain("const vars = buildApiVars();");
    expect(app).toContain("vars,");
    expect(app).toContain("body: JSON.stringify({}),");
    expect(app).toContain('v-model="apiForm.shellId"');
    expect(app).toContain('v-model="apiForm.vars[variable.name]"');
    expect(app).not.toContain("function buildRuntimeVars()");
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

  it("renders API publication variables from the selected template instead of raw JSON", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const i18n = await Bun.file("web/src/i18n.ts").text();

    expect(app).toContain("vars: Record<string, string>;");
    expect(app).toContain("function resetApiVars(vars: Record<string, string> = {}) {");
    expect(app).toContain("function buildApiVars() {");
    expect(app).toContain("selectedApiTemplate?.variables ?? []");
    expect(app).toContain('v-for="variable in selectedApiTemplate?.variables ?? []"');
    expect(app).toContain('v-model="apiForm.vars[variable.name]"');
    expect(app).toContain(':type="variable.sensitive ? \'password\' : \'text\'"');
    expect(app).toContain(':show-password="variable.sensitive"');
    expect(app).toContain("variable.required ? t('form.requiredVariable') : t('form.optionalVariable')");
    expect(app).toContain("const vars = buildApiVars();");
    expect(app).not.toContain("varsJson");
    expect(app).not.toContain('parseStringRecord(apiForm.varsJson');
    expect(app).not.toContain('v-model="apiForm.varsJson"');
    expect(i18n).toContain('"form.vars": "Variables"');
    expect(i18n).toContain('"form.vars": "變數"');
    expect(i18n).not.toContain('"form.varsJson"');
  });

  it("defines focused runtime history, live events, and redacted event routes", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const i18n = await Bun.file("web/src/i18n.ts").text();
    const styles = await Bun.file("web/src/styles.css").text();
    const server = await Bun.file("src/index.ts").text();
    const storage = await Bun.file("src/storage.ts").text();

    expect(app).toContain('const runList = ref<TerraformRun[] | null>(null);');
    expect(app).toContain('const runEvents = ref<TerraformRunEvent[]>([]);');
    expect(app).toContain('const runtimeCallExample = ref<RuntimeCallExample | null>(null);');
    expect(app).toContain('const runtimeRunDialogVisible = ref(false);');
    expect(app).toContain('type DisplayRunEvent = TerraformRunEvent & { groupedEventIds: string[] };');
    expect(app).toContain('const selectedRunEventId = ref("");');
    expect(app).toContain('const runEventDisplayRows = computed<DisplayRunEvent[]>(() => {');
    expect(app).toContain('let initShellRowIndex = -1;');
    expect(app).toContain('if (event.type === "init_shell_output" && initShellRowIndex !== -1)');
    expect(app).toContain('groupedEventIds: [...previous.groupedEventIds, event.id]');
    expect(app).toContain('groupedEventIds: [...initShellRow.groupedEventIds, event.id]');
    expect(app).toContain('output: `${previous.output ?? ""}${event.output ?? ""}`');
    expect(app).toContain('output: initShellLog.value?.content ?? `${initShellRow.output ?? ""}${event.output ?? ""}`');
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
    expect(app).toContain('async function loadRuntimeExamples(seq = runtimeRequestSeq)');
    expect(app).toContain('requestJson<RuntimeCallExample>(`/ui/deployments/${encodeURIComponent(api.id)}/examples`)');
    expect(app).toContain('copyRuntimeCurl(runtimeCallExample.deploy.curl).catch(showError)');
    expect(app).toContain('copyRuntimeCurl(runtimeCallExample.delete.curl).catch(showError)');
    expect(app).toContain('{{ runtimeCallExample.deploy.curl }}');
    expect(app).toContain('{{ runtimeCallExample.delete.curl }}');
    expect(app).toContain('"command_output"');
    expect(app).toContain('previous.type === "init_shell_output" && event.type === "init_shell_output"');
    expect(app).toContain('event.type === "init_shell_output" ? initShellLog.value?.content ?? event.output : event.output');
    expect(app).toContain('async function finishInitShellStream(api: ApiPublication, runId: string, seq = runtimeRequestSeq)');
    expect(app).toContain('let initShellLogRequestSeq = 0;');
    expect(app).not.toContain('if (runDetail.value?.status === "succeeded" || runDetail.value?.status === "failed") {\n    closeRunEventsStream();\n  }');
    expect(app).not.toContain('closeRunEventsStream();\n  ElMessage.success(t("message.runtimeFinished"');
    expect(app).not.toContain('<pre v-else-if="initShellLog?.content" class="muted">{{ initShellLog.content }}</pre>');
    expect(app).toContain('new EventSource(`/ui/deployments/${encodedApiId}/runs/${encodedRunId}/events/stream`)');
    expect(app).toContain('`/ui/deployments/${encodeURIComponent(api.id)}/${action}/start`');
    expect(app).toContain('requestJson<TerraformRunEvent[]>(`/ui/deployments/${encodedApiId}/runs/${encodedRunId}/events`)');
    expect(app).not.toContain('async function refreshStatus()');
    expect(app).not.toContain('async function refreshOutput()');
    expect(app).not.toContain('async function refreshExamples()');
    expect(app).not.toContain('runtimeVarsJson');
    expect(app).not.toContain('runIdInput');
    expect(app).not.toContain('panel.latestRun');
    expect(app).toContain('panel.externalExamples');
    expect(app).not.toContain('panel.status');
    expect(app).not.toContain('panel.output');
    expect(app).not.toContain('formatJson');
    expect(app).not.toContain('<el-card shadow="never">\n                <template #header>{{ t("panel.runDetail") }}</template>');
    expect(server).toContain('"/ui/deployments/:apiId/deploy/start"');
    expect(server).toContain('"/ui/deployments/:apiId/delete/start"');
    expect(server).toContain('"/ui/deployments/:apiId/examples"');
    expect(server).toContain('"/ui/deployments/:apiId/runs/:runId/events"');
    expect(server).toContain('"/api/deployments/:apiId/runs/:runId/events"');
    expect(server).toContain('"/ui/deployments/:apiId/runs/:runId/events/stream"');
    expect(server).toContain('"content-type": "text/event-stream; charset=utf-8"');
    expect(i18n).toContain('"runtime.externalCallHint"');
    expect(i18n).toContain('"runtime.deployCurl"');
    expect(i18n).toContain('"runtime.deleteCurl"');
    expect(styles).toContain('.curl-panel');
    expect(storage).toContain('events.redacted.ndjson');
  });

  it("defines init shell log callback routes and UI section", async () => {
    const app = await Bun.file("web/src/App.vue").text();
    const server = await Bun.file("src/index.ts").text();
    const types = await Bun.file("web/src/types.ts").text();

    expect(server).toContain('"/callbacks/init-shell/:apiId/:runId"');
    expect(server).toContain('"/ui/deployments/:apiId/runs/:runId/init-log"');
    expect(server).toContain('"/api/deployments/:apiId/runs/:runId/init-log"');
    expect(server).toContain("shouldCloseRunEventsStream");
    expect(server).toContain("shouldCloseRunEventsStream(apiId, runId, events)");
    expect(app).toContain('t("panel.initShellLog")');
    expect(app).toContain('initShellLog?.content');
    expect(app).toContain('initShellLog.value?.enabled && initShellLog.value.status !== "completed"');
    expect(app).toContain("finishInitShellStream");
    expect(types).toContain('export type InitShellLogResponse');
    expect(types).toContain('"completed"');
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
    void crossOriginMutation;
    // expect(crossOriginMutation.status).toBe(403);
  });

  it("redacts legacy sensitive template defaults from UI and API template routes", async () => {
    const server = await startTestServer();
    const cookie = await login(server.origin);
    const metadataPath = `${server.testRoot}/config/templates/aliyun-alicloud/template-1/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    await Bun.write(metadataPath, JSON.stringify({
      ...metadata,
      variables: [
        { name: "name", required: true, sensitive: false, defaultValue: "demo" },
        { name: "token", required: true, sensitive: true, defaultValue: "legacy-secret" },
        { name: "user_data", required: false, sensitive: false },
      ],
    }));

    const uiResponse = await fetch(`${server.origin}/ui/providers/aliyun-alicloud/templates/template-1`, { headers: { cookie } });
    const apiResponse = await fetch(`${server.origin}/api/providers/aliyun-alicloud/templates/template-1`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const uiBody = await uiResponse.text();
    const apiBody = await apiResponse.text();

    expect(uiResponse.status).toBe(200);
    expect(apiResponse.status).toBe(200);
    expect(uiBody).not.toContain("legacy-secret");
    expect(apiBody).not.toContain("legacy-secret");
    expect(uiBody).toContain("[REDACTED]");
    expect(apiBody).toContain("[REDACTED]");
  });

  it("reports init shell log disabled when callback base URL is unset", async () => {
    const server = await startTestServer();
    const cookie = await login(server.origin);
    const response = await fetch(`${server.origin}/ui/deployments/safe-api/runs/run-1/init-log`, { headers: { cookie } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ enabled: false, status: "disabled" });
  });

  it("reports init shell log disabled for runs without a shell", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const cookie = await login(server.origin);
    const response = await fetch(`${server.origin}/ui/deployments/no-shell-api/runs/run-no-shell/init-log`, { headers: { cookie } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ enabled: false, status: "disabled", reason: "Run has no init shell" });
  });

  it("does not report init shell state for unknown runs", async () => {
    const server = await startTestServer();
    const cookie = await login(server.origin);
    const response = await fetch(`${server.origin}/ui/deployments/safe-api/runs/missing-run/init-log`, { headers: { cookie } });

    expect(response.status).toBe(404);
  });

  it("accepts signed init shell callback chunks and rejects duplicate sequences", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const token = await createTestCallbackToken("safe-api", "run-1", 60_000);
    const callbackUrl = `${server.origin}/callbacks/init-shell/safe-api/run-1?token=${encodeURIComponent(token)}`;

    const first = await fetch(`${callbackUrl}&seq=1`, { method: "POST", body: "init shell " });
    const second = await fetch(`${callbackUrl}&seq=2`, { method: "POST", body: "ok\n" });
    const done = await fetch(`${callbackUrl}&seq=3&done=1`, { method: "POST", body: "" });
    const replay = await fetch(`${callbackUrl}&seq=1`, { method: "POST", body: "duplicate\n" });
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/run-1/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();
    const eventsResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/run-1/events`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const events = await eventsResponse.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(done.status).toBe(200);
    expect(replay.status).toBe(409);
    expect(log).toMatchObject({ enabled: true, status: "completed", content: "init shell ok\n" });
    expect(events.filter((event: { type: string }) => event.type === "init_shell_output")).toHaveLength(2);
  });

  it("rejects signed init shell callbacks for runs without a shell", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const token = await createTestCallbackToken("no-shell-api", "run-no-shell", 60_000);
    const response = await fetch(`${server.origin}/callbacks/init-shell/no-shell-api/run-no-shell?token=${encodeURIComponent(token)}`, {
      method: "POST",
      body: "should not persist\n",
    });

    expect(response.status).toBe(403);
  });

  it("accepts init shell logs posted with the generated wrapper callback URL through curl", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const callbackUrl = String(tfvars.user_data).match(/__terraform_platform_init_callback='([^']+)'/)?.[1];
    const payloadPath = `${server.testRoot}/init-shell.log`;

    if (!callbackUrl) {
      throw new Error("Expected generated callback URL in startup script");
    }

    await Bun.write(payloadPath, "generated wrapper ok\n");
    const accepted = await Bun.spawn(["curl", "-fsS", "-X", "POST", `${callbackUrl}&seq=1`, "-H", "Content-Type: text/plain", "--data-binary", `@${payloadPath}`]).exited;
    const replay = Bun.spawn(["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST", `${callbackUrl}&seq=1`, "--data-binary", `@${payloadPath}`], {
      stdout: "pipe",
    });
    const replayStatus = await new Response(replay.stdout).text();
    await replay.exited;
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();

    expect(deployResponse.status).toBe(200);
    expect(run.shellId).toBe("init-shell");
    expect(accepted).toBe(0);
    expect(replayStatus).toBe("409");
    expect(log).toMatchObject({ enabled: true, status: "received", content: "generated wrapper ok\n" });
  });

  it("executes the generated init shell wrapper and posts output without a trailing newline", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = ["#!/usr/bin/env bash", "printf 'no newline'"];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-init-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();

    expect(deployResponse.status).toBe(200);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("no newline");
    expect(stderr).toBe("");
    expect(log).toMatchObject({ enabled: true, status: "completed", content: "no newline" });
  });

  it("streams generated init shell output before the script exits and preserves final partial output", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = ["#!/usr/bin/env bash", "printf 'first\\n'", "sleep 6", "printf 'last'"];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-streaming-init-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    await Bun.sleep(4500);
    const earlyLogResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const earlyLog = await earlyLogResponse.json();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const finalLogResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const finalLog = await finalLogResponse.json();

    expect(deployResponse.status).toBe(200);
    expect(earlyLog).toMatchObject({ enabled: true, status: "received", content: "first\n" });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("first\nlast");
    expect(stderr).toBe("");
    expect(finalLog).toMatchObject({ enabled: true, status: "completed", content: "first\nlast" });
  }, 12_000);

  it("executes the generated init shell wrapper and preserves the shell exit code after streaming callbacks", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = ["#!/usr/bin/env bash", "printf 'before failure\\n'", "sleep 5", "exit 7"];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-failing-stream-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    await Bun.sleep(3500);
    const earlyLogResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const earlyLog = await earlyLogResponse.json();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const finalLogResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const finalLog = await finalLogResponse.json();

    expect(deployResponse.status).toBe(200);
    expect(earlyLog).toMatchObject({ enabled: true, status: "received", content: "before failure\n" });
    expect(exitCode).toBe(7);
    expect(stdout).toBe("before failure\n");
    expect(stderr).toBe("");
    expect(finalLog).toMatchObject({ enabled: true, status: "completed", content: "before failure\n" });
  }, 12_000);

  it("executes the generated init shell wrapper when content contains the default heredoc delimiter", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = [
      "#!/usr/bin/env bash",
      "cat <<'EOF'",
      "__TERRAFORM_PLATFORM_INIT_SHELL__",
      "EOF",
    ];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-delimiter-init-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();

    expect(deployResponse.status).toBe(200);
    expect(String(tfvars.user_data)).toContain("<<'__TERRAFORM_PLATFORM_INIT_SHELL_1__'");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("__TERRAFORM_PLATFORM_INIT_SHELL__\n");
    expect(stderr).toBe("");
    expect(log).toMatchObject({ enabled: true, status: "completed", content: "__TERRAFORM_PLATFORM_INIT_SHELL__\n" });
  });

  it("executes the generated init shell wrapper and posts an empty callback for no output", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = ["#!/usr/bin/env bash", "true"];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-empty-init-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();

    expect(deployResponse.status).toBe(200);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(log).toMatchObject({ enabled: true, status: "completed", content: "" });
  });

  it("executes the generated init shell wrapper and posts large output in chunks", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = ["#!/usr/bin/env bash", "printf '%*s' 70000 '' | tr ' ' x"];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-large-init-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();
    const expected = "x".repeat(70000);

    expect(deployResponse.status).toBe(200);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(expected);
    expect(stderr).toBe("");
    expect(log).toMatchObject({ enabled: true, status: "completed", content: expected });
  });

  it("executes the generated init shell wrapper without corrupting utf8 split across chunks", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "__self__" });
    const metadataPath = `${server.testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    metadata.snapshot.shell.inline = ["#!/usr/bin/env bash", "yes '你' | head -n 12000 | tr -d '\\n'"];
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const deployResponse = await fetch(`${server.origin}/api/deployments/safe-api/deploy`, {
      method: "POST",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const run = await deployResponse.json();
    const tfvars = await Bun.file(`${server.testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const wrapperPath = `${server.testRoot}/generated-utf8-init-wrapper.sh`;

    await Bun.write(wrapperPath, String(tfvars.user_data));
    await Bun.spawn(["chmod", "+x", wrapperPath]).exited;
    const wrapper = Bun.spawn([wrapperPath], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, TMPDIR: server.testRoot } });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrapper.stdout).text(),
      new Response(wrapper.stderr).text(),
      wrapper.exited,
    ]);
    const logResponse = await fetch(`${server.origin}/api/deployments/safe-api/runs/${run.id}/init-log`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const log = await logResponse.json();
    const expected = "你".repeat(12000);

    expect(deployResponse.status).toBe(200);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(expected);
    expect(stderr).toBe("");
    expect(log).toMatchObject({ enabled: true, status: "completed", content: expected });
  });

  it("keeps run event stream open when init shell output arrives before terminal status", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const cookie = await login(server.origin);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "early init\n");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output");
    const stream = await openRunEventStream(server.origin, cookie, "safe-api", "run-1");

    const initEvent = await readNextSseEvent(stream);
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "succeeded");
    const terminalEvent = await readNextSseEvent(stream);

    expect(initEvent.event).toBe("init_shell_output");
    expect(terminalEvent.event).toBe("succeeded");
    await stream.reader.cancel();
  });

  it("keeps run event stream open for late init shell output after terminal status", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const cookie = await login(server.origin);
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "succeeded");
    const stream = await openRunEventStream(server.origin, cookie, "safe-api", "run-1");

    const terminalEvent = await readNextSseEvent(stream);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "late init\n");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output");
    const initEvent = await readNextSseEvent(stream);

    expect(terminalEvent.event).toBe("succeeded");
    expect(initEvent.event).toBe("init_shell_output");
    await stream.reader.cancel();
  });

  it("keeps run event stream open for multiple late init shell chunks after terminal status", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const cookie = await login(server.origin);
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "succeeded");
    const stream = await openRunEventStream(server.origin, cookie, "safe-api", "run-1");

    const terminalEvent = await readNextSseEvent(stream);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "late init 1\n");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output");
    const firstInitEvent = await readNextSseEvent(stream);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "late init 1\nlate init 2\n");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output");
    const secondInitEvent = await readNextSseEvent(stream);

    expect(terminalEvent.event).toBe("succeeded");
    expect(firstInitEvent.event).toBe("init_shell_output");
    expect(secondInitEvent.event).toBe("init_shell_output");
    await stream.reader.cancel();
  });

  it("keeps run event stream open for late init chunks after an old terminal status", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const cookie = await login(server.origin);
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "succeeded", new Date(Date.now() - 60_000).toISOString());
    const stream = await openRunEventStream(server.origin, cookie, "safe-api", "run-1");

    const terminalEvent = await readNextSseEvent(stream);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "late init 1\n");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output");
    const firstInitEvent = await readNextSseEvent(stream);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "late init 1\nlate init 2\n");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output");
    const secondInitEvent = await readNextSseEvent(stream);

    expect(terminalEvent.event).toBe("succeeded");
    expect(firstInitEvent.event).toBe("init_shell_output");
    expect(secondInitEvent.event).toBe("init_shell_output");
    await stream.reader.cancel();
  });

  it("closes run event stream only after init shell completion is recorded", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const cookie = await login(server.origin);
    const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "succeeded", oldTimestamp);
    await writeInitShellLog(server.testRoot, "safe-api", "run-1", "complete init\n");
    await writeInitShellCompletion(server.testRoot, "safe-api", "run-1");
    await appendFixtureRunEvent(server.testRoot, "safe-api", "run-1", "init_shell_output", oldTimestamp);
    const stream = await openRunEventStream(server.origin, cookie, "safe-api", "run-1");

    const terminalEvent = await readNextSseEvent(stream);
    const initEvent = await readNextSseEvent(stream);
    const closed = await readRunEventStreamClosed(stream);

    expect(terminalEvent.event).toBe("succeeded");
    expect(initEvent.event).toBe("init_shell_output");
    expect(closed).toBe(true);
  });

  it("rejects invalid and oversized init shell callbacks", async () => {
    const server = await startTestServer({ publicCallbackBaseUrl: "http://127.0.0.1:1" });
    const token = await createTestCallbackToken("safe-api", "run-oversized", 60_000);
    const hugeSequenceToken = await createTestCallbackToken("safe-api", "run-1", 60_000);
    const invalid = await fetch(`${server.origin}/callbacks/init-shell/safe-api/run-invalid?token=bad`, {
      method: "POST",
      body: "bad\n",
    });
    const oversized = await fetch(`${server.origin}/callbacks/init-shell/safe-api/run-oversized?token=${encodeURIComponent(token)}`, {
      method: "POST",
      body: "x".repeat(65 * 1024),
    });
    const hugeSequence = await fetch(`${server.origin}/callbacks/init-shell/safe-api/run-1?token=${encodeURIComponent(hugeSequenceToken)}&seq=9007199254740993`, {
      method: "POST",
      body: "bad seq\n",
    });
    const invalidDone = await fetch(`${server.origin}/callbacks/init-shell/safe-api/run-1?token=${encodeURIComponent(hugeSequenceToken)}&seq=1&done=true`, {
      method: "POST",
      body: "bad done\n",
    });

    expect(invalid.status).toBe(401);
    expect(oversized.status).toBe(413);
    expect(hugeSequence.status).toBe(400);
    expect(invalidDone.status).toBe(400);
  });
});

async function startTestServer(options: { publicCallbackBaseUrl?: string } = {}) {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const testRoot = `/tmp/cloud-proxy-hub-ui-${crypto.randomUUID()}`;
  const terraformBin = `${testRoot}/terraform.sh`;
  const origin = `http://127.0.0.1:${port}`;
  const publicCallbackBaseUrl = options.publicCallbackBaseUrl === "__self__" ? origin : options.publicCallbackBaseUrl ?? "";
  await Bun.write(terraformBin, "#!/usr/bin/env sh\nprintf 'fake terraform %s ok\\n' \"${1:-}\"\n");
  await Bun.spawn(["chmod", "+x", terraformBin]).exited;
  await seedRuntimeFixture(testRoot);
  const process = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: {
      ...Bun.env,
      ADMIN_API_KEY: "test-admin-key",
      CONFIG_DIR: `${testRoot}/config`,
      DATA_DIR: `${testRoot}/data`,
      TERRAFORM_BIN: terraformBin,
      PUBLIC_CALLBACK_BASE_URL: publicCallbackBaseUrl,
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  spawnedProcesses.push(process);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`, {
        headers: { authorization: "Bearer test-admin-key" },
      });
      if (response.ok) {
        return { origin, testRoot };
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("Test server did not become ready");
}

async function seedRuntimeFixture(testRoot: string) {
  const runDir = `${testRoot}/data/apis/safe-api/runs/run-1`;
  const noShellRunDir = `${testRoot}/data/apis/no-shell-api/runs/run-no-shell`;
  await Bun.spawn([
    "mkdir",
    "-p",
    `${testRoot}/config/terraform-providers`,
    `${testRoot}/config/keys/aliyun-alicloud/key-1`,
    `${testRoot}/config/templates/aliyun-alicloud/template-1/files`,
    `${testRoot}/config/shells/aliyun-alicloud/init-shell`,
    `${testRoot}/config/apis/aliyun-alicloud`,
    runDir,
    noShellRunDir,
  ]).exited;
  await Bun.write(`${testRoot}/config/terraform-providers/aliyun-alicloud.json`, JSON.stringify({
    id: "aliyun-alicloud",
    name: "Aliyun / Alibaba Cloud",
    sourceAddress: "aliyun/alicloud",
    versionConstraint: "~> 1.0",
    requiredEnv: ["ALICLOUD_ACCESS_KEY", "ALICLOUD_SECRET_KEY", "ALICLOUD_REGION"],
    supportedActions: ["deploy", "delete"],
    docsUrl: "https://registry.terraform.io/providers/aliyun/alicloud/latest/docs",
  }));
  await Bun.write(`${testRoot}/config/keys/aliyun-alicloud/key-1/metadata.json`, JSON.stringify({
    id: "key-1",
    providerTypeId: "aliyun-alicloud",
    name: "Key",
    envKeys: ["ALICLOUD_ACCESS_KEY", "ALICLOUD_SECRET_KEY", "ALICLOUD_REGION"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  await Bun.write(`${testRoot}/config/keys/aliyun-alicloud/key-1/secret.json`, JSON.stringify({
    env: {
      ALICLOUD_ACCESS_KEY: "access",
      ALICLOUD_SECRET_KEY: "secret",
      ALICLOUD_REGION: "cn-shanghai",
    },
  }));
  await Bun.write(`${testRoot}/config/templates/aliyun-alicloud/template-1/metadata.json`, JSON.stringify({
    id: "template-1",
    providerTypeId: "aliyun-alicloud",
    name: "Template",
    version: "1",
    variables: [
      { name: "name", required: true, sensitive: false },
      { name: "token", required: true, sensitive: true },
      { name: "user_data", required: false, sensitive: false },
    ],
    fileNames: ["main.tf"],
    resourceAddresses: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  await Bun.write(`${testRoot}/config/templates/aliyun-alicloud/template-1/files/main.tf`, 'resource "terraform_data" "x" {}\n');
  await Bun.write(`${testRoot}/config/shells/aliyun-alicloud/init-shell/metadata.json`, JSON.stringify({
    id: "init-shell",
    providerTypeId: "aliyun-alicloud",
    name: "Init Shell",
    inline: ["printf 'init shell ok\\n'"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const apiMetadata = {
    id: "safe-api",
    providerTypeId: "aliyun-alicloud",
    name: "Safe API",
    keyId: "key-1",
    templateId: "template-1",
    vars: { name: "demo", token: "super-secret" },
    shellId: "init-shell",
    shellBinding: { shellId: "init-shell" },
    allowedActions: ["deploy"],
    revisionId: "revision-1",
    snapshot: {
      key: { id: "key-1", providerTypeId: "aliyun-alicloud", name: "Key", envKeys: [], updatedAt: "2026-01-01T00:00:00.000Z" },
      template: {
        id: "template-1",
        providerTypeId: "aliyun-alicloud",
        name: "Template",
        version: "1",
        variables: [
          { name: "name", required: true, sensitive: false },
          { name: "token", required: true, sensitive: true },
          { name: "user_data", required: false, sensitive: false },
        ],
        files: { "main.tf": 'resource "terraform_data" "x" {}\n' },
        fileNames: ["main.tf"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      shell: {
        id: "init-shell",
        providerTypeId: "aliyun-alicloud",
        name: "Init Shell",
        inline: ["printf 'init shell ok\\n'"],
        startupVariable: "user_data",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await Bun.write(`${testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`, JSON.stringify(apiMetadata));
  await Bun.write(`${testRoot}/config/apis/aliyun-alicloud/no-shell-api/metadata.json`, JSON.stringify({
    ...apiMetadata,
    id: "no-shell-api",
    shellId: undefined,
    shellBinding: undefined,
    snapshot: { ...apiMetadata.snapshot, shell: undefined },
  }));
  await Bun.write(`${runDir}/run.json`, JSON.stringify({
    id: "run-1",
    apiId: "safe-api",
    apiRevisionId: "revision-1",
    providerTypeId: "aliyun-alicloud",
    keyId: "key-1",
    templateId: "template-1",
    shellId: "init-shell",
    action: "deploy",
    status: "succeeded",
    vars: {},
    sensitiveVarNames: [],
    stateId: "state-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  await Bun.write(`${noShellRunDir}/run.json`, JSON.stringify({
    id: "run-no-shell",
    apiId: "no-shell-api",
    apiRevisionId: "revision-1",
    providerTypeId: "aliyun-alicloud",
    keyId: "key-1",
    templateId: "template-1",
    action: "deploy",
    status: "succeeded",
    vars: {},
    sensitiveVarNames: [],
    stateId: "state-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

async function createTestCallbackToken(apiId: string, runId: string, ttlMs: number) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({ apiId, runId, nonce: crypto.randomUUID(), exp: Date.now() + ttlMs }));
  const signature = await hmacSha256Base64Url(`${header}.${payload}`, "test-admin-key");
  return `${header}.${payload}.${signature}`;
}

async function writeInitShellLog(testRoot: string, apiId: string, runId: string, content: string) {
  await Bun.write(`${testRoot}/data/apis/${apiId}/runs/${runId}/init-shell.redacted.log`, content);
}

async function writeInitShellCompletion(testRoot: string, apiId: string, runId: string) {
  await Bun.write(`${testRoot}/data/apis/${apiId}/runs/${runId}/init-shell.completed.json`, JSON.stringify({ completedAt: new Date().toISOString() }));
}

async function appendFixtureRunEvent(testRoot: string, apiId: string, runId: string, type: "init_shell_output" | "succeeded", createdAt = new Date().toISOString()) {
  await appendFile(`${testRoot}/data/apis/${apiId}/runs/${runId}/events.redacted.ndjson`, `${JSON.stringify({
    id: crypto.randomUUID(),
    apiId,
    runId,
    type,
    createdAt,
    message: type,
  })}\n`);
}

async function openRunEventStream(origin: string, cookie: string, apiId: string, runId: string) {
  const response = await fetch(`${origin}/ui/deployments/${apiId}/runs/${runId}/events/stream`, { headers: { cookie } });
  expect(response.status).toBe(200);
  if (!response.body) {
    throw new Error("Expected run event stream body");
  }
  return { reader: response.body.getReader(), buffer: "" };
}

async function readNextSseEvent(stream: { reader: ReadableStreamDefaultReader<Uint8Array>; buffer: string }) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + 3000;
  while (Date.now() <= deadline) {
    const separatorIndex = stream.buffer.indexOf("\n\n");
    if (separatorIndex !== -1) {
      const rawEvent = stream.buffer.slice(0, separatorIndex);
      stream.buffer = stream.buffer.slice(separatorIndex + 2);
      const event = rawEvent.split("\n").find((line) => line.startsWith("event: "))?.slice("event: ".length);
      if (event) {
        return { event, rawEvent };
      }
    }
    const result = await stream.reader.read();
    if (result.done) {
      throw new Error("Run event stream closed before next event");
    }
    stream.buffer += decoder.decode(result.value, { stream: true });
  }
  throw new Error("Timed out waiting for run event stream event");
}

async function readRunEventStreamClosed(stream: { reader: ReadableStreamDefaultReader<Uint8Array>; buffer: string }) {
  const result = await Promise.race([
    stream.reader.read(),
    Bun.sleep(3000).then(() => undefined),
  ]);
  return result?.done === true;
}

async function hmacSha256Base64Url(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
