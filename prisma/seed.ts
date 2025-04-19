import { PrismaClient } from '../generated/prisma/client';
import { createLogger } from '../src/utils/logger';

// 創建日誌記錄器
const logger = createLogger("prisma-seed");

// 初始化 Prisma 客戶端
const prisma = new PrismaClient();

/**
 * 初始化用戶數據
 */
async function initUsers() {
    logger.info("初始化用戶數據");

    // 檢查 admin 用戶是否已存在
    const userAdmin = await prisma.user.findFirst({
        where: { name: "admin" },
    });

    if (userAdmin) {
        logger.info("admin 用戶已存在");
        return;
    }

    // 創建 admin 用戶
    await prisma.user.create({
        data: { name: "admin" },
    });

    logger.info("admin 用戶創建成功");
}

/**
 * 創建測試實例數據
 */
async function createMaskInstance() {
    logger.info("創建測試實例數據");

    const id = "i-xxxxx";
    const dockerStep = 9;
    const socksStep = 2;
    const ipsecVpnStep = 7;
    const psk = "xxxxx";
    const user = "xxxxx";
    const password = "xxxxx";

    // 檢查測試實例是否已存在
    const existingInstance = await prisma.instance.findUnique({
        where: { id },
    });

    if (existingInstance) {
        logger.info("測試實例已存在");
        return;
    }

    // 創建測試實例
    await prisma.instance.create({
        data: {
            id,
            name: "xxxxx",
            owner: "admin",
            dockerStepTotal: dockerStep,
            socksStepTotal: socksStep,
            ipsecVpnStepTotal: ipsecVpnStep,
            ip: "127.0.0.1",
            start: true,
            docker: true,
            dockerStep,
            socks: true,
            socksStep,
            ipsecVpn: true,
            ipsecVpnStep,
            ipsecPsk: psk,
            ipsecUser: user,
            ipsecPwd: password,
        },
    });

    logger.info("測試實例數據創建成功", { id });
}

/**
 * 主要的 seed 函數
 */
async function main() {
    logger.info("開始初始化資料庫...");

    try {
        // 初始化用戶數據
        await initUsers();

        // 創建測試實例數據
        // await createMaskInstance();

        logger.info("資料庫初始化完成");
    } catch (error) {
        logger.error("資料庫初始化失敗", {
            error: error instanceof Error ? error.message : String(error)
        });
        process.exit(1);
    } finally {
        // 關閉 Prisma 客戶端連接
        await prisma.$disconnect();
    }
}

// 執行 seed 函數
main();