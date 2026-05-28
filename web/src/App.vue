<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import { requestJson } from "./api";
import type {
  ApiPublication,
  BootstrapResponse,
  DeploymentAction,
  ProviderType,
  PublicProviderKey,
  PublicTerraformTemplate,
  RuntimeCallExample,
  TerraformRun,
  TerraformTemplate,
  TemplateVariable,
} from "./types";

type PageKey = "dashboard" | "keys" | "templates" | "apis" | "runtime";
type ResourceKind = "key" | "template" | "api";

type KeyForm = {
  id: string;
  name: string;
  description: string;
  env: Record<string, string>;
};

type TemplateForm = {
  id: string;
  name: string;
  version: string;
  description: string;
  variablesJson: string;
  filesJson: string;
};

type ApiForm = {
  id: string;
  name: string;
  keyId: string;
  templateId: string;
  allowedActions: DeploymentAction[];
};

const sampleVariables: TemplateVariable[] = [{ name: "name", required: true, sensitive: false, defaultValue: "demo" }];
const sampleTemplate = [
  'variable "name" {',
  "  type = string",
  "}",
  "",
  'resource "terraform_data" "sample" {',
  "  input = var.name",
  "}",
  "",
  'output "name" {',
  "  value = terraform_data.sample.output",
  "}",
].join("\n");

const activePage = ref<PageKey>("dashboard");
const loading = ref(false);
const actionLoading = ref(false);
const state = reactive<BootstrapResponse>({ providerTypes: [], keys: [], templates: [], apis: [] });
const selectedProviderId = ref("");
const keyDialogVisible = ref(false);
const templateDialogVisible = ref(false);
const apiDialogVisible = ref(false);
const editingKeySecrets = ref(false);
const editingKeyId = ref("");
const editingTemplateId = ref("");
const editingApiId = ref("");
const runtimeApiId = ref("");
const runtimeVarsJson = ref("{}");
const runIdInput = ref("");
const latestRun = ref<unknown>(null);
const runList = ref<unknown>(null);
const examples = ref<RuntimeCallExample | null>(null);
const statusResult = ref<unknown>(null);
const outputResult = ref<unknown>(null);
const runDetail = ref<unknown>(null);

const keyForm = reactive<KeyForm>({ id: "", name: "", description: "", env: {} });
const templateForm = reactive<TemplateForm>({
  id: "",
  name: "",
  version: "1.0.0",
  description: "",
  variablesJson: JSON.stringify(sampleVariables, null, 2),
  filesJson: JSON.stringify({ "main.tf": sampleTemplate }, null, 2),
});
const apiForm = reactive<ApiForm>({ id: "", name: "", keyId: "", templateId: "", allowedActions: [] });

const selectedProvider = computed(() => state.providerTypes.find((provider) => provider.id === selectedProviderId.value));
const providerKeys = computed(() => state.keys.filter((key) => key.providerTypeId === selectedProviderId.value));
const providerTemplates = computed(() =>
  state.templates.filter((template) => template.providerTypeId === selectedProviderId.value),
);
const providerApis = computed(() => state.apis.filter((api) => api.providerTypeId === selectedProviderId.value));
const selectedRuntimeApi = computed(() => state.apis.find((api) => api.id === runtimeApiId.value));
const selectedRuntimeTemplate = computed(() => selectedRuntimeApi.value?.snapshot.template);
const deployDisabled = computed(() => !selectedRuntimeApi.value?.allowedActions.includes("deploy"));
const deleteDisabled = computed(() => !selectedRuntimeApi.value?.allowedActions.includes("delete"));

const metrics = computed(() => [
  { label: "Provider Types", value: state.providerTypes.length },
  { label: "Keys", value: providerKeys.value.length },
  { label: "Templates", value: providerTemplates.value.length },
  { label: "Published APIs", value: providerApis.value.length },
]);

const pageTitle = computed(() => {
  const titles: Record<PageKey, string> = {
    dashboard: "Operations Dashboard",
    keys: "Credential Profiles",
    templates: "Template Library",
    apis: "Published API Contracts",
    runtime: "Runtime Cockpit",
  };
  return titles[activePage.value];
});

