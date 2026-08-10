#!/usr/bin/env bash
# Sadece React arayüz önizlemesi (indirme çalışmaz — Tauri gerekir).
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_env.sh"

ensure_tools
ensure_node_modules

echo "==> UI önizleme → http://localhost:1420"
echo "   Not: Gerçek indirme için ./scripts/run.sh kullanın."
npm run dev
