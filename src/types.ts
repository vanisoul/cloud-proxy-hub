export type JsonRecord = Record<string, unknown>;

export type ProviderType = {
  id: string;
  name: string;
  sourceAddress: string;
  versionConstraint: string;
  requiredEnv: string[];
  supportedActions: DeploymentAction[];
  docsUrl: string;
};

export type ProviderKey = {
  id: string;
  providerTypeId: string;
  name: string;
  description?: string;
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type PublicProviderKey = Omit<ProviderKey, "env"> & {
  envKeys: string[];
};

export type TemplateVariable = {
  name: string;
  required: boolean;
  sensitive: boolean;
  defaultValue?: string;
};

export type TerraformTemplate = {
  id: string;
  providerTypeId: string;
  name: string;
  version: string;
  description?: string;
  variables: TemplateVariable[];
  files: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type PublicTerraformTemplate = Omit<TerraformTemplate, "files"> & {
  fileNames: string[];
};

export type ApiPublication = {
  id: string;
  providerTypeId: string;
  name: string;
  keyId: string;
  templateId: string;
  allowedActions: DeploymentAction[];
  createdAt: string;
  updatedAt: string;
};

export type DeploymentAction = "deploy" | "delete";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "needs_attention";

export type TerraformRun = {
  id: string;
  apiId: string;
  providerTypeId: string;
  keyId: string;
  templateId: string;
  action: DeploymentAction;
  status: RunStatus;
  vars: Record<string, string>;
  sensitiveVarNames: string[];
  stateId: string;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
  error?: string;
};