onMounted(() => {
  loadBootstrap().catch(showError);
});

async function loadBootstrap() {
  loading.value = true;
  try {
    const data = await requestJson<BootstrapResponse>("/ui/bootstrap");
    state.providerTypes = data.providerTypes;
    state.keys = data.keys;
    state.templates = data.templates;
    state.apis = data.apis;
    if (!selectedProviderId.value && data.providerTypes[0]) {
      selectedProviderId.value = data.providerTypes[0].id;
    }
    if (!runtimeApiId.value || !state.apis.some((api) => api.id === runtimeApiId.value)) {
      runtimeApiId.value = providerApis.value[0]?.id ?? "";
    }
    refreshRuntimeVars();
  } finally {
    loading.value = false;
  }
}

function providerChanged() {
  runtimeApiId.value = providerApis.value[0]?.id ?? "";
  resetRuntimePanels();
  refreshRuntimeVars();
}

function selectPage(index: string) {
  if (isPageKey(index)) {
    activePage.value = index;
  }
}

function isPageKey(value: string): value is PageKey {
  return value === "dashboard" || value === "keys" || value === "templates" || value === "apis" || value === "runtime";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-Hant", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatJson(value: unknown, emptyText: string) {
  return value === null || value === undefined ? emptyText : JSON.stringify(value, null, 2);
}

function openKeyDialog(key?: PublicProviderKey) {
  const provider = selectedProvider.value;
  editingKeyId.value = key?.id ?? "";
  keyForm.id = key?.id ?? "";
  keyForm.name = key?.name ?? "";
  keyForm.description = key?.description ?? "";
  keyForm.env = Object.fromEntries((provider?.requiredEnv ?? []).map((envName) => [envName, ""]));
  editingKeySecrets.value = Boolean(key);
  keyDialogVisible.value = true;
}

async function saveKey() {
  const provider = requireProvider();
  const path = `/ui/providers/${encodeURIComponent(provider.id)}/keys${
    editingKeyId.value ? `/${encodeURIComponent(editingKeyId.value)}` : ""
  }`;
  await runAction(async () => {
    await requestJson<PublicProviderKey>(path, {
      method: "POST",
      body: JSON.stringify({
        id: editingKeyId.value ? undefined : optionalText(keyForm.id),
        name: keyForm.name,
        description: optionalText(keyForm.description),
        env: keyForm.env,
      }),
    });
    keyDialogVisible.value = false;
    await loadBootstrap();
    ElMessage.success("Key saved. Secret values are not returned to the browser.");
  });
}

function openTemplateDialog(template?: PublicTerraformTemplate) {
  editingTemplateId.value = template?.id ?? "";
  templateForm.id = template?.id ?? "";
  templateForm.name = template?.name ?? "";
  templateForm.version = template?.version ?? "1.0.0";
  templateForm.description = template?.description ?? "";
  templateForm.variablesJson = JSON.stringify(template?.variables ?? sampleVariables, null, 2);
  templateForm.filesJson = JSON.stringify({ "main.tf": sampleTemplate }, null, 2);
  templateDialogVisible.value = true;
  if (template) {
    requestJson<TerraformTemplate>(
      `/ui/providers/${encodeURIComponent(template.providerTypeId)}/templates/${encodeURIComponent(template.id)}`,
    )
      .then((fullTemplate) => {
        templateForm.variablesJson = JSON.stringify(fullTemplate.variables, null, 2);
        templateForm.filesJson = JSON.stringify(fullTemplate.files, null, 2);
      })
      .catch(showError);
  }
}

