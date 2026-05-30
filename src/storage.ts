import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

import { appConfig, builtInProviderTypes } from "@/config";
import { uuidV7 } from "@/id";
import { normalizeTemplateFiles } from "@/template";
import type {
  ApiPublication,
  ProviderKey,
  ProviderType,
  PublicProviderKey,
  PublicTerraformTemplate,
  InitShellLogResponse,
  RuntimeCallExample,
  ShellBinding,
  ShellResource,
  TerraformRun,
  TerraformRunEvent,
  TerraformTemplate,
  TerraformTemplateInput,
} from "@/types";

type KeyInput = Omit<ProviderKey, "createdAt" | "updatedAt" | "id"> & { id?: string };
type ShellInput = Omit<ShellResource, "createdAt" | "updatedAt" | "id"> & { id?: string };
type ApiInput = Omit<ApiPublication, "createdAt" | "updatedAt" | "id" | "revisionId" | "snapshot" | "shellId" | "vars"> & {
  id?: string;
  vars?: Record<string, string>;
};
type ApiSecret = { vars: Record<string, string> };
type RunEventInput = Omit<TerraformRunEvent, "id" | "apiId" | "runId" | "createdAt">;

export class PlatformStore {
  async initialize() {
    await Promise.all([
      mkdir(this.configPath("terraform-providers"), { recursive: true }),
      mkdir(this.configPath("keys"), { recursive: true }),
      mkdir(this.configPath("templates"), { recursive: true }),
      mkdir(this.configPath("shells"), { recursive: true }),
      mkdir(this.configPath("apis"), { recursive: true }),
      mkdir(this.dataPath("apis"), { recursive: true }),
      mkdir(this.dataPath("reconciler"), { recursive: true }),
    ]);

    for (const provider of builtInProviderTypes) {
      await this.writeJson(this.configPath("terraform-providers", `${provider.id}.json`), provider);
    }
  }

  async listProviderTypes(): Promise<ProviderType[]> {
    return this.listFiles<ProviderType>(this.configPath("terraform-providers"));
  }

  async getProviderType(id: string): Promise<ProviderType> {
    return this.readJson<ProviderType>(this.configPath("terraform-providers", `${id}.json`));
  }

  async listKeys(providerTypeId?: string): Promise<PublicProviderKey[]> {
    const providerIds = providerTypeId ? [providerTypeId] : await this.listProviderTypeIds();
    const nested = await Promise.all(providerIds.map((id) => this.listProviderKeys(id)));
    return nested.flat().sort((left, right) => left.id.localeCompare(right.id));
  }

  async getPublicKey(providerTypeId: string, keyId: string): Promise<PublicProviderKey> {
    return toPublicKey(await this.getKey(providerTypeId, keyId));
  }

  async getKey(providerTypeId: string, keyId: string): Promise<ProviderKey> {
    const metadata = await this.readJson<Omit<ProviderKey, "env">>(
      this.keyPath(providerTypeId, keyId, "metadata.json"),
    );
    const secret = await this.readJson<Pick<ProviderKey, "env">>(this.keyPath(providerTypeId, keyId, "secret.json"));
    return { ...metadata, env: secret.env };
  }

  async saveKey(input: KeyInput): Promise<PublicProviderKey> {
    await this.getProviderType(input.providerTypeId);
    const now = new Date().toISOString();
    const id = input.id ?? uuidV7();
    const existing = await this.maybeReadJson<Omit<ProviderKey, "env">>(
      this.keyPath(input.providerTypeId, id, "metadata.json"),
    );
    const key: ProviderKey = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const keyDir = this.keyPath(key.providerTypeId, key.id);
    await mkdir(keyDir, { recursive: true });
    const { env, ...metadata } = key;
    await this.writeJson(join(keyDir, "metadata.json"), metadata);
    await this.writeJson(join(keyDir, "secret.json"), { env });
    return toPublicKey(key);
  }

  async deleteKey(providerTypeId: string, keyId: string) {
    await this.assertApiDoesNotReference(providerTypeId, { keyId });
    await rm(this.keyPath(providerTypeId, keyId), { recursive: true, force: true });
  }

