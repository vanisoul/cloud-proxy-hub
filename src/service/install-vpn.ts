import { aliyunECS } from "@/aliyun/index";
import { sqliteDB } from "@/sqlite";
import { getVpnInstallSteps, generateRandomAlphanumeric } from "@/env/env-manager";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("install-vpn");

// 指定 ECS ID 執行 Vpn 安裝
export async function installVpn(id: string) {
  logger.info("開始安裝 IPsec VPN", { id });

  // 生成隨機憑證
  const psk = generateRandomAlphanumeric();
  const user = generateRandomAlphanumeric();
  const password = generateRandomAlphanumeric();

  logger.debug("生成 VPN 隨機憑證", { id });

  // 從環境變數獲取安裝步驟
  const installVpnStep = getVpnInstallSteps(psk, user, password);
  logger.debug("獲取 VPN 安裝步驟", { id, stepsCount: installVpnStep.length });

  for (
    const { step, idx } of installVpnStep.map((step, idx) => ({
      step,
      idx,
    }))
  ) {
    logger.info(`執行安裝步驟 ${idx + 1}/${installVpnStep.length}`, { id });
    const { success, msg } = await aliyunECS.runCommand(id, step);

    if (!success) {
      logger.error(`安裝步驟 ${idx + 1} 失敗`, { id, error: msg });
      return msg;
    }

    logger.debug(`安裝步驟 ${idx + 1} 成功`, { id });
    await sqliteDB.updateInstanceIpsecVpnStep(id, idx + 1);
  }

  logger.debug("保存 VPN 憑證到數據庫", { id });
  await sqliteDB.setInstanceIpsec(id, psk, user, password);

  logger.info("IPsec VPN 安裝成功", { id });
  return "VPN installed successfully";
}
