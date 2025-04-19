import { PrismaClient } from '../generated/prisma/client';
import { createLogger } from '@/utils/logger';

// 創建日誌記錄器
const logger = createLogger("prisma-client");

// 使用單例模式確保整個應用只有一個 PrismaClient 實例
export const prisma = new PrismaClient();

logger.info("Prisma 客戶端初始化完成");
