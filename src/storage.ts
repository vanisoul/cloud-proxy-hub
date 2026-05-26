import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

import { appConfig, builtInProviderTypes } from "@/config";
import type {
  ApiPublication,
  Credential,
  ProviderInstance,
  ProviderType,
  PublicCredential,
  TerraformRun,
  TerraformTemplate,
  Workspace,
} from "@/types";

type CollectionName = "credentials" | "provider-instances" | "workspaces" | "templates" | "apis";

export class PlatformStore {
  async initialize() {
    await Promise.all([
      mkdir(this.configPath("terraform-providers"), { recursive: true }),
      mkdir(this.configPath("credentials"), { recursive: true }),
      mkdir(this.configPath("provider-instances"), { recursive: true }),
      mkdir(this.configPath("workspaces"), { recursive: true }),
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

  async listCredentials(): Promise<PublicCredential[]> {
    const credentials = await this.listFiles<Credential>(this.configPath("credentials"));
    return credentials.map(toPublicCredential);
  }

  async getCredential(id: string): Promise<Credential> {
    return this.readJson<Credential>(this.configPath("credentials", `${id}.json`));
  }

  async saveCredential(input: Omit<Credential, "createdAt" | "updatedAt">): Promise<PublicCredential> {
    const now = new Date().toISOString();
    const credential: Credential = { ...input, createdAt: now, updatedAt: now };
    await this.writeCollection("credentials", credential.id, credential);
    return toPublicCredential(credential);
  }

  async listProviderInstances(): Promise<ProviderInstance[]> {
    return this.listFiles<ProviderInstance>(this.configPath("provider-instances"));
  }

  async getProviderInstance(id: string): Promise<ProviderInstance> {
    return this.readJson<ProviderInstance>(this.configPath("provider-instances", `${id}.json`));
  }

  async saveProviderInstance(input: Omit<ProviderInstance, "createdAt" | "updatedAt">): Promise<ProviderInstance> {
    await this.getProviderType(input.providerTypeId);
    await this.getCredential(input.credentialId);
    const now = new Date().toISOString();
    const instance = { ...input, createdAt: now, updatedAt: now };
    await this.writeCollection("provider-instances", instance.id, instance);
    return instance;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return this.listFiles<Workspace>(this.configPath("workspaces"));
  }

  async getWorkspace(id: string): Promise<Workspace> {
    return this.readJson<Workspace>(this.configPath("workspaces", `${id}.json`));
  }

  async saveWorkspace(input: Omit<Workspace, "createdAt" | "updatedAt">): Promise<Workspace> {
    const now = new Date().toISOString();
    const workspace = { ...input, createdAt: now, updatedAt: now };
    await this.writeCollection("workspaces", workspace.id, workspace);
    return workspace;
  }

  async listTemplates(): Promise<TerraformTemplate[]> {
    return this.listFiles<TerraformTemplate>(this.configPath("templates"));
  }

  async getTemplate(id: string): Promise<TerraformTemplate> {
    return this.readJson<TerraformTemplate>(this.configPath("templates", `${id}.json`));
  }

  async saveTemplate(input: Omit<TerraformTemplate, "createdAt" | "updatedAt">): Promise<TerraformTemplate> {
    await this.getProviderType(input.providerTypeId);
    assertSafeTemplate(input);
    const now = new Date().toISOString();
    const template = { ...input, createdAt: now, updatedAt: now };
    await this.writeCollection("templates", template.id, template);
    return template;
  }

  async listApis(): Promise<ApiPublication[]> {
    return this.listFiles<ApiPublication>(this.configPath("apis"));
  }

  async getApi(id: string): Promise<ApiPublication> {
    return this.readJson<ApiPublication>(this.configPath("apis", `${id}.json`));
  }

  async saveApi(input: Omit<ApiPublication, "createdAt" | "updatedAt">): Promise<ApiPublication> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const template = await this.getTemplate(input.templateId);
    const providerInstance = await this.getProviderInstance(input.providerInstanceId);
    const credential = await this.getCredential(providerInstance.credentialId);
    if (template.providerTypeId !== providerInstance.providerTypeId) {
      throw new Error("Template provider type does not match provider instance");
    }
    if (!workspace.allowedTemplateIds.includes(template.id)) {
      throw new Error("Template is not allowed in this workspace");
    }
    if (!credential.allowedWorkspaceIds.includes(workspace.id)) {
      throw new Error("Credential is not allowed in this workspace");
    }
    const now = new Date().toISOString();
    const api = { ...input, createdAt: now, updatedAt: now };
    await this.writeCollection("apis", api.id, api);
    await mkdir(this.apiDataPath(api.id, "runs"), { recursive: true });
    return api;
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

  runPath(apiId: string, runId: string, ...parts: string[]) {
    return this.dataPath("apis", apiId, "runs", runId, ...parts);
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

  private async writeCollection(collection: CollectionName, id: string, value: unknown) {
    await this.writeJson(this.configPath(collection, `${id}.json`), value);
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

  private async writeJson(filePath: string, value: unknown) {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, filePath);
  }

  async removeRuntimeData() {
    await rm(appConfig.dataDir, { recursive: true, force: true });
  }
}

function toPublicCredential(credential: Credential): PublicCredential {
  const { env, ...rest } = credential;
  return { ...rest, envKeys: Object.keys(env).sort() };
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

function assertSafeTemplate(template: Omit<TerraformTemplate, "createdAt" | "updatedAt">) {
  for (const [fileName, content] of Object.entries(template.files)) {
    if (isUnsafeRelativePath(fileName)) {
      throw new Error(`Template file ${fileName} is not a safe relative path`);
    }
    if (!fileName.endsWith(".tf") && !fileName.endsWith(".tf.json")) {
      throw new Error(`Template file ${fileName} is not a Terraform file`);
    }
    if (/provisioner\s+|backend\s+|required_providers\s+|local-exec|remote-exec/i.test(content)) {
      throw new Error(`Template file ${fileName} contains a blocked Terraform construct`);
    }
    if (fileName.endsWith(".tf.json") && hasBlockedTerraformJsonConstruct(content)) {
      throw new Error(`Template file ${fileName} contains a blocked Terraform construct`);
    }
  }
}

function hasBlockedTerraformJsonConstruct(content: string) {
  try {
    return containsBlockedJsonKey(JSON.parse(content));
  } catch {
    throw new Error("Template file contains invalid Terraform JSON");
  }
}

function containsBlockedJsonKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsBlockedJsonKey);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) =>
      ["backend", "provisioner", "required_providers"].includes(key) ||
      (key === "terraform" && typeof child === "object") ||
      containsBlockedJsonKey(child),
  );
}

function isUnsafeRelativePath(fileName: string) {
  const normalized = normalize(fileName);
  const segments = fileName.split(/[\\/]+/);
  return (
    isAbsolute(fileName) ||
    segments.includes("..") ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    normalized.includes(`${sep}..${sep}`)
  );
}
