import { appConfig } from "@/config";

export const initShellCallbackMaxBytes = 64 * 1024;
export const initShellCallbackTtlMs = 30 * 60 * 1000;

export type InitShellCallbackClaims = {
  apiId: string;
  runId: string;
  nonce: string;
  exp: number;
};

export async function createInitShellCallbackToken(claims: InitShellCallbackClaims) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = await hmacSha256Base64Url(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export async function createInitShellCallbackUrl(apiId: string, runId: string) {
  const baseUrl = appConfig.publicCallbackBaseUrl;
  if (!baseUrl) {
    return undefined;
  }
  const token = await createInitShellCallbackToken({
    apiId,
    runId,
    nonce: crypto.randomUUID(),
    exp: Date.now() + initShellCallbackTtlMs,
  });
  const url = new URL(`/callbacks/init-shell/${encodeURIComponent(apiId)}/${encodeURIComponent(runId)}`, baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function verifyInitShellCallbackToken(token: string, apiId: string, runId: string) {
  const [header, payload, signature, ...rest] = token.split(".");
  if (!header || !payload || !signature || rest.length > 0) {
    return undefined;
  }
  const expected = await hmacSha256Base64Url(`${header}.${payload}`);
  if (!constantTimeEqual(signature, expected)) {
    return undefined;
  }

  const claims = parseClaims(payload);
  if (!claims || claims.apiId !== apiId || claims.runId !== runId || claims.exp <= Date.now()) {
    return undefined;
  }
  return claims;
}

async function hmacSha256Base64Url(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appConfig.apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function parseClaims(payload: string): InitShellCallbackClaims | undefined {
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<InitShellCallbackClaims>;
    if (
      typeof parsed.apiId === "string" &&
      typeof parsed.runId === "string" &&
      typeof parsed.nonce === "string" &&
      typeof parsed.exp === "number"
    ) {
      return { apiId: parsed.apiId, runId: parsed.runId, nonce: parsed.nonce, exp: parsed.exp };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
