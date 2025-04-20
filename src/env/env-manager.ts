import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("env-manager");

/**
 * 通用環境變數
 */
export const Common = {
  /**
   * 獲取應用版本
   */
  getVersion: () => process.env.VERSION ?? "0.0.0",

  /**
   * 是否為生產環境
   */
  isProd: Bun.env.NODE_ENV === "production",
};

/**
 * 日誌相關環境變數
 */
export const Logging = {
  /**
   * 最低日誌級別
   */
  minLevel: Bun.env.LOG_MIN_LEVEL ?? "INFO",

  /**
   * 是否在生產環境中禁用 DEBUG 級別的日誌
   */
  disableDebugInProd: Bun.env.LOG_DISABLE_DEBUG_IN_PROD?.toLowerCase() === "true",

  /**
   * 是否包含時間戳
   */
  includeTimestamp: Bun.env.LOG_INCLUDE_TIMESTAMP?.toLowerCase() !== "false",

  /**
   * 是否包含日誌級別
   */
  includeLevel: Bun.env.LOG_INCLUDE_LEVEL?.toLowerCase() !== "false",

  /**
   * 是否包含模塊名稱
   */
  includeModule: Bun.env.LOG_INCLUDE_MODULE?.toLowerCase() !== "false",

  /**
   * 是否格式化對象
   */
  formatObjects: Bun.env.LOG_FORMAT_OBJECTS?.toLowerCase() !== "false",
};

/**
 * Docker Registry 登錄相關環境變數
 */
export const DockerRegistry = {
  /**
   * Docker Registry 用戶名
   */
  username: Bun.env.DOCKER_REGISTRY_USERNAME ?? "XXXXXXXXXX",

  /**
   * Docker Registry 密碼
   */
  password: Bun.env.DOCKER_REGISTRY_PASSWORD ?? "XXXXXXXXXX",

  /**
   * Docker Registry 地址
   */
  registry: Bun.env.DOCKER_REGISTRY ?? "registry.cn-shanghai.aliyuncs.com",
}

/**
 * 代理相關環境變數
 */
export const Proxy = {
  /**
   * 獲取代理目標列表
   */
  getTargets: () => {
    const defaultTargets = [
      "www.bilibili.com",
      "api.bilibili.com",
      "*.iqiyipic.com",
      "manga.bilibili.com"
    ];

    const proxyTarget = Bun.env.PROXY_TARGETS?.split(",").map((target) => target.trim()) ?? defaultTargets;
    logger.debug("獲取代理目標", { proxyTarget });
    return proxyTarget;
  },

  /**
   * 獲取 API 密鑰
   */
  getXApiKey: () => Bun.env.X_API_KEY ?? "",

  /**
   * 獲取檢查頭部列表
   */
  checkHeaders: Bun.env.CHECK_HEADERS ?? "x-forwarded-for;x-real-ip",
};

/**
 * 阿里雲 API 相關環境變數
 */
export const AliyunAPI = {
  /**
   * 訪問密鑰 ID
   */
  accessKeyId: Bun.env.ACCESS_KEY_ID ?? "",

  /**
   * 訪問密鑰密碼
   */
  accessKeySecret: Bun.env.ACCESS_KEY_SECRET ?? "",

  /**
   * 區域 ID
   */
  regionId: Bun.env.REGION_ID ?? "cn-shanghai",

  /**
   * 端點
   */
  endpoint: Bun.env.ENDPOINT ?? "ecs.cn-shanghai.aliyuncs.com",

  /**
   * 獲取連接超時時間
   */
  getConnectTimeout: () => parseInt(Bun.env.CONNECT_TIMEOUT ?? "100000"),
};

/**
 * 阿里雲 ECS 實例配置相關環境變數
 */
