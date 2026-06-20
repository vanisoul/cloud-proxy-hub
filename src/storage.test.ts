import { afterEach, describe, expect, it } from "bun:test";

const testRoot = `/tmp/cloud-proxy-hub-test-${crypto.randomUUID()}`;
Bun.env.CONFIG_DIR = `${testRoot}/config`;
Bun.env.DATA_DIR = `${testRoot}/data`;
Bun.env.ADMIN_API_KEY = "test-admin-key";

const { PlatformStore } = await import("@/storage");
const { TerraformService } = await import("@/terraform");
const store = new PlatformStore();

afterEach(async () => {
  Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
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

  it("issues runtime output tokens without leaking token material", async () => {
    await createConfigFixture();

    const api = await saveSafeApi();
    const secret = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/safe-api/secret.json`).json();
    const metadata = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/safe-api/metadata.json`).json();
    const listed = await store.listApis();

    expect(api.runtimeOutputToken).toStartWith("cph_rt_");
    expect(secret.runtimeOutputTokenHash).toBeString();
    expect(secret.runtimeOutputTokenHash).not.toBe(api.runtimeOutputToken);
    expect(JSON.stringify(metadata)).not.toContain(api.runtimeOutputToken);
    expect(JSON.stringify(metadata)).not.toContain(secret.runtimeOutputTokenHash);
    expect(JSON.stringify(listed)).not.toContain(api.runtimeOutputToken);
    expect(JSON.stringify(listed)).not.toContain(secret.runtimeOutputTokenHash);
  });

  it("stores provider-scoped templates as metadata plus files", async () => {
    await store.initialize();
    const template = await saveSafeTemplate();
    const metadata = await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/safe/metadata.json`).json();
    const file = await Bun.file(`${testRoot}/config/templates/aliyun-alicloud/safe/files/main.tf`).text();

    expect(template.fileNames).toEqual(["main.tf"]);
    expect(template.resourceAddresses).toEqual(["terraform_data.x"]);
    expect(metadata.name).toBe("Safe");
    expect(metadata.files).toBeUndefined();
    expect(file).toContain("terraform_data");
  });

  it("rejects sensitive template variables with default values", async () => {
    await store.initialize();

    await expectRejects(
      store.saveTemplate({
        id: "sensitive-default",
        name: "Sensitive default",
        providerTypeId: "aliyun-alicloud",
        version: "1.0.0",
        variables: [{ name: "token", required: true, sensitive: true, defaultValue: "secret" }],
        mainTf: 'resource "terraform_data" "x" {}',
      }),
      "Variable token is sensitive and cannot define defaultValue",
    );
  });

  it("stores provider-scoped shell resources as metadata", async () => {
    await store.initialize();
    const shell = await saveInitShell();
    const listed = await store.listShells("aliyun-alicloud");
    const loaded = await store.getShell("aliyun-alicloud", "init-shell");
    const metadata = await Bun.file(`${testRoot}/config/shells/aliyun-alicloud/init-shell/metadata.json`).json();

    expect(shell.inline).toEqual(["printf 'init shell ok\\n'"]);
    expect(listed.map((item) => item.id)).toEqual(["init-shell"]);
    expect(loaded).not.toHaveProperty("connection");
    expect(loaded).not.toHaveProperty("dependsOn");
    expect(metadata).toMatchObject({ providerTypeId: "aliyun-alicloud", name: "Init shell" });
    expect(metadata.connection).toBeUndefined();
    expect(metadata.dependsOn).toBeUndefined();
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
    expect(template.resourceAddresses).toEqual(["terraform_data.x"]);
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

  it("publishes APIs with optional shell snapshots", async () => {
    await createConfigFixture();
    await saveInitShell();
    await saveShellTemplate();
    await store.saveTemplate({
      id: "no-auth-shell-safe",
      name: "No auth shell safe",
      providerTypeId: "aliyun-alicloud",
      version: "1.0.0",
      variables: [{ name: "user", required: true, sensitive: false }],
      files: { "main.tf": 'resource "terraform_data" "x" {}' },
    });
    const api = await saveShellApi();
    const metadata = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/shell-api/metadata.json`).json();

    expect(api.shellId).toBe("init-shell");
    expect(api.snapshot.shell?.id).toBe("init-shell");
    expect(api.snapshot.shell?.inline).toEqual(["printf 'init shell ok\\n'"]);
    expect(api.shellId).toBe("init-shell");
    expect(metadata.shellId).toBe("init-shell");
    expect(metadata.shellBinding.shellId).toBe("init-shell");
    expect(metadata.snapshot.shell.startupVariable).toBe("user_data");
  });

  it("rejects shell API publish when the template lacks a provider startup variable", async () => {
    await createConfigFixture();
    await saveInitShell();

    await expectRejects(
      store.saveApi({
        id: "missing-startup-api",
        providerTypeId: "aliyun-alicloud",
        name: "Missing startup API",
        keyId: "aliyun-main",
        templateId: "safe",
        shellBinding: shellBinding(),
        allowedActions: ["deploy"],
      }),
      "requires template variable user_data",
    );
  });

  it("rejects Aliyun shell APIs when the template only exposes non-Aliyun startup variables", async () => {
    await createConfigFixture();
    await saveInitShell();
    await store.saveTemplate({
      id: "aliyun-wrong-startup",
      name: "Aliyun wrong startup",
      providerTypeId: "aliyun-alicloud",
      version: "1.0.0",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "startup_script", required: false, sensitive: false },
      ],
      files: { "main.tf": 'resource "alicloud_instance" "vm" { user_data = var.startup_script }' },
    });

    await expectRejects(
      store.saveApi({
        id: "aliyun-wrong-startup-api",
        providerTypeId: "aliyun-alicloud",
        name: "Aliyun Wrong Startup API",
        keyId: "aliyun-main",
        templateId: "aliyun-wrong-startup",
        shellBinding: shellBinding(),
        allowedActions: ["deploy"],
      }),
      "requires template variable user_data",
    );
  });

  it("uses Google startup_script when publishing shell APIs for Google", async () => {
    await createConfigFixture();
    await saveGoogleKey();
    await store.saveShell({
      id: "google-init-shell",
      providerTypeId: "google",
      name: "Google init shell",
      inline: ["printf 'google init ok\\n'"],
    });
    await store.saveTemplate({
      id: "google-shell-safe",
      name: "Google shell safe",
      providerTypeId: "google",
      version: "1.0.0",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "startup_script", required: false, sensitive: false },
      ],
      files: { "main.tf": 'resource "google_compute_instance" "vm" {}' },
    });

    const api = await store.saveApi({
      id: "google-shell-api",
      providerTypeId: "google",
      name: "Google Shell API",
      keyId: "google-main",
      templateId: "google-shell-safe",
      shellBinding: shellBinding({ shellId: "google-init-shell" }),
      vars: { name: "google-demo" },
      allowedActions: ["deploy"],
    });

    expect(api.snapshot.shell?.startupVariable).toBe("startup_script");
  });

  it("rejects Google shell APIs when the template only exposes non-Google startup variables", async () => {
    await createConfigFixture();
    await saveGoogleKey();
    await store.saveShell({
      id: "google-init-shell",
      providerTypeId: "google",
      name: "Google init shell",
      inline: ["printf 'google init ok\n'"],
    });
    await store.saveTemplate({
      id: "google-wrong-startup",
      name: "Google wrong startup",
      providerTypeId: "google",
      version: "1.0.0",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "user_data", required: false, sensitive: false },
      ],
      files: { "main.tf": 'resource "google_compute_instance" "vm" {}' },
    });

    await expectRejects(
      store.saveApi({
        id: "google-wrong-startup-api",
        providerTypeId: "google",
        name: "Google Wrong Startup API",
        keyId: "google-main",
        templateId: "google-wrong-startup",
        shellBinding: shellBinding({ shellId: "google-init-shell" }),
        allowedActions: ["deploy"],
      }),
      "requires template variable startup_script",
    );
  });

  it("publishes APIs without shell resources", async () => {
    await createConfigFixture();
    const api = await saveSafeApi();

    expect(api.shellId).toBeUndefined();
    expect(api.snapshot.shell).toBeUndefined();
  });

  it("hydrates shell binding from legacy API snapshots", async () => {
    await createConfigFixture();
    await saveInitShell();
    await saveShellTemplate();
    const api = await saveShellApi();
    const metadataPath = `${testRoot}/config/apis/aliyun-alicloud/shell-api/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    delete metadata.shellBinding;
    await Bun.write(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    const loaded = await store.getApi(api.id);
    const listed = await store.listApis("aliyun-alicloud");

    expect(loaded.shellId).toBe("init-shell");
    expect(loaded.shellBinding).toEqual(shellBinding());
    expect(listed.find((item) => item.id === api.id)?.shellBinding).toEqual(shellBinding());
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
    expect(deployExample.body).toEqual({});
    expect(deployExample.curl).toContain("/api/deployments/safe-api/deploy");
    expect(deployExample.curl).not.toContain("secret");
  });

  it("stores API publish vars and uses them when runtime vars are omitted", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.saveApi({
      id: "api-vars",
      providerTypeId: "aliyun-alicloud",
      name: "API vars",
      keyId: "aliyun-main",
      templateId: "safe",
      allowedActions: ["deploy"],
      vars: { name: "api-demo", token: "api-secret" },
    });

    const run = await terraform.deploy(api, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/api-vars/terraform.tfvars.json`).json();
    const saved = await store.getRun("api-vars", run.id);
    const metadata = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/api-vars/metadata.json`).text();
    const loadedApi = await store.getApi("api-vars");

    expect(tfvars).toEqual({ name: "api-demo", token: "api-secret" });
    expect(saved.vars).toEqual({ name: "api-demo", token: "[REDACTED]" });
    expect(metadata).not.toContain("api-secret");
    expect(loadedApi.vars).toEqual({ name: "api-demo", token: "[REDACTED]" });
  });

  it("redacts legacy raw API metadata vars while keeping them usable for Terraform", async () => {
    const terraform = await createRuntimeFixture();
    const apiPath = `${testRoot}/config/apis/aliyun-alicloud/legacy-raw-vars/metadata.json`;
    const api = await store.getApi("safe-api");
    await Bun.write(apiPath, JSON.stringify({
      ...api,
      id: "legacy-raw-vars",
      vars: { name: "legacy-demo", token: "legacy-secret" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const loaded = await store.getApi("legacy-raw-vars");
    const listed = await store.listApis("aliyun-alicloud");
    const run = await terraform.deploy(loaded, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/legacy-raw-vars/terraform.tfvars.json`).json();

    expect(loaded.vars).toEqual({ name: "legacy-demo", token: "[REDACTED]" });
    expect(listed.find((item) => item.id === "legacy-raw-vars")?.vars).toEqual({ name: "legacy-demo", token: "[REDACTED]" });
    expect(tfvars).toEqual({ name: "legacy-demo", token: "legacy-secret" });
    expect((await store.getRun("legacy-raw-vars", run.id)).vars).toEqual({ name: "legacy-demo", token: "[REDACTED]" });
  });

  it("redacts legacy sensitive template defaults in API snapshots", async () => {
    await createConfigFixture();
    const metadataPath = `${testRoot}/config/templates/aliyun-alicloud/safe/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    await Bun.write(metadataPath, JSON.stringify({
      ...metadata,
      variables: [
        { name: "name", required: true, sensitive: false, defaultValue: "api-demo" },
        { name: "token", required: true, sensitive: true, defaultValue: "legacy-secret" },
      ],
    }));

    const template = await store.getPublicTemplate("aliyun-alicloud", "safe");
    const api = await store.saveApi({
      id: "legacy-template-default-api",
      providerTypeId: "aliyun-alicloud",
      name: "Legacy template default API",
      keyId: "aliyun-main",
      templateId: "safe",
      allowedActions: ["deploy"],
      vars: { token: "api-secret" },
    });
    const apiMetadata = await Bun.file(`${testRoot}/config/apis/aliyun-alicloud/legacy-template-default-api/metadata.json`).text();

    expect(JSON.stringify(template)).not.toContain("legacy-secret");
    expect(template.variables.find((variable) => variable.name === "token")?.defaultValue).toBe("[REDACTED]");
    expect(JSON.stringify(api)).not.toContain("legacy-secret");
    expect(api.snapshot.template.variables.find((variable) => variable.name === "token")?.defaultValue).toBe("[REDACTED]");
    expect(apiMetadata).not.toContain("legacy-secret");
  });

  it("uses raw legacy API snapshot sensitive defaults without exposing them", async () => {
    const terraform = await createRuntimeFixture();
    const apiPath = `${testRoot}/config/apis/aliyun-alicloud/legacy-snapshot-default/metadata.json`;
    const api = await store.getApi("safe-api");
    await Bun.write(apiPath, JSON.stringify({
      ...api,
      id: "legacy-snapshot-default",
      vars: {},
      snapshot: {
        ...api.snapshot,
        template: {
          ...api.snapshot.template,
          variables: [
            { name: "name", required: true, sensitive: false, defaultValue: "legacy-demo" },
            { name: "token", required: true, sensitive: true, defaultValue: "legacy-secret" },
          ],
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const loaded = await store.getApi("legacy-snapshot-default");
    await terraform.deploy(loaded, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/legacy-snapshot-default/terraform.tfvars.json`).json();

    expect(JSON.stringify(loaded)).not.toContain("legacy-secret");
    expect(loaded.snapshot.template.variables.find((variable) => variable.name === "token")?.defaultValue).toBe("[REDACTED]");
    expect(tfvars).toEqual({ name: "legacy-demo", token: "legacy-secret" });
  });

  it("uses raw legacy sensitive defaults when publishing with redacted placeholder vars", async () => {
    const terraform = await createRuntimeFixture();
    const metadataPath = `${testRoot}/config/templates/aliyun-alicloud/safe/metadata.json`;
    const metadata = await Bun.file(metadataPath).json();
    await Bun.write(metadataPath, JSON.stringify({
      ...metadata,
      variables: [
        { name: "name", required: true, sensitive: false, defaultValue: "api-demo" },
        { name: "token", required: true, sensitive: true, defaultValue: "legacy-secret" },
      ],
    }));

    const template = await store.getPublicTemplate("aliyun-alicloud", "safe");
    const api = await store.saveApi({
      id: "legacy-redacted-placeholder-api",
      providerTypeId: "aliyun-alicloud",
      name: "Legacy redacted placeholder API",
      keyId: "aliyun-main",
      templateId: "safe",
      allowedActions: ["deploy"],
      vars: Object.fromEntries(template.variables.map((variable) => [variable.name, variable.defaultValue ?? ""])),
    });

    await terraform.deploy(api, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/legacy-redacted-placeholder-api/terraform.tfvars.json`).json();

    expect(api.vars).toEqual({ name: "api-demo", token: "[REDACTED]" });
    expect(tfvars).toEqual({ name: "api-demo", token: "legacy-secret" });
  });

  it("rejects API publish vars that are not declared by the template", async () => {
    await createConfigFixture();

    await expectRejects(
      store.saveApi({
        id: "bad-vars-api",
        providerTypeId: "aliyun-alicloud",
        name: "Bad vars API",
        keyId: "aliyun-main",
        templateId: "safe",
        allowedActions: ["deploy"],
        vars: { undeclared: "value" },
      }),
      "Variable undeclared is not declared by this template",
    );
  });

  it("rejects API publishing when required template vars are not provided", async () => {
    await createConfigFixture();

    await expectRejects(
      store.saveApi({
        id: "missing-vars-api",
        providerTypeId: "aliyun-alicloud",
        name: "Missing vars API",
        keyId: "aliyun-main",
        templateId: "safe",
        allowedActions: ["deploy"],
      }),
      "Missing API variables: name, token",
    );
  });

  it("preserves raw API vars when updating an API without vars", async () => {
    const terraform = await createRuntimeFixture();
    const original = await store.getApi("safe-api");
    const updated = await store.saveApi({
      id: original.id,
      providerTypeId: original.providerTypeId,
      name: "Safe API renamed",
      keyId: original.keyId,
      templateId: original.templateId,
      allowedActions: original.allowedActions,
    });

    const run = await terraform.deploy(updated, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();
    const saved = await store.getRun("safe-api", run.id);

    expect(tfvars).toEqual({ name: "api-default", token: "api-token" });
    expect(saved.vars).toEqual({ name: "api-default", token: "[REDACTED]" });
  });

  it("allows shell startup variables to satisfy required template vars", async () => {
    const terraform = await createRuntimeFixture();
    await store.saveTemplate({
      id: "shell-required-startup",
      providerTypeId: "aliyun-alicloud",
      name: "Shell required startup",
      version: "1.0.0",
      variables: [
        { name: "name", required: true, sensitive: false },
        { name: "token", required: true, sensitive: true },
        { name: "user_data", required: true, sensitive: false },
      ],
      files: { "main.tf": 'resource "alicloud_instance" "vm" { user_data = var.user_data }' },
    });
    const api = await store.saveApi({
      id: "shell-required-startup-api",
      providerTypeId: "aliyun-alicloud",
      name: "Shell required startup API",
      keyId: "aliyun-main",
      templateId: "shell-required-startup",
      shellBinding: shellBinding(),
      allowedActions: ["deploy"],
      vars: { name: "api-demo", token: "api-secret" },
    });

    await terraform.deploy(api, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/shell-required-startup-api/terraform.tfvars.json`).json();

    expect(tfvars).toEqual({ name: "api-demo", token: "api-secret", user_data: "printf 'init shell ok\\n'\n" });
  });

  it("keeps shell startup injection above API publish vars", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.saveApi({
      id: "shell-api-vars",
      providerTypeId: "aliyun-alicloud",
      name: "Shell API vars",
      keyId: "aliyun-main",
      templateId: "shell-safe",
      shellBinding: shellBinding(),
      allowedActions: ["deploy"],
      vars: { name: "api-demo", token: "api-secret", user_data: "api value" },
    });

    await terraform.deploy(api, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/shell-api-vars/terraform.tfvars.json`).json();

    expect(tfvars).toEqual({ name: "api-demo", token: "api-secret", user_data: "printf 'init shell ok\\n'\n" });
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
    await saveInitShell();
    await saveShellTemplate();
    await saveSafeApi();
    await saveShellApi();

    await expectRejects(store.deleteKey("aliyun-alicloud", "aliyun-main"), "referenced by API");
    await expectRejects(store.deleteTemplate("aliyun-alicloud", "safe"), "referenced by API");
    await expectRejects(store.deleteShell("aliyun-alicloud", "init-shell"), "referenced by API");
    await expectRejects(
      store.saveApi({
        id: "bad-api",
        providerTypeId: "google",
        name: "Bad API",
        keyId: "aliyun-main",
        templateId: "safe",
        shellBinding: shellBinding(),
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

  it("injects shell commands into the provider startup variable during deploy", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("shell-api");
    const run = await terraform.deploy(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const tfvars = await Bun.file(`${testRoot}/data/apis/shell-api/terraform.tfvars.json`).json();
    const log = await Bun.file(`${testRoot}/data/apis/shell-api/runs/${run.id}/logs.redacted.txt`).text();
    const events = await store.listRunEvents("shell-api", run.id);

    expect(run.status).toBe("succeeded");
    expect(run.shellId).toBe("init-shell");
    expect(tfvars.user_data).toBe("printf 'init shell ok\\n'\n");
    expect(await Bun.file(`${testRoot}/data/apis/shell-api/platform-shell.tf`).exists()).toBe(false);
    expect(log).toContain("fake terraform apply ok");
    expect(events.some((event) => event.type === "command_output" && event.step === "apply")).toBe(true);
  });

  it("leaves init shell callback disabled when callback base URL is unset", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("shell-api");

    const run = await terraform.deploy(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const tfvars = await Bun.file(`${testRoot}/data/apis/shell-api/terraform.tfvars.json`).json();
    const initLog = await store.getInitShellLog("shell-api", run.id);

    expect(tfvars.user_data).toBe("printf 'init shell ok\\n'\n");
    expect(initLog).toMatchObject({ enabled: false, status: "disabled" });
  });

  it("wraps init shell with a signed curl callback when callback base URL is set", async () => {
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("shell-api");

    const run = await terraform.deploy(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const tfvars = await Bun.file(`${testRoot}/data/apis/shell-api/terraform.tfvars.json`).json();

    expect(tfvars.user_data).toContain("curl --connect-timeout 2 --max-time 10 -fsS -X POST");
    expect(tfvars.user_data).toContain("&done=1");
    expect(tfvars.user_data).toContain(`/callbacks/init-shell/shell-api/${run.id}?token=`);
    expect(tfvars.user_data).toContain('mktemp -d "${TMPDIR:-/tmp}/terraform-platform-init.XXXXXX"');
    expect(tfvars.user_data).toContain('trap \'rm -rf "$__terraform_platform_init_dir"\' EXIT HUP INT TERM');
    expect(tfvars.user_data).toContain("cat >\"$__terraform_platform_init_script\"");
    expect(tfvars.user_data).toContain("chmod 0700 \"$__terraform_platform_init_script\"");
    expect(tfvars.user_data).toContain('"$__terraform_platform_init_script"');
    expect(tfvars.user_data).toContain("printf 'init shell ok\\n'");
    expect(tfvars.user_data).not.toContain("(\nprintf 'init shell ok\\n'");
    expect(tfvars.user_data).not.toContain("terraform-platform-init-$$");
    expect(JSON.stringify(run)).not.toContain("token=");
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("preserves user shell shebang by executing a generated script file", async () => {
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    const terraform = await createRuntimeFixture();
    await store.saveShell({
      id: "bash-shell",
      providerTypeId: "aliyun-alicloud",
      name: "Bash shell",
      inline: ["#!/usr/bin/env bash", "set -euo pipefail", "printf 'bash init ok\\n'"],
    });
    await store.saveApi({
      id: "bash-shell-api",
      providerTypeId: "aliyun-alicloud",
      name: "Bash Shell API",
      keyId: "aliyun-main",
      templateId: "shell-safe",
      shellBinding: shellBinding({ shellId: "bash-shell" }),
      vars: { name: "api-default", token: "api-token" },
      allowedActions: ["deploy"],
    });

    await terraform.deploy(await store.getApi("bash-shell-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    const tfvars = await Bun.file(`${testRoot}/data/apis/bash-shell-api/terraform.tfvars.json`).json();

    expect(tfvars.user_data).toContain("cat >\"$__terraform_platform_init_script\"");
    expect(tfvars.user_data).toContain("#!/usr/bin/env bash\nset -euo pipefail\nprintf 'bash init ok\\n'");
    expect(tfvars.user_data).toContain('"$__terraform_platform_init_script"');
    expect(tfvars.user_data).not.toContain("(\n#!/usr/bin/env bash");
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("redacts signed callback URLs from Terraform output", async () => {
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    const terraform = await createRuntimeFixture(undefined, "", "", "", "__TFVARS__");
    const run = await terraform.deploy(await store.getApi("shell-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    const log = await Bun.file(`${testRoot}/data/apis/shell-api/runs/${run.id}/logs.redacted.txt`).text();
    const events = await store.listRunEvents("shell-api", run.id);

    expect(log).not.toContain("token=");
    expect(JSON.stringify(events)).not.toContain("token=");
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("persists init shell log chunks with sequence replay protection", async () => {
    const terraform = await createRuntimeFixture();
    const run = await terraform.deploy(await store.getApi("shell-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    await store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 1, content: "init " });
    await store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 2, content: "ok" });
    await expectRejects(
      store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 1, content: "replay\n" }),
      "already used",
    );
    const initLog = await store.getInitShellLog("shell-api", run.id);
    const events = await store.listRunEvents("shell-api", run.id);

    expect(initLog).toMatchObject({ status: "received", content: "init ok" });
    expect(events.filter((event) => event.type === "init_shell_output")).toHaveLength(2);
    expect(events.filter((event) => event.type === "init_shell_output").every((event) => event.output === undefined)).toBe(true);
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("marks init shell log complete without adding an empty output event", async () => {
    const terraform = await createRuntimeFixture();
    const run = await terraform.deploy(await store.getApi("shell-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    await store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 1, content: "first\n" });
    await store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 2, content: "", completed: true });
    const initLog = await store.getInitShellLog("shell-api", run.id);
    const events = await store.listRunEvents("shell-api", run.id);

    expect(initLog).toMatchObject({ status: "completed", content: "first\n" });
    expect(events.filter((event) => event.type === "init_shell_output")).toHaveLength(1);
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("does not expose corrupted init shell event output when utf8 splits across callback chunks", async () => {
    const terraform = await createRuntimeFixture();
    const run = await terraform.deploy(await store.getApi("shell-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    const bytes = new TextEncoder().encode("你");
    await store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 1, content: bytes.slice(0, 1) });
    const partialLog = await store.getInitShellLog("shell-api", run.id);
    await store.appendInitShellLog("shell-api", run.id, { nonce: "nonce-1", sequence: 2, content: bytes.slice(1), completed: true });
    const initLog = await store.getInitShellLog("shell-api", run.id);
    const events = await store.listRunEvents("shell-api", run.id);

    expect(partialLog).toMatchObject({ status: "received", content: "" });
    expect(partialLog.content).not.toContain("�");
    expect(initLog).toMatchObject({ status: "completed", content: "你" });
    expect(events.filter((event) => event.type === "init_shell_output")).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("�");
    expect(events.filter((event) => event.type === "init_shell_output").every((event) => event.output === undefined)).toBe(true);
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("keeps init shell logs disabled and rejects callbacks for runs without a shell", async () => {
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    const terraform = await createRuntimeFixture();
    const run = await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });

    const initLog = await store.getInitShellLog("safe-api", run.id);

    expect(initLog).toMatchObject({ enabled: false, status: "disabled", reason: "Run has no init shell" });
    await expectRejects(
      store.appendInitShellLog("safe-api", run.id, { nonce: "nonce-1", sequence: 1, content: "should not persist\n" }),
      "has no init shell",
    );
    Bun.env.PUBLIC_CALLBACK_BASE_URL = "";
  });

  it("lets selected shell override caller-provided startup variable values", async () => {
    const terraform = await createRuntimeFixture();
    const api = await store.getApi("shell-api");

    await terraform.deploy(api, {
      vars: { token: "super-secret", name: "demo", user_data: "caller value" },
    });
    const tfvars = await Bun.file(`${testRoot}/data/apis/shell-api/terraform.tfvars.json`).json();

    expect(tfvars.user_data).toBe("printf 'init shell ok\\n'\n");
  });

  it("writes shell commands to startup variables without Terraform interpolation escaping", async () => {
    const terraform = await createRuntimeFixture();
    await store.saveShell({
      id: "escaped-shell",
      providerTypeId: "aliyun-alicloud",
      name: "Escaped shell",
      inline: ['printf "${var.private_key} %{if true}unsafe%{endif}"'],
    });
    const api = await store.saveApi({
      id: "escaped-api",
      providerTypeId: "aliyun-alicloud",
      name: "Escaped API",
      keyId: "aliyun-main",
      templateId: "shell-safe",
      shellBinding: shellBinding({ shellId: "escaped-shell" }),
      vars: { name: "api-default", token: "api-token" },
      allowedActions: ["deploy"],
    });

    await terraform.deploy(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const tfvars = await Bun.file(`${testRoot}/data/apis/escaped-api/terraform.tfvars.json`).json();

    expect(tfvars.user_data).toBe('printf "${var.private_key} %{if true}unsafe%{endif}"\n');
  });

  it("does not generate shell configuration when an API has no shell", async () => {
    const terraform = await createRuntimeFixture();
    await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });

    expect(await Bun.file(`${testRoot}/data/apis/safe-api/platform-shell.tf`).exists()).toBe(false);
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
        "command_output",
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

  it("streams redacted Terraform command output events before the command finishes", async () => {
    const terraform = await createRuntimeFixture(undefined, "", "", "", "", "stream line 1\nvery-private\nstream line 2");
    const api = await store.getApi("safe-api");
    const deployPromise = terraform.deploy(api, {
      vars: { token: "very-private", name: "demo" },
    });

    try {
      const outputEvent = await waitForRunEvent("safe-api", "command_output");
      const status = await terraform.status("safe-api");

      expect(status.latestRun?.status).toBe("running");
      expect(outputEvent.step).toBe("apply");
      expect(outputEvent.output).toContain("stream line 1");
      expect(outputEvent.output).toContain("[REDACTED]");
      expect(outputEvent.output).not.toContain("very-private");

      await deployPromise;
    } finally {
      await deployPromise.catch(() => undefined);
    }
  });


  it("does not leak secrets split across streamed Terraform output chunks", async () => {
    const terraform = await createRuntimeFixture(undefined, "", "", "", "", "", ["very-", "private"]);
    const api = await store.getApi("safe-api");
    const deployPromise = terraform.deploy(api, {
      vars: { token: "very-private", name: "demo" },
    });

    try {
      const outputEvent = await waitForRunEvent("safe-api", "command_output");
      const status = await terraform.status("safe-api");

      expect(status.latestRun?.status).toBe("running");
      expect(outputEvent.step).toBe("apply");
      expect(JSON.stringify(await store.listRunEvents("safe-api", outputEvent.runId))).not.toContain("very-private");

      const run = await deployPromise;
      const events = await store.listRunEvents("safe-api", run.id);
      const outputEvents = events.filter((event) => event.type === "command_output");
      const streamedOutput = outputEvents.map((event) => event.output ?? "").join("");

      expect(outputEvents.length).toBeGreaterThanOrEqual(1);
      expect(streamedOutput).toContain("[REDACTED]");
      expect(streamedOutput).not.toContain("very-private");
      expect(JSON.stringify(events)).not.toContain("very-private");
    } finally {
      await deployPromise.catch(() => undefined);
    }
  });
  it("starts deploys asynchronously while events persist through terminal status", async () => {
    const terraform = await createRuntimeFixture(undefined, "", "", "apply");
    const api = await store.getApi("safe-api");
    const startedAt = Date.now();
    const run = await terraform.startDeploy(api, {
      vars: { token: "super-secret", name: "demo" },
    });
    const startElapsedMs = Date.now() - startedAt;
    const immediate = await store.getRun("safe-api", run.id);

    expect(startElapsedMs).toBeLessThan(500);
    expect(run.status).toBe("queued");
    expect(["queued", "running"]).toContain(immediate.status);
    expect(immediate.workdir).toBe("data/apis/safe-api");
    expect(immediate.artifactsDir).toBe(`data/apis/safe-api/runs/${run.id}`);

    const finished = await waitForLatestRunStatus(terraform, "safe-api", "succeeded");
    const events = await store.listRunEvents("safe-api", run.id);
    const deleteRun = await terraform.delete(api, { vars: { token: "super-secret", name: "demo" } });

    expect(finished.latestRun?.id).toBe(run.id);
    expect(finished.latestRun?.status).toBe("succeeded");
    expect(events.map((event) => event.type)).toEqual([
      "queued",
      "running",
      "command_started",
      "command_finished",
      "command_started",
      "command_finished",
      "command_started",
      "command_output",
      "command_finished",
      "succeeded",
    ]);
    expect(deleteRun.status).toBe("succeeded");
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
      vars: { name: "republished-demo", token: "republished-secret" },
      allowedActions: originalApi.allowedActions,
    });

    const run = await terraform.deploy(originalApi, {});
    const tfvars = await Bun.file(`${testRoot}/data/apis/safe-api/terraform.tfvars.json`).json();

    expect(republished.revisionId).not.toBe(originalApi.revisionId);
    expect(run.apiRevisionId).toBe(originalApi.revisionId);
    expect(tfvars).toEqual({ name: "api-default", token: "api-token" });
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

  it("serves runtime output snapshots with API-scoped token auth", async () => {
    const terraform = await createRuntimeFixture();
    const token = (await store.rotateRuntimeOutputToken("safe-api")).runtimeOutputToken;
    await terraform.deploy(await store.getApi("safe-api"), {
      vars: { token: "super-secret", name: "demo" },
    });
    await Bun.file(`${testRoot}/terraform-called.txt`).delete();

    const plain = await store.getRuntimeOutput("safe-api", "plain_output", token);
    const sensitive = await store.getRuntimeOutput("safe-api", "secret_output", token);
    await expectRejects(store.getRuntimeOutput("safe-api", "plain_output", "wrong-token"), "Unauthorized");
    await expectRejects(store.getRuntimeOutput("safe-api", "missing_output", token), "Output missing_output not found");

    expect(plain).toMatchObject({ apiId: "safe-api", outputName: "plain_output", value: "hello", sensitive: false });
    expect(sensitive).toMatchObject({ apiId: "safe-api", outputName: "secret_output", value: "[REDACTED]", sensitive: true });
    expect(Object.keys(plain).sort()).toEqual(["apiId", "outputName", "sensitive", "value"]);
    expect(JSON.stringify(plain)).not.toContain("latestRun");
    expect(JSON.stringify(plain)).not.toContain("super-secret");
    expect(await Bun.file(`${testRoot}/terraform-called.txt`).exists()).toBe(false);
  });

  it("disables current runtime outputs after successful delete", async () => {
    const terraform = await createRuntimeFixture();
    const token = (await store.rotateRuntimeOutputToken("safe-api")).runtimeOutputToken;
    const api = await store.getApi("safe-api");
    await terraform.deploy(api, { vars: { token: "super-secret", name: "demo" } });
    await terraform.delete(api, { vars: { token: "super-secret", name: "demo" } });

    await expectRejects(store.getRuntimeOutput("safe-api", "plain_output", token), "Runtime output is unavailable after delete");
  });

  it("does not serve stale runtime output when post-deploy output capture fails", async () => {
    const terraform = await createRuntimeFixture();
    const token = (await store.rotateRuntimeOutputToken("safe-api")).runtimeOutputToken;
    const api = await store.getApi("safe-api");
    await terraform.deploy(api, { vars: { token: "super-secret", name: "demo" } });
    expect(await store.getRuntimeOutput("safe-api", "plain_output", token)).toMatchObject({ value: "hello" });

    const terraformBin = Bun.env.TERRAFORM_BIN;
    expect(terraformBin).toBeString();
    await Bun.write(
      terraformBin as string,
      `#!/usr/bin/env sh
set -eu
if [ "\${1:-}" = "output" ]; then
  printf '%s\n' 'output capture failed' >&2
  exit 1
fi
if [ "\${1:-}" = "apply" ] || [ "\${1:-}" = "destroy" ]; then
  printf 'fake state %s\n' "\${1:-}" > terraform.tfstate
fi
printf 'fake terraform %s ok\n' "\${1:-}"
`,
    );
    await terraform.deploy(api, { vars: { token: "super-secret", name: "demo" } });

    await expectRejects(store.getRuntimeOutput("safe-api", "plain_output", token), "Runtime output is not available");
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
  streamingApplyOutput = "",
  splitStreamingApplyOutput: [string, string] | undefined = undefined,
) {
  await createConfigFixture();
  await saveSafeApi();
  await saveInitShell();
  await saveShellTemplate();
  await saveShellApi();
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
if [ "\${1:-}" = "apply" ] && [ "${applyOutput}" = "__TFVARS__" ]; then
  cat terraform.tfvars.json
  exit 0
fi
if [ "\${1:-}" = "apply" ] && [ -n "${applyOutput}" ]; then
  printf '%s\\n' '${applyOutput}'
  exit 0
fi
if [ "\${1:-}" = "apply" ] && [ -n "${streamingApplyOutput}" ]; then
  printf '%s\n' '${streamingApplyOutput}'
  sleep 1
  printf '%s\n' 'stream finished'
  exit 0
fi
if [ "\${1:-}" = "apply" ] && [ -n "${splitStreamingApplyOutput?.join("") ?? ""}" ]; then
  printf '%s' '${splitStreamingApplyOutput?.[0] ?? ""}'
  sleep 1
  printf '%s\n' '${splitStreamingApplyOutput?.[1] ?? ""}'
  sleep 1
  printf '%s\n' 'stream finished'
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
    vars: { name: "api-default", token: "api-token" },
    allowedActions: ["deploy", "delete"],
  });
}

async function saveInitShell() {
  return store.saveShell({
    id: "init-shell",
    providerTypeId: "aliyun-alicloud",
    name: "Init shell",
    description: "Bootstrap commands",
    inline: ["printf 'init shell ok\\n'"],
  });
}

async function saveShellTemplate() {
  return store.saveTemplate({
    id: "shell-safe",
    name: "Shell safe",
    providerTypeId: "aliyun-alicloud",
    version: "1.0.0",
    variables: [
      { name: "name", required: true, sensitive: false },
      { name: "token", required: true, sensitive: true },
      { name: "user_data", required: false, sensitive: false },
    ],
    files: { "main.tf": 'resource "alicloud_instance" "vm" { user_data = var.user_data }' },
  });
}

async function saveShellApi() {
  return store.saveApi({
    id: "shell-api",
    providerTypeId: "aliyun-alicloud",
    name: "Shell API",
    keyId: "aliyun-main",
    templateId: "shell-safe",
    shellBinding: shellBinding(),
    vars: { name: "api-default", token: "api-token" },
    allowedActions: ["deploy"],
  });
}

function shellBinding(overrides: Partial<{
  shellId: string;
}> = {}) {
  return {
    shellId: overrides.shellId ?? "init-shell",
  };
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

async function waitForRunEvent(apiId: string, type: string) {
  const timeoutMs = 2000;
  const intervalMs = 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const runs = await store.listRuns(apiId);
    for (const run of runs) {
      const event = (await store.listRunEvents(apiId, run.id)).find((candidate) => candidate.type === type);
      if (event) {
        return event;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Expected run event ${type}`);
}

async function waitForLatestRunStatus(
  terraform: {
    status(apiId: string): Promise<{ latestRun?: { id?: string; status?: string; workdir?: string; artifactsDir?: string } }>;
  },
  apiId: string,
  expectedStatus: "running" | "succeeded" | "failed",
) {
  const timeoutMs = 2000;
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
