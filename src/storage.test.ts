import { afterEach, describe, expect, it } from "bun:test";

const testRoot = `/tmp/cloud-proxy-hub-test-${crypto.randomUUID()}`;
Bun.env.CONFIG_DIR = `${testRoot}/config`;
Bun.env.DATA_DIR = `${testRoot}/data`;
Bun.env.ADMIN_API_KEY = "test-admin-key";

const { PlatformStore } = await import("@/storage");
const { TerraformService } = await import("@/terraform");
const store = new PlatformStore();

afterEach(async () => {
  await store.removeRuntimeData();
  await store.removeConfigData();
});

describe("PlatformStore", () => {
  it("rejects Terraform status and output for unpublished APIs", async () => {
    await store.initialize();
    const terraform = new TerraformService(store);

    await expectRejects(terraform.status("missing-api"), "not found");
    await expectRejects(terraform.output("missing-api"), "not found");
  });

  it("initializes built-in Terraform providers", async () => {
    await store.initialize();
    const providers = await store.listProviderTypes();
    expect(providers.map((provider) => provider.id)).toContain("aliyun-alicloud");
    expect(providers.map((provider) => provider.id)).toContain("google");
  });

  it("stores provider-scoped keys without returning secret values", async () => {
    await store.initialize();
    const key = await saveAliyunKey();
    const listed = await store.listKeys("aliyun-alicloud");
    const metadata = await Bun.file(`${testRoot}/config/keys/aliyun-alicloud/aliyun-main/metadata.json`).json();
    const secret = await Bun.file(`${testRoot}/config/keys/aliyun-alicloud/aliyun-main/secret.json`).json();

    expect(key.envKeys).toEqual(["ALICLOUD_ACCESS_KEY", "ALICLOUD_REGION", "ALICLOUD_SECRET_KEY"]);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(key)).not.toContain("secret");
    expect(JSON.stringify(metadata)).not.toContain("secret");
    expect(secret.env.ALICLOUD_SECRET_KEY).toBe("secret");
  });

  it("generates uuidv7 resource ids when callers omit ids", async () => {
    await store.initialize();
    const key = await store.saveKey({
      providerTypeId: "aliyun-alicloud",
      name: "Generated key",
      env: {
        ALICLOUD_ACCESS_KEY: "access",
        ALICLOUD_SECRET_KEY: "secret",
        ALICLOUD_REGION: "cn-shanghai",
      },
    });
    const template = await store.saveTemplate({
      providerTypeId: "aliyun-alicloud",
      name: "Generated template",
      version: "1.0.0",
      variables: [],
      mainTf: 'resource "terraform_data" "x" {}',
    });
    const api = await store.saveApi({
      providerTypeId: "aliyun-alicloud",
      name: "Generated API",
      keyId: key.id,
      templateId: template.id,
      allowedActions: ["deploy"],
    });

    expect(key.id).toMatch(uuidV7Pattern);
    expect(template.id).toMatch(uuidV7Pattern);
    expect(api.id).toMatch(uuidV7Pattern);
    expect(await Bun.file(`${testRoot}/config/keys/aliyun-alicloud/${key.id}/metadata.json`).exists()).toBe(true);
    expect(await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/${template.id}/metadata.json`).exists()).toBe(true);
    expect(await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/${api.id}/metadata.json`).exists()).toBe(true);
  });

  it("stores provider-scoped templates as metadata plus files", async () => {
    await store.initialize();
    const template = await saveSafeTemplate();
    const metadata = await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/safe/metadata.json`).json();
    const file = await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/safe/files/main.tf`).text();

    expect(template.fileNames).toEqual(["main.tf"]);
    expect(metadata.name).toBe("Safe");
    expect(metadata.files).toBeUndefined();
    expect(file).toContain("terraform_data");
  });

  it("stores raw main.tf templates and blocks unsafe provider constructs", async () => {
    await store.initialize();
    const template = await store.saveTemplate({
      id: "raw-main",
      name: "Raw main",
      providerTypeId: "aliyun-alicloud",
      version: "1.0.0",
      variables: [],
      mainTf: 'resource "terraform_data" "x" {}',
    });
    const file = await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/raw-main/files/main.tf`).text();

    expect(template.fileNames).toEqual(["main.tf"]);
    expect(file).toBe('resource "terraform_data" "x" {}');
    await expectRejects(
      store.saveTemplate({
        id: "raw-provider",
        name: "Raw provider",
        providerTypeId: "aliyun-alicloud",
        version: "1.0.0",
        variables: [],
        mainTf: 'provider "alicloud" {}',
      }),
      "blocked",
    );
  });

  it("blocks unsafe Terraform template constructs and paths", async () => {
    await store.initialize();
    await expectTemplateError({ "modules/../main.tf": 'resource "terraform_data" "x" {}' }, "safe relative path");
    await expectTemplateError({ "main.tf": "terraform{}" }, "blocked");
    await expectTemplateError({ "main.tf": 'terraform{backend"s3"{}}' }, "blocked");
    await expectTemplateError({ "main.tf": "required_providers{}" }, "blocked");
    await expectTemplateError({ "main.tf": 'provider "alicloud" {}' }, "blocked");
    await expectTemplateError({ "main.tf": 'resource "x" "y" { provisioner "local-exec" {} }' }, "blocked");
    await expectTemplateError({ "main.tf": 'provisioner"local-exec"{}' }, "blocked");
    await expectTemplateError(
      { "main.tf.json": JSON.stringify({ terraform: { required_providers: { evil: {} } } }) },
      "blocked",
    );
    await expectTemplateError({ "main.tf.json": JSON.stringify({ provider: { alicloud: {} } }) }, "blocked");
    await expectTemplateError({ "main.tf": 'module "x" { source = "./x" }' }, "blocked");
    await expectTemplateError({ "main.tf.json": JSON.stringify({ module: { x: { source: "./x" } } }) }, "blocked");
  });

  it("overwrites templates without leaving stale files behind", async () => {
    await store.initialize();
    await store.saveTemplate({
      id: "safe",
      name: "Safe",
      providerTypeId: "aliyun-alicloud",
      version: "1.0.0",
      variables: [],
      files: { "main.tf": 'resource "terraform_data" "x" {}' },
    });

    await store.saveTemplate({
      id: "safe",
      name: "Safe replacement",
      providerTypeId: "aliyun-alicloud",
      version: "1.0.1",
      variables: [],
      files: { "replacement.tf": 'resource "terraform_data" "y" {}' },
    });

    const template = await store.getTemplate("aliyun-alicloud", "safe");
    const oldFileExists = await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/safe/files/main.tf`).exists();

    expect(Object.keys(template.files)).toEqual(["replacement.tf"]);
    expect(oldFileExists).toBe(false);
  });

  it("publishes APIs from matching provider key and template references", async () => {
    await createConfigFixture();
    const api = await saveSafeApi();
    const apis = await store.listApis("aliyun-alicloud");
    const metadata = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`).json();

    expect(api.keyId).toBe("aliyun-main");
    expect(api.templateId).toBe("safe");
    expect(apis).toHaveLength(1);
    expect(metadata).toMatchObject({ providerTypeId: "aliyun-alicloud", keyId: "aliyun-main", templateId: "safe" });
  });



  it("stores API publish snapshots and runtime examples without secrets", async () => {
    await createConfigFixture();
    const api = await saveSafeApi();
    const metadata = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`).json();
    const example = await store.getRuntimeCallExample("safe-api");

    expect(api.revisionId).toMatch(uuidV7Pattern);
    expect(api.snapshot.key.id).toBe("aliyun-main");
    expect(api.snapshot.template.id).toBe("safe");
    expect(api.snapshot.template.variables.map((variable) => variable.name)).toEqual(["name", "token"]);
    expect(api.snapshot.template.files["main.tf"]).toContain("terraform_data");
    expect(metadata.revisionId).toBe(api.revisionId);
    expect(JSON.stringify(metadata)).not.toContain("secret");
    expect(example.apiRevisionId).toBe(api.revisionId);
    expect(example.deploy).toBeDefined();
    const deployExample = example.deploy;
    if (!deployExample) {
      throw new Error("Expected deploy example to be defined");
    }
    expect(deployExample.method).toBe("POST");
    expect(deployExample.path).toBe("/api/deployments/safe-api/deploy");
    expect(deployExample.body).toEqual({ vars: { name: "", token: "" } });
    expect(deployExample.curl).toContain("/api/deployments/safe-api/deploy");
    expect(deployExample.curl).not.toContain("secret");
  });

  it("records API revision on runs and lists runtime history by API", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("safe-api");
    await store.saveTemplate({
      id: "safe",
      providerTypeId: "aliyun-alicloud",
      name: "Safe replacement",
      version: "1.0.1",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "token", required: true, sensitive: true },
      ],
      files: { "replacement.tf": 'resource "terraform_data" "replacement" {}' },
    });

    const run = await terraform.deploy(api, { vars: { token: "super-secret", name: "demo" } });
    const runs = await store.listRuns("safe-api");

    expect(run.apiRevisionId).toBe(api.revisionId);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(run.id);
    expect(runs[0].apiRevisionId).toBe(api.revisionId);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/main.tf`).exists()).toBe(true);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/replacement.tf`).exists()).toBe(false);
    expect(JSON.stringify(runs)).not.toContain("super-secret");
  });

  it("stores redacted run events as ordered multiline NDJSON", async () => {
    await createConfigFixture();

    expect(await store.listRunEvents("safe-api", "missing-run")).toEqual([]);

    const first = await store.appendRunEvent("safe-api", "manual-run", { type: "queued", message: "queued" });
    const second = await store.appendRunEvent("safe-api", "manual-run", {
      type: "command_finished",
      step: "apply",
      exitCode: 0,
      output: "line 1\n[REDACTED]\nline 2\n",
    });
    const events = await store.listRunEvents("safe-api", "manual-run");
    const raw = await Bun.file(`${testRoot}/data/apis/safe-api/runs/manual-run/events.redacted.ndjson`).text();

    expect(events.map((event) => event.id)).toEqual([first.id, second.id]);
    expect(events.map((event) => event.type)).toEqual(["queued", "command_finished"]);
    expect(events[1].output).toBe("line 1\n[REDACTED]\nline 2\n");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("super-secret");
    expect(JSON.stringify(events)).not.toContain("very-private");
  });

  it("rejects provider mismatches and referenced resource deletion", async () => {
    await createConfigFixture();
    await saveSafeApi();

    await expectRejects(store.deleteKey("aliyun-alicloud", "aliyun-main"), "referenced by API");
    await expectRejects(store.deleteTemplate("aliyun-alicloud", "safe"), "referenced by API");
    await expectRejects(
      store.saveApi({
        id: "bad-api",
        providerTypeId: "google",
        name: "Bad API",
        keyId: "aliyun-main",
        templateId: "safe",
        allowedActions: ["deploy"],
      }),
    );
  });

  it("rejects duplicate api ids across providers", async () => {
    await createConfigFixture();
    await saveSafeApi();
    await saveGoogleKey();
    await saveGoogleTemplate();

    await expectRejects(
      store.saveApi({
        id: "safe-api",
        providerTypeId: "google",
        name: "Google Safe API",
        keyId: "google-main",
        templateId: "safe",
        allowedActions: ["deploy"],
      }),
      "already exists",
    );
  });

  it("runs deploy with selected key env and redacted metadata", async () => {
    const terraform = await createRuntimeFixture();
    const run = await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    const saved = await store.getRun("safe-api", run.id);
    const log = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/logs.redacted.txt`).text();
    const versions = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/versions.tf`).text();

    expect(saved.status).toBe("succeeded");
    expect(saved.action).toBe("deploy");
    expect(saved.vars).toEqual({ name: "demo", token: "[REDACTED]" });
    expect(JSON.stringify(saved)).not.toContain("super-secret");
    expect(log).toContain("fake terraform apply ok");
    expect(log).toContain("ADMIN_API_KEY=unset");
    expect(log).not.toContain("super-secret");
    expect(versions).toContain('source = "aliyun/alicloud"');
  });

  it("reuses a stable API Terraform workdir and returns command details", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("safe-api");
    const deploy = await terraform.deploy(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const destroy = await terraform.delete(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const stateFile = await Bun.file(`${testRoot}/data/apis/safe-api/terraform.tfstate`).text();
    const deployLog = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${deploy.id}/logs.redacted.txt`).text();
    const destroyLog = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${destroy.id}/logs.redacted.txt`).text();

    expect(deploy.id).toMatch(uuidV7Pattern);
    expect(destroy.id).toMatch(uuidV7Pattern);
    expect(deploy.workdir).toBe("data/apis/safe-api");
    expect(deploy.artifactsDir).toBe(`data/apis/safe-api/runs/${deploy.id}`);
    expect(deploy.commandResults?.map((result) => result.step)).toEqual(["init", "validate", "apply"]);
    expect(destroy.commandResults?.map((result) => result.step)).toEqual(["init", "validate", "destroy"]);
    expect(stateFile).toContain("fake state");
    expect(deployLog).toContain("fake terraform apply ok");
    expect(destroyLog).toContain("fake terraform destroy ok");
  });

  it("keeps a running history entry visible during slow deploys and redacts multiline output", async () => {
    const terraform = await createRuntimeFixture(undefined, "", "", "apply", "line 1\nvery-private\nline 2");
    const api = await store.getApi("safe-api");
    const deployPromise = terraform.deploy(api, {
      vars: { token: "very-private", name: "demo" },
    });

    try {
      const status = await waitForLatestRunStatus(terraform, "safe-api", "running");
      const run = await deployPromise;
      const log = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/logs.redacted.txt`).text();
      const events = await store.listRunEvents("safe-api", run.id);

      expect(status.latestRun?.status).toBe("running");
      expect(status.latestRun?.workdir).toBe("data/apis/safe-api");
      expect(status.latestRun?.artifactsDir).toMatch(new RegExp(`^data/apis/safe-api/runs/${run.id}$`));
      expect(run.workdir).toBe("data/apis/safe-api");
      expect(run.artifactsDir).toBe(`data/apis/safe-api/runs/${run.id}`);
      expect(run.commandResults?.map((result) => result.step)).toEqual(["init", "validate", "apply"]);
      expect(run.commandResults?.[2].output).toContain("line 1\n[REDACTED]\nline 2\n");
      expect(JSON.stringify(run.commandResults)).not.toContain("very-private");
      expect(log).toContain("line 1\n[REDACTED]\nline 2\n");
      expect(log).not.toContain("very-private");
      expect(events.map((event) => event.type)).toEqual([
        "queued",
        "running",
        "command_started",
        "command_finished",
        "command_started",
        "command_finished",
        "command_started",
        "command_finished",
        "succeeded",
      ]);
      expect(events.filter((event) => event.type === "command_finished").map((event) => event.step)).toEqual([
        "init",
        "validate",
        "apply",
      ]);
      expect(events.at(-2)?.output).toContain("line 1\n[REDACTED]\nline 2\n");
      expect(events.at(-1)?.output).toContain("line 1\n[REDACTED]\nline 2\n");
      expect(JSON.stringify(events)).not.toContain("very-private");
    } finally {
      await deployPromise.catch(() => undefined);
    }
  });



  it("executes the API revision passed to Terraform even after republish", async () => {
    const terraform = await createRuntimeFixture();
    const originalApi = await store.getApi("safe-api");
    await store.saveTemplate({
      id: "safe",
      providerTypeId: "aliyun-alicloud",
      name: "Safe replacement",
      version: "1.0.1",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "token", required: true, sensitive: true },
      ],
      files: { "replacement.tf": 'resource "terraform_data" "replacement" {}' },
    });
    const republished = await store.saveApi({
      id: originalApi.id,
      providerTypeId: originalApi.providerTypeId,
      name: originalApi.name,
      keyId: originalApi.keyId,
      templateId: originalApi.templateId,
      allowedActions: originalApi.allowedActions,
    });

    const run = await terraform.deploy(originalApi, { vars: { token: "super-secret", name: "demo" } });

    expect(republished.revisionId).not.toBe(originalApi.revisionId);
    expect(run.apiRevisionId).toBe(originalApi.revisionId);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/main.tf`).exists()).toBe(true);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/replacement.tf`).exists()).toBe(false);
  });

  it("redacts Terraform failure output before saving run metadata", async () => {
    const terraform = await createRuntimeFixture("apply", "super-secret leaked by terraform");
    const run = await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    const saved = await store.getRun("safe-api", run.id);
    const log = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/logs.redacted.txt`).text();

    expect(saved.status).toBe("failed");
    expect(saved.error).toContain("[REDACTED]");
    expect(JSON.stringify(saved)).not.toContain("super-secret");
    expect(log).not.toContain("super-secret");
    expect(JSON.stringify(await store.listRunEvents("safe-api", run.id))).not.toContain("super-secret");
  });

  it("redacts sensitive Terraform outputs while preserving non-sensitive values", async () => {
    const terraform = await createRuntimeFixture();
    await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });

    const response = await terraform.output("safe-api");
    const outputs = response.outputs as Record<string, { sensitive?: boolean; value?: string }>;

    expect(JSON.stringify(response)).not.toContain("super-secret");
    expect(outputs.secret_output.value).toBe("[REDACTED]");
    expect(outputs.plain_output.value).toBe("hello");
  });

  it("returns a safe generic error when Terraform output fails", async () => {
    const terraform = await createRuntimeFixture(undefined, "", "super-secret from terraform output");
    await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });

    const response = await terraform.output("safe-api");

    expect(JSON.stringify(response)).not.toContain("super-secret");
    expect(JSON.stringify(response)).toContain("Terraform output failed");
    expect(response.error).toBe("Terraform output failed");
  });

  it("validates raw templates with the selected Terraform provider", async () => {
    const terraform = await createRuntimeFixture("validate", "provider schema rejected template");

    await expectRejects(
      terraform.validateTemplate({
        providerTypeId: "aliyun-alicloud",
        name: "Invalid provider template",
        version: "1.0.0",
        variables: [],
        mainTf: 'resource "terraform_data" "x" {}',
      }),
      "provider schema rejected template",
    );
  });

  it("rejects unsafe template validation before Terraform is called", async () => {
    const terraform = await createRuntimeFixture();
    await Bun.file(`${testRoot}/terraform-called.txt`).delete();

    await expectRejects(
      terraform.validateTemplate({
        id: "escape",
        providerTypeId: "aliyun-alicloud",
        name: "Escape",
        version: "1.0.0",
        variables: [],
        files: { "../escape.tf": 'resource "terraform_data" "x" {}' },
      }),
      "safe relative path",
    );
    expect(await Bun.file(`${testRoot}/data/escape.tf`).exists()).toBe(false);
    expect(await Bun.file(`${testRoot}/terraform-called.txt`).exists()).toBe(false);
  });

  it("removes stale Terraform config files before reusing an API workdir", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("safe-api");
    await terraform.deploy(api, { vars: { token: "super-secret", name: "demo" } });
    await Bun.write(`${testRoot}/data/apis/safe-api/stale.tf`, 'resource "terraform_data" "stale" {}');

    await store.saveTemplate({
      id: "safe",
      providerTypeId: "aliyun-alicloud",
      name: "Safe replacement",
      version: "1.0.1",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "token", required: true, sensitive: true },
      ],
      files: { "replacement.tf": 'resource "terraform_data" "replacement" {}' },
    });
    const republished = await store.saveApi({
      id: api.id,
      providerTypeId: api.providerTypeId,
      name: api.name,
      keyId: api.keyId,
      templateId: api.templateId,
      allowedActions: api.allowedActions,
    });
    await terraform.deploy(republished, { vars: { token: "super-secret", name: "demo" } });

    expect(await Bun.file(`${testRoot}/data/apis/safe-api/stale.tf`).exists()).toBe(false);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/main.tf`).exists()).toBe(false);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/replacement.tf`).exists()).toBe(true);
    expect(await Bun.file(`${testRoot}/data/apis/safe-api/terraform.tfstate`).exists()).toBe(true);
  });

  it("rejects concurrent Terraform runs for the same API", async () => {
    const terraform = await createRuntimeFixture(undefined, "", "", "apply");
    const api = await store.getApi("safe-api");
    const first = terraform.deploy(api, { vars: { token: "super-secret", name: "demo" } });

    await expectRejects(
      terraform.delete(api, { vars: { token: "super-secret", name: "demo" } }),
      "already has a Terraform run in progress",
    );

    await first;
  });
});

