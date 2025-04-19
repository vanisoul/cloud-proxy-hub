import { aliyunECS } from "@/aliyun/index";
import { sqliteDB } from "@/sqlite";
import { getDockerInstallSteps, getDockerLoginRegistryStep, getDockerCheckCommand } from "@/env/env-manager";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("install-docker");

// 指定 ECS ID 執行 docker 安裝
export async function installDocker(id: string) {
  logger.info("開始安裝 Docker", { id });

  // 從環境變數獲取安裝步驟
  const installDockerStep = getDockerInstallSteps();
  const installDockerLoginStep = getDockerLoginRegistryStep();
  logger.debug("獲取 Docker 安裝步驟", { id, stepsCount: installDockerStep.length });
  logger.debug("獲取 Docker 登錄步驟", { id, stepsCount: installDockerLoginStep.length });

  const allSteps = [...installDockerStep, ...installDockerLoginStep];
  logger.debug("獲取 Docker 安裝步驟總數", { id, stepsCount: allSteps.length });

  for (
    const { step, idx } of allSteps.map((step, idx) => ({ step, idx }))
  ) {
    logger.info(`執行安裝步驟 ${idx + 1}/${allSteps.length}`, { id });
    const { success, msg } = await aliyunECS.runCommand(id, step);

    if (!success) {
      logger.error(`安裝步驟 ${idx + 1} 失敗`, { id, error: msg });
      return msg;
    }

    logger.debug(`安裝步驟 ${idx + 1} 成功`, { id });
    await sqliteDB.updateInstanceDockerStep(id, idx + 1);
  }

  // 從環境變數獲取檢查命令
  const dockerCheck = getDockerCheckCommand();
  logger.debug("執行 Docker 檢查命令", { id, command: dockerCheck });

  const { success, msg } = await aliyunECS.runCommand(id, dockerCheck);
  if (success) {
    logger.info("Docker 安裝成功", { id, version: msg.trim() });
    return msg;
  } else {
    logger.error("Docker 安裝失敗", { id, error: msg });
    return "Docker install failed";
  }
}