  async listTemplates(providerTypeId?: string): Promise<PublicTerraformTemplate[]> {
    const providerIds = providerTypeId ? [providerTypeId] : await this.listProviderTypeIds();
    const nested = await Promise.all(providerIds.map((id) => this.listProviderTemplates(id)));
    return nested.flat().sort((left, right) => left.id.localeCompare(right.id));
  }

  async getTemplate(providerTypeId: string, templateId: string): Promise<TerraformTemplate> {
    const metadata = await this.readJson<Omit<TerraformTemplate, "files">>(
      this.templatePath(providerTypeId, templateId, "metadata.json"),
    );
    const files = await this.readTemplateFiles(this.templatePath(providerTypeId, templateId, "files"));
    return { ...metadata, files };
  }

  async getPublicTemplate(providerTypeId: string, templateId: string): Promise<TerraformTemplate> {
    const template = await this.getTemplate(providerTypeId, templateId);
    return { ...template, variables: redactTemplateVariables(template.variables) };
  }

  async saveTemplate(input: TerraformTemplateInput): Promise<PublicTerraformTemplate> {
    await this.getProviderType(input.providerTypeId);
    validateTemplateVariables(input.variables);
    const files = normalizeTemplateFiles(input);
    const now = new Date().toISOString();
    const id = input.id ?? uuidV7();
    const existing = await this.maybeReadJson<Omit<TerraformTemplate, "files">>(
      this.templatePath(input.providerTypeId, id, "metadata.json"),
    );
    const { mainTf: _mainTf, files: _files, ...metadataInput } = input;
    const template: TerraformTemplate = {
      ...metadataInput,
      id,
      files,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const templateDir = this.templatePath(template.providerTypeId, template.id);
    const filesDir = join(templateDir, "files");
    await rm(filesDir, { recursive: true, force: true });
    await mkdir(filesDir, { recursive: true });
    const { files: savedFiles, ...metadata } = template;
    await this.writeJson(join(templateDir, "metadata.json"), metadata);
    await Promise.all(
      Object.entries(savedFiles).map(async ([fileName, content]) => {
        const filePath = join(filesDir, fileName);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, { mode: 0o600 });
      }),
    );
    return toPublicTemplate(template);
  }

  async deleteTemplate(providerTypeId: string, templateId: string) {
    await this.assertApiDoesNotReference(providerTypeId, { templateId });
    await rm(this.templatePath(providerTypeId, templateId), { recursive: true, force: true });
  }

  async listShells(providerTypeId?: string): Promise<ShellResource[]> {
    const providerIds = providerTypeId ? [providerTypeId] : await this.listProviderTypeIds();
    const nested = await Promise.all(providerIds.map((id) => this.listProviderShells(id)));
    return nested.flat().sort((left, right) => left.id.localeCompare(right.id));
  }

  async getShell(providerTypeId: string, shellId: string): Promise<ShellResource> {
    return this.readJson<ShellResource>(this.shellPath(providerTypeId, shellId, "metadata.json"));
  }

  async saveShell(input: ShellInput): Promise<ShellResource> {
    await this.getProviderType(input.providerTypeId);
    const now = new Date().toISOString();
    const id = input.id ?? uuidV7();
    const existing = await this.maybeReadJson<ShellResource>(this.shellPath(input.providerTypeId, id, "metadata.json"));
    const shell: ShellResource = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await this.writeJson(this.shellPath(shell.providerTypeId, shell.id, "metadata.json"), shell);
    return shell;
  }

  async deleteShell(providerTypeId: string, shellId: string) {
    await this.assertApiDoesNotReference(providerTypeId, { shellId });
    await rm(this.shellPath(providerTypeId, shellId), { recursive: true, force: true });
  }

  async listApis(providerTypeId?: string): Promise<ApiPublication[]> {
    const providerIds = providerTypeId ? [providerTypeId] : await this.listProviderTypeIds();
    const nested = await Promise.all(providerIds.map((id) => this.listProviderApis(id)));
    return nested.flat().sort((left, right) => left.id.localeCompare(right.id));
  }

  async getApi(apiId: string): Promise<ApiPublication> {
    const matches = await Promise.all(
      (await this.listProviderTypeIds()).map(async (providerTypeId) => {
        try {
          return await this.getProviderApi(providerTypeId, apiId);
        } catch {
          return undefined;
        }
      }),
    );
    const api = matches.find((value): value is ApiPublication => value !== undefined);
    if (!api) {
      throw new Error(`API ${apiId} not found`);
    }
    return api;
  }

