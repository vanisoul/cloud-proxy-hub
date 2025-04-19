import { aliyunECS } from "@/aliyun/index";
import { sqliteDB } from "@/sqlite";
import { getSocksInstallSteps, getSocksCheckCommand } from "@/env/env-manager";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("install-socks");

// 指定 ECS ID 執行 Socks 安裝
export async function installSocks(id: string, ip: string) {
  logger.info("開始安裝 Socks5 代理", { id, ip });

  // 從環境變數獲取安裝步驟
  const installSocksStep = getSocksInstallSteps();
  logger.debug("獲取 Socks5 安裝步驟", { id, stepsCount: installSocksStep.length });

  for (
    const { step, idx } of installSocksStep.map((step, idx) => ({ step, idx }))
  ) {
    logger.info(`執行安裝步驟 ${idx + 1}/${installSocksStep.length}`, { id });
    const { success, msg } = await aliyunECS.runCommand(id, step);

    if (!success) {
      logger.error(`安裝步驟 ${idx + 1} 失敗`, { id, error: msg });
      return msg;
    }

    logger.debug(`安裝步驟 ${idx + 1} 成功`, { id });
    await sqliteDB.updateInstanceSocksStep(id, idx + 1);
  }

  // 從環境變數獲取檢查命令
  const socksCheck = getSocksCheckCommand(ip);
  logger.debug("執行 Socks5 檢查命令", { id, command: socksCheck });

  const { success, msg } = await aliyunECS.runCommand(id, socksCheck);
  if (success && msg.trim() === ip) {
    logger.info("Socks5 代理安裝成功", { id, ip });
    return msg;
  } else {
    logger.error("Socks5 代理安裝失敗", { id, ip, response: msg });
    return `Socks install failed, ${msg}`;
  }
}
