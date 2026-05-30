#!/usr/bin/env bash
set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-terraform-platform}"
IMAGE_NAME="${IMAGE_NAME:-terraform-platform}"
IMAGE_FULL_NAME="${IMAGE_REPO}/${IMAGE_NAME}"
VERSION="${1:-latest}"

docker build \
 --platform linux/amd64 \
 -t "${IMAGE_FULL_NAME}:${VERSION}" \
 -t "${IMAGE_FULL_NAME}:latest" .

echo "docker push ${IMAGE_FULL_NAME}:${VERSION}"