export const AliyunECS = {
  /**
   * 虛擬交換機 ID
   */
  vSwitchId: Bun.env.V_SWITCH_ID ?? "vsw-uf6myeotduwfb3omd9waq",

  /**
   * 安全組 ID
   */
  securityGroupId: Bun.env.SECURITY_GROUP_ID ?? "sg-uf6epjbtjr1q3a7ssar7",

  /**
   * 網絡最大出口帶寬
   */
  internetMaxBandwidthOut: parseInt(Bun.env.INTERNET_MAX_BANDWIDTH_OUT ?? "50"),

  /**
   * 磁盤大小
   */
  diskSize: parseInt(Bun.env.DISK_SIZE ?? "20"),

  /**
   * 磁盤類型
   */
  diskCategory: Bun.env.DISK_CATEGORY ?? "cloud_efficiency",

  /**
   * 鏡像 ID
   */
  imageId: Bun.env.IMAGE_ID ?? "ubuntu_22_04_x64_20G_alibase_20230907.vhd",

  /**
   * 實例類型
   */
  instanceType: Bun.env.INSTANCE_TYPE ?? "ecs.t6-c2m1.large",

  /**
   * 網絡計費類型
   */
  internetChargeType: Bun.env.INTERNET_CHARGE_TYPE ?? "PayByTraffic",

  /**
   * 實例計費類型
   */
  instanceChargeType: Bun.env.INSTANCE_CHARGE_TYPE ?? "PostPaid",

  /**
   * 計費周期
   */
  chargePeriod: parseInt(Bun.env.CHARGE_PERIOD ?? "1"),

  /**
   * 計費周期單位
   */
  chargePeriodUnit: Bun.env.CHARGE_PERIOD_UNIT ?? "Hourly",

  /**
   * 安全策略
   */
  securityStrategy: Bun.env.SECURITY_STRATEGY ?? "Active",

  /**
   * 實例名稱前綴
   */
  instanceNamePrefix: Bun.env.INSTANCE_NAME_PREFIX ?? "Z-",
};

/**
 * 阿里雲命令執行相關環境變數
 */
export const AliyunCommand = {
  /**
   * 命令類型
   */
  commandType: Bun.env.COMMAND_TYPE ?? "RunShellScript",

  /**
   * 命令工作目錄
   */
  commandWorkingDir: Bun.env.COMMAND_WORKING_DIR ?? "/root/",

  /**
   * 命令重複模式
   */
  commandRepeatMode: Bun.env.COMMAND_REPEAT_MODE ?? "Once",

  /**
   * 命令內容編碼
   */
  commandContentEncoding: Bun.env.COMMAND_CONTENT_ENCODING ?? "PlainText",

  /**
   * 命令超時時間
   */
  commandTimeout: parseInt(Bun.env.COMMAND_TIMEOUT ?? "600"),

  /**
   * 命令初始等待時間
   */
  commandInitialWaitTime: parseInt(Bun.env.COMMAND_INITIAL_WAIT_TIME ?? "1000"),

  /**
   * 命令輪詢等待時間
   */
  commandPollingWaitTime: parseInt(Bun.env.COMMAND_POLLING_WAIT_TIME ?? "5000"),
};

/**
 * 安全組規則相關環境變數
 */
export const SecurityGroup = {
  /**
   * TCP/UDP 端口範圍
   */
  tcpUdpPortRange: Bun.env.TCP_UDP_PORT_RANGE ?? "1/65535",

  /**
   * ICMP 端口範圍
   */
  icmpPortRange: Bun.env.ICMP_PORT_RANGE ?? "-1/-1",
};

/**
 * 定時任務相關環境變數
 */
export const CronJob = {
  /**
   * 是否啟用強制清理
   */
  enableForceClear: Bun.env.ENABLE_FORCE_CLEAR?.toString().toLowerCase() === "true" || false,

  /**
   * 強制清理時間
   */
  forceCronTime: Bun.env.FORCE_CLEAR_TIME ?? "0 4 * * *",

  /**
   * 強制清理時區
   */
  timeZone: Bun.env.FORCE_CLEAR_TIMEZONE ?? "Asia/Taipei",
};

/**
 * 安裝步驟相關環境變數
 */
