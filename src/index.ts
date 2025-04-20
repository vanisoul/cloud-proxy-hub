import { CronTime } from "cron";
import { Elysia, t } from "elysia";
import * as ipTools from "ip";

import { createLogger } from "@/utils/logger";
import { swagger } from "@elysiajs/swagger";

import { clearInstance } from "@/service/clear-instance";
import { createInstance } from "@/service/create-instance";
import { getInstanceIp } from "@/service/get-instance-ip";
import { installDocker } from "@/service/install-docker";
import { installSocks } from "@/service/install-sock5";
import { installVpn } from "@/service/install-vpn";
import { isReady } from "@/service/instance-ready";
import { generatePACFile } from "@/service/pac-file";
import { startInstance } from "@/service/start-instance";

import { aliyunECS } from "@/aliyun/index";
import { clearInstanceJob, forceClearJob } from "@/cron-tab/index";
import { sqliteDB } from "@/sqlite/index";

import {
  checkHeaders,
  enableForceClear,
  forceClearTimeZone,
  forceCronTime,
  getProxyTarget,
  getVersion,
  getXApiKey,
  logAllEnvironmentVariables,
} from "@/env/env-manager";

// 創建日誌記錄器
const logger = createLogger("index");

// API 認證模式
const queryStringSchema = t.Object({
  xApiKey: t.String(),
});

// 建立中變數, 用於避免重複執行
let creating = false;

/**
 * 將 IPv6 地址轉換為 IPv4 地址
 */
function addressToIpv4(address: string) {
  // 正則表達式匹配 IPv4 映射的 IPv6 地址
  const regex = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
  const match = address.match(regex);

  // 如果匹配成功，則返回匹配的 IPv4 地址
  if (match) {
    return match[1];
  }

  // 如果輸入的不是有效的 IPv4 映射的 IPv6 地址，返回原地址
  return address;
}

/**
 * 從請求頭中獲取 IP 地址
 */
function getIpFromHeaders(headers: Headers, checkHeaderNames: string[]): string | undefined {
  // 檢查指定的請求頭
  for (const headerName of checkHeaderNames) {
    const headerValue = headers.get(headerName.toLowerCase());
    if (headerValue) {
      // 如果請求頭包含多個 IP 地址（通常以逗號分隔），取第一個
      const ips = headerValue.split(',').map(ip => ip.trim());
      if (ips.length > 0 && ips[0]) {
        logger.debug("找到 IP 地址", { headerName, ip: ips[0] });
        return ips[0];
      }
    }
  }

  logger.warn("未找到 IP 地址");
  return undefined;
}

/**
 * 創建實例的完整流程
 */
