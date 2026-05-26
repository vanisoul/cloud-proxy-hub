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

async function createRuntimeFixture(failingCommand?: string, failureOutput = "", outputFailureOutput = "") {
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
if [ "\${1:-}" = "${failingCommand ?? ""}" ]; then
  printf '%s\\n' '${failureOutput}' >&2
  exit 1
fi
printf 'fake terraform %s ok ADMIN_API_KEY=%s\\n' "\${1:-}" "\${ADMIN_API_KEY:-unset}"
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
