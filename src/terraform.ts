import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appConfig } from "@/config";
import { PlatformStore } from "@/storage";
import type { ApiPublication, TerraformAction, TerraformRun } from "@/types";

type RunInput = {
  action: TerraformAction;
  vars: Record<string, string>;
};

export class TerraformService {
  constructor(private readonly store: PlatformStore) {}

  async testProviderInstance(providerInstanceId: string) {
    const instance = await this.store.getProviderInstance(providerInstanceId);
    const providerType = await this.store.getProviderType(instance.providerTypeId);
    const credential = await this.store.getCredential(instance.credentialId);
    const missing = providerType.requiredEnv.filter((name) => !credential.env[name]);
    return {
      providerInstanceId,
      providerTypeId: providerType.id,
      ok: missing.length === 0,
      missingEnv: missing,
    };
  }

  async createRun(api: ApiPublication, input: RunInput): Promise<TerraformRun> {
    if (!api.allowedActions.includes(input.action)) {
      throw new Error(`Action ${input.action} is not allowed for API ${api.id}`);
    }

    const template = await this.store.getTemplate(api.templateId);
    const missing = template.variables.filter(
      (variable) => variable.required && input.vars[variable.name] === undefined,
    );
    if (missing.length > 0) {
      throw new Error(`Missing variables: ${missing.map((variable) => variable.name).join(", ")}`);
    }

    const run: TerraformRun = {
      id: crypto.randomUUID(),
      apiId: api.id,
      workspaceId: api.workspaceId,
      templateId: api.templateId,
      providerInstanceId: api.providerInstanceId,
      action: input.action,
      status: "queued",
      vars: redactVars(
        input.vars,
        template.variables.filter((variable) => variable.sensitive).map((variable) => variable.name),
      ),
      sensitiveVarNames: template.variables
        .filter((variable) => variable.sensitive)
        .map((variable) => variable.name)
        .sort(),
      stateId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const executionVars = sanitizeVars(
      template.variables.map((variable) => variable.name),
      input.vars,
    );
    await this.store.saveRun(run);
    return this.execute(run, executionVars);
  }

  async execute(run: TerraformRun, executionVars: Record<string, string>): Promise<TerraformRun> {
    const api = await this.store.getApi(run.apiId);
    const template = await this.store.getTemplate(api.templateId);
    const providerInstance = await this.store.getProviderInstance(api.providerInstanceId);
    const providerType = await this.store.getProviderType(providerInstance.providerTypeId);
    const credential = await this.store.getCredential(providerInstance.credentialId);
    const runDir = this.store.runPath(run.apiId, run.id);
    const secrets = [...Object.values(credential.env), ...Object.values(executionVars)];

    await mkdir(runDir, { recursive: true });
    await Promise.all(
      Object.entries(template.files).map(async ([fileName, content]) => {
        const filePath = join(runDir, fileName);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, { mode: 0o600 });
      }),
    );
    await writeFile(join(runDir, "terraform.tfvars.json"), `${JSON.stringify(executionVars, null, 2)}\n`, {
      mode: 0o600,
    });
    await writeFile(
      join(runDir, "versions.tf"),
      providerRequirement(providerType.sourceAddress, providerType.versionConstraint),
      {
        mode: 0o600,
      },
    );
    await writeFile(
      join(runDir, "provider.json"),
      `${JSON.stringify({ source: providerType.sourceAddress }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );

    const env = terraformEnv(credential.env);
    const init = await runTerraform(["init", "-input=false"], runDir, env);
    if (init.exitCode !== 0) {
      return this.fail(run, init.exitCode, init.output, secrets);
    }

    const validate = await runTerraform(["validate", "-no-color"], runDir, env);
    if (validate.exitCode !== 0) {
      return this.fail(run, validate.exitCode, validate.output, secrets);
    }

    const action = await runTerraform(terraformArgs(run.action), runDir, env);
    const status = action.exitCode === 0 ? successStatus(run.action) : "failed";
    const redactedOutput = redactSecrets(action.output, secrets);
    const updated = updateRun(run, status, action.exitCode, redactedOutput);
    await writeFile(join(runDir, "logs.redacted.txt"), redactedOutput, {
      mode: 0o600,
    });
    await this.store.saveRun(updated);
    return updated;
  }

  private async fail(run: TerraformRun, exitCode: number, output: string, secrets: string[]) {
    const redactedOutput = redactSecrets(output, secrets);
    const failed = updateRun(run, "failed", exitCode, redactedOutput);
    await writeFile(this.store.runPath(run.apiId, run.id, "logs.redacted.txt"), redactedOutput, { mode: 0o600 });
    await this.store.saveRun(failed);
    return failed;
  }
}

function updateRun(run: TerraformRun, status: TerraformRun["status"], exitCode: number, output: string): TerraformRun {
  return {
    ...run,
    status,
    exitCode,
    error: status === "failed" ? output.slice(0, 2000) : undefined,
    updatedAt: new Date().toISOString(),
  };
}

async function runTerraform(args: string[], cwd: string, env: Record<string, string | undefined>) {
  const proc = Bun.spawn([Bun.env.TERRAFORM_BIN ?? appConfig.terraformBin, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

function terraformEnv(credentialEnv: Record<string, string>) {
  return {
    HOME: Bun.env.HOME,
    PATH: Bun.env.PATH,
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_LOG: "",
    ...credentialEnv,
  };
}

function providerRequirement(sourceAddress: string, versionConstraint: string) {
  const localName = sourceAddress.split("/").at(-1);
  if (!localName || !/^[a-zA-Z0-9_-]+$/.test(localName)) {
    throw new Error(`Invalid Terraform provider source: ${sourceAddress}`);
  }
  return `terraform {
  required_providers {
    ${localName} = {
      source = "${sourceAddress}"
      version = "${versionConstraint}"
    }
  }
}
`;
}

function sanitizeVars(allowedNames: string[], vars: Record<string, string>) {
  const allowed = new Set(allowedNames);
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!allowed.has(key)) {
      throw new Error(`Variable ${key} is not declared by this template`);
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function redactVars(vars: Record<string, string>, sensitiveNames: string[]) {
  const sensitive = new Set(sensitiveNames);
  return Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, sensitive.has(key) ? "[REDACTED]" : value]),
  );
}

function terraformArgs(action: TerraformAction) {
  switch (action) {
    case "plan":
      return ["plan", "-input=false", "-no-color", "-out=plan.bin"];
    case "apply":
      return ["apply", "-input=false", "-no-color", "-auto-approve"];
    case "destroy":
      return ["destroy", "-input=false", "-no-color", "-auto-approve"];
    case "refresh":
      return ["refresh", "-input=false", "-no-color"];
  }
}

function successStatus(action: TerraformAction): TerraformRun["status"] {
  return action === "plan" ? "planned" : "succeeded";
}

function redactSecrets(output: string, secrets: string[]) {
  return secrets.reduce((current, secret) => (secret ? current.replaceAll(secret, "[REDACTED]") : current), output);
}
