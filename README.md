# cloud-proxy-hub

這是一個使用 Elysia with Bun 架構的微服務，主要功能是在 Aliyun
上自動建立虛擬機器 (VM) 並在該虛擬機器上啟動 Docker、VPN 和 Socks5
服務。系統使用 Prisma ORM 進行資料庫操作，並提供結構化的日誌記錄和環境變數管理。

## 技術架構

- **運行環境**: Bun - 高性能 JavaScript 運行時和套件管理器
- **Web 框架**: Elysia - 輕量級、高性能的 Web 框架
- **資料庫**: SQLite + Prisma ORM - 輕量級資料庫和強大的 ORM 工具
- **雲服務**: 阿里雲 ECS - 彈性計算服務
- **代理服務**: Socks5 和 IPsec VPN - 提供安全的網絡代理
- **容器化**: Docker - 用於服務部署和隔離

## 開始之前

請確保您已經安裝了 Bun（[安裝指南](https://bun.sh/docs/installation)）。Bun
是一個快速的 JavaScript 運行環境和套件管理器。

## 環境配置

此微服務使用分類組織的環境變數進行配置。所有環境變數都在 `.env` 文件中設定，並由
`env-manager.ts` 統一管理。

### 通用設定

- `VERSION`: 應用版本號，預設為 "0.0.0"
- `NODE_ENV`: 環境類型，設為 "production" 時啟用生產模式

### 日誌設定

- `LOG_MIN_LEVEL`: 最低日誌級別 (DEBUG, INFO, WARN, ERROR)，預設為 "INFO"
- `LOG_DISABLE_DEBUG_IN_PROD`: 是否在生產環境中禁用 DEBUG 級別的日誌，預設為
  "true"
- `LOG_INCLUDE_TIMESTAMP`: 是否在日誌中包含時間戳，預設為 "true"
- `LOG_INCLUDE_LEVEL`: 是否在日誌中包含日誌級別，預設為 "true"
- `LOG_INCLUDE_MODULE`: 是否在日誌中包含模塊名稱，預設為 "true"
- `LOG_FORMAT_OBJECTS`: 是否格式化日誌中的對象，預設為 "true"

### 代理設定

- `PROXY_TARGETS`: Socks5 代理目標，使用逗號分隔，例如
  "www.bilibili.com,api.bilibili.com"
- `X_API_KEY`: API 授權密鑰，用於查詢字串驗證
- `CHECK_HEADERS`: 用於檢查客戶端 IP 的請求頭，使用分號分隔，預設為
  "x-forwarded-for;x-real-ip"

### 阿里雲 API 設定

- `ACCESS_KEY_ID`: 您的 Aliyun Access Key ID
- `ACCESS_KEY_SECRET`: 您的 Aliyun Access Key Secret
- `REGION_ID`: 您希望創建 VM 的 Aliyun 區域 ID，預設為 "cn-shanghai"
- `ENDPOINT`: Aliyun 服務的端點，預設為 "ecs.cn-shanghai.aliyuncs.com"
- `CONNECT_TIMEOUT`: 連接超時設置（以毫秒為單位），預設為 100000

### 阿里雲 ECS 實例配置

- `V_SWITCH_ID`: 虛擬交換機 ID
- `SECURITY_GROUP_ID`: 安全組 ID
- `INTERNET_MAX_BANDWIDTH_OUT`: 頻寬限制，預設為 50，最大 100，單位 Mbps
- `DISK_SIZE`: 磁盤大小，預設為 20 GB
- `DISK_CATEGORY`: 磁盤類型，預設為 "cloud_efficiency"
- `IMAGE_ID`: 鏡像 ID，預設為 "ubuntu_22_04_x64_20G_alibase_20230907.vhd"
- `INSTANCE_TYPE`: 實例類型，預設為 "ecs.t6-c2m1.large"
- `INTERNET_CHARGE_TYPE`: 網絡計費類型，預設為 "PayByTraffic"
- `INSTANCE_CHARGE_TYPE`: 實例計費類型，預設為 "PostPaid"
- `CHARGE_PERIOD`: 計費周期，預設為 1
- `CHARGE_PERIOD_UNIT`: 計費周期單位，預設為 "Hourly"
- `SECURITY_STRATEGY`: 安全策略，預設為 "Active"
- `INSTANCE_NAME_PREFIX`: 實例名稱前綴，預設為 "Z-"

### 阿里雲命令執行配置

- `COMMAND_TYPE`: 命令類型，預設為 "RunShellScript"
- `COMMAND_WORKING_DIR`: 命令工作目錄，預設為 "/root/"
- `COMMAND_REPEAT_MODE`: 命令重複模式，預設為 "Once"
- `COMMAND_CONTENT_ENCODING`: 命令內容編碼，預設為 "PlainText"
- `COMMAND_TIMEOUT`: 命令超時時間，預設為 600 秒
- `COMMAND_INITIAL_WAIT_TIME`: 命令初始等待時間，預設為 1000 毫秒
- `COMMAND_POLLING_WAIT_TIME`: 命令輪詢等待時間，預設為 5000 毫秒

### 安全組規則配置

- `TCP_UDP_PORT_RANGE`: TCP/UDP 端口範圍，預設為 "1/65535"
- `ICMP_PORT_RANGE`: ICMP 端口範圍，預設為 "-1/-1"

### 定時任務設定

- `ENABLE_FORCE_CLEAR`: 是否啟動每日強制清除實體，預設為 "false"
- `FORCE_CLEAR_TIME`: 每日強制清除實體時間，使用 CronTab 格式，當
  `ENABLE_FORCE_CLEAR` 啟動才有作用，預設為 "0 4 * * *"

### 安裝步驟設定

- `DOCKER_INSTALL_STEPS`: Docker 安裝步驟，JSON 格式的字符串數組
- `DOCKER_CHECK_COMMAND`: Docker 檢查命令，預設為 "docker --version"
- `SOCKS_INSTALL_STEPS`: Socks5 安裝步驟，JSON 格式的字符串數組
- `SOCKS_CHECK_COMMAND_TEMPLATE`: Socks5 檢查命令模板，使用 {ip} 作為 IP
  地址的佔位符
- `VPN_INSTALL_STEPS`: VPN 安裝步驟，JSON 格式的字符串數組，使用 {psk}, {user},
  {password} 作為佔位符

### 資料庫設定

- `DATABASE_URL`: 資料庫連接 URL，預設為 "file:/tmp/aliyundb/db.sqlite"

## 安裝依賴

在專案目錄下執行以下命令來安裝必要的依賴：

```bash
bun install
```

## 資料庫設置與初始化

### 開發環境資料庫管理

#### 生成 Prisma 客戶端

在首次運行或修改 schema.prisma 後，需要生成 Prisma 客戶端：

```bash
# 使用 package.json 中的腳本
bun run db:generate

# 或直接使用 Prisma CLI
bun prisma generate
```

#### 資料庫遷移

如果您修改了 schema.prisma 文件中的資料模型，需要執行遷移命令來更新資料庫結構：

```bash
# 使用 package.json 中的腳本
bun run db:migrate

# 或直接使用 Prisma CLI
bun prisma migrate dev --name <migration-name>
```

#### 快速重置資料庫

在開發過程中，您可能需要重置資料庫並重新應用所有遷移：

```bash
# 重置資料庫並應用所有遷移
bun prisma migrate reset

# 或使用強制選項
bun prisma migrate reset --force
```

這個命令會執行以下操作：

1. 刪除資料庫（如果存在）
2. 創建新的資料庫
3. 應用所有遷移
4. 運行 seed 腳本

#### 資料庫初始化

使用 Prisma Seed 功能初始化資料庫，創建必要的基礎數據：

```bash
# 使用 package.json 中的腳本
bun run db:seed

# 或直接使用 Prisma CLI
bun prisma db seed
```

這將執行 `prisma/seed.ts` 文件中的代碼，初始化以下數據：

1. 創建 admin 用戶
2. 創建測試實例數據（如果需要）

#### 資料庫檢查

您可以使用 Prisma Studio 來查看和編輯資料庫中的數據：

```bash
bun prisma studio
```

這將啟動一個 Web 界面，默認在 http://localhost:5555 上運行。

### 生產環境資料庫部署

在生產環境中，我們使用 `bun prisma migrate deploy` 命令來應用遷移，而不是
`bun prisma migrate dev`。這個命令只會應用現有的遷移，不會創建新的遷移或重置資料庫。

#### 手動部署

```bash
# 應用所有遷移
bun prisma migrate deploy

# 初始化資料庫
bun prisma db seed
```

#### Docker 部署

在 Dockerfile 中，我們已經添加了資料庫部署和初始化的步驟：

```dockerfile
# 生成 Prisma 客戶端
RUN bun prisma generate

# 部署資料庫 - 在生產環境中使用 prisma migrate deploy
RUN bun prisma migrate deploy

# 初始化資料庫
RUN bun prisma db seed
```

這確保了在容器啟動時，資料庫已經正確設置並初始化。

#### 環境變數配置

在生產環境中，您需要設置 `DATABASE_URL` 環境變數，指向您的資料庫：

```
DATABASE_URL="file:/tmp/aliyundb/db.sqlite"
```

您可以在 `.env` 文件中設置此變數，或在運行容器時通過環境變數傳遞：

```bash
docker run -e DATABASE_URL="file:/tmp/aliyundb/db.sqlite" ...
```

#### 持久化資料庫

如果您需要持久化資料庫數據，可以將資料庫文件掛載到容器外部：

```bash
docker run -v /path/to/host/db:/tmp/aliyundb ...
```

## 啟動服務

使用以下命令來啟動微服務：

```bash
# 開發模式（自動重啟）
bun dev

# 生產模式
bun start
```

## 功能說明

### 主要功能

1. **自動建立虛擬機器**：在阿里雲上自動建立 ECS 實例
2. **安裝 Docker**：在虛擬機器上自動安裝 Docker
3. **安裝 Socks5 代理**：在虛擬機器上自動安裝和配置 Socks5 代理服務
4. **安裝 IPsec VPN**：在虛擬機器上自動安裝和配置 IPsec VPN 服務
5. **生成 PAC 文件**：根據配置的代理目標生成 PAC 文件
6. **安全組管理**：自動配置安全組規則，限制訪問來源
7. **定時清理**：定期清理不在管理中的實例

### API 端點

- `/create`: 建立新的虛擬機器實例
- `/ids`: 獲取所有實例 ID
- `/delete/:id`: 刪除指定 ID 的實例
- `/delete/`: 刪除所有實例
- `/clear`: 清理不在管理中的實例
- `/status/:id`: 獲取指定 ID 的實例狀態
- `/list`: 獲取所有實例的狀態
- `/pacfile/:id`: 根據指定 ID 的實例生成 PAC 文件
- `/pacfile`: 隨機選擇一個就緒的實例生成 PAC 文件
- `/setSecurity`: 根據請求頭中的 IP 設置安全組規則
- `/setSecurity/:ip`: 根據指定的 IP 設置安全組規則

## API 文檔

完整的 API 文檔可以通過以下地址訪問：

```
http://localhost:3000/swagger
```

## 開發指南

### 項目結構

```
cloud-proxy-hub/
├── prisma/                  # Prisma 相關文件
│   └── schema.prisma        # 資料庫模型定義
├── src/
│   ├── aliyun/              # 阿里雲 API 相關代碼
│   ├── cron-tab/            # 定時任務相關代碼
│   ├── env/                 # 環境變數管理
│   ├── service/             # 業務邏輯服務
│   ├── sqlite/              # 資料庫存取層
│   ├── utils/               # 工具函數
│   ├── index.ts             # 應用入口
│   └── prisma-client.ts     # Prisma 客戶端
├── .env                     # 環境變數配置
├── .gitignore               # Git 忽略文件
├── bun.lockb                # Bun 鎖定文件
├── docker-compose.yml       # Docker Compose 配置
├── dockerfile               # Docker 構建文件
├── package.json             # 項目配置
├── README.md                # 項目說明
└── tsconfig.json            # TypeScript 配置
```

### 代碼風格

- 使用 TypeScript 進行類型安全的開發
- 使用 Kebab Case 命名文件和目錄（例如 env-manager.ts）
- 使用 Camel Case 命名變數和函數（例如 getDockerInstallSteps）
- 使用 Pascal Case 命名類和介面（例如 PrismaClient）
- 使用命名空間組織環境變數，提高代碼的內聚性
- 使用結構化的日誌記錄，便於問題診斷和性能分析

### 日誌記錄

系統使用結構化的日誌記錄模塊，支持不同的日誌級別：

- `DEBUG`: 詳細的調試信息，僅在開發環境中輸出
- `INFO`: 一般信息，記錄系統的正常操作
- `WARN`: 警告信息，表示可能的問題
- `ERROR`: 錯誤信息，表示發生了錯誤

每個模塊都有自己的日誌記錄器，便於區分不同模塊的日誌：

```typescript
import { createLogger } from "@/utils/logger";

// 創建日誌記錄器
const logger = createLogger("your-module-name");

// 使用日誌記錄器
logger.info("操作信息", { key: "value" });
logger.error("錯誤信息", { error: "錯誤詳情" });
```

## 部署指南

### Docker 部署

1. 構建 Docker 鏡像：

```bash
docker build -t cloud-proxy-hub .
```

2. 運行 Docker 容器：

```bash
docker run -p 3000:3000 --env-file .env cloud-proxy-hub
```

### Docker Compose 部署

使用 Docker Compose 可以更方便地管理服務：

```bash
docker-compose up -d
```

### 檢查影像安全

在部署前，建議檢查 Docker 影像的安全性：

```bash
docker build -t testimg .
docker scout cves local://testimg
```

## 貢獻指南

1. Fork 本項目
2. 創建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打開一個 Pull Request

## 許可證

本項目使用 MIT 許可證 - 詳見 [LICENSE](LICENSE) 文件