export const Installation = {
  /**
   * 獲取 Docker 安裝步驟
   */
  getDockerInstallSteps: (): string[] => {
    try {
      // 嘗試從環境變數讀取 JSON 格式的安裝步驟
      const envSteps = Bun.env.DOCKER_INSTALL_STEPS;
      if (envSteps) {
        const steps = JSON.parse(envSteps);
        logger.debug("從環境變數獲取 Docker 安裝步驟", { stepsCount: steps.length });
        return steps;
      }
    } catch (error) {
      logger.error("解析 DOCKER_INSTALL_STEPS 環境變數失敗", { error: error instanceof Error ? error.message : String(error) });
    }

    // 默認的 Docker 安裝步驟
    const defaultSteps = [
      "sudo apt-get update",
      "sudo apt-get -y install ca-certificates curl gnupg",
      "sudo install -m 0755 -d /etc/apt/keyrings",
      "sudo rm -rf /etc/apt/keyrings/docker.gpg",
      "curl -fsSL http://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --batch --dearmor -o /etc/apt/keyrings/docker.gpg",
      "sudo chmod a+r /etc/apt/keyrings/docker.gpg",
      `echo "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] http://mirrors.aliyun.com/docker-ce/linux/ubuntu "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null`,
      "sudo apt-get update",
      "sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
    ];

    logger.debug("使用默認 Docker 安裝步驟", { stepsCount: defaultSteps.length });
    return defaultSteps;
  },

  getDockerLoginRegistryStep: (): string[] => {
    // USERNAME 和 PASSWORD 和 Registry 需要從環境變數中獲取
    const username = DockerRegistry.username;
    const password = DockerRegistry.password;
    const registry = DockerRegistry.registry;
    const loginStep = [
      `docker login --username=${username} -p ${password} ${registry}`,
    ];
    logger.debug("獲取 Docker 登錄步驟", { loginStep });
    return loginStep;
  },

  /**
   * 獲取 Docker 檢查命令
   */
  getDockerCheckCommand: (): string => Bun.env.DOCKER_CHECK_COMMAND ?? "docker --version",

  /**
   * 獲取 Socks5 安裝步驟
   */
  getSocksInstallSteps: (): string[] => {
    try {
      const envSteps = Bun.env.SOCKS_INSTALL_STEPS;
      if (envSteps) {
        const steps = JSON.parse(envSteps);
        logger.debug("從環境變數獲取 Socks5 安裝步驟", { stepsCount: steps.length });
        return steps;
      }
    } catch (error) {
      logger.error("解析 SOCKS_INSTALL_STEPS 環境變數失敗", { error: error instanceof Error ? error.message : String(error) });
    }

    const defaultSteps = [
      "docker pull registry.cn-shanghai.aliyuncs.com/pry/socks5:latest",
      "sudo docker run --rm -d --name socks5 -p 1080:1080 registry.cn-shanghai.aliyuncs.com/pry/socks5:latest",
    ];

    logger.debug("使用默認 Socks5 安裝步驟", { stepsCount: defaultSteps.length });
    return defaultSteps;
  },

  /**
   * 獲取 Socks5 檢查命令
   */
  getSocksCheckCommand: (ip: string): string => {
    const template = Bun.env.SOCKS_CHECK_COMMAND_TEMPLATE ?? "curl -s --socks5 http://{ip}:1080 http://ifcfg.co";
    return template.replace("{ip}", ip);
  },

  /**
   * 獲取 VPN 安裝步驟
   */
  getVpnInstallSteps: (psk: string, user: string, password: string): string[] => {
    try {
      const envSteps = Bun.env.VPN_INSTALL_STEPS;
      if (envSteps) {
        const steps = JSON.parse(envSteps);
        const processedSteps = steps.map((step: string) =>
          step.replace("{psk}", psk)
            .replace("{user}", user)
            .replace("{password}", password)
        );
        logger.debug("從環境變數獲取 VPN 安裝步驟", { stepsCount: processedSteps.length });
        return processedSteps;
      }
    } catch (error) {
      logger.error("解析 VPN_INSTALL_STEPS 環境變數失敗", { error: error instanceof Error ? error.message : String(error) });
    }

    const defaultSteps = [
      "docker pull registry.cn-shanghai.aliyuncs.com/pry/vpn:latest",
      "rm -rf /tmp/vpn.env",
      "touch /tmp/vpn.env",
      `echo 'VPN_IPSEC_PSK=${psk}' >> /tmp/vpn.env`,
      `echo 'VPN_USER=${user}' >> /tmp/vpn.env`,
      `echo 'VPN_PASSWORD=${password}' >> /tmp/vpn.env`,
      "sudo docker run --name ipsec-vpn-server --env-file /tmp/vpn.env -p 500:500/udp -p 4500:4500/udp -d --rm --privileged registry.cn-shanghai.aliyuncs.com/pry/vpn:latest",
    ];

    logger.debug("使用默認 VPN 安裝步驟", { stepsCount: defaultSteps.length });
    return defaultSteps;
  },

  /**
   * 生成隨機字母數字字符串
   */
  generateRandomAlphanumeric: (length = 10): string => {
    return [...Array(length)]
      .map(() => (~~(Math.random() * 36)).toString(36))
      .join("");
  },
};