async function saveTemplate() {
  await runAction(async () => {
    const provider = requireProvider();
    const variables = parseTemplateVariables(templateForm.variablesJson);
    const files = parseStringRecord(templateForm.filesJson, "Template files JSON");
    const path = `/ui/providers/${encodeURIComponent(provider.id)}/templates${
      editingTemplateId.value ? `/${encodeURIComponent(editingTemplateId.value)}` : ""
    }`;
    await requestJson<PublicTerraformTemplate>(path, {
      method: "POST",
      body: JSON.stringify({
        id: editingTemplateId.value ? undefined : optionalText(templateForm.id),
        name: templateForm.name,
        version: templateForm.version,
        description: optionalText(templateForm.description),
        variables,
        files,
      }),
    });
    templateDialogVisible.value = false;
    await loadBootstrap();
    ElMessage.success("Template saved and validated by the server allowlist.");
  });
}

function openApiDialog(api?: ApiPublication) {
  const provider = selectedProvider.value;
  editingApiId.value = api?.id ?? "";
  apiForm.id = api?.id ?? "";
  apiForm.name = api?.name ?? "";
  apiForm.keyId = api?.keyId ?? providerKeys.value[0]?.id ?? "";
  apiForm.templateId = api?.templateId ?? providerTemplates.value[0]?.id ?? "";
  apiForm.allowedActions = [...(api?.allowedActions ?? provider?.supportedActions ?? [])];
  apiDialogVisible.value = true;
}

async function saveApi() {
  await runAction(async () => {
    const provider = requireProvider();
    if (apiForm.allowedActions.length === 0) {
      throw new Error("Select at least one allowed action");
    }
    const path = `/ui/providers/${encodeURIComponent(provider.id)}/apis${
      editingApiId.value ? `/${encodeURIComponent(editingApiId.value)}` : ""
    }`;
    await requestJson<ApiPublication>(path, {
      method: "POST",
      body: JSON.stringify({
        id: editingApiId.value ? undefined : optionalText(apiForm.id),
        name: apiForm.name,
        keyId: apiForm.keyId,
        templateId: apiForm.templateId,
        allowedActions: apiForm.allowedActions,
      }),
    });
    apiDialogVisible.value = false;
    await loadBootstrap();
    ElMessage.success("API published. Runtime actions are available from the cockpit.");
  });
}

async function deleteResource(kind: ResourceKind, item: PublicProviderKey | PublicTerraformTemplate | ApiPublication) {
  await ElMessageBox.confirm(`Delete ${item.name}?`, "Confirm delete", { type: "warning" });
  await runAction(async () => {
    if (kind === "key") {
      await requestJson<{ ok: true }>(
        `/ui/providers/${encodeURIComponent(item.providerTypeId)}/keys/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
    } else if (kind === "template") {
      await requestJson<{ ok: true }>(
        `/ui/providers/${encodeURIComponent(item.providerTypeId)}/templates/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
    } else {
      await requestJson<{ ok: true }>(`/ui/apis/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    }
    await loadBootstrap();
    ElMessage.success("Resource deleted.");
  });
}

function refreshRuntimeVars() {
  const template = selectedRuntimeTemplate.value;
  if (!template) {
    runtimeVarsJson.value = "{}";
    return;
  }
  const vars = Object.fromEntries(
    template.variables.map((variable) => [variable.name, variable.sensitive ? "" : variable.defaultValue ?? ""]),
  );
  runtimeVarsJson.value = JSON.stringify(vars, null, 2);
}

function runtimeApiChanged() {
  resetRuntimePanels();
  refreshRuntimeVars();
  refreshExamples(false).catch(showError);
}

async function runtimeAction(action: DeploymentAction) {
  await runAction(async () => {
    const api = requireRuntimeApi();
    const vars = parseStringRecord(runtimeVarsJson.value, "Vars JSON");
    const result = await requestJson<TerraformRun>(`/ui/deployments/${encodeURIComponent(api.id)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ vars }),
    });
    latestRun.value = result;
    runIdInput.value = result.id;
    await refreshRuns(false);
    ElMessage.success(`${action} finished with status ${result.status}.`);
  });
}

async function refreshStatus() {
  const api = requireRuntimeApi();
  await runAction(async () => {
    const result = await requestJson<unknown>(`/ui/deployments/${encodeURIComponent(api.id)}/status`);
    statusResult.value = result;
    if (isStatusResponse(result)) {
      latestRun.value = result.latestRun ?? null;
    }
    ElMessage.success("Status refreshed.");
  });
}

