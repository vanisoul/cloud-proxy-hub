<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import { requestJson } from "./api";
import {
  dateLocales,
  elementPlusLocales,
  loadSavedLocale,
  localeOptions,
  saveLocale,
  translate,
  type LocaleKey,
  type TranslationKey,
  type TranslationParams,
} from "./i18n";
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
  name: string;
  description: string;
  env: Record<string, string>;
};

type TemplateForm = {
  name: string;
  version: string;
  description: string;
  variablesJson: string;
  mainTf: string;
};

type ApiForm = {
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
const currentLocale = ref<LocaleKey>(loadSavedLocale());
const templateFiles = ref<Record<string, string>>({ "main.tf": sampleTemplate });

const keyForm = reactive<KeyForm>({ name: "", description: "", env: {} });
const templateForm = reactive<TemplateForm>({
  name: "",
  version: "1.0.0",
  description: "",
  variablesJson: JSON.stringify(sampleVariables, null, 2),
  mainTf: sampleTemplate,
});
const apiForm = reactive<ApiForm>({ name: "", keyId: "", templateId: "", allowedActions: [] });

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
const elementLocale = computed(() => elementPlusLocales[currentLocale.value]);
const selectedLocale = computed({
  get: () => currentLocale.value,
  set: (locale: LocaleKey) => {
    currentLocale.value = locale;
    saveLocale(locale);
  },
});

const metrics = computed(() => [
  { label: t("metric.providerTypes"), value: state.providerTypes.length },
  { label: t("metric.keys"), value: providerKeys.value.length },
  { label: t("metric.templates"), value: providerTemplates.value.length },
  { label: t("metric.publishedApis"), value: providerApis.value.length },
]);

const pageTitle = computed(() => {
  const titles: Record<PageKey, TranslationKey> = {
    dashboard: "page.dashboard",
    keys: "page.keys",
    templates: "page.templates",
    apis: "page.apis",
    runtime: "page.runtime",
  };
  return t(titles[activePage.value]);
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
  return new Intl.DateTimeFormat(dateLocales[currentLocale.value], { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatJson(value: unknown, emptyText: string) {
  return value === null || value === undefined ? emptyText : JSON.stringify(value, null, 2);
}

function openKeyDialog(key?: PublicProviderKey) {
  const provider = selectedProvider.value;
  editingKeyId.value = key?.id ?? "";
  keyForm.name = key?.name ?? "";
  keyForm.description = key?.description ?? "";
  keyForm.env = Object.fromEntries((provider?.requiredEnv ?? []).map((envName) => [envName, ""]));
  editingKeySecrets.value = Boolean(key);
  keyDialogVisible.value = true;
}

async function saveKey() {
  await runAction(async () => {
    const provider = requireProvider();
    const path = `/ui/providers/${encodeURIComponent(provider.id)}/keys${
      editingKeyId.value ? `/${encodeURIComponent(editingKeyId.value)}` : ""
    }`;
    await requestJson<PublicProviderKey>(path, {
      method: "POST",
      body: JSON.stringify({
        name: keyForm.name,
        description: optionalText(keyForm.description),
        env: keyForm.env,
      }),
    });
    keyDialogVisible.value = false;
    await loadBootstrap();
    ElMessage.success(t("message.keySaved"));
  });
}

function openTemplateDialog(template?: PublicTerraformTemplate) {
  editingTemplateId.value = template?.id ?? "";
  templateForm.name = template?.name ?? "";
  templateForm.version = template?.version ?? "1.0.0";
  templateForm.description = template?.description ?? "";
  templateForm.variablesJson = JSON.stringify(template?.variables ?? sampleVariables, null, 2);
  templateFiles.value = { "main.tf": sampleTemplate };
  templateForm.mainTf = sampleTemplate;
  templateDialogVisible.value = true;
  if (template) {
    requestJson<TerraformTemplate>(
      `/ui/providers/${encodeURIComponent(template.providerTypeId)}/templates/${encodeURIComponent(template.id)}`,
    )
      .then((fullTemplate) => {
        templateForm.variablesJson = JSON.stringify(fullTemplate.variables, null, 2);
        templateFiles.value = fullTemplate.files;
        templateForm.mainTf = fullTemplate.files["main.tf"] ?? "";
      })
      .catch(showError);
  }
}

async function saveTemplate() {
  await runAction(async () => {
    const provider = requireProvider();
    const variables = parseTemplateVariables(templateForm.variablesJson);
    const files = { ...templateFiles.value, "main.tf": templateForm.mainTf };
    const path = `/ui/providers/${encodeURIComponent(provider.id)}/templates${
      editingTemplateId.value ? `/${encodeURIComponent(editingTemplateId.value)}` : ""
    }`;
    await requestJson<PublicTerraformTemplate>(path, {
      method: "POST",
      body: JSON.stringify({
        name: templateForm.name,
        version: templateForm.version,
        description: optionalText(templateForm.description),
        variables,
        files,
      }),
    });
    templateDialogVisible.value = false;
    await loadBootstrap();
    ElMessage.success(t("message.templateSaved"));
  });
}

function openApiDialog(api?: ApiPublication) {
  const provider = selectedProvider.value;
  editingApiId.value = api?.id ?? "";
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
      throw new Error(t("error.allowedActionRequired"));
    }
    const path = `/ui/providers/${encodeURIComponent(provider.id)}/apis${
      editingApiId.value ? `/${encodeURIComponent(editingApiId.value)}` : ""
    }`;
    await requestJson<ApiPublication>(path, {
      method: "POST",
      body: JSON.stringify({
        name: apiForm.name,
        keyId: apiForm.keyId,
        templateId: apiForm.templateId,
        allowedActions: apiForm.allowedActions,
      }),
    });
    apiDialogVisible.value = false;
    await loadBootstrap();
    ElMessage.success(t("message.apiPublished"));
  });
}

async function deleteResource(kind: ResourceKind, item: PublicProviderKey | PublicTerraformTemplate | ApiPublication) {
  await runAction(async () => {
    const confirmed = await confirmDelete(item.name);
    if (!confirmed) {
      return;
    }
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
    ElMessage.success(t("message.resourceDeleted"));
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
  refreshExamples(false);
}

async function runtimeAction(action: DeploymentAction) {
  await runAction(async () => {
    const api = requireRuntimeApi();
    const vars = parseStringRecord(runtimeVarsJson.value, t("form.varsJson"));
    const result = await requestJson<TerraformRun>(`/ui/deployments/${encodeURIComponent(api.id)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ vars }),
    });
    latestRun.value = result;
    runIdInput.value = result.id;
    await loadRuns(api, false);
    ElMessage.success(t("message.runtimeFinished", { action, status: result.status }));
  });
}

async function refreshStatus() {
  await runAction(async () => {
    const api = requireRuntimeApi();
    const result = await requestJson<unknown>(`/ui/deployments/${encodeURIComponent(api.id)}/status`);
    statusResult.value = result;
    if (isStatusResponse(result)) {
      latestRun.value = result.latestRun ?? null;
    }
    ElMessage.success(t("message.statusRefreshed"));
  });
}

async function refreshOutput() {
  await runAction(async () => {
    const api = requireRuntimeApi();
    outputResult.value = await requestJson<unknown>(`/ui/deployments/${encodeURIComponent(api.id)}/output`);
    ElMessage.success(t("message.outputRefreshed"));
  });
}

async function refreshRuns(showMessage = true) {
  await runAction(async () => {
    const api = requireRuntimeApi();
    await loadRuns(api, showMessage);
  });
}

async function loadRuns(api: ApiPublication, showMessage: boolean) {
  const result = await requestJson<TerraformRun[]>(`/ui/deployments/${encodeURIComponent(api.id)}/runs`);
  runList.value = result;
  if (showMessage) {
    ElMessage.success(t("message.runsRefreshed"));
  }
}

async function refreshExamples(showMessage = true) {
  await runAction(async () => {
    const api = selectedRuntimeApi.value;
    if (!api) {
      examples.value = null;
      return;
    }
    await loadExamples(api, showMessage);
  });
}

async function loadExamples(api: ApiPublication, showMessage: boolean) {
  examples.value = await requestJson<RuntimeCallExample>(`/ui/deployments/${encodeURIComponent(api.id)}/examples`);
  if (showMessage) {
    ElMessage.success(t("message.examplesRefreshed"));
  }
}

async function viewRun() {
  await runAction(async () => {
    const api = requireRuntimeApi();
    const runId = runIdInput.value.trim();
    if (!runId) {
      throw new Error(t("error.runIdRequired"));
    }
    runDetail.value = await requestJson<TerraformRun>(
      `/ui/deployments/${encodeURIComponent(api.id)}/runs/${encodeURIComponent(runId)}`,
    );
    ElMessage.success(t("message.runDetailLoaded"));
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
    throw new Error(t("error.selectProvider"));
  }
  return selectedProvider.value;
}

function requireRuntimeApi(): ApiPublication {
  if (!selectedRuntimeApi.value) {
    throw new Error(t("error.selectRuntimeApi"));
  }
  return selectedRuntimeApi.value;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTemplateVariables(text: string): TemplateVariable[] {
  const parsed = parseJson(text, t("form.variablesJson"));
  if (!Array.isArray(parsed)) {
    throw new Error(t("error.variablesMustArray"));
  }
  return parsed.map((item) => {
    if (!isTemplateVariable(item)) {
      throw new Error(t("error.invalidVariable"));
    }
    return item;
  });
}

function parseStringRecord(text: string, label: string): Record<string, string> {
  const parsed = parseJson(text, label);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(t("error.jsonObject", { label }));
  }
  const entries = Object.entries(parsed);
  if (!entries.every(([, value]) => typeof value === "string")) {
    throw new Error(t("error.stringValues", { label }));
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(t("error.invalidJson", { label }));
  }
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

async function confirmDelete(name: string) {
  try {
    await ElMessageBox.confirm(t("confirm.deleteMessage", { name }), t("confirm.deleteTitle"), { type: "warning" });
    return true;
  } catch (error) {
    return false;
  }
}

function t(key: TranslationKey, params?: TranslationParams) {
  return translate(currentLocale.value, key, params);
}
</script>

<template>
  <el-config-provider :locale="elementLocale">
  <el-container class="app-shell">
    <el-aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">TP</div>
        <h1 class="brand-title">{{ t("app.brand.title") }}</h1>
        <p class="brand-subtitle">{{ t("app.brand.subtitle") }}</p>
      </div>
      <el-menu :default-active="activePage" text-color="var(--color-sidebar-text)" active-text-color="var(--color-sidebar-active)" @select="selectPage">
        <el-menu-item index="dashboard">{{ t("nav.dashboard") }}</el-menu-item>
        <el-menu-item index="keys">{{ t("nav.keys") }}</el-menu-item>
        <el-menu-item index="templates">{{ t("nav.templates") }}</el-menu-item>
        <el-menu-item index="apis">{{ t("nav.apis") }}</el-menu-item>
        <el-menu-item index="runtime">{{ t("nav.runtime") }}</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">
          <h1>{{ pageTitle }}</h1>
          <span>{{ t("header.subtitle") }}</span>
        </div>
        <el-space>
          <div class="language-control">
            <span class="language-label">{{ t("header.language") }}</span>
            <el-select v-model="selectedLocale" class="language-selector" size="small">
              <el-option v-for="option in localeOptions" :key="option.key" :label="option.label" :value="option.key" />
            </el-select>
          </div>
          <el-tag type="success" effect="dark">{{ t("header.authenticated") }}</el-tag>
          <el-button @click="logout">{{ t("action.logout") }}</el-button>
        </el-space>
      </el-header>

      <el-main v-loading="loading" class="main-content">
        <el-card class="provider-card">
          <el-row :gutter="18" align="middle">
            <el-col :xs="24" :md="8">
              <el-form-item :label="t('provider.context')">
                <el-select v-model="selectedProviderId" :placeholder="t('provider.select')" @change="providerChanged">
                  <el-option v-for="provider in state.providerTypes" :key="provider.id" :label="`${provider.name} (${provider.id})`" :value="provider.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="16">
              <el-alert v-if="selectedProvider" type="info" :closable="false" show-icon>
                <template #title>{{ selectedProvider.sourceAddress }} {{ selectedProvider.versionConstraint }}</template>
                {{ t("provider.requiredEnv") }}: {{ selectedProvider.requiredEnv.join(", ") }} · {{ t("provider.actions") }}: {{ selectedProvider.supportedActions.join(", ") }}
              </el-alert>
              <el-empty v-else :description="t('provider.empty')" :image-size="52" />
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
              <h2 class="workbench-title">{{ t("dashboard.title") }}</h2>
              <p class="workbench-copy">{{ t("dashboard.copy") }}</p>
            </div>
            <el-button type="primary" @click="activePage = 'runtime'">{{ t("action.openRuntime") }}</el-button>
          </div>
          <el-row :gutter="18">
            <el-col :xs="24" :md="8"><el-alert :title="t('dashboard.keysTitle')" :description="t('dashboard.keysDescription', { count: providerKeys.length })" type="success" :closable="false" /></el-col>
            <el-col :xs="24" :md="8"><el-alert :title="t('dashboard.templatesTitle')" :description="t('dashboard.templatesDescription', { count: providerTemplates.length })" type="warning" :closable="false" /></el-col>
            <el-col :xs="24" :md="8"><el-alert :title="t('dashboard.apisTitle')" :description="t('dashboard.apisDescription', { count: providerApis.length })" type="info" :closable="false" /></el-col>
          </el-row>
        </el-card>

        <el-card v-if="activePage === 'keys'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">{{ t("keys.title") }}</h2><p class="workbench-copy">{{ t("keys.copy") }}</p></div>
            <el-button type="primary" @click="openKeyDialog()">{{ t("action.createKey") }}</el-button>
          </div>
          <el-table :data="providerKeys" :empty-text="t('empty.keys')" stripe>
            <el-table-column :label="t('table.name')" min-width="220"><template #default="{ row }"><div class="resource-name"><strong>{{ row.name }}</strong><small>{{ row.id }}</small></div></template></el-table-column>
            <el-table-column :label="t('table.envKeys')" min-width="260"><template #default="{ row }"><el-tag v-for="envName in row.envKeys" :key="envName" class="mr-2">{{ envName }}</el-tag></template></el-table-column>
            <el-table-column prop="updatedAt" :label="t('table.updated')" width="190"><template #default="{ row }">{{ formatDate(row.updatedAt) }}</template></el-table-column>
            <el-table-column :label="t('table.actions')" width="180" fixed="right"><template #default="{ row }"><el-button size="small" @click="openKeyDialog(row)">{{ t("action.edit") }}</el-button><el-button size="small" type="danger" @click="deleteResource('key', row)">{{ t("action.delete") }}</el-button></template></el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="activePage === 'templates'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">{{ t("templates.title") }}</h2><p class="workbench-copy">{{ t("templates.copy") }}</p></div>
            <el-button type="primary" @click="openTemplateDialog()">{{ t("action.createTemplate") }}</el-button>
          </div>
          <el-table :data="providerTemplates" :empty-text="t('empty.templates')" stripe>
            <el-table-column :label="t('table.name')" min-width="220"><template #default="{ row }"><div class="resource-name"><strong>{{ row.name }}</strong><small>{{ row.id }} · v{{ row.version }}</small></div></template></el-table-column>
            <el-table-column :label="t('table.variables')" min-width="220"><template #default="{ row }"><el-tag v-for="variable in row.variables" :key="variable.name" :type="variable.sensitive ? 'danger' : 'info'">{{ variable.name }}</el-tag></template></el-table-column>
            <el-table-column :label="t('table.files')" min-width="180"><template #default="{ row }">{{ row.fileNames.join(", ") }}</template></el-table-column>
            <el-table-column :label="t('table.actions')" width="180" fixed="right"><template #default="{ row }"><el-button size="small" @click="openTemplateDialog(row)">{{ t("action.edit") }}</el-button><el-button size="small" type="danger" @click="deleteResource('template', row)">{{ t("action.delete") }}</el-button></template></el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="activePage === 'apis'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">{{ t("apis.title") }}</h2><p class="workbench-copy">{{ t("apis.copy") }}</p></div>
            <el-button type="primary" :disabled="providerKeys.length === 0 || providerTemplates.length === 0" @click="openApiDialog()">{{ t("action.publishApi") }}</el-button>
          </div>
          <el-table :data="providerApis" :empty-text="t('empty.apis')" stripe>
            <el-table-column :label="t('table.name')" min-width="220"><template #default="{ row }"><div class="resource-name"><strong>{{ row.name }}</strong><small>{{ row.id }}</small></div></template></el-table-column>
            <el-table-column :label="t('table.binding')" min-width="260"><template #default="{ row }">{{ row.keyId }} + {{ row.templateId }}</template></el-table-column>
            <el-table-column :label="t('table.actions')" min-width="180"><template #default="{ row }"><el-tag v-for="action in row.allowedActions" :key="action" type="success">{{ action }}</el-tag></template></el-table-column>
            <el-table-column prop="revisionId" :label="t('table.revision')" min-width="180" />
            <el-table-column :label="t('table.manage')" width="180" fixed="right"><template #default="{ row }"><el-button size="small" @click="openApiDialog(row)">{{ t("action.edit") }}</el-button><el-button size="small" type="danger" @click="deleteResource('api', row)">{{ t("action.delete") }}</el-button></template></el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="activePage === 'runtime'" class="workbench-card">
          <div class="workbench-header">
            <div><h2 class="workbench-title">{{ t("runtime.title") }}</h2><p class="workbench-copy">{{ t("runtime.copy") }}</p></div>
          </div>
          <el-empty v-if="providerApis.length === 0" :description="t('runtime.unlock')" />
          <div v-else class="runtime-grid">
            <el-card shadow="never">
              <el-form label-position="top">
                <el-form-item :label="t('form.api')">
                  <el-select v-model="runtimeApiId" @change="runtimeApiChanged">
                    <el-option v-for="api in providerApis" :key="api.id" :label="`${api.name} (${api.id})`" :value="api.id" />
                  </el-select>
                </el-form-item>
                <el-form-item :label="t('form.varsJson')">
                  <el-input v-model="runtimeVarsJson" type="textarea" :rows="12" spellcheck="false" />
                </el-form-item>
                <el-space wrap>
                  <el-button type="primary" :disabled="deployDisabled" :loading="actionLoading" @click="runtimeAction('deploy')">{{ t("action.deploy") }}</el-button>
                  <el-button type="danger" :disabled="deleteDisabled" :loading="actionLoading" @click="runtimeAction('delete')">{{ t("action.terraformDelete") }}</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshStatus">{{ t("action.status") }}</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshOutput">{{ t("action.output") }}</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshRuns(true)">{{ t("action.runs") }}</el-button>
                  <el-button :disabled="!selectedRuntimeApi" @click="refreshExamples(true)">{{ t("action.examples") }}</el-button>
                </el-space>
                <el-divider />
                <el-form-item :label="t('form.runId')">
                  <el-input v-model="runIdInput" :placeholder="t('form.runIdPlaceholder')"><template #append><el-button :disabled="!selectedRuntimeApi" @click="viewRun">{{ t("action.viewRun") }}</el-button></template></el-input>
                </el-form-item>
              </el-form>
            </el-card>
            <div class="runtime-panels">
              <el-card shadow="never"><template #header>{{ t("panel.latestRun") }}</template><pre class="code-panel">{{ formatJson(latestRun, t("empty.latestRun")) }}</pre></el-card>
              <el-card shadow="never"><template #header>{{ t("panel.runList") }}</template><pre class="code-panel">{{ formatJson(runList, t("empty.runList")) }}</pre></el-card>
              <el-card shadow="never"><template #header>{{ t("panel.externalExamples") }}</template><pre class="code-panel">{{ formatJson(examples, t("empty.examples")) }}</pre></el-card>
              <el-card shadow="never"><template #header>{{ t("panel.status") }}</template><pre class="code-panel">{{ formatJson(statusResult, t("empty.status")) }}</pre></el-card>
              <el-card shadow="never"><template #header>{{ t("panel.output") }}</template><pre class="code-panel">{{ formatJson(outputResult, t("empty.output")) }}</pre></el-card>
              <el-card shadow="never"><template #header>{{ t("panel.runDetail") }}</template><pre class="code-panel">{{ formatJson(runDetail, t("empty.runDetail")) }}</pre></el-card>
            </div>
          </div>
        </el-card>
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="keyDialogVisible" :title="editingKeyId ? t('dialog.editKey') : t('dialog.createKey')" width="560px">
    <el-alert v-if="editingKeySecrets" class="form-tip" :title="t('dialog.secretTip')" type="warning" show-icon :closable="false" />
    <el-form label-position="top">
      <el-form-item :label="t('form.name')" required><el-input v-model="keyForm.name" /></el-form-item>
      <el-form-item :label="t('form.description')"><el-input v-model="keyForm.description" /></el-form-item>
      <el-form-item v-for="envName in selectedProvider?.requiredEnv ?? []" :key="envName" :label="envName" required>
        <el-input v-model="keyForm.env[envName]" type="password" autocomplete="off" show-password />
      </el-form-item>
    </el-form>
    <template #footer><div class="dialog-footer"><el-button @click="keyDialogVisible = false">{{ t("action.cancel") }}</el-button><el-button type="primary" :loading="actionLoading" @click="saveKey">{{ t("action.saveKey") }}</el-button></div></template>
  </el-dialog>

  <el-dialog v-model="templateDialogVisible" :title="editingTemplateId ? t('dialog.editTemplate') : t('dialog.createTemplate')" width="760px">
    <el-form label-position="top">
      <el-form-item :label="t('form.name')" required><el-input v-model="templateForm.name" /></el-form-item>
      <el-form-item :label="t('form.version')" required><el-input v-model="templateForm.version" /></el-form-item>
      <el-form-item :label="t('form.description')"><el-input v-model="templateForm.description" /></el-form-item>
      <el-form-item :label="t('form.variablesJson')" required><el-input v-model="templateForm.variablesJson" type="textarea" :rows="8" spellcheck="false" /></el-form-item>
      <el-form-item :label="t('form.mainTf')" required><el-input v-model="templateForm.mainTf" type="textarea" :rows="12" spellcheck="false" /></el-form-item>
    </el-form>
    <template #footer><div class="dialog-footer"><el-button @click="templateDialogVisible = false">{{ t("action.cancel") }}</el-button><el-button type="primary" :loading="actionLoading" @click="saveTemplate">{{ t("action.saveTemplate") }}</el-button></div></template>
  </el-dialog>

  <el-dialog v-model="apiDialogVisible" :title="editingApiId ? t('dialog.editApi') : t('dialog.publishApi')" width="600px">
    <el-form label-position="top">
      <el-form-item :label="t('form.name')" required><el-input v-model="apiForm.name" /></el-form-item>
      <el-form-item :label="t('form.key')" required><el-select v-model="apiForm.keyId"><el-option v-for="key in providerKeys" :key="key.id" :label="`${key.name} (${key.id})`" :value="key.id" /></el-select></el-form-item>
      <el-form-item :label="t('form.template')" required><el-select v-model="apiForm.templateId"><el-option v-for="template in providerTemplates" :key="template.id" :label="`${template.name} (${template.id})`" :value="template.id" /></el-select></el-form-item>
      <el-form-item :label="t('form.allowedActions')" required><el-checkbox-group v-model="apiForm.allowedActions"><el-checkbox-button v-for="action in selectedProvider?.supportedActions ?? []" :key="action" :label="action" /></el-checkbox-group></el-form-item>
    </el-form>
    <template #footer><div class="dialog-footer"><el-button @click="apiDialogVisible = false">{{ t("action.cancel") }}</el-button><el-button type="primary" :loading="actionLoading" @click="saveApi">{{ t("action.publishApi") }}</el-button></div></template>
  </el-dialog>
  </el-config-provider>
</template>
