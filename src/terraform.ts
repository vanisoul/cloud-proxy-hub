import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appConfig } from "@/config";
import { uuidV7 } from "@/id";
import { PlatformStore } from "@/storage";
import { normalizeTemplateFiles } from "@/template";
import type {
  ApiPublication,
  DeploymentAction,
  TerraformCommandResult,
  TerraformRun,
  TerraformTemplateInput,
} from "@/types";

type RunInput = {
  vars: Record<string, string>;
};

export class TerraformService {
  private readonly activeApiRuns = new Set<string>();

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

  async validateTemplate(input: TerraformTemplateInput) {
    const providerType = await this.store.getProviderType(input.providerTypeId);
    const workDir = this.store.dataPath("template-validations", uuidV7());
    try {
      await mkdir(workDir, { recursive: true });
      await Promise.all(
        Object.entries(normalizeTemplateFiles(input)).map(async ([fileName, content]) => {
          const filePath = join(workDir, fileName);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, content, { mode: 0o600 });
        }),
      );
      await writeFile(
        join(workDir, "versions.tf"),
        providerRequirement(providerType.sourceAddress, providerType.versionConstraint),
        { mode: 0o600 },
      );
      const env = terraformEnv({});
      const init = await runTerraform(["init", "-input=false"], workDir, env);
      if (init.exitCode !== 0) {
        throw new Error(init.output);
      }
      const validate = await runTerraform(["validate", "-no-color"], workDir, env);
      if (validate.exitCode !== 0) {
        throw new Error(validate.output);
      }
      return { ok: true, providerTypeId: input.providerTypeId };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
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
    const result = await runTerraform(["output", "-json"], this.store.terraformPath(apiId), env);
    if (result.exitCode !== 0) {
      return { apiId, outputs: {}, latestRun, error: "Terraform output failed" };
    }
    return { apiId, outputs: redactTerraformOutputs(parseOutputJson(result.output)), latestRun };
  }

