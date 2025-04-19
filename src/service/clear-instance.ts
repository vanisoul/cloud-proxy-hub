// 清除管理之外的實例

import { sqliteDB } from "@/sqlite/index";
import { aliyunECS } from "@/aliyun/index";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("clear-instance");

export async function forceClear() {
  logger.info("開始強制清理所有實例");
  const instances = await sqliteDB.getInstances();
  const ids = instances.map((instance) => instance.id);
  logger.info("刪除所有實例記錄", { count: ids.length, ids });
  await sqliteDB.deleteInstances(ids);
  const result = await clearInstance();
  logger.info("強制清理完成", { result });
  return result;
}

export async function clearInstance() {
  logger.info("開始清理不在管理中的實例");

  // 取得所有 aliyunECS 存在實體
  logger.debug("獲取阿里雲 ECS 實例列表");
  const instances = await aliyunECS.describeInstances();

  const instanceIdsByAliyun = instances.instances?.instance?.map((x) =>
    x.instanceId
  ).filter((x) => x !== undefined) as string[];

  if (instanceIdsByAliyun === undefined) {
    logger.warn("未找到阿里雲 ECS 實例");
    return [];
  }

  logger.debug("阿里雲 ECS 實例列表", { count: instanceIdsByAliyun.length, ids: instanceIdsByAliyun });

  // 取得所有 sqliteDB 存在實體
  logger.debug("獲取資料庫中的實例列表");
  const instance = await sqliteDB.getInstances();
  const instanceIdsBySqlite = instance.map((instance) =>
    instance.id
  );

  logger.debug("資料庫中的實例列表", { count: instanceIdsBySqlite.length, ids: instanceIdsBySqlite });

  // 取得所有在 aliyunECS 但是不在 sqliteDB 的實體
  const instanceIdsByAliyunOnly = instanceIdsByAliyun.filter(
    (id) => !instanceIdsBySqlite.includes(id),
  );

  logger.debug("僅在阿里雲中存在的實例", { count: instanceIdsByAliyunOnly.length, ids: instanceIdsByAliyunOnly });

  // 取得所有在 sqliteDB 但是不在 aliyunECS 的實體
  const instanceIdsBySqliteOnly = instanceIdsBySqlite.filter(
    (id) => !instanceIdsByAliyun.includes(id),
  );

  logger.debug("僅在資料庫中存在的實例", { count: instanceIdsBySqliteOnly.length, ids: instanceIdsBySqliteOnly });

  // 刪除只存在 instanceIdsBySqliteOnly 的紀錄
  if (instanceIdsBySqliteOnly.length > 0) {
    logger.info("刪除僅在資料庫中存在的實例記錄", { count: instanceIdsBySqliteOnly.length, ids: instanceIdsBySqliteOnly });
    await sqliteDB.deleteInstances(instanceIdsBySqliteOnly);
  }

  // 刪除實際實體, 如果為空則不刪除
  if (instanceIdsByAliyunOnly.length === 0) {
    logger.info("沒有需要刪除的阿里雲實例");
    return undefined;
  }

  // 刪除 instanceIdsByAliyunOnly 這些實體
  logger.info("刪除僅在阿里雲中存在的實例", { count: instanceIdsByAliyunOnly.length, ids: instanceIdsByAliyunOnly });
  await aliyunECS.deleteInstance(instanceIdsByAliyunOnly);

  logger.info("清理完成", { deletedCount: instanceIdsByAliyunOnly.length });
  return instanceIdsByAliyunOnly;
}
