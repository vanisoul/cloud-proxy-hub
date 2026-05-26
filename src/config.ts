import type { ProviderType } from "@/types";

export const appConfig = {
  port: Number(Bun.env.PORT ?? "3000"),
  configDir: Bun.env.CONFIG_DIR ?? "./config",
  dataDir: Bun.env.DATA_DIR ?? "./data",
  apiKey: Bun.env.ADMIN_API_KEY ?? "",
  terraformBin: Bun.env.TERRAFORM_BIN ?? "terraform",
};

export const builtInProviderTypes: ProviderType[] = [
  {
    id: "aliyun-alicloud",
    name: "Aliyun / Alibaba Cloud",
    sourceAddress: "aliyun/alicloud",
    versionConstraint: "~> 1.0",
    requiredEnv: ["ALICLOUD_ACCESS_KEY", "ALICLOUD_SECRET_KEY", "ALICLOUD_REGION"],
    supportedActions: ["plan", "apply", "destroy", "refresh"],
    docsUrl: "https://registry.terraform.io/providers/aliyun/alicloud/latest/docs",
  },
  {
    id: "google",
    name: "Google Cloud",
    sourceAddress: "hashicorp/google",
    versionConstraint: "~> 6.0",
    requiredEnv: ["GOOGLE_CREDENTIALS", "GOOGLE_PROJECT", "GOOGLE_REGION"],
    supportedActions: ["plan", "apply", "destroy", "refresh"],
    docsUrl: "https://registry.terraform.io/providers/hashicorp/google/latest/docs",
  },
];
