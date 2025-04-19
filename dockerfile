# docker build 範例
# docker build . --build-arg VERSION=1.0.0 -t cloud-proxy-hub:1.0.0

# docker compose 範例
# docker compose up -d

# 使用 ARG 將 Project VERSION 設置為預設值
ARG VERSION=0.0.0

# 使用 Node.js 18.17.1 作為基礎映像檔
FROM node:22.11.0-slim

# 將 ARG 的版本抓進 image 中
ARG VERSION
ENV VERSION=${VERSION}

# 安裝 curl
RUN apt-get update && apt-get install -y curl unzip

# 安裝 bun cli
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# 清除相關暫存
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# 設置工作目錄
WORKDIR /app

# 建立暫存資料夾
RUN mkdir -p /tmp/aliyundb/

# 複製 package.json 和 bun.lock 進入容器
COPY package.json bun.lock .

# 安裝專案相依套件
RUN bun install --production --frozen-lockfile

# 將 Prisma schema 複製到容器中
COPY prisma ./prisma

# 生成 Prisma 客戶端
RUN bun prisma generate

# 將專案代碼複製到容器中
COPY . .

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# 在容器啟動時運行 `bun start` 命令
CMD ["bun", "run", "start"]
