# 工作１
# 建立發布影像工作
# 這個工作會將專案編譯成 Docker 映像檔

# 顯示可用的命令
_default:
    @just --list

# 安裝依賴
install:
    #!/usr/bin/env bash
    echo "安裝依賴"
    bun install

# 運行測試
test:
    #!/usr/bin/env bash
    echo "運行測試"
    bun test

# 運行開發服務器
dev:
    #!/usr/bin/env bash
    echo "啟動開發服務器"
    bun run dev

# 初始化資料庫
db-init:
    #!/usr/bin/env bash
    echo "初始化資料庫"
    bun run db:init

# 重置資料庫
db-reset:
    #!/usr/bin/env bash
    echo "重置資料庫"
    bun run db:reset

# 構建 Docker 映像檔
build version="0.0.1":
    #!/usr/bin/env bash
    : '
    # Example usage:
    DOCKER_HUB_ACCOUNT=cloudproxyhub \
        just build 0.0.1
    '

    DOCKER_HUB_ACCOUNT=${DOCKER_HUB_ACCOUNT:-cloudproxyhub}
    IMAGE_NAME="cloud-proxy-hub"
    FULL_IMAGE_NAME="$DOCKER_HUB_ACCOUNT/$IMAGE_NAME"

    echo "構建 Docker 映像檔 $FULL_IMAGE_NAME:{{version}}"
    docker build -t $FULL_IMAGE_NAME:{{version}} -t $FULL_IMAGE_NAME:latest --build-arg VERSION={{version}} .
    echo "構建完成，映像檔名稱: $FULL_IMAGE_NAME:{{version}}"
    echo "構建完成，映像檔名稱: $FULL_IMAGE_NAME:latest"

# 推送 Docker 映像檔到 Docker Hub
push version="0.0.1":
    #!/usr/bin/env bash
    : '
    # Example usage:
    DOCKER_HUB_ACCOUNT=cloudproxyhub \
        DOCKER_HUB_TOKEN=your_token \
        just push 0.0.1
    '

    DOCKER_HUB_ACCOUNT=${DOCKER_HUB_ACCOUNT:-cloudproxyhub}
    DOCKER_HUB_TOKEN=${DOCKER_HUB_TOKEN:-}
    IMAGE_NAME="cloud-proxy-hub"
    FULL_IMAGE_NAME="$DOCKER_HUB_ACCOUNT/$IMAGE_NAME"

    echo "登錄到 Docker Hub"
    if [ -z "$DOCKER_HUB_TOKEN" ]; then
        echo "警告: DOCKER_HUB_TOKEN 未設置，使用交互式登錄"
        docker login -u $DOCKER_HUB_ACCOUNT
    else
        echo "使用 DOCKER_HUB_TOKEN 登錄"
        echo "$DOCKER_HUB_TOKEN" | docker login -u $DOCKER_HUB_ACCOUNT --password-stdin
    fi

    echo "推送映像檔 $FULL_IMAGE_NAME:{{version}} 到 Docker Hub"
    docker push $FULL_IMAGE_NAME:{{version}}
    docker push $FULL_IMAGE_NAME:latest

# 構建並推送 Docker 映像檔到 Docker Hub
build-push version="0.0.1":
    #!/usr/bin/env bash
    : '
    # Example usage:
    DOCKER_HUB_ACCOUNT=cloudproxyhub \
        DOCKER_HUB_TOKEN=your_token \
        just build-push 0.0.1
    '
    just build {{version}}
    just push {{version}}

# 運行 Docker 容器
run version="0.0.1" port="3000":
    #!/usr/bin/env bash
    : '
    # Example usage:
    IMAGE_NAMESPACE=cloudproxyhub \
        just run 0.0.1 3000
    # Example usage:
    IMAGE_NAMESPACE=cloudproxyhub \
        just run 0.0.1
    '

    IMAGE_NAMESPACE=${IMAGE_NAMESPACE:-cloudproxyhub}
    IMAGE_NAME="cloud-proxy-hub"
    FULL_IMAGE_NAME="$IMAGE_NAMESPACE/$IMAGE_NAME"

    DOCKER_HUB_ACCOUNT=$IMAGE_NAMESPACE \
        just build {{version}}

    echo "運行 Docker 容器 $IMAGE_NAME 從 $FULL_IMAGE_NAME:{{version}}"
    docker run --rm -p {{port}}:3000 -d --name $IMAGE_NAME $FULL_IMAGE_NAME:{{version}}
    echo "運行完成，容器名稱: $IMAGE_NAME"

# 停止並刪除 Docker 容器
stop:
    #!/usr/bin/env bash
    : '
    # Example usage:
    just stop
    '

    IMAGE_NAME="cloud-proxy-hub"

    echo "停止並刪除 Docker 容器 $IMAGE_NAME"
    docker rm -vf $IMAGE_NAME || true
    echo "容器 $IMAGE_NAME 已停止並刪除"
    echo "如果需要，請手動刪除映像檔 $IMAGE_NAME"

# 重新啟動 Docker 容器
restart version="0.0.1" port="3000":
    #!/usr/bin/env bash
    : '
    # Example usage:
    just restart 0.0.1 3000
    '
    just stop
    just run {{version}} {{port}}
    echo "重新啟動 Docker 容器 $IMAGE_NAME 從 $FULL_IMAGE_NAME:{{version}}"
    echo "運行完成，容器名稱: $IMAGE_NAME"

# 顯示 Docker 容器日誌
logs:
    #!/usr/bin/env bash
    : '
    # Example usage:
    just logs
    '

    IMAGE_NAME="cloud-proxy-hub"

    echo "顯示 Docker 容器 $IMAGE_NAME 的日誌"
    docker logs -f $IMAGE_NAME



