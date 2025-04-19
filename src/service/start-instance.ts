import { aliyunECS } from "@/aliyun/index";
import { sqliteDB } from "@/sqlite";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("start-instance");

// start instance
export async function startInstance(id: string) {
  logger.info("開始啟動實例", { id });

  const result = await aliyunECS.startInstance(id);
  logger.debug("啟動實例請求已發送", { id, requestId: result.requestId });

  // 等待實例狀態變為 Running
  logger.info("等待實例狀態變為 Running", { id });
  let running = false;
  let attempts = 0;

  while (!running) {
    attempts++;
    logger.debug(`檢查實例狀態 (嘗試 ${attempts})`, { id });
    running = await aliyunECS.describeRunningInstance(id);

    if (running) {
      logger.info("實例已進入 Running 狀態", { id });
    } else {
      logger.debug("實例尚未進入 Running 狀態，等待 3 秒後重試", { id });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  logger.debug("更新數據庫中的實例狀態為已啟動", { id });
  await sqliteDB.startInstance(id);

  logger.info("實例啟動流程完成", { id });
  return result;
}
