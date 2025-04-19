import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("pac-file");

export function generatePACFile(hosts: string[], ip: string) {
  logger.info("生成 PAC 文件", { hostsCount: hosts.length, ip });

  let pacScript = `function FindProxyForURL(url, host) {
  `;

  hosts.forEach((host) => {
    logger.debug("添加代理規則", { host, ip });
    pacScript += `    if (shExpMatch(host, "${host}")) {
          return "SOCKS5 ${ip}:1080;DIRECT";
      }
  `;
  });

  pacScript += `    return "DIRECT";
  }`;

  logger.debug("PAC 文件生成完成", { scriptLength: pacScript.length });
  return pacScript;
}
