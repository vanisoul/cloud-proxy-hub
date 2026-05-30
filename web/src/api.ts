export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (!response.ok) {
    const message = isErrorResponse(data) ? data.error : response.statusText;
    throw new Error(message);
  }

  return data as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isErrorResponse(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}
