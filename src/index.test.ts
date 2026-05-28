import { afterEach, describe, expect, it } from "bun:test";

const spawnedProcesses: Bun.Subprocess[] = [];

afterEach(async () => {
  while (spawnedProcesses.length > 0) {
    const process = spawnedProcesses.pop();
    if (!process) {
      continue;
    }
    process.kill();
    await process.exited.catch(() => undefined);
  }
});

describe("Admin SPA contract", () => {
  it("keeps the backend login page and replaces the inline admin page with SPA serving", async () => {
    const source = await Bun.file("src/index.ts").text();

    expect(source).toContain("Terraform Platform Login");
    expect(source).toContain("serveSpaIndex");
    expect(source).toContain("serveSpaAsset");
    expect(source).not.toContain("function adminPage()");
  });

  it("defines the Vite Vue Element Plus admin shell and workbenches", async () => {
    const html = await Bun.file("web/index.html").text();
    const app = await Bun.file("web/src/App.vue").text();
    const main = await Bun.file("web/src/main.ts").text();

    expect(html).toContain('<div id="app"></div>');
    expect(main).toContain('import ElementPlus from "element-plus"');
    expect(app).toContain("Operations Dashboard");
    expect(app).toContain("Credential Profiles");
    expect(app).toContain("Template Library");
    expect(app).toContain("Published API Contracts");
    expect(app).toContain("Runtime Cockpit");
    expect(app).toContain("Publish an API to unlock runtime actions.");
    expect(app).toContain("Resource ID");
    expect(app).toContain("Template files JSON");
    expect(app).toContain("filesJson");
  });

  it("preserves optional resource ids and full template file editing in the SPA", async () => {
    const app = await Bun.file("web/src/App.vue").text();

    expect(app).toContain("editingKeyId");
    expect(app).toContain("editingTemplateId");
    expect(app).toContain("editingApiId");
    expect(app).toContain("id: editingKeyId.value ? undefined : optionalText(keyForm.id)");
    expect(app).toContain("id: editingTemplateId.value ? undefined : optionalText(templateForm.id)");
    expect(app).toContain("id: editingApiId.value ? undefined : optionalText(apiForm.id)");
    expect(await Bun.file("web/src/types.ts").text()).toContain('files: Record<string, string>');
    expect(app).toContain('fullTemplate.files');
    expect(app).not.toContain('mainTf: templateForm.mainTf');
  });

  it("uses only same-origin UI calls from the browser client", async () => {
    const apiClient = await Bun.file("web/src/api.ts").text();
    const webSource = `${apiClient}
${await Bun.file("web/src/App.vue").text()}`;

    expect(apiClient).toContain('credentials: "same-origin"');
    expect(webSource).toContain("/ui/bootstrap");
    expect(webSource).toContain("/ui/providers/");
    expect(webSource).toContain("/ui/deployments/");
    expect(webSource).not.toContain("ADMIN_API_KEY");
    expect(webSource).not.toContain("authorization");
  });

  it("redirects unauthenticated root requests to login", async () => {
    const server = await startTestServer();
    const response = await fetch(server.origin, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("serves the built SPA shell and hashed assets after login while keeping login text", async () => {
    const server = await startTestServer();
    const loginPage = await fetch(`${server.origin}/login`);
    const cookie = await login(server.origin);
    const response = await fetch(server.origin, { headers: { cookie } });
    const html = await response.text();
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];

    expect(await loginPage.text()).toContain("Terraform Platform Login");
    expect(response.status).toBe(200);
    expect(html).toContain('<div id="app"></div>');
    expect(html).toContain('/assets/');
    expect(assetPath).toBeString();

    if (!assetPath) {
      throw new Error("Expected built JS asset path");
    }

    const assetResponse = await fetch(`${server.origin}${assetPath}`);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
  });

  it("preserves backend route auth guarantees for UI and API routes", async () => {
    const server = await startTestServer();
    const cookie = await login(server.origin);

    const unauthorizedApi = await fetch(`${server.origin}/api/provider-types`);
    const authorizedApi = await fetch(`${server.origin}/api/provider-types`, {
      headers: { authorization: "Bearer test-admin-key" },
    });
    const uiBootstrap = await fetch(`${server.origin}/ui/bootstrap`, { headers: { cookie } });
    const crossOriginMutation = await fetch(`${server.origin}/ui/providers/aliyun-alicloud/keys`, {
      method: "POST",
      headers: { cookie, origin: "https://example.invalid", "content-type": "application/json" },
      body: JSON.stringify({ name: "blocked", env: {} }),
    });

    expect(unauthorizedApi.status).toBe(401);
    expect(authorizedApi.status).toBe(200);
    expect(uiBootstrap.status).toBe(200);
    expect(crossOriginMutation.status).toBe(403);
  });
});

async function startTestServer() {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const testRoot = `/tmp/cloud-proxy-hub-ui-${crypto.randomUUID()}`;
  const process = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: {
      ...Bun.env,
      ADMIN_API_KEY: "test-admin-key",
      CONFIG_DIR: `${testRoot}/config`,
      DATA_DIR: `${testRoot}/data`,
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  spawnedProcesses.push(process);
  const origin = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`, {
        headers: { authorization: "Bearer test-admin-key" },
      });
      if (response.ok) {
        return { origin };
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("Test server did not become ready");
}

async function login(origin: string) {
  const response = await fetch(`${origin}/login`, {
    method: "POST",
    body: new URLSearchParams({ adminKey: "test-admin-key" }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie");

  expect(response.status).toBe(303);
  expect(cookie).toContain("terraform_platform_session=");

  if (!cookie) {
    throw new Error("Expected login cookie");
  }

  return cookie;
}
