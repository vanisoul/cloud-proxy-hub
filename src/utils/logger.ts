/**
 * 日誌記錄模塊
 * 提供結構化的日誌記錄功能，支持不同的日誌級別和格式化輸出
 */

// 日誌級別
export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

// 日誌配置
interface LoggerConfig {
    // 最低日誌級別，低於此級別的日誌不會輸出
    minLevel: LogLevel;
    // 是否在生產環境中禁用 DEBUG 級別的日誌
    disableDebugInProd: boolean;
    // 是否包含時間戳
    includeTimestamp: boolean;
    // 是否包含日誌級別
    includeLevel: boolean;
    // 是否包含模塊名稱
    includeModule: boolean;
    // 是否格式化對象
    formatObjects: boolean;
}

// 默認配置
const defaultConfig: LoggerConfig = {
    minLevel: LogLevel.DEBUG,
    disableDebugInProd: true,
    includeTimestamp: true,
    includeLevel: true,
    includeModule: true,
    formatObjects: true,
};

// 從環境變數獲取配置
function getConfigFromEnv(): Partial<LoggerConfig> {
    const config: Partial<LoggerConfig> = {};

    // 最低日誌級別
    const minLevel = Bun.env.LOG_MIN_LEVEL;
    if (minLevel && Object.values(LogLevel).includes(minLevel as LogLevel)) {
        config.minLevel = minLevel as LogLevel;
    }

    // 是否在生產環境中禁用 DEBUG 級別的日誌
    const disableDebugInProd = Bun.env.LOG_DISABLE_DEBUG_IN_PROD;
    if (disableDebugInProd !== undefined) {
        config.disableDebugInProd = disableDebugInProd.toLowerCase() === 'true';
    }

    // 是否包含時間戳
    const includeTimestamp = Bun.env.LOG_INCLUDE_TIMESTAMP;
    if (includeTimestamp !== undefined) {
        config.includeTimestamp = includeTimestamp.toLowerCase() === 'true';
    }

    // 是否包含日誌級別
    const includeLevel = Bun.env.LOG_INCLUDE_LEVEL;
    if (includeLevel !== undefined) {
        config.includeLevel = includeLevel.toLowerCase() === 'true';
    }

    // 是否包含模塊名稱
    const includeModule = Bun.env.LOG_INCLUDE_MODULE;
    if (includeModule !== undefined) {
        config.includeModule = includeModule.toLowerCase() === 'true';
    }

    // 是否格式化對象
    const formatObjects = Bun.env.LOG_FORMAT_OBJECTS;
    if (formatObjects !== undefined) {
        config.formatObjects = formatObjects.toLowerCase() === 'true';
    }

    return config;
}

// 合併配置
const config: LoggerConfig = {
    ...defaultConfig,
    ...getConfigFromEnv(),
};

// 判斷是否為生產環境
const isProd = Bun.env.NODE_ENV === 'production';

// 日誌級別對應的控制台方法
const logMethods = {
    [LogLevel.DEBUG]: console.debug,
    [LogLevel.INFO]: console.info,
    [LogLevel.WARN]: console.warn,
    [LogLevel.ERROR]: console.error,
};

// 日誌級別對應的顏色（僅在非生產環境中使用）
const logColors = {
    [LogLevel.DEBUG]: '\x1b[34m', // 藍色
    [LogLevel.INFO]: '\x1b[32m',  // 綠色
    [LogLevel.WARN]: '\x1b[33m',  // 黃色
    [LogLevel.ERROR]: '\x1b[31m', // 紅色
};

// 重置顏色
const resetColor = '\x1b[0m';

// 格式化對象
function formatObject(obj: any): string {
    try {
        return JSON.stringify(obj, null, isProd ? 0 : 2);
    } catch (error) {
        return String(obj);
    }
}

// 格式化日誌消息
function formatLogMessage(level: LogLevel, module: string, message: string, ...args: any[]): string {
    const parts: string[] = [];

    // 添加時間戳
    if (config.includeTimestamp) {
        const timestamp = new Date().toISOString();
        parts.push(`[${timestamp}]`);
    }

    // 添加日誌級別
    if (config.includeLevel) {
        parts.push(`[${level}]`);
    }

    // 添加模塊名稱
    if (config.includeModule && module) {
        parts.push(`[${module}]`);
    }

    // 添加消息
    parts.push(message);

    // 添加參數
    if (args.length > 0) {
        if (config.formatObjects) {
            parts.push(args.map(arg => {
                if (typeof arg === 'object' && arg !== null) {
                    return formatObject(arg);
                }
                return String(arg);
            }).join(' '));
        } else {
            parts.push(args.map(String).join(' '));
        }
    }

    return parts.join(' ');
}

// 判斷是否應該記錄此級別的日誌
function shouldLog(level: LogLevel): boolean {
    const levelOrder = Object.values(LogLevel);
    const minLevelIndex = levelOrder.indexOf(config.minLevel);
    const currentLevelIndex = levelOrder.indexOf(level);

    // 如果在生產環境中禁用 DEBUG 級別的日誌
    if (isProd && config.disableDebugInProd && level === LogLevel.DEBUG) {
        return false;
    }

    return currentLevelIndex >= minLevelIndex;
}

// 創建日誌記錄器
export function createLogger(module: string) {
    return {
        debug(message: string, ...args: any[]) {
            if (shouldLog(LogLevel.DEBUG)) {
                const formattedMessage = formatLogMessage(LogLevel.DEBUG, module, message, ...args);
                if (isProd) {
                    logMethods[LogLevel.DEBUG](formattedMessage);
                } else {
                    console.debug(`${logColors[LogLevel.DEBUG]}${formattedMessage}${resetColor}`);
                }
            }
        },

        info(message: string, ...args: any[]) {
            if (shouldLog(LogLevel.INFO)) {
                const formattedMessage = formatLogMessage(LogLevel.INFO, module, message, ...args);
                if (isProd) {
                    logMethods[LogLevel.INFO](formattedMessage);
                } else {
                    console.info(`${logColors[LogLevel.INFO]}${formattedMessage}${resetColor}`);
                }
            }
        },

        warn(message: string, ...args: any[]) {
            if (shouldLog(LogLevel.WARN)) {
                const formattedMessage = formatLogMessage(LogLevel.WARN, module, message, ...args);
                if (isProd) {
                    logMethods[LogLevel.WARN](formattedMessage);
                } else {
                    console.warn(`${logColors[LogLevel.WARN]}${formattedMessage}${resetColor}`);
                }
            }
        },

        error(message: string, ...args: any[]) {
            if (shouldLog(LogLevel.ERROR)) {
                const formattedMessage = formatLogMessage(LogLevel.ERROR, module, message, ...args);
                if (isProd) {
                    logMethods[LogLevel.ERROR](formattedMessage);
                } else {
                    console.error(`${logColors[LogLevel.ERROR]}${formattedMessage}${resetColor}`);
                }
            }
        },
    };
}

// 默認日誌記錄器
export const logger = createLogger('app');