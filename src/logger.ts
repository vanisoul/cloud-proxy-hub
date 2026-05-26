export function createLogger(moduleName: string) {
  return {
    info(message: string, meta?: Record<string, unknown>) {
      console.info(format("INFO", moduleName, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      console.warn(format("WARN", moduleName, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>) {
      console.error(format("ERROR", moduleName, message, meta));
    },
  };
}

function format(level: string, moduleName: string, message: string, meta?: Record<string, unknown>) {
  const suffix = meta ? ` ${JSON.stringify(redact(meta))}` : "";
  return `[${new Date().toISOString()}] [${level}] [${moduleName}] ${message}${suffix}`;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = /secret|token|password|credential|key/i.test(key) ? "[REDACTED]" : redact(nested);
    }
    return output;
  }

  return value;
}
