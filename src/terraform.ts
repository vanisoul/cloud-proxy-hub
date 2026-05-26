import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appConfig } from "@/config";
import { PlatformStore } from "@/storage";
import type { ApiPublication, DeploymentAction, TerraformRun } from "@/types";

type RunInput = {
  vars: Record<string, string>;
};

export class TerraformService {
  constructor(private readonly store: PlatformStore) {}

  async testKey(providerTypeId: string, keyId: string) {
    const providerType = await this.store.getProviderType(providerTypeId);
    const key = await this.store.getKey(providerTypeId, keyId);
    const missing = providerType.requiredEnv.filter((name) => !key.env[name]);
    return {
      keyId,
      providerTypeId,
      ok: missing.length === 0,
      missingEnv: missing,
    };
  }

  async deploy(api: ApiPublication, input: RunInput) {
    return this.createRun(api, "deploy", input);
  }

  async delete(api: ApiPublication, input: RunInput) {
    return this.createRun(api, "delete", input);
  }

  async status(apiId: string) {
    await this.store.getApi(apiId);
    const latestRun = await this.store.getLatestRun(apiId);
    return { apiId, latestRun };
  }

  async output(apiId: string) {
    await this.store.getApi(apiId);
    const latestRun = await this.store.getLatestRun(apiId);
    if (!latestRun || latestRun.status !== "succeeded") {
      return { apiId, outputs: {}, latestRun };
    }
    const env = terraformEnv({});
    const result = await runTerraform(["output", "-json"], this.store.runPath(apiId, latestRun.id), env);
    if (result.exitCode !== 0) {
      return { apiId, outputs: {}, latestRun, error: "Terraform output failed" };
    }
    return { apiId, outputs: redactTerraformOutputs(parseOutputJson(result.output)), latestRun };
  }

  private async createRun(api: ApiPublication, action: DeploymentAction, input: RunInput): Promise<TerraformRun> {
    if (!api.allowedActions.includes(action)) {
      throw new Error(`Action ${action} is not allowed for API ${api.id}`);
    }

    const template = await this.store.getTemplate(api.providerTypeId, api.templateId);
    const missing = template.variables.filter(
      (variable) => variable.required && input.vars[variable.name] === undefined,
    );
    if (missing.length > 0) {
      throw new Error(`Missing variables: ${missing.map((variable) => variable.name).join(", ")}`);
    }

    const sensitiveVarNames = template.variables
      .filter((variable) => variable.sensitive)
      .map((variable) => variable.name);
    const executionVars = sanitizeVars(
      template.variables.map((variable) => variable.name),
      input.vars,
    );
    const run: TerraformRun = {
      id: crypto.randomUUID(),
      apiId: api.id,
      providerTypeId: api.providerTypeId,
      keyId: api.keyId,
      templateId: api.templateId,
      action,
      status: "queued",
      vars: redactVars(input.vars, sensitiveVarNames),
      sensitiveVarNames: sensitiveVarNames.sort(),
      stateId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.store.saveRun(run);
    return this.execute(run, executionVars);
  }

  private async execute(run: TerraformRun, executionVars: Record<string, string>): Promise<TerraformRun> {
    const api = await this.store.getApi(run.apiId);
    const template = await this.store.getTemplate(api.providerTypeId, api.templateId);
    const providerType = await this.store.getProviderType(api.providerTypeId);
    const key = await this.store.getKey(api.providerTypeId, api.keyId);
    const runDir = this.store.runPath(run.apiId, run.id);
    const secrets = [...Object.values(key.env), ...Object.values(executionVars)];

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
      { mode: 0o600 },
    );
    await writeFile(
      join(runDir, "provider.json"),
      `${JSON.stringify({ source: providerType.sourceAddress }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );

    const env = terraformEnv(key.env);
    const init = await runTerraform(["init", "-input=false"], runDir, env);
    if (init.exitCode !== 0) {
      return this.fail(run, init.exitCode, init.output, secrets);
    }

    const validate = await runTerraform(["validate", "-no-color"], runDir, env);
    if (validate.exitCode !== 0) {
      return this.fail(run, validate.exitCode, validate.output, secrets);
    }

    const action = await runTerraform(terraformArgs(run.action), runDir, env);
    const redactedOutput = redactSecrets(action.output, secrets);
    const updated = updateRun(run, action.exitCode === 0 ? "succeeded" : "failed", action.exitCode, redactedOutput);
    await writeFile(join(runDir, "logs.redacted.txt"), redactedOutput, { mode: 0o600 });
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

function terraformEnv(keyEnv: Record<string, string>) {
  return {
    HOME: Bun.env.HOME,
    PATH: Bun.env.PATH,
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_LOG: "",
    ...keyEnv,
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

function terraformArgs(action: DeploymentAction) {
  return action === "deploy"
    ? ["apply", "-input=false", "-no-color", "-auto-approve"]
    : ["destroy", "-input=false", "-no-color", "-auto-approve"];
}

function redactSecrets(output: string, secrets: string[]) {
  return secrets.reduce((current, secret) => (secret ? current.replaceAll(secret, "[REDACTED]") : current), output);
}

function parseOutputJson(output: string) {
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function redactTerraformOutputs(outputs: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, redactTerraformOutputValue(value)]));
}

function redactTerraformOutputValue(value: unknown) {
  if (!isTerraformOutputObject(value) || value.sensitive !== true) {
    return value;
  }

  return { ...value, value: "[REDACTED]" };
}

function isTerraformOutputObject(
  value: unknown,
): value is { sensitive?: boolean; value?: unknown; [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