  async getProviderApi(providerTypeId: string, apiId: string): Promise<ApiPublication> {
    const api = normalizeApiPublication(await this.readJson<ApiPublication>(this.apiPath(providerTypeId, apiId, "metadata.json")));
    return redactApiPublicationVars(api);
  }

  async saveApi(input: ApiInput): Promise<ApiPublication> {
    const providerType = await this.getProviderType(input.providerTypeId);
    const key = await this.getKey(input.providerTypeId, input.keyId);
    const template = await this.getTemplate(input.providerTypeId, input.templateId);
    const shell = input.shellBinding ? await this.getShell(input.providerTypeId, input.shellBinding.shellId) : undefined;
    if (shell && input.shellBinding) {
      validateShellCompatibility(shell, input.shellBinding, template);
    }
    for (const action of input.allowedActions) {
      if (!providerType.supportedActions.includes(action)) {
        throw new Error(`Action ${action} is not supported by provider ${providerType.id}`);
      }
    }
    const existingApis = await this.listApis();
    const conflictingApi = existingApis.find(
      (api) => input.id !== undefined && api.id === input.id && api.providerTypeId !== input.providerTypeId,
    );
    if (conflictingApi) {
      throw new Error(`API ${input.id} already exists under provider ${conflictingApi.providerTypeId}`);
    }
    const now = new Date().toISOString();
    const id = input.id ?? uuidV7();
    const existing = await this.maybeReadJson<ApiPublication>(this.apiPath(input.providerTypeId, id, "metadata.json"));
    const existingSecret = await this.maybeReadJson<ApiSecret>(this.apiPath(input.providerTypeId, id, "secret.json"));
    const startupVariable = shell && input.shellBinding ? resolveShellStartupVariable(template, input.shellBinding.shellId) : undefined;
    const vars = resolveApiVars(template, input.vars, existingSecret?.vars ?? {});
    const missing = template.variables.filter(
      (variable) => variable.name !== startupVariable && variable.required && isBlank(vars[variable.name]),
    );
    if (missing.length > 0) {
      throw new Error(`Missing API variables: ${missing.map((variable) => variable.name).join(", ")}`);
    }
    const revisionId = uuidV7();
    const api: ApiPublication = {
      ...input,
      shellId: input.shellBinding?.shellId,
      vars: redactApiVars(template, vars),
      id,
      revisionId,
      snapshot: toApiSnapshot(key, template, shell, input.shellBinding),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const apiDir = this.apiPath(api.providerTypeId, api.id);
    await mkdir(apiDir, { recursive: true });
    await this.writeJson(join(apiDir, "metadata.json"), api);
    await this.writeJson(join(apiDir, "secret.json"), { vars });
    await this.writeJson(join(apiDir, "revisions", revisionId, "secret.json"), { vars });
    await mkdir(this.apiDataPath(api.id, "runs"), { recursive: true });
    return api;
  }

  async getApiVars(api: ApiPublication) {
    const revisionSecret = await this.maybeReadJson<ApiSecret>(this.apiPath(api.providerTypeId, api.id, "revisions", api.revisionId, "secret.json"));
    const secret = await this.maybeReadJson<ApiSecret>(this.apiPath(api.providerTypeId, api.id, "secret.json"));
    const metadata = await this.maybeReadJson<ApiPublication>(this.apiPath(api.providerTypeId, api.id, "metadata.json"));
    return revisionSecret?.vars ?? secret?.vars ?? legacyApiVars(metadata) ?? api.vars ?? {};
  }

  async deleteApi(apiId: string) {
    const api = await this.getApi(apiId);
    await rm(this.apiPath(api.providerTypeId, api.id), { recursive: true, force: true });
  }

  async saveRun(run: TerraformRun): Promise<TerraformRun> {
    const runDir = this.runPath(run.apiId, run.id);
    await mkdir(runDir, { recursive: true });
    await this.writeJson(join(runDir, "run.json"), run);
    await this.writeJson(join(runDir, "vars.snapshot.redacted.json"), run.vars);
    return run;
  }

  async getRun(apiId: string, runId: string): Promise<TerraformRun> {
    try {
      return await this.readJson<TerraformRun>(this.runPath(apiId, runId, "run.json"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Run ${runId} not found`);
      }
      throw error;
    }
  }

  async appendRunEvent(apiId: string, runId: string, eventInput: RunEventInput): Promise<TerraformRunEvent> {
    const event: TerraformRunEvent = {
      ...eventInput,
      id: uuidV7(),
      apiId,
      runId,
      createdAt: new Date().toISOString(),
    };
    const eventPath = this.runPath(apiId, runId, "events.redacted.ndjson");
    await mkdir(dirname(eventPath), { recursive: true });
    await appendFile(eventPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return event;
  }

  async listRunEvents(apiId: string, runId: string): Promise<TerraformRunEvent[]> {
    try {
      const content = await readFile(this.runPath(apiId, runId, "events.redacted.ndjson"), "utf8");
      return content
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as TerraformRunEvent);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async appendInitShellLog(apiId: string, runId: string, input: { nonce: string; sequence: number; content: string }) {
    const run = await this.getRun(apiId, runId);
    if (!run.shellId) {
      throw new Error(`Run ${runId} has no init shell`);
    }
    const noncePath = this.runPath(apiId, runId, "init-shell-nonces", input.nonce, `${input.sequence}.json`);
    await mkdir(dirname(noncePath), { recursive: true });
    try {
      await writeFile(noncePath, `${JSON.stringify({ nonce: input.nonce, sequence: input.sequence, createdAt: new Date().toISOString() }, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error(`Init shell callback nonce ${input.nonce} sequence ${input.sequence} already used`);
      }
      throw error;
    }
    const logPath = this.runPath(apiId, runId, "init-shell.redacted.log");
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, input.content, { mode: 0o600 });
    await this.appendRunEvent(apiId, runId, {
      type: "init_shell_output",
      message: "init shell log received",
      output: input.content,
    });
  }

  async getInitShellLog(apiId: string, runId: string): Promise<InitShellLogResponse> {
    const run = await this.getRun(apiId, runId);
    if (!run.shellId) {
      return { enabled: false, status: "disabled", content: "", reason: "Run has no init shell" };
    }
    if (!appConfig.publicCallbackBaseUrl) {
      return { enabled: false, status: "disabled", content: "", reason: "PUBLIC_CALLBACK_BASE_URL is not configured" };
    }
    const logPath = this.runPath(apiId, runId, "init-shell.redacted.log");
    if (!(await Bun.file(logPath).exists())) {
      return { enabled: true, status: "waiting", content: "" };
    }
    const content = await readFile(logPath, "utf8");
    return { enabled: true, status: "received", content, updatedAt: new Date().toISOString() };
  }

  async listRuns(apiId: string): Promise<TerraformRun[]> {
    await this.getApi(apiId);
    const runsDir = this.apiDataPath(apiId, "runs");
    await mkdir(runsDir, { recursive: true });
    const runIds = await readdir(runsDir);
    const runs = await Promise.all(
      runIds.map((runId) => this.maybeReadJson<TerraformRun>(this.runPath(apiId, runId, "run.json"))),
    );
    return runs.filter((run) => run !== undefined).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getRuntimeCallExample(apiId: string): Promise<RuntimeCallExample> {
    const api = await this.getApi(apiId);
    const body = {};
    const example: RuntimeCallExample = {
      apiId: api.id,
      apiRevisionId: api.revisionId,
    };
    if (api.allowedActions.includes("deploy")) {
      example.deploy = runtimeActionExample(api.id, "deploy", body);
    }
    if (api.allowedActions.includes("delete")) {
      example.delete = runtimeActionExample(api.id, "delete", body);
    }
    return example;
  }

  async getLatestRun(apiId: string): Promise<TerraformRun | undefined> {
    const runsDir = this.apiDataPath(apiId, "runs");
    await mkdir(runsDir, { recursive: true });
    const runIds = await readdir(runsDir);
    const runs = await Promise.all(
      runIds.map((runId) => this.maybeReadJson<TerraformRun>(this.runPath(apiId, runId, "run.json"))),
    );
    return runs.filter((run) => run !== undefined).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  runPath(apiId: string, runId: string, ...parts: string[]) {
    return this.dataPath("apis", apiId, "runs", runId, ...parts);
  }

  terraformPath(apiId: string, ...parts: string[]) {
    return this.dataPath("apis", apiId, ...parts);
  }

  apiDataPath(apiId: string, ...parts: string[]) {
    return this.dataPath("apis", apiId, ...parts);
  }

  configPath(...parts: string[]) {
    return safeJoin(appConfig.configDir, parts);
  }

  dataPath(...parts: string[]) {
    return safeJoin(appConfig.dataDir, parts);
  }

  private async listProviderTypeIds() {
    return (await this.listProviderTypes()).map((provider) => provider.id);
  }

  private keyPath(providerTypeId: string, keyId: string, ...parts: string[]) {
    return this.configPath("keys", providerTypeId, keyId, ...parts);
  }

  private templatePath(providerTypeId: string, templateId: string, ...parts: string[]) {
    return this.configPath("templates", providerTypeId, templateId, ...parts);
  }

  private shellPath(providerTypeId: string, shellId: string, ...parts: string[]) {
    return this.configPath("shells", providerTypeId, shellId, ...parts);
  }

  private apiPath(providerTypeId: string, apiId: string, ...parts: string[]) {
    return this.configPath("apis", providerTypeId, apiId, ...parts);
  }

  private async listProviderKeys(providerTypeId: string) {
    const providerDir = this.configPath("keys", providerTypeId);
    await mkdir(providerDir, { recursive: true });
    const keyIds = await readdir(providerDir);
    return Promise.all(keyIds.map((keyId) => this.getPublicKey(providerTypeId, keyId)));
  }

  private async listProviderTemplates(providerTypeId: string) {
    const providerDir = this.configPath("templates", providerTypeId);
    await mkdir(providerDir, { recursive: true });
    const templateIds = await readdir(providerDir);
    return Promise.all(templateIds.map(async (id) => toPublicTemplate(await this.getTemplate(providerTypeId, id))));
  }

  private async listProviderShells(providerTypeId: string) {
    const providerDir = this.configPath("shells", providerTypeId);
    await mkdir(providerDir, { recursive: true });
    const shellIds = await readdir(providerDir);
    return Promise.all(shellIds.map((id) => this.getShell(providerTypeId, id)));
  }

  private async listProviderApis(providerTypeId: string) {
    const providerDir = this.configPath("apis", providerTypeId);
    await mkdir(providerDir, { recursive: true });
    const apiIds = await readdir(providerDir);
    return Promise.all(apiIds.map((id) => this.getProviderApi(providerTypeId, id)));
  }

  private async assertApiDoesNotReference(providerTypeId: string, reference: { keyId?: string; templateId?: string; shellId?: string }) {
    const apis = await this.listApis(providerTypeId);
    const found = apis.find(
      (api) =>
        (reference.keyId !== undefined && api.keyId === reference.keyId) ||
        (reference.templateId !== undefined && api.templateId === reference.templateId) ||
        (reference.shellId !== undefined && apiReferencesShell(api, reference.shellId)),
    );
    if (found) {
      throw new Error(`Resource is referenced by API ${found.id}`);
    }
  }

  private async readTemplateFiles(directory: string, prefix = ""): Promise<Record<string, string>> {
    const entries = await readdir(directory, { withFileTypes: true });
    const chunks = await Promise.all(
      entries.map(async (entry) => {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return this.readTemplateFiles(path, relativePath);
        }
        return { [relativePath]: await readFile(path, "utf8") };
      }),
    );
    return Object.assign({}, ...chunks);
  }

  private async listFiles<T>(directory: string): Promise<T[]> {
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const values = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map((name) => this.readJson<T>(join(directory, name))),
    );
    return values.sort((left, right) => getId(left).localeCompare(getId(right)));
  }

  private async readJson<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  }

  private async maybeReadJson<T>(filePath: string): Promise<T | undefined> {
    try {
      return await this.readJson<T>(filePath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async writeJson(filePath: string, value: unknown) {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, filePath);
  }

  async removeRuntimeData() {
    await rm(appConfig.dataDir, { recursive: true, force: true });
  }

  async removeConfigData() {
    await rm(appConfig.configDir, { recursive: true, force: true });
  }
}

function toPublicKey(key: ProviderKey): PublicProviderKey {
  const { env, ...rest } = key;
  return { ...rest, envKeys: Object.keys(env).sort() };
}

function toPublicTemplate(template: TerraformTemplate): PublicTerraformTemplate {
  const { files, ...rest } = template;
  return {
    ...rest,
    variables: redactTemplateVariables(rest.variables),
    fileNames: Object.keys(files).sort(),
    resourceAddresses: [...templateResourceAddresses(template)].sort(),
  };
}

function normalizeApiPublication(api: ApiPublication): ApiPublication {
  const normalized = {
    ...api,
    vars: api.vars ?? {},
  };
  if (normalized.shellBinding || !normalized.snapshot.shell) {
    return normalized;
  }
  return {
    ...normalized,
    shellId: normalized.shellId ?? normalized.snapshot.shell.id,
    shellBinding: {
      shellId: normalized.snapshot.shell.id,
    },
  };
}

function redactApiPublicationVars(api: ApiPublication): ApiPublication {
  return {
    ...api,
    vars: redactVarsByVariables(api.snapshot.template.variables, api.vars ?? {}),
    snapshot: {
      ...api.snapshot,
      template: {
        ...api.snapshot.template,
        variables: redactTemplateVariables(api.snapshot.template.variables),
      },
    },
  };
}

function legacyApiVars(api: ApiPublication | undefined) {
  if (!api) {
    return undefined;
  }
  const defaults = Object.fromEntries(
    api.snapshot.template.variables
      .filter((variable) => variable.defaultValue !== undefined)
      .map((variable) => [variable.name, variable.defaultValue as string]),
  );
  const metadataVars = Object.fromEntries(
    Object.entries(api.vars ?? {}).filter(([, value]) => value !== "[REDACTED]"),
  );
  return { ...defaults, ...metadataVars };
}

function validateTemplateVariables(variables: TerraformTemplate["variables"]) {
  const invalid = variables.find((variable) => variable.sensitive && variable.defaultValue !== undefined);
  if (invalid) {
    throw new Error(`Variable ${invalid.name} is sensitive and cannot define defaultValue`);
  }
}

function redactTemplateVariables(variables: TerraformTemplate["variables"]) {
  return variables.map((variable) => variable.sensitive && variable.defaultValue !== undefined
    ? { ...variable, defaultValue: "[REDACTED]" }
    : variable);
}

function resolveApiVars(template: TerraformTemplate, vars: Record<string, string> | undefined, existingVars: Record<string, string>) {
  const defaults = templateDefaultVars(template);
  const preserved = declaredVars(template, existingVars);
  if (vars === undefined) {
    return { ...defaults, ...preserved };
  }
  return { ...defaults, ...preserved, ...sanitizeApiVars(template, vars, existingVars) };
}

function templateDefaultVars(template: TerraformTemplate) {
  return Object.fromEntries(
    template.variables
      .filter((variable) => variable.defaultValue !== undefined)
      .map((variable) => [variable.name, variable.defaultValue as string]),
  );
}

function declaredVars(template: TerraformTemplate, vars: Record<string, string>) {
  const variableNames = new Set(template.variables.map((variable) => variable.name));
  return Object.fromEntries(Object.entries(vars).filter(([key]) => variableNames.has(key)));
}

function sanitizeApiVars(template: TerraformTemplate, vars: Record<string, string>, existingVars: Record<string, string>) {
  const variablesByName = new Map(template.variables.map((variable) => [variable.name, variable]));
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    const variable = variablesByName.get(key);
    if (!variable) {
      throw new Error(`Variable ${key} is not declared by this template`);
    }
    if (variable.sensitive && value === "[REDACTED]") {
      if (existingVars[key] !== undefined) {
        sanitized[key] = existingVars[key];
        continue;
      }
      if (variable.defaultValue !== undefined) {
        sanitized[key] = variable.defaultValue;
        continue;
      }
      throw new Error(`Variable ${key} is sensitive and requires a value`);
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function isBlank(value: string | undefined) {
  return value === undefined || value.trim() === "";
}

function redactApiVars(template: TerraformTemplate, vars: Record<string, string>) {
  return redactVarsByVariables(template.variables, vars);
}

function redactVarsByVariables(variables: TerraformTemplate["variables"], vars: Record<string, string>) {
  const sensitiveNames = new Set(variables.filter((variable) => variable.sensitive).map((variable) => variable.name));
  return Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, sensitiveNames.has(key) ? "[REDACTED]" : value]),
  );
}

function apiReferencesShell(api: ApiPublication, shellId: string) {
  return api.shellId === shellId || api.shellBinding?.shellId === shellId || api.snapshot.shell?.id === shellId;
}

function safeJoin(root: string, parts: string[]) {
  const resolved = normalize(join(root, ...parts));
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel.includes("../") || rel === "..") {
    throw new Error("Invalid path traversal");
  }
  return resolved;
}

function getId(value: unknown) {
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return "";
}


function toApiSnapshot(
  key: ProviderKey,
  template: TerraformTemplate,
  shell?: ShellResource,
  shellBinding?: ShellBinding,
): ApiPublication["snapshot"] {
  const shellSnapshot = shell && shellBinding
    ? {
        id: shell.id,
        providerTypeId: shell.providerTypeId,
        name: shell.name,
        inline: shell.inline,
        startupVariable: resolveShellStartupVariable(template, shell.id),
        updatedAt: shell.updatedAt,
      }
    : undefined;
  return {
    key: {
      id: key.id,
      providerTypeId: key.providerTypeId,
      name: key.name,
      envKeys: Object.keys(key.env).sort(),
      updatedAt: key.updatedAt,
    },
    template: {
      id: template.id,
      providerTypeId: template.providerTypeId,
      name: template.name,
      version: template.version,
      variables: redactTemplateVariables(template.variables),
      files: template.files,
      fileNames: Object.keys(template.files).sort(),
      updatedAt: template.updatedAt,
    },
    shell: shellSnapshot,
  };
}

function validateShellCompatibility(shell: ShellResource, shellBinding: ShellBinding, template: TerraformTemplate) {
  if (shell.id !== shellBinding.shellId) {
    throw new Error(`Shell binding ${shellBinding.shellId} does not match shell ${shell.id}`);
  }
  resolveShellStartupVariable(template, shell.id);
}

function resolveShellStartupVariable(template: TerraformTemplate, shellId: string) {
  const variableNames = new Set(template.variables.map((variable) => variable.name));
  const candidates = startupVariableCandidates(template.providerTypeId);
  const variableName = candidates.find((candidate) => variableNames.has(candidate));
  if (!variableName) {
    throw new Error(`Shell ${shellId} requires template variable ${candidates.join(" or ")}`);
  }
  return variableName;
}

function startupVariableCandidates(providerTypeId: string) {
  if (providerTypeId === "aliyun-alicloud") {
    return ["user_data"];
  }
  if (providerTypeId === "google") {
    return ["startup_script"];
  }
  return ["user_data", "startup_script", "cloud_init"];
}

function templateResourceAddresses(template: TerraformTemplate) {
  const addresses = new Set<string>();
  for (const [fileName, content] of Object.entries(template.files)) {
    if (fileName.endsWith(".tf.json")) {
      addJsonTemplateResourceAddresses(content, addresses);
      continue;
    }
    for (const match of stripHclComments(content).matchAll(/resource\s+"([A-Za-z0-9_-]+)"\s+"([A-Za-z0-9_-]+)"/g)) {
      addresses.add(`${match[1]}.${match[2]}`);
    }
  }
  return addresses;
}

function addJsonTemplateResourceAddresses(content: string, addresses: Set<string>) {
  try {
    const parsed = JSON.parse(content) as { resource?: unknown };
    if (!parsed.resource || typeof parsed.resource !== "object" || Array.isArray(parsed.resource)) {
      return;
    }
    for (const [resourceType, resources] of Object.entries(parsed.resource)) {
      if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
        continue;
      }
      for (const resourceName of Object.keys(resources)) {
        if (/^[A-Za-z0-9_-]+$/.test(resourceType) && /^[A-Za-z0-9_-]+$/.test(resourceName)) {
          addresses.add(`${resourceType}.${resourceName}`);
        }
      }
    }
  } catch {
    return;
  }
}

function stripHclComments(content: string) {
  return content
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function runtimeActionExample(
  apiId: string,
  action: "deploy" | "delete",
  body: { vars?: Record<string, string> },
): NonNullable<RuntimeCallExample["deploy"]> {
  const path = `/api/deployments/${apiId}/${action}`;
  const json = JSON.stringify(body);
  return {
    method: "POST",
    path,
    body,
    curl: `curl -X POST \"$BASE_URL${path}\" -H \"Authorization: Bearer $ADMIN_API_KEY\" -H \"Content-Type: application/json\" -d '${json}'`,
  };
}
