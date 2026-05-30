#!/usr/bin/env bash
set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-terraform-platform}"
VERSION="${1:-latest}"

docker build -t "${IMAGE_REPO}:${VERSION}" -t "${IMAGE_REPO}:latest" .

echo "Built ${IMAGE_REPO}:${VERSION}"
