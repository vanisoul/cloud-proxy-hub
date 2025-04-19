import { prisma } from "@/prisma-client";
import { isReady } from "@/service/instance-ready";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("sqlite");

// 導出 User 和 Instance 介面，保持與原始代碼相容
export interface User {
  id: number;
  name: string;
}

export interface Instance {
  id: string;
  name: string;
  owner: string;
  ip: string | null;
  start: boolean;
  docker: boolean;
  dockerStep: number;
  dockerStepTotal: number;
  socks: boolean;
  socksStep: number;
  socksStepTotal: number;
  ipsecVpn: boolean;
  ipsecVpnStep: number;
  ipsecVpnStepTotal: number;
  ipsecPsk: string;
  ipsecUser: string;
  ipsecPwd: string;
}

class Sqlite {
  constructor() {
    logger.info("SQLite 初始化完成");
  }

  // 新增一個 instance, 只需要指定 id, name, owner, StepTotal
  async createInstance(
    id: string,
    name: string,
    owner: string,
    dockerStepTotal: number,
    socksStepTotal: number,
    ipsecVpnStepTotal: number,
  ): Promise<void> {
    logger.info("創建新實例", { id, name, owner, dockerStepTotal, socksStepTotal, ipsecVpnStepTotal });
    try {
      await prisma.instance.create({
        data: {
          id,
          name,
          owner,
          dockerStepTotal,
          socksStepTotal,
          ipsecVpnStepTotal,
        },
      });
      logger.debug("實例創建成功", { id });
    } catch (error) {
      logger.error("創建實例失敗", { id, error: error instanceof Error ? error.message : String(error) });
      throw error; // 重新拋出錯誤，讓調用者處理
    }
  }

  // 刪除一個 instance, 只需要指定 id
  async deleteInstance(id: string): Promise<void> {
    logger.info("刪除實例", { id });
    try {
      await prisma.instance.delete({
        where: { id },
      });
      logger.debug("實例刪除成功", { id });
    } catch (error) {
      // 忽略刪除不存在的記錄的錯誤
      logger.error("刪除實例失敗", { id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 刪除多個 instance, 只需要指定 ids
  async deleteInstances(ids: string[]): Promise<void> {
    logger.info("批量刪除實例", { count: ids.length, ids });
    for (const id of ids) {
      await this.deleteInstance(id);
    }
    logger.debug("批量刪除實例完成", { count: ids.length });
  }

  // 根據 id 啟動一個 instance, 只需要指定 id
  async startInstance(id: string): Promise<void> {
    logger.info("啟動實例", { id });
    try {
      await prisma.instance.update({
        where: { id },
        data: { start: true },
      });
      logger.debug("實例啟動成功", { id });
    } catch (error) {
      logger.error("啟動實例失敗", { id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 根據 id 設定 ip
  async setInstanceIp(id: string, ip: string): Promise<void> {
    logger.info("設定實例 IP", { id, ip });
    try {
      await prisma.instance.update({
        where: { id },
        data: { ip },
      });
      logger.debug("設定實例 IP 成功", { id, ip });
    } catch (error) {
      logger.error("設定實例 IP 失敗", { id, ip, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 更新一個 instance 的 dockerStep, 只需要指定 id, Step, 並且 Step == StepTotal 時, 將 docker 設為 true
  async updateInstanceDockerStep(id: string, step: number): Promise<void> {
    logger.debug("更新實例 Docker 步驟", { id, step });
    await this.updateInstanceStep(id, step, "docker");
  }

  // 更新一個 instance 的 socksStep, 只需要指定 id, Step, 並且 Step == StepTotal 時, 將 socks 設為 true
  async updateInstanceSocksStep(id: string, step: number): Promise<void> {
    logger.debug("更新實例 Socks 步驟", { id, step });
    await this.updateInstanceStep(id, step, "socks");
  }

  // 更新一個 instance 的 ipsecVpnStep, 只需要指定 id, Step, 並且 Step == StepTotal 時, 將 ipsecVpn 設為 true
  async updateInstanceIpsecVpnStep(id: string, step: number): Promise<void> {
    logger.debug("更新實例 IpsecVpn 步驟", { id, step });
    await this.updateInstanceStep(id, step, "ipsecVpn");
  }

  // 根據 instance id, 更新 其各類 Step 是否完成, 完成時將相對應的 boolean 設為 true
  async updateInstanceStep(id: string, step: number, type: StepType): Promise<void> {
    logger.info(`更新實例 ${type} 步驟`, { id, step, type });
    try {
      // 更新步驟
      await prisma.instance.update({
        where: { id },
        data: { [`${type}Step`]: step },
      });
      logger.debug(`實例 ${type} 步驟更新成功`, { id, step });

      // 檢查步驟是否完成
      const instance = await prisma.instance.findUnique({
        where: { id },
      });

      if (instance && instance[`${type}Step`] === instance[`${type}StepTotal`]) {
        logger.info(`實例 ${type} 安裝完成`, { id });
        await prisma.instance.update({
          where: { id },
          data: { [type]: true },
        });
      }
    } catch (error) {
      logger.error(`更新實例 ${type} 步驟失敗`, { id, step, type, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 得到所有 instance
  async getInstances(): Promise<Instance[]> {
    logger.debug("獲取所有實例");
    try {
      const instances = await prisma.instance.findMany();
      logger.debug("獲取所有實例成功", { count: instances.length });
      return instances as unknown as Instance[];
    } catch (error) {
      logger.error("獲取所有實例失敗", { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  // 指定 id 得到其對應的 instance
  async getInstanceById(id: string): Promise<Instance | null> {
    logger.debug("獲取指定實例", { id });
    try {
      const instance = await prisma.instance.findUnique({
        where: { id },
      });
      if (instance) {
        logger.debug("獲取指定實例成功", { id });
      } else {
        logger.debug("指定實例不存在", { id });
      }
      return instance as unknown as Instance | null;
    } catch (error) {
      logger.error("獲取指定實例失敗", { id, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  // 清空 Database
  async clearDatabase(): Promise<void> {
    logger.info("清空資料庫");
    try {
      await prisma.user.deleteMany();
      await prisma.instance.deleteMany();
      logger.debug("清空資料庫成功");
    } catch (error) {
      logger.error("清空資料庫失敗", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 根據所有 instance 中, 確認是否有正在執行的 instance, 透過各服務的 boolean 值, 有其中一個非 true, 則代表正在執行
  async getRunningInstance(): Promise<boolean> {
    logger.debug("檢查是否有正在執行的實例");
    try {
      const instances = await prisma.instance.findMany();
      const readys = instances.map((instance: any) => isReady(instance as unknown as Instance));
      const running = readys.some((ready: boolean) => !ready);
      logger.debug("檢查執行中實例完成", { running, instanceCount: instances.length });
      return running;
    } catch (error) {
      logger.error("檢查執行中實例失敗", { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  // 設定 ipsecPsk, ipsecUser, ipsecPwd
  async setInstanceIpsec(
    id: string,
    ipsecPsk: string,
    ipsecUser: string,
    ipsecPwd: string,
  ): Promise<void> {
    logger.info("設定實例 IPsec 參數", { id });
    try {
      await prisma.instance.update({
        where: { id },
        data: { ipsecPsk, ipsecUser, ipsecPwd },
      });
      logger.debug("設定實例 IPsec 參數成功", { id });
    } catch (error) {
      logger.error("設定實例 IPsec 參數失敗", { id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

// 建立 Step Type 使用 "docker", "socks", "ipsecVpn"
type StepType = "docker" | "socks" | "ipsecVpn";

export const sqliteDB = new Sqlite();
