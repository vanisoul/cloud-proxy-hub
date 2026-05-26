export type JsonRecord = Record<string, unknown>;

export type ProviderType = {
  id: string;
  name: string;
  sourceAddress: string;
  versionConstraint: string;
  requiredEnv: string[];
  supportedActions: TerraformAction[];
  docsUrl: string;
};

export type Credential = {
  id: string;
  providerTypeId: string;
  name: string;
  env: Record<string, string>;
  allowedWorkspaceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProviderInstance = {
  id: string;
  providerTypeId: string;
  credentialId: string;
  name: string;
  defaults: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  id: string;
  name: string;
  allowedTemplateIds: string[];
  currentStateId?: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateVariable = {
  name: string;
  required: boolean;
  sensitive: boolean;
  defaultValue?: string;
};

export type TerraformTemplate = {
  id: string;
  name: string;
  providerTypeId: string;
  version: string;
  variables: TemplateVariable[];
  files: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type ApiPublication = {
  id: string;
  name: string;
  workspaceId: string;
  templateId: string;
  providerInstanceId: string;
  allowedActions: TerraformAction[];
  createdAt: string;
  updatedAt: string;
};

export type TerraformAction = "plan" | "apply" | "destroy" | "refresh";

export type RunStatus = "queued" | "planning" | "planned" | "applying" | "succeeded" | "failed" | "needs_attention";

export type TerraformRun = {
  id: string;
  apiId: string;
  workspaceId: string;
  templateId: string;
  providerInstanceId: string;
  action: TerraformAction;
  status: RunStatus;
  vars: Record<string, string>;
  sensitiveVarNames: string[];
  stateId: string;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
  error?: string;
};

export type PublicCredential = Omit<Credential, "env"> & {
  envKeys: string[];
};