// 為了向後兼容，保留一些常用的導出
export const getProxyTarget = Proxy.getTargets;
export const getXApiKey = Proxy.getXApiKey;
export const getVersion = Common.getVersion;
export const getConnectTimeout = AliyunAPI.getConnectTimeout;
export const accessKeyId = AliyunAPI.accessKeyId;
export const accessKeySecret = AliyunAPI.accessKeySecret;
export const endpoint = AliyunAPI.endpoint;
export const regionId = AliyunAPI.regionId;
export const vSwitchId = AliyunECS.vSwitchId;
export const securityGroupId = AliyunECS.securityGroupId;
export const internetMaxBandwidthOut = AliyunECS.internetMaxBandwidthOut;
export const isProd = Common.isProd;
export const checkHeaders = Proxy.checkHeaders;
export const enableForceClear = CronJob.enableForceClear;
export const forceCronTime = CronJob.forceCronTime;
export const forceClearTimeZone = CronJob.timeZone;
export const diskSize = AliyunECS.diskSize;
export const diskCategory = AliyunECS.diskCategory;
export const imageId = AliyunECS.imageId;
export const instanceType = AliyunECS.instanceType;
export const internetChargeType = AliyunECS.internetChargeType;
export const instanceChargeType = AliyunECS.instanceChargeType;
export const chargePeriod = AliyunECS.chargePeriod;
export const chargePeriodUnit = AliyunECS.chargePeriodUnit;
export const securityStrategy = AliyunECS.securityStrategy;
export const instanceNamePrefix = AliyunECS.instanceNamePrefix;
export const commandType = AliyunCommand.commandType;
export const commandWorkingDir = AliyunCommand.commandWorkingDir;
export const commandRepeatMode = AliyunCommand.commandRepeatMode;
export const commandContentEncoding = AliyunCommand.commandContentEncoding;
export const commandTimeout = AliyunCommand.commandTimeout;
export const commandInitialWaitTime = AliyunCommand.commandInitialWaitTime;
export const commandPollingWaitTime = AliyunCommand.commandPollingWaitTime;
export const tcpUdpPortRange = SecurityGroup.tcpUdpPortRange;
export const icmpPortRange = SecurityGroup.icmpPortRange;
export const getDockerInstallSteps = Installation.getDockerInstallSteps;
export const getDockerLoginRegistryStep = Installation.getDockerLoginRegistryStep;
export const getDockerCheckCommand = Installation.getDockerCheckCommand;
export const getSocksInstallSteps = Installation.getSocksInstallSteps;
export const getSocksCheckCommand = Installation.getSocksCheckCommand;
export const getVpnInstallSteps = Installation.getVpnInstallSteps;
export const generateRandomAlphanumeric = Installation.generateRandomAlphanumeric;

/**
 * 輸出所有環境變數，按照分類進行組織
 */