  private async createRun(api: ApiPublication, action: DeploymentAction, input: RunInput): Promise<TerraformRun> {
    if (!api.allowedActions.includes(action)) {
      throw new Error(`Action ${action} is not allowed for API ${api.id}`);
    }
    if (this.activeApiRuns.has(api.id)) {
      throw new Error(`API ${api.id} already has a Terraform run in progress`);
    }
    this.activeApiRuns.add(api.id);

    try {
      const template = api.snapshot.template;
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
      const runId = uuidV7();
      const run: TerraformRun = {
        id: runId,
        apiId: api.id,
        apiRevisionId: api.revisionId,
        providerTypeId: api.providerTypeId,
        keyId: api.keyId,
        templateId: api.templateId,
        action,
        status: "queued",
        vars: redactVars(input.vars, sensitiveVarNames),
        sensitiveVarNames: sensitiveVarNames.sort(),
        stateId: uuidV7(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workdir: relativeApiPath(api.id),
        artifactsDir: relativeRunPath(api.id, runId),
      };

      await this.store.saveRun(run);
      await this.store.appendRunEvent(run.apiId, run.id, { type: "queued", message: `${action} queued` });
      return await this.execute(run, api, executionVars);
    } finally {
      this.activeApiRuns.delete(api.id);
    }
  }

  private async execute(
    run: TerraformRun,
    api: ApiPublication,
    executionVars: Record<string, string>,
  ): Promise<TerraformRun> {
    const template = api.snapshot.template;
    const providerType = await this.store.getProviderType(api.providerTypeId);
    const key = await this.store.getKey(api.providerTypeId, api.keyId);
    const workDir = this.store.terraformPath(run.apiId);
    const secrets = [...Object.values(key.env), ...Object.values(executionVars)];
    const runningRun: TerraformRun = { ...run, status: "running", updatedAt: new Date().toISOString() };

    await this.store.saveRun(runningRun);
    await this.store.appendRunEvent(run.apiId, run.id, { type: "running", message: `${run.action} started` });
    await mkdir(workDir, { recursive: true });
    await cleanManagedTerraformFiles(workDir);
    await Promise.all(
      Object.entries(template.files).map(async ([fileName, content]) => {
        const filePath = join(workDir, fileName);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, { mode: 0o600 });
      }),
    );
    await writeFile(join(workDir, "terraform.tfvars.json"), `${JSON.stringify(executionVars, null, 2)}\n`, {
      mode: 0o600,
    });
    await writeFile(
      join(workDir, "versions.tf"),
      providerRequirement(providerType.sourceAddress, providerType.versionConstraint),
      { mode: 0o600 },
    );
    await writeFile(
      this.store.runPath(run.apiId, run.id, "versions.tf"),
      providerRequirement(providerType.sourceAddress, providerType.versionConstraint),
      { mode: 0o600 },
    );
    await writeFile(
      join(workDir, "provider.json"),
      `${JSON.stringify({ source: providerType.sourceAddress }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );

    const env = terraformEnv(key.env);
    const commandResults: TerraformCommandResult[] = [];
    const init = await this.runCommand(run, "init", ["init", "-input=false"], workDir, env, secrets);
    commandResults.push(toCommandResult("init", init, secrets));
    if (init.exitCode !== 0) {
      return this.fail(runningRun, init.exitCode, init.output, secrets, commandResults);
    }

    const validate = await this.runCommand(run, "validate", ["validate", "-no-color"], workDir, env, secrets);
    commandResults.push(toCommandResult("validate", validate, secrets));
    if (validate.exitCode !== 0) {
      return this.fail(runningRun, validate.exitCode, validate.output, secrets, commandResults);
    }

    const actionStep = run.action === "deploy" ? "apply" : "destroy";
    const action = await this.runCommand(run, actionStep, terraformArgs(run.action), workDir, env, secrets);
    const redactedOutput = redactSecrets(action.output, secrets);
    commandResults.push(toCommandResult(actionStep, action, secrets));
    const updated = updateRun(
      runningRun,
      action.exitCode === 0 ? "succeeded" : "failed",
      action.exitCode,
      redactedOutput,
      commandResults,
    );
    await writeFile(this.store.runPath(run.apiId, run.id, "logs.redacted.txt"), redactedOutput, { mode: 0o600 });
    await this.store.saveRun(updated);
    await this.store.appendRunEvent(run.apiId, run.id, {
      type: updated.status === "succeeded" ? "succeeded" : "failed",
      exitCode: action.exitCode,
      message: `${run.action} ${updated.status}`,
      output: redactedOutput,
    });
    return updated;
  }

  private async runCommand(
    run: TerraformRun,
    step: TerraformCommandResult["step"],
    args: string[],
    workDir: string,
    env: Record<string, string | undefined>,
    secrets: string[],
  ) {
    const message = `terraform ${args.join(" ")}`;
    await this.store.appendRunEvent(run.apiId, run.id, { type: "command_started", step, message });
    const result = await runTerraform(args, workDir, env);
    await this.store.appendRunEvent(run.apiId, run.id, {
      type: "command_finished",
      step,
      exitCode: result.exitCode,
      message,
      output: redactSecrets(result.output, secrets),
    });
    return result;
  }

  private async fail(
    run: TerraformRun,
    exitCode: number,
    output: string,
    secrets: string[],
    commandResults: TerraformCommandResult[],
  ) {
    const redactedOutput = redactSecrets(output, secrets);
    const failed = updateRun(run, "failed", exitCode, redactedOutput, commandResults);
    await writeFile(this.store.runPath(run.apiId, run.id, "logs.redacted.txt"), redactedOutput, { mode: 0o600 });
    await this.store.saveRun(failed);
    await this.store.appendRunEvent(run.apiId, run.id, {
      type: "failed",
      exitCode,
      message: `${run.action} failed`,
      output: redactedOutput,
    });
    return failed;
  }
}

function updateRun(
  run: TerraformRun,
  status: TerraformRun["status"],
  exitCode: number,
  output: string,
  commandResults: TerraformCommandResult[],
): TerraformRun {
  return {
    ...run,
    status,
    exitCode,
    error: status === "failed" ? output.slice(0, 2000) : undefined,
    commandResults,
    updatedAt: new Date().toISOString(),
  };
}

function toCommandResult(
  step: TerraformCommandResult["step"],
  result: { exitCode: number; output: string },
  secrets: string[],
): TerraformCommandResult {
  return { step, exitCode: result.exitCode, output: redactSecrets(result.output, secrets) };
}

function relativeApiPath(apiId: string) {
  return `data/apis/${apiId}`;
}

function relativeRunPath(apiId: string, runId: string) {
  return `data/apis/${apiId}/runs/${runId}`;
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

async function cleanManagedTerraformFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === ".terraform") {
        return;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await cleanManagedTerraformFiles(path);
        return;
      }
      if (
        entry.name.endsWith(".tf") ||
        entry.name.endsWith(".tf.json") ||
        entry.name === "terraform.tfvars.json" ||
        entry.name === "provider.json"
      ) {
        await rm(path, { force: true });
      }
    }),
  );
}