async function expectTemplateError(files: Record<string, string>, message: string) {
  await expectRejects(
    store.saveTemplate({
      id: crypto.randomUUID(),
      name: "Bad template",
      providerTypeId: "aliyun-alicloud",
      version: "1.0.0",
      variables: [],
      files,
    }),
    message,
  );
}

async function expectRejects(promise: Promise<unknown>, message?: string) {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (message) {
      expect((error as Error).message).toContain(message);
    }
  }
}

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function createRuntimeFixture(
  failingCommand?: string,
  failureOutput = "",
  outputFailureOutput = "",
  slowCommand = "",
  applyOutput = "",
) {
  await createConfigFixture();
  await saveSafeApi();
  const terraformBin = `${testRoot}/terraform-${crypto.randomUUID()}.sh`;
  await Bun.write(
    terraformBin,
    `#!/usr/bin/env sh
set -eu
if [ "\${1:-}" = "output" ] && [ -n "${outputFailureOutput}" ]; then
  printf '%s\\n' '${outputFailureOutput}' >&2
  exit 1
fi
if [ "\${1:-}" = "output" ]; then
  printf '%s\\n' '{"secret_output":{"sensitive":true,"type":"string","value":"super-secret"},"plain_output":{"sensitive":false,"type":"string","value":"hello"}}'
  exit 0
fi
printf 'called\n' > '${testRoot}/terraform-called.txt'
if [ "\${1:-}" = "${failingCommand ?? ""}" ]; then
  printf '%s\\n' '${failureOutput}' >&2
  exit 1
fi
if [ "\${1:-}" = "${slowCommand}" ]; then
  sleep 1
fi
if [ "\${1:-}" = "apply" ] && [ -n "${applyOutput}" ]; then
  printf '%s\\n' '${applyOutput}'
  exit 0
fi
if [ "\${1:-}" = "apply" ] || [ "\${1:-}" = "destroy" ]; then
  printf 'fake state %s\\n' "\${1:-}" > terraform.tfstate
fi
printf 'fake terraform %s ok ADMIN_API_KEY=unset\\n' "\${1:-}"
`,
  );
  await Bun.spawn(["chmod", "+x", terraformBin]).exited;
  Bun.env.TERRAFORM_BIN = terraformBin;
  return new TerraformService(store);
}

