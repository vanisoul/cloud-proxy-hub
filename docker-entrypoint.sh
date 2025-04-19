#!/bin/bash

# 部署資料庫 - 在生產環境中使用 prisma migrate deploy
bun prisma migrate deploy

# 初始化資料庫
bun prisma db seed

$@