export function logAllEnvironmentVariables(): void {
  logger.info("=== 應用環境變數配置 ===");

  // 通用環境變數
  logger.info("【通用環境變數】");
  logger.info(`版本: ${Common.getVersion()}`);
  logger.info(`生產環境: ${Common.isProd}`);

  // 日誌相關環境變數
  logger.info("【日誌相關環境變數】");
  logger.info(`最低日誌級別: ${Logging.minLevel}`);
  logger.info(`生產環境禁用 DEBUG: ${Logging.disableDebugInProd}`);
  logger.info(`包含時間戳: ${Logging.includeTimestamp}`);
  logger.info(`包含日誌級別: ${Logging.includeLevel}`);
  logger.info(`包含模塊名稱: ${Logging.includeModule}`);
  logger.info(`格式化對象: ${Logging.formatObjects}`);

  // 代理相關環境變數
  logger.info("【代理相關環境變數】");
  logger.info(`代理目標: ${Proxy.getTargets().join(', ')}`);
  logger.info(`API 密鑰: ${Proxy.getXApiKey() ? '已設置' : '未設置'}`);
  logger.info(`檢查頭部: ${Proxy.checkHeaders}`);

  // 阿里雲 API 相關環境變數
  logger.info("【阿里雲 API 相關環境變數】");
  logger.info(`訪問密鑰 ID: ${AliyunAPI.accessKeyId ? '已設置' : '未設置'}`);
  logger.info(`訪問密鑰密碼: ${AliyunAPI.accessKeySecret ? '已設置' : '未設置'}`);
  logger.info(`區域 ID: ${AliyunAPI.regionId}`);
  logger.info(`端點: ${AliyunAPI.endpoint}`);
  logger.info(`連接超時時間: ${AliyunAPI.getConnectTimeout()}`);

  // 阿里雲 ECS 實例配置相關環境變數
  logger.info("【阿里雲 ECS 實例配置相關環境變數】");
  logger.info(`虛擬交換機 ID: ${AliyunECS.vSwitchId}`);
  logger.info(`安全組 ID: ${AliyunECS.securityGroupId}`);
  logger.info(`網絡最大出口帶寬: ${AliyunECS.internetMaxBandwidthOut}`);
  logger.info(`磁盤大小: ${AliyunECS.diskSize}`);
  logger.info(`磁盤類型: ${AliyunECS.diskCategory}`);
  logger.info(`鏡像 ID: ${AliyunECS.imageId}`);
  logger.info(`實例類型: ${AliyunECS.instanceType}`);
  logger.info(`網絡計費類型: ${AliyunECS.internetChargeType}`);
  logger.info(`實例計費類型: ${AliyunECS.instanceChargeType}`);
  logger.info(`計費周期: ${AliyunECS.chargePeriod}`);
  logger.info(`計費周期單位: ${AliyunECS.chargePeriodUnit}`);
  logger.info(`安全策略: ${AliyunECS.securityStrategy}`);
  logger.info(`實例名稱前綴: ${AliyunECS.instanceNamePrefix}`);

  // 阿里雲命令執行相關環境變數
  logger.info("【阿里雲命令執行相關環境變數】");
  logger.info(`命令類型: ${AliyunCommand.commandType}`);
  logger.info(`命令工作目錄: ${AliyunCommand.commandWorkingDir}`);
  logger.info(`命令重複模式: ${AliyunCommand.commandRepeatMode}`);
  logger.info(`命令內容編碼: ${AliyunCommand.commandContentEncoding}`);
  logger.info(`命令超時時間: ${AliyunCommand.commandTimeout}`);
  logger.info(`命令初始等待時間: ${AliyunCommand.commandInitialWaitTime}`);
  logger.info(`命令輪詢等待時間: ${AliyunCommand.commandPollingWaitTime}`);

  // 安全組規則相關環境變數
  logger.info("【安全組規則相關環境變數】");
  logger.info(`TCP/UDP 端口範圍: ${SecurityGroup.tcpUdpPortRange}`);
  logger.info(`ICMP 端口範圍: ${SecurityGroup.icmpPortRange}`);

  // 定時任務相關環境變數
  logger.info("【定時任務相關環境變數】");
  logger.info(`啟用強制清理: ${CronJob.enableForceClear}`);
  logger.info(`強制清理時間: ${CronJob.forceCronTime}`);
  logger.info(`強制清理時區: ${CronJob.timeZone}`);

  // Docker Registry 登錄相關環境變數
  logger.info("【Docker Registry 登錄相關環境變數】");
  logger.info(`Docker Registry 用戶名: ${Bun.env.DOCKER_REGISTRY_USERNAME ? '已設置' : '未設置'}`);
  logger.info(`Docker Registry 密碼: ${Bun.env.DOCKER_REGISTRY_PASSWORD ? '已設置' : '未設置'}`);
  logger.info(`Docker Registry: ${Bun.env.DOCKER_REGISTRY ?? 'registry.cn-shanghai.aliyuncs.com'}`);

  // 安裝步驟相關環境變數
  logger.info("【安裝步驟相關環境變數】");
  logger.info(`Docker 安裝步驟數量: ${Installation.getDockerInstallSteps().length}`);
  logger.info(`Docker 檢查命令: ${Installation.getDockerCheckCommand()}`);
  logger.info(`Socks5 安裝步驟數量: ${Installation.getSocksInstallSteps().length}`);
  logger.info(`VPN 安裝步驟數量: ${Installation.getVpnInstallSteps('*', '*', '*').length}`);

  logger.info("=== 環境變數配置輸出完成 ===");
}
