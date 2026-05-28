import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  RuntimeCallExample,
  TerraformRun,
  TerraformTemplate,
  TerraformTemplateInput,
} from "@/types";

type KeyInput = Omit<ProviderKey, "createdAt" | "updatedAt" | "id"> & { id?: string };
type ApiInput = Omit<ApiPublication, "createdAt" | "updatedAt" | "id" | "revisionId" | "snapshot"> & { id?: string };

export class PlatformStore {
  async initialize() {
    await Promise.all([
      mkdir(this.configPath("terraform-providers"), { recursive: true }),
      mkdir(this.configPath("keys"), { recursive: true }),
      mkdir(this.configPath("templates"), { recursive: true }),
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

  async saveTemplate(input: TerraformTemplateInput): Promise<PublicTerraformTemplate> {
    await this.getProviderType(input.providerTypeId);
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
    return this.readJson<ApiPublication>(this.apiPath(providerTypeId, apiId, "metadata.json"));
  }

  async saveApi(input: ApiInput): Promise<ApiPublication> {
    const providerType = await this.getProviderType(input.providerTypeId);
    const key = await this.getKey(input.providerTypeId, input.keyId);
    const template = await this.getTemplate(input.providerTypeId, input.templateId);
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
    const api: ApiPublication = {
      ...input,
      id,
      revisionId: uuidV7(),
      snapshot: toApiSnapshot(key, template),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const apiDir = this.apiPath(api.providerTypeId, api.id);
    await mkdir(apiDir, { recursive: true });
    await this.writeJson(join(apiDir, "metadata.json"), api);
    await mkdir(this.apiDataPath(api.id, "runs"), { recursive: true });
    return api;
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
    return this.readJson<TerraformRun>(this.runPath(apiId, runId, "run.json"));
  }

  async listRuns(apiId: string): Promise<TerraformRun[]> {
    await this.getApi(apiId);
    const runsDir = this.apiDataPath(apiId, "runs");
    await mkdir(runsDir, { recursive: true });
    const runIds = await readdir(runsDir);
    const runs = await Promise.all(
      runIds.map((runId) => this.readJson<TerraformRun>(this.runPath(apiId, runId, "run.json"))),
    );
    return runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getRuntimeCallExample(apiId: string): Promise<RuntimeCallExample> {
    const api = await this.getApi(apiId);
    const body = {
      vars: Object.fromEntries(api.snapshot.template.variables.map((variable) => [variable.name, ""])),
    };
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
      runIds.map((runId) => this.readJson<TerraformRun>(this.runPath(apiId, runId, "run.json"))),
    );
    return runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
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

  private async listProviderApis(providerTypeId: string) {
    const providerDir = this.configPath("apis", providerTypeId);
    await mkdir(providerDir, { recursive: true });
    const apiIds = await readdir(providerDir);
    return Promise.all(apiIds.map((id) => this.getProviderApi(providerTypeId, id)));
  }

  private async assertApiDoesNotReference(providerTypeId: string, reference: { keyId?: string; templateId?: string }) {
    const apis = await this.listApis(providerTypeId);
    const found = apis.find(
      (api) =>
        (reference.keyId !== undefined && api.keyId === reference.keyId) ||
        (reference.templateId !== undefined && api.templateId === reference.templateId),
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
  return { ...rest, fileNames: Object.keys(files).sort() };
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


function toApiSnapshot(key: ProviderKey, template: TerraformTemplate): ApiPublication["snapshot"] {
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
      variables: template.variables,
      files: template.files,
      fileNames: Object.keys(template.files).sort(),
      updatedAt: template.updatedAt,
    },
  };
}

function runtimeActionExample(
  apiId: string,
  action: "deploy" | "delete",
  body: { vars: Record<string, string> },
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
