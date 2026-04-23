#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_NODE_BIN="$ROOT_DIR/.tooling/node/bin"

if [[ ! -x "$LOCAL_NODE_BIN/node" || ! -x "$LOCAL_NODE_BIN/npm" ]]; then
  echo "Local Node toolchain is missing."
  echo "Run:"
  echo "  mkdir -p .tooling"
  echo "  curl -fsSL https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-arm64.tar.gz -o .tooling/node.tar.gz"
  echo "  tar -xzf .tooling/node.tar.gz -C .tooling"
  echo "  rm -rf .tooling/node && mv .tooling/node-v22.22.0-darwin-arm64 .tooling/node"
  exit 1
fi

export PATH="$LOCAL_NODE_BIN:$PATH"
export HOME="$ROOT_DIR"
export npm_config_cache="$ROOT_DIR/.npm-cache"

exec "$@"