async function refreshOutput() {
  const api = requireRuntimeApi();
  await runAction(async () => {
    outputResult.value = await requestJson<unknown>(`/ui/deployments/${encodeURIComponent(api.id)}/output`);
    ElMessage.success("Output refreshed.");
  });
}

async function refreshRuns(showMessage = true) {
  const api = requireRuntimeApi();
  const result = await requestJson<TerraformRun[]>(`/ui/deployments/${encodeURIComponent(api.id)}/runs`);
  runList.value = result;
  if (showMessage) {
    ElMessage.success("Runs refreshed.");
  }
}

async function refreshExamples(showMessage = true) {
  const api = selectedRuntimeApi.value;
  if (!api) {
    examples.value = null;
    return;
  }
  examples.value = await requestJson<RuntimeCallExample>(`/ui/deployments/${encodeURIComponent(api.id)}/examples`);
  if (showMessage) {
    ElMessage.success("Examples refreshed.");
  }
}

async function viewRun() {
  const api = requireRuntimeApi();
  const runId = runIdInput.value.trim();
  if (!runId) {
    throw new Error("Enter a run id first");
  }
  await runAction(async () => {
    runDetail.value = await requestJson<TerraformRun>(
      `/ui/deployments/${encodeURIComponent(api.id)}/runs/${encodeURIComponent(runId)}`,
    );
    ElMessage.success("Run detail loaded.");
  });
}

