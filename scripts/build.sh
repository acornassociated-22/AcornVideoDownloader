#!/usr/bin/env bash
# Frontend + Tauri masaüstü paketini derler.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_env.sh"

ensure_tools
ensure_node_modules
ensure_linux_build_deps

if ! command -v cargo >/dev/null; then
  echo "Rust/cargo bulunamadı."
  exit 1
fi

echo "==> Frontend build"
npm run build

echo "==> Tauri build"
npx tauri build

echo "==> Paketler genelde şurada:"
echo "   $ROOT/src-tauri/target/release/bundle/"
