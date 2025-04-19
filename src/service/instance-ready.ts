import { Instance } from "@/sqlite/index";
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("instance-ready");

export function isReady(instance: Instance) {
  const ready = instance.start && instance.docker && instance.socks; // && instance.ipsecVpn;

  if (ready) {
    logger.debug("實例已準備就緒", {
      id: instance.id,
      start: instance.start,
      docker: instance.docker,
      socks: instance.socks,
      ipsecVpn: instance.ipsecVpn
    });
  } else {
    logger.debug("實例尚未準備就緒", {
      id: instance.id,
      start: instance.start,
      docker: instance.docker,
      socks: instance.socks,
      ipsecVpn: instance.ipsecVpn
    });
  }

  return ready;
}
