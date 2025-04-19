import { aliyunECS } from "@/aliyun";
import { sqliteDB } from "@/sqlite";
import { getDockerInstallSteps, getDockerLoginRegistryStep, getSocksInstallSteps, getVpnInstallSteps } from "@/env/env-manager";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("create-instance");

export async function createInstance() {
  logger.info("開始創建實例");

  const { instanceId, instanceName } = await aliyunECS.createInstance();

  if (instanceId !== undefined) {
    logger.debug("實例創建成功，準備初始化數據庫記錄", { instanceId, instanceName });

    // 從環境變數獲取安裝步驟的長度
    const dockerStepTotal = getDockerInstallSteps().length + getDockerLoginRegistryStep().length;
    const socksStepTotal = getSocksInstallSteps().length;
    const vpnStepTotal = getVpnInstallSteps("", "", "").length;

    logger.debug("獲取安裝步驟總數", {
      dockerStepTotal,
      socksStepTotal,
      vpnStepTotal
    });

    await sqliteDB.createInstance(
      instanceId,
      instanceName,
      "admin",
      dockerStepTotal,
      socksStepTotal,
      vpnStepTotal,
    );

    logger.info("實例數據庫記錄創建成功", { instanceId });
  } else {
    logger.error("實例創建失敗，未獲得實例ID");
  }

  return instanceId;
}
