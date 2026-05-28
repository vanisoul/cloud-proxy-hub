import { isAbsolute, normalize, sep } from "node:path";

import type { TerraformTemplateInput } from "@/types";

const blockedTerraformTerms = [
  "terraform",
  "backend",
  "required_providers",
  "provider",
  "provisioner",
  "local-exec",
  "remote-exec",
  "module",
];

const blockedTerraformPattern = new RegExp(
  `(?:^|[^A-Za-z0-9_-])(?:${blockedTerraformTerms.join("|")})(?=[^A-Za-z0-9_-]|$)`,
  "i",
);

export function normalizeTemplateFiles(template: TerraformTemplateInput) {
  const files = template.mainTf !== undefined ? { "main.tf": template.mainTf } : template.files;
  if (files === undefined) {
    throw new Error("Template must include main.tf content");
  }
  assertSafeTemplateFiles(files);
  return files;
}

export function assertSafeTemplateFiles(files: Record<string, string>) {
  for (const [fileName, content] of Object.entries(files)) {
    if (isUnsafeRelativePath(fileName)) {
      throw new Error(`Template file ${fileName} is not a safe relative path`);
    }
    if (!fileName.endsWith(".tf") && !fileName.endsWith(".tf.json")) {
      throw new Error(`Template file ${fileName} is not a Terraform file`);
    }
    if (blockedTerraformPattern.test(content)) {
      throw new Error(`Template file ${fileName} contains a blocked Terraform construct`);
    }
    if (fileName.endsWith(".tf.json") && hasBlockedTerraformJsonConstruct(content)) {
      throw new Error(`Template file ${fileName} contains a blocked Terraform construct`);
    }
  }
}

function hasBlockedTerraformJsonConstruct(content: string) {
  try {
    return containsBlockedJsonKey(JSON.parse(content));
  } catch {
    throw new Error("Template file contains invalid Terraform JSON");
  }
}

function containsBlockedJsonKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsBlockedJsonKey);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) => blockedTerraformTerms.includes(key) || containsBlockedJsonKey(child),
  );
}

function isUnsafeRelativePath(fileName: string) {
  const normalized = normalize(fileName);
  const segments = fileName.split(/[\\/]+/);
  return (
    isAbsolute(fileName) ||
    segments.includes("..") ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    normalized.includes(`${sep}..${sep}`)
  );
}
