import { aliyunECS } from "@/aliyun";
import { sqliteDB } from "@/sqlite";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("get-instance-ip");

export async function getInstanceIp(id: string) {
  logger.info("開始獲取實例 IP", { id });

  const ip = await aliyunECS.getInstanceIp(id);

  if (ip) {
    logger.info("獲取實例 IP 成功", { id, ip });
    await sqliteDB.setInstanceIp(id, ip);
  } else {
    logger.error("獲取實例 IP 失敗", { id });
    await sqliteDB.setInstanceIp(id, "error");
  }

  return ip;
}
