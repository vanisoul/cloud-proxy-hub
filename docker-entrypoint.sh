#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${CONFIG_DIR:-/app/config}" "${DATA_DIR:-/app/data}"

exec "$@"
