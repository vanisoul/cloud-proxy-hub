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

export type TerraformTemplateInput = Omit<TerraformTemplate, "createdAt" | "updatedAt" | "files" | "id"> & {
  id?: string;
  files?: Record<string, string>;
  mainTf?: string;
};

export type PublicTerraformTemplate = Omit<TerraformTemplate, "files"> & {
  fileNames: string[];
  resourceAddresses: string[];
};

export type ShellBinding = {
  shellId: string;
};

export type ShellResource = {
  id: string;
  providerTypeId: string;
  name: string;
  description?: string;
  inline: string[];
  createdAt: string;
  updatedAt: string;
};

export type ApiPublication = {
  id: string;
  providerTypeId: string;
  name: string;
  keyId: string;
  templateId: string;
  vars: Record<string, string>;
  shellId?: string;
  shellBinding?: ShellBinding;
  allowedActions: DeploymentAction[];
  revisionId: string;
  snapshot: ApiPublicationSnapshot;
  createdAt: string;
  updatedAt: string;
};

export type ApiPublicationSnapshot = {
  key: {
    id: string;
    providerTypeId: string;
    name: string;
    envKeys: string[];
    updatedAt: string;
  };
  template: {
    id: string;
    providerTypeId: string;
    name: string;
    version: string;
    variables: TemplateVariable[];
    files: Record<string, string>;
    fileNames: string[];
    updatedAt: string;
  };
  shell?: {
    id: string;
    providerTypeId: string;
    name: string;
    inline: string[];
    startupVariable: string;
    updatedAt: string;
  };
};

export type DeploymentAction = "deploy" | "delete";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "needs_attention";

export type TerraformRun = {
  id: string;
  apiId: string;
  apiRevisionId: string;
  providerTypeId: string;
  keyId: string;
  templateId: string;
  shellId?: string;
  action: DeploymentAction;
  status: RunStatus;
  vars: Record<string, string>;
  sensitiveVarNames: string[];
  stateId: string;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
  error?: string;
  workdir?: string;
  artifactsDir?: string;
  commandResults?: TerraformCommandResult[];
};

export type TerraformCommandResult = {
  step: "init" | "validate" | "apply" | "destroy" | "output";
  exitCode: number;
  output: string;
};

export type TerraformRunEventType =
  | "queued"
  | "running"
  | "command_started"
  | "command_output"
  | "command_finished"
  | "init_shell_output"
  | "succeeded"
  | "failed";

export type TerraformRunEvent = {
  id: string;
  apiId: string;
  runId: string;
  createdAt: string;
  type: TerraformRunEventType;
  step?: TerraformCommandResult["step"];
  exitCode?: number;
  message?: string;
  output?: string;
};

export type InitShellLogStatus = "disabled" | "waiting" | "received" | "completed";

export type InitShellLogResponse = {
  enabled: boolean;
  status: InitShellLogStatus;
  content: string;
  updatedAt?: string;
  reason?: string;
};

export type RuntimeCallExample = {
  apiId: string;
  apiRevisionId: string;
  deploy?: RuntimeActionExample;
  delete?: RuntimeActionExample;
};

export type RuntimeActionExample = {
  method: "POST";
  path: string;
  body: { vars?: Record<string, string> };
  curl: string;
};

export type TerraformOutputSnapshot = {
  apiId: string;
  runId: string;
  revisionId: string;
  capturedAt: string;
  outputs: Record<string, unknown>;
};

export type RuntimeOutputResponse = {
  apiId: string;
  outputName: string;
  value: unknown;
  sensitive: boolean;
};