async function logout() {
  await fetch("/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/login";
}

function resetRuntimePanels() {
  latestRun.value = null;
  runList.value = null;
  examples.value = null;
  statusResult.value = null;
  outputResult.value = null;
  runDetail.value = null;
  runIdInput.value = "";
}

function requireProvider(): ProviderType {
  if (!selectedProvider.value) {
    throw new Error("Select a provider first");
  }
  return selectedProvider.value;
}

function requireRuntimeApi(): ApiPublication {
  if (!selectedRuntimeApi.value) {
    throw new Error("Select a published API first");
  }
  return selectedRuntimeApi.value;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTemplateVariables(text: string): TemplateVariable[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Variables JSON must be an array");
  }
  return parsed.map((item) => {
    if (!isTemplateVariable(item)) {
      throw new Error("Variables JSON contains an invalid variable");
    }
    return item;
  });
}

function parseStringRecord(text: string, label: string): Record<string, string> {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const entries = Object.entries(parsed);
  if (!entries.every(([, value]) => typeof value === "string")) {
    throw new Error(`${label} values must be strings`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function isTemplateVariable(value: unknown): value is TemplateVariable {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.required === "boolean" &&
    typeof candidate.sensitive === "boolean" &&
    (candidate.defaultValue === undefined || typeof candidate.defaultValue === "string")
  );
}

function isStatusResponse(value: unknown): value is { latestRun?: TerraformRun } {
  return typeof value === "object" && value !== null && "latestRun" in value;
}

async function runAction(action: () => Promise<void>) {
  actionLoading.value = true;
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    actionLoading.value = false;
  }
}

function showError(error: unknown) {
  ElMessage.error(error instanceof Error ? error.message : String(error));
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">TP</div>
        <h1 class="brand-title">Terraform Platform</h1>
        <p class="brand-subtitle">Admin deployment console</p>
      </div>
      <el-menu :default-active="activePage" text-color="#d6e4ff" active-text-color="#ffffff" @select="selectPage">
        <el-menu-item index="dashboard">Dashboard</el-menu-item>
        <el-menu-item index="keys">Keys</el-menu-item>
        <el-menu-item index="templates">Templates</el-menu-item>
        <el-menu-item index="apis">Published APIs</el-menu-item>
        <el-menu-item index="runtime">Runtime</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">
          <h1>{{ pageTitle }}</h1>
          <span>Same-origin browser session for provider-scoped Terraform operations.</span>
        </div>
        <el-space>
          <el-tag type="success" effect="dark">Session authenticated</el-tag>
          <el-button @click="logout">Logout</el-button>
        </el-space>
      </el-header>

      <el-main v-loading="loading" class="main-content">
        <el-card class="provider-card">
          <el-row :gutter="18" align="middle">
            <el-col :xs="24" :md="8">
              <el-form-item label="Provider context">
                <el-select v-model="selectedProviderId" placeholder="Select provider" @change="providerChanged">
                  <el-option v-for="provider in state.providerTypes" :key="provider.id" :label="`${provider.name} (${provider.id})`" :value="provider.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="16">
              <el-alert v-if="selectedProvider" type="info" :closable="false" show-icon>
                <template #title>{{ selectedProvider.sourceAddress }} {{ selectedProvider.versionConstraint }}</template>
                Required env: {{ selectedProvider.requiredEnv.join(", ") }} · Actions: {{ selectedProvider.supportedActions.join(", ") }}
              </el-alert>
              <el-empty v-else description="No provider types configured." :image-size="52" />
            </el-col>
          </el-row>
        </el-card>

        <section class="metric-grid">
          <el-card v-for="metric in metrics" :key="metric.label" class="metric-card">
            <div class="metric-value">{{ metric.value }}</div>
            <div class="metric-label">{{ metric.label }}</div>
          </el-card>
        </section>

        <el-card v-if="activePage === 'dashboard'" class="workbench-card">
          <div class="workbench-header">
            <div>
              <h2 class="workbench-title">Resource Overview</h2>
              <p class="workbench-copy">Create credentials, validate templates, publish API contracts, then operate runtime safely from one console.</p>
            </div>
            <el-button type="primary" @click="activePage = 'runtime'">Open Runtime</el-button>
          </div>
          <el-row :gutter="18">
            <el-col :xs="24" :md="8"><el-alert title="Keys" :description="`${providerKeys.length} credential profiles are scoped to this provider.`" type="success" :closable="false" /></el-col>
            <el-col :xs="24" :md="8"><el-alert title="Templates" :description="`${providerTemplates.length} templates are ready for publishing.`" type="warning" :closable="false" /></el-col>
            <el-col :xs="24" :md="8"><el-alert title="Published APIs" :description="`${providerApis.length} APIs can be selected in Runtime.`" type="info" :closable="false" /></el-col>
          </el-row>
        </el-card>

        <el-card v-if="activePage === 'keys'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">Keys</h2><p class="workbench-copy">Secret values are accepted once and never returned by UI responses.</p></div>
            <el-button type="primary" @click="openKeyDialog()">Create Key</el-button>
          </div>
          <el-table :data="providerKeys" empty-text="No key resources yet." stripe>
            <el-table-column label="Name" min-width="220"><template #default="{ row }"><div class="resource-name"><strong>{{ row.name }}</strong><small>{{ row.id }}</small></div></template></el-table-column>
            <el-table-column label="Env Keys" min-width="260"><template #default="{ row }"><el-tag v-for="envName in row.envKeys" :key="envName" class="mr-2">{{ envName }}</el-tag></template></el-table-column>
            <el-table-column prop="updatedAt" label="Updated" width="190"><template #default="{ row }">{{ formatDate(row.updatedAt) }}</template></el-table-column>
            <el-table-column label="Actions" width="180" fixed="right"><template #default="{ row }"><el-button size="small" @click="openKeyDialog(row)">Edit</el-button><el-button size="small" type="danger" @click="deleteResource('key', row)">Delete</el-button></template></el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="activePage === 'templates'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">Templates</h2><p class="workbench-copy">Terraform content remains server-side allowlisted before it can be published.</p></div>
            <el-button type="primary" @click="openTemplateDialog()">Create Template</el-button>
          </div>
          <el-table :data="providerTemplates" empty-text="No template resources yet." stripe>
            <el-table-column label="Name" min-width="220"><template #default="{ row }"><div class="resource-name"><strong>{{ row.name }}</strong><small>{{ row.id }} · v{{ row.version }}</small></div></template></el-table-column>
            <el-table-column label="Variables" min-width="220"><template #default="{ row }"><el-tag v-for="variable in row.variables" :key="variable.name" :type="variable.sensitive ? 'danger' : 'info'">{{ variable.name }}</el-tag></template></el-table-column>
            <el-table-column label="Files" min-width="180"><template #default="{ row }">{{ row.fileNames.join(", ") }}</template></el-table-column>
            <el-table-column label="Actions" width="180" fixed="right"><template #default="{ row }"><el-button size="small" @click="openTemplateDialog(row)">Edit</el-button><el-button size="small" type="danger" @click="deleteResource('template', row)">Delete</el-button></template></el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="activePage === 'apis'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">Published APIs</h2><p class="workbench-copy">Bind one key and one template into a versioned deployment contract.</p></div>
            <el-button type="primary" :disabled="providerKeys.length === 0 || providerTemplates.length === 0" @click="openApiDialog()">Publish API</el-button>
          </div>
          <el-table :data="providerApis" empty-text="No published APIs yet." stripe>
            <el-table-column label="Name" min-width="220"><template #default="{ row }"><div class="resource-name"><strong>{{ row.name }}</strong><small>{{ row.id }}</small></div></template></el-table-column>
            <el-table-column label="Binding" min-width="260"><template #default="{ row }">{{ row.keyId }} + {{ row.templateId }}</template></el-table-column>
            <el-table-column label="Actions" min-width="180"><template #default="{ row }"><el-tag v-for="action in row.allowedActions" :key="action" type="success">{{ action }}</el-tag></template></el-table-column>
            <el-table-column prop="revisionId" label="Revision" min-width="180" />
            <el-table-column label="Manage" width="180" fixed="right"><template #default="{ row }"><el-button size="small" @click="openApiDialog(row)">Edit</el-button><el-button size="small" type="danger" @click="deleteResource('api', row)">Delete</el-button></template></el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="activePage === 'runtime'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">Runtime</h2><p class="workbench-copy">Deploy, delete, inspect status/output, and review run history for a published API.</p></div>
          </div>
          <el-empty v-if="providerApis.length === 0" description="Publish an API to unlock runtime actions." />
          <div v-else class="runtime-grid">
            <el-card shadow="never">
              <el-form label-position="top">
                <el-form-item label="API">
                  <el-select v-model="runtimeApiId" @change="runtimeApiChanged">
                    <el-option v-for="api in providerApis" :key="api.id" :label="`${api.name} (${api.id})`" :value="api.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="Vars JSON">
                  <el-input v-model="runtimeVarsJson" type="textarea" :rows="12" spellcheck="false" />
                </el-form-item>
                <el-space wrap>
                  <el-button type="primary" :disabled="deployDisabled" :loading="actionLoading" @click="runtimeAction('deploy')">Deploy</el-button>
                  <el-button type="danger" :disabled="deleteDisabled" :loading="actionLoading" @click="runtimeAction('delete')">Terraform Delete</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshStatus">Status</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshOutput">Output</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshRuns(true)">Runs</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshExamples(true)">Examples</el-button>
                </el-space>
                <el-divider />
                <el-form-item label="Run ID">
                  <el-input v-model="runIdInput" placeholder="paste run id"><template #append><el-button :disabled="!selectedRuntimeApi" @click="viewRun">View Run</el-button></template></el-input>
                </el-form-item>
              </el-form>
            </el-card>
            <div class="runtime-panels">
              <el-card shadow="never"><template #header>Latest Run</template><pre class="code-panel">{{ formatJson(latestRun, "No run yet.") }}</pre></el-card>
              <el-card shadow="never"><template #header>Run List</template><pre class="code-panel">{{ formatJson(runList, "No runs loaded.") }}</pre></el-card>
              <el-card shadow="never"><template #header>External Call Examples</template><pre class="code-panel">{{ formatJson(examples, "No examples loaded.") }}</pre></el-card>
              <el-card shadow="never"><template #header>Status</template><pre class="code-panel">{{ formatJson(statusResult, "No status loaded.") }}</pre></el-card>
              <el-card shadow="never"><template #header>Output</template><pre class="code-panel">{{ formatJson(outputResult, "No output loaded.") }}</pre></el-card>
              <el-card shadow="never"><template #header>Run Detail</template><pre class="code-panel">{{ formatJson(runDetail, "No run detail loaded.") }}</pre></el-card>
            </div>
          </div>
        </el-card>
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="keyDialogVisible" :title="editingKeyId ? 'Edit Key' : 'Create Key'" width="560px">
    <el-alert v-if="editingKeySecrets" class="form-tip" title="Secret values are never returned. Re-enter every required secret before saving this key." type="warning" show-icon :closable="false" />
    <el-form label-position="top">
      <el-form-item label="Resource ID"><el-input v-model="keyForm.id" :disabled="Boolean(editingKeyId)" placeholder="Optional; generated when blank" /></el-form-item>
      <el-form-item label="Name" required><el-input v-model="keyForm.name" /></el-form-item>
      <el-form-item label="Description"><el-input v-model="keyForm.description" /></el-form-item>
      <el-form-item v-for="envName in selectedProvider?.requiredEnv ?? []" :key="envName" :label="envName" required>
        <el-input v-model="keyForm.env[envName]" type="password" autocomplete="off" show-password />
      </el-form-item>
    </el-form>
    <template #footer><div class="dialog-footer"><el-button @click="keyDialogVisible = false">Cancel</el-button><el-button type="primary" :loading="actionLoading" @click="saveKey">Save Key</el-button></div></template>
  </el-dialog>

  <el-dialog v-model="templateDialogVisible" :title="editingTemplateId ? 'Edit Template' : 'Create Template'" width="760px">
    <el-form label-position="top">
      <el-form-item label="Resource ID"><el-input v-model="templateForm.id" :disabled="Boolean(editingTemplateId)" placeholder="Optional; generated when blank" /></el-form-item>
      <el-form-item label="Name" required><el-input v-model="templateForm.name" /></el-form-item>
      <el-form-item label="Version" required><el-input v-model="templateForm.version" /></el-form-item>
      <el-form-item label="Description"><el-input v-model="templateForm.description" /></el-form-item>
      <el-form-item label="Variables JSON" required><el-input v-model="templateForm.variablesJson" type="textarea" :rows="8" spellcheck="false" /></el-form-item>
      <el-form-item label="Template files JSON" required><el-input v-model="templateForm.filesJson" type="textarea" :rows="12" spellcheck="false" /></el-form-item>
    </el-form>
    <template #footer><div class="dialog-footer"><el-button @click="templateDialogVisible = false">Cancel</el-button><el-button type="primary" :loading="actionLoading" @click="saveTemplate">Save Template</el-button></div></template>
  </el-dialog>

  <el-dialog v-model="apiDialogVisible" :title="editingApiId ? 'Edit API' : 'Publish API'" width="600px">
    <el-form label-position="top">
      <el-form-item label="Resource ID"><el-input v-model="apiForm.id" :disabled="Boolean(editingApiId)" placeholder="Optional; generated when blank" /></el-form-item>
      <el-form-item label="Name" required><el-input v-model="apiForm.name" /></el-form-item>
      <el-form-item label="Key" required><el-select v-model="apiForm.keyId"><el-option v-for="key in providerKeys" :key="key.id" :label="`${key.name} (${key.id})`" :value="key.id" /></el-select></el-form-item>
      <el-form-item label="Template" required><el-select v-model="apiForm.templateId"><el-option v-for="template in providerTemplates" :key="template.id" :label="`${template.name} (${template.id})`" :value="template.id" /></el-select></el-form-item>
      <el-form-item label="Allowed Actions" required><el-checkbox-group v-model="apiForm.allowedActions"><el-checkbox-button v-for="action in selectedProvider?.supportedActions ?? []" :key="action" :label="action" /></el-checkbox-group></el-form-item>
    </el-form>
    <template #footer><div class="dialog-footer"><el-button @click="apiDialogVisible = false">Cancel</el-button><el-button type="primary" :loading="actionLoading" @click="saveApi">Publish API</el-button></div></template>
  </el-dialog>
</template>
