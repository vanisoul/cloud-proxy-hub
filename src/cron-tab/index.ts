import { CronJob } from "cron";
import { clearInstance, forceClear } from "@/service/clear-instance";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("cron-tab");

// 定期清除管理之外的實例
export const clearInstanceJob = CronJob.from({
  cronTime: "*/10 * * * *",
  onTick: function () {
    logger.info("執行定期清理任務");
    clearInstance().then(result => {
      logger.debug("定期清理任務完成", { result });
    }).catch(error => {
      logger.error("定期清理任務失敗", { error: error.message });
    });
  },
  timeZone: "Asia/Taipei",
});

export const forceClearJob = CronJob.from({
  cronTime: "0 4 * * *",
  onTick: function () {
    logger.info("執行強制清理任務");
    forceClear().then(result => {
      logger.debug("強制清理任務完成", { result });
    }).catch(error => {
      logger.error("強制清理任務失敗", { error: error.message });
    });
  },
  timeZone: "Asia/Taipei",
});
