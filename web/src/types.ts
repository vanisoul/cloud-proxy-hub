export type DeploymentAction = "deploy" | "delete";

export type ProviderType = {
  id: string;
  name: string;
  sourceAddress: string;
  versionConstraint: string;
  requiredEnv: string[];
  supportedActions: DeploymentAction[];
  docsUrl: string;
};

export type PublicProviderKey = {
  id: string;
  providerTypeId: string;
  name: string;
  description?: string;
  envKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type TemplateVariable = {
  name: string;
  required: boolean;
  sensitive: boolean;
  defaultValue?: string;
};

export type PublicTerraformTemplate = {
  id: string;
  providerTypeId: string;
  name: string;
  version: string;
  description?: string;
  variables: TemplateVariable[];
  fileNames: string[];
  resourceAddresses: string[];
  createdAt: string;
  updatedAt: string;
};

export type TerraformTemplate = Omit<PublicTerraformTemplate, "fileNames"> & {
  files: Record<string, string>;
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
  shellId?: string;
  shellBinding?: ShellBinding;
  allowedActions: DeploymentAction[];
  revisionId: string;
  snapshot: {
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
  createdAt: string;
  updatedAt: string;
};

export type TerraformRun = {
  id: string;
  apiId: string;
  apiRevisionId: string;
  providerTypeId: string;
  keyId: string;
  templateId: string;
  shellId?: string;
  action: DeploymentAction;
  status: "queued" | "running" | "succeeded" | "failed" | "needs_attention";
  vars: Record<string, string>;
  sensitiveVarNames: string[];
  stateId: string;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
  error?: string;
  workdir?: string;
  artifactsDir?: string;
  commandResults?: Array<{
    step: "init" | "validate" | "apply" | "destroy" | "output";
    exitCode: number;
    output: string;
  }>;
};

export type TerraformRunEventType =
  | "queued"
  | "running"
  | "command_started"
  | "command_output"
  | "command_finished"
  | "succeeded"
  | "failed";

export type TerraformRunEvent = {
  id: string;
  apiId: string;
  runId: string;
  createdAt: string;
  type: TerraformRunEventType;
  step?: NonNullable<TerraformRun["commandResults"]>[number]["step"];
  exitCode?: number;
  message?: string;
  output?: string;
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
  body: { vars: Record<string, string> };
  curl: string;
};

export type BootstrapResponse = {
  providerTypes: ProviderType[];
  keys: PublicProviderKey[];
  templates: PublicTerraformTemplate[];
  shells: ShellResource[];
  apis: ApiPublication[];
};