async function create() {
  logger.info("開始創建實例");

  // 建立實例
  const id = await createInstance();
  if (id === undefined) {
    logger.error("創建實例失敗");
    return;
  }

  // 等待狀態為 Stopped
  logger.info("等待實例狀態為 Stopped", { id });
  let stoped = false;
  while (!stoped) {
    stoped = await aliyunECS.describeStoppedInstance(id);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // 獲取 IP
  logger.info("獲取實例 IP", { id });
  const ip = await getInstanceIp(id);
  if (ip === undefined) {
    logger.error("獲取實例 IP 失敗", { id });
    return;
  }

  // 啟動實例, 並等待狀態為 Running
  logger.info("啟動實例", { id, ip });
  const start = await startInstance(id);

  // 安裝 docker
  logger.info("安裝 Docker", { id, start });
  const docker = await installDocker(id);

  // 安裝 sock5
  logger.info("安裝 Socks5", { id, docker });
  const socks = await installSocks(id, ip);

  // 安裝 vpn
  logger.info("安裝 VPN", { id, socks });
  await installVpn(id);

  logger.info("實例創建完成", { id });
}

// 創建 API 認證中間件
const authMiddleware = new Elysia()
  .onBeforeHandle(({ query, path }) => {
    // 排除檢查列表
    const excludeList = ["/swagger/json"];
    if (excludeList.includes(path)) {
      return;
    }

    const apiKey = getXApiKey();
    if (apiKey && apiKey !== query.xApiKey) {
      return { status: 401, body: "Unauthorized" };
    }
  });

// 實例管理路由組
const instanceManagementRoutes = new Elysia()
  // 建立實例
  .get("/create", async () => {
    // 如果有正在建立中的實例, 則不執行
    if (creating) {
      logger.warn("已有實例正在創建中");
      return "creating";
    }
    creating = true;

    // 等待 15 秒, 解放避免連點手誤
    setTimeout(() => {
      creating = false;
    }, 15000);

    // 建立實例
    void create();
    void clearInstance();

    // 回傳已收到建立指令, 並在背景執行, 如果需要知道狀態, 請使用 /ids & /status/:id
    return "start create, please check /ids & /status/:id";
  }, {
    query: queryStringSchema,
  })
  // 根據 id 刪除實例
  .get("/delete/:id", async ({ params: { id } }) => {
    sqliteDB.deleteInstance(id);
    const result = await clearInstance();
    return result;
  }, {
    query: queryStringSchema,
  })
  // 刪除所有實例
  .get("/delete/", async () => {
    const instances = await sqliteDB.getInstances();
    const ids = instances.map((instance) => instance.id);
    await sqliteDB.deleteInstances(ids);
    const result = await clearInstance();
    return result;
  }, {
    query: queryStringSchema,
  })
  // 清理不在管理中的實例
  .get("/clear", async () => {
    const result = await clearInstance();
    if (result === undefined) {
      return "no instance need delete";
    } else {
      return "instance deleted: " + result.join(", ");
    }
  }, {
    query: queryStringSchema,
  });

// 實例查詢路由組
const instanceQueryRoutes = new Elysia()
  // 取得所有 id
  .get("/ids", async () => {
    const result = await aliyunECS.describeInstances();
    const ids = result.instances?.instance?.map((instance) =>
      instance.instanceId
    );
    return ids;
  }, {
    query: queryStringSchema,
  })
  // 根據 id 得到實例狀態
  .get("/status/:id", async ({ params: { id } }) => {
    const result = await sqliteDB.getInstanceById(id);
    if (result === null) {
      return { msg: "id not found" };
    }
    return result;
  }, {
    query: queryStringSchema,
  })
  // 取得所有實例狀態
  .get("/list", async () => await sqliteDB.getInstances(), {
    query: queryStringSchema,
  });

// PAC 文件路由組
const pacFileRoutes = new Elysia()
  // 產生指定實例的 proxy.pac
  .get("/pacfile/:id", async ({ params: { id } }) => {
    const instance = await sqliteDB.getInstanceById(id);
    if (instance === null || !isReady(instance) || !instance.ip) {
      return "id not found, instance not ready, or IP not set";
    }
    const pacFile = generatePACFile(getProxyTarget(), instance.ip);
    return pacFile;
  }, {
    query: queryStringSchema,
  })
  // 產生隨機實例的 proxy.pac
  .get("/pacfile", async () => {
    const allInstances = await sqliteDB.getInstances();
    const instances = allInstances.filter((instance) =>
      isReady(instance)
    );
    if (instances.length === 0) {
      return "no instance";
    }

    const instance = instances[Math.floor(Math.random() * instances.length)];
    if (!instance.ip) {
      return "selected instance has no IP set";
    }
    const pacFile = generatePACFile(getProxyTarget(), instance.ip);
    return pacFile;
  }, {
    query: queryStringSchema,
  });

// 安全組管理路由組
const securityGroupRoutes = new Elysia()
  // 根據請求頭設定安全組
  .get("/setSecurity", async ({ request }) => {
    logger.debug("收到設定安全組請求", { headers: Object.fromEntries(request.headers.entries()) });

    // 從請求頭中獲取 IP 地址
    const headerNames = checkHeaders.split(";");
    const clientIp = getIpFromHeaders(request.headers, headerNames) ||
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    logger.info("檢測到客戶端 IP", { clientIp });

    const ipv4Ip = addressToIpv4(clientIp);

    if (!ipTools.isV4Format(ipv4Ip)) {
      logger.error("無效的 IPv4 地址", { ipv4Ip });
      return "not a valid ipv4";
    }

    logger.info("撤銷現有安全組規則");
    await aliyunECS.revokeSecurityGroup();

    logger.info("授權安全組", { ipv4Ip });
    const result = await aliyunECS.authorizeSecurityGroup(
      true,
      true,
      true,
      ipv4Ip,
    );

    logger.info("安全組設定完成", { result });
    return result;
  }, {
    query: queryStringSchema,
  })
  // 根據指定 IP 設定安全組
  .get("/setSecurity/:ip", async ({ params: { ip } }) => {
    await aliyunECS.revokeSecurityGroup();
    const result = await aliyunECS.authorizeSecurityGroup(true, true, true, ip);
    return result;
  }, {
    query: queryStringSchema,
  });

// 主應用
const app = new Elysia()
  // 使用 API 認證中間件
  .use(authMiddleware)
  // 使用 Swagger 文檔
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: { version: getVersion(), title: "cloud-proxy-hub" },
      },
    }),
  )
  // 使用各個路由組
  .use(instanceManagementRoutes)
  .use(instanceQueryRoutes)
  .use(pacFileRoutes)
  .use(securityGroupRoutes)
  .listen(3000);

// 輸出所有環境變數配置
logAllEnvironmentVariables();

// 啟動定時任務
logger.info("啟動定時清理任務");
clearInstanceJob.start();

if (enableForceClear) {
  logger.info("啟動強制清理任務", { cronTime: forceCronTime, timeZone: forceClearTimeZone });
  forceClearJob.cronTime = new CronTime(forceCronTime, forceClearTimeZone);
  forceClearJob.start();
}

// 輸出服務啟動信息
logger.info("服務啟動成功", {
  hostname: app.server?.hostname,
  port: app.server?.port,
  swagger: `http://${app.server?.hostname}:${app.server?.port}/swagger`,
});
