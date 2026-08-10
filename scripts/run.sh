#!/usr/bin/env bash
# Acorn Video Downloader — masaüstü uygulamayı geliştirme modunda açar.
set -euo pipefail
echo "==> npm start / ./scripts/run.sh — doğru başlatma yolu"
exec "$(cd "$(dirname "$0")" && pwd)/tauri.sh" dev