async function createConfigFixture() {
  await store.removeRuntimeData();
  await store.removeConfigData();
  await store.initialize();
  await saveAliyunKey();
  await saveSafeTemplate();
}

async function saveAliyunKey() {
  return store.saveKey({
    id: "aliyun-main",
    providerTypeId: "aliyun-alicloud",
    name: "Aliyun main",
    env: {
      ALICLOUD_ACCESS_KEY: "access",
      ALICLOUD_SECRET_KEY: "secret",
      ALICLOUD_REGION: "cn-shanghai",
    },
  });
}

async function saveSafeTemplate() {
  return store.saveTemplate({
    id: "safe",
    name: "Safe",
    providerTypeId: "aliyun-alicloud",
    version: "1.0.0",
    variables: [
      { name: "name", required: true, sensitive: false },
      { name: "token", required: true, sensitive: true },
    ],
    files: { "main.tf": 'resource "terraform_data" "x" {}' },
  });
}

async function saveSafeApi() {
  return store.saveApi({
    id: "safe-api",
    providerTypeId: "aliyun-alicloud",
    name: "Safe API",
    keyId: "aliyun-main",
    templateId: "safe",
    allowedActions: ["deploy", "delete"],
  });
}

async function saveGoogleKey() {
  return store.saveKey({
    id: "google-main",
    providerTypeId: "google",
    name: "Google main",
    env: {
      GOOGLE_CREDENTIALS: "{}",
      GOOGLE_PROJECT: "test-project",
      GOOGLE_REGION: "us-central1",
    },
  });
}

async function saveGoogleTemplate() {
  return store.saveTemplate({
    id: "safe",
    name: "Safe",
    providerTypeId: "google",
    version: "1.0.0",
    variables: [
      { name: "name", required: true, sensitive: false },
      { name: "token", required: true, sensitive: true },
    ],
    files: { "main.tf": 'resource "terraform_data" "x" {}' },
  });
}

async function waitForLatestRunStatus(
  terraform: {
    status(apiId: string): Promise<{ latestRun?: { status?: string; workdir?: string; artifactsDir?: string } }>;
  },
  apiId: string,
  expectedStatus: "running",
) {
  const timeoutMs = 1000;
  const intervalMs = 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const status = await terraform.status(apiId);
    if (status.latestRun?.status === expectedStatus) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Expected latest run status to become ${expectedStatus}`);
}
