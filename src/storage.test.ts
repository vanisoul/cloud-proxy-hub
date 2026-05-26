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
});

describe("PlatformStore", () => {
  it("initializes built-in Terraform providers", async () => {
    await store.initialize();
    const providers = await store.listProviderTypes();
    expect(providers.map((provider) => provider.id)).toContain("aliyun-alicloud");
    expect(providers.map((provider) => provider.id)).toContain("google");
  });

  it("stores credentials without returning secret values", async () => {
    await store.initialize();
    const credential = await store.saveCredential({
      id: "aliyun-main",
      providerTypeId: "aliyun-alicloud",
      name: "Aliyun main",
      env: {
        ALICLOUD_ACCESS_KEY: "access",
        ALICLOUD_SECRET_KEY: "secret",
        ALICLOUD_REGION: "cn-shanghai",
      },
      allowedWorkspaceIds: ["default"],
    });

    expect(credential.envKeys).toEqual(["ALICLOUD_ACCESS_KEY", "ALICLOUD_REGION", "ALICLOUD_SECRET_KEY"]);
    expect(JSON.stringify(credential)).not.toContain("secret");
  });

  it("blocks unsafe Terraform template constructs", async () => {
    await store.initialize();
    try {
      await store.saveTemplate({
        id: "bad",
        name: "Bad template",
        providerTypeId: "google",
        version: "1.0.0",
        variables: [],
        files: { "main.tf": 'resource "null_resource" "x" { provisioner "local-exec" { command = "echo bad" } }' },
      });
      throw new Error("Expected unsafe template to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("blocked Terraform construct");
    }
  });

  it("blocks template path traversal", async () => {
    await store.initialize();
    try {
      await store.saveTemplate({
        id: "bad-path",
        name: "Bad path",
        providerTypeId: "google",
        version: "1.0.0",
        variables: [],
        files: { "modules/../main.tf": "terraform {}" },
      });
      throw new Error("Expected unsafe template path to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("safe relative path");
    }
  });

  it("blocks Terraform JSON backend and provider declarations", async () => {
    await store.initialize();
    try {
      await store.saveTemplate({
        id: "bad-json",
        name: "Bad JSON",
        providerTypeId: "google",
        version: "1.0.0",
        variables: [],
        files: { "main.tf.json": JSON.stringify({ terraform: { required_providers: { evil: {} } } }) },
      });
      throw new Error("Expected unsafe Terraform JSON to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("blocked Terraform construct");
    }
  });

  it("stores run metadata under api id with sensitive vars redacted", async () => {
    const terraform = await createTerraformFixture();
    const run = await terraform.createRun(await store.getApi("safe-api"), {
      action: "apply",
      vars: { token: "super-secret", name: "demo" },
    });
    const saved = await store.getRun("safe-api", run.id);

    expect(saved.status).toBe("succeeded");
    expect(saved.vars).toEqual({ name: "demo", token: "[REDACTED]" });
    expect(saved.sensitiveVarNames).toEqual(["token"]);
    expect(JSON.stringify(saved)).not.toContain("super-secret");

    const log = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/logs.redacted.txt`).text();
    const versions = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/versions.tf`).text();
    expect(log).toContain("fake terraform apply ok");
    expect(log).toContain("ADMIN_API_KEY=unset");
    expect(versions).toContain('source = "aliyun/alicloud"');
    expect(versions).toContain('version = "~> 1.0"');
  });

  it("redacts Terraform failure output before saving run metadata", async () => {
    const terraform = await createTerraformFixture("plan", "super-secret leaked by terraform");
    const run = await terraform.createRun(await store.getApi("safe-api"), {
      action: "plan",
      vars: { token: "super-secret", name: "demo" },
    });
    const saved = await store.getRun("safe-api", run.id);
    const log = await Bun.file(`${testRoot}/data/apis/safe-api/runs/${run.id}/logs.redacted.txt`).text();

    expect(saved.status).toBe("failed");
    expect(saved.error).toContain("[REDACTED]");
    expect(JSON.stringify(saved)).not.toContain("super-secret");
    expect(log).not.toContain("super-secret");
  });
});

async function createTerraformFixture(failingCommand?: string, failureOutput = "") {
  await store.removeRuntimeData();
  await store.initialize();
  const terraformBin = `${testRoot}/terraform-${crypto.randomUUID()}.sh`;
  await Bun.write(
    terraformBin,
    `#!/usr/bin/env sh
set -eu
if [ "\${1:-}" = "${failingCommand ?? ""}" ]; then
  printf '%s\\n' '${failureOutput}' >&2
  exit 1
fi
printf 'fake terraform %s ok ADMIN_API_KEY=%s\\n' "\${1:-}" "\${ADMIN_API_KEY:-unset}"
`,
  );
  await Bun.spawn(["chmod", "+x", terraformBin]).exited;
  Bun.env.TERRAFORM_BIN = terraformBin;

  await store.saveCredential({
    id: "aliyun-main",
    providerTypeId: "aliyun-alicloud",
    name: "Aliyun main",
    env: {
      ALICLOUD_ACCESS_KEY: "access",
      ALICLOUD_SECRET_KEY: "credential-secret",
      ALICLOUD_REGION: "cn-shanghai",
    },
    allowedWorkspaceIds: ["default"],
  });
  await store.saveProviderInstance({
    id: "aliyun-provider",
    providerTypeId: "aliyun-alicloud",
    credentialId: "aliyun-main",
    name: "Aliyun provider",
    defaults: {},
  });
  await store.saveWorkspace({ id: "default", name: "Default", allowedTemplateIds: ["safe"] });
  await store.saveTemplate({
    id: "safe",
    name: "Safe",
    providerTypeId: "aliyun-alicloud",
    version: "1.0.0",
    variables: [
      { name: "name", required: true, sensitive: false },
      { name: "token", required: true, sensitive: true },
    ],
    files: { "main.tf": "terraform {}" },
  });
  await store.saveApi({
    id: "safe-api",
    name: "Safe API",
    workspaceId: "default",
    templateId: "safe",
    providerInstanceId: "aliyun-provider",
    allowedActions: ["plan", "apply", "destroy", "refresh"],
  });

  return new TerraformService(store);
}
