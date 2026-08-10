#!/usr/bin/env bash
# Package dispatcher for Acorn Video Downloader.
# Usage:
#   ./scripts/package.sh linux|deb
#   ./scripts/package.sh windows|nsis|exe|msi|both
#   ./scripts/package.sh macos|dmg
#   ./scripts/package.sh android|apk [mod]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${1:-}"
shift || true

usage() {
  cat <<'EOF'
Kullanım: ./scripts/package.sh <hedef>

  linux | deb              Linux .deb (Linux host)
  windows | both           Windows NSIS (.exe) + MSI (Windows host)
  nsis | exe               Yalnızca Windows NSIS .exe
  msi                      Yalnızca Windows MSI
  macos | dmg              macOS .dmg (macOS host)
  android | apk [mod]      Android APK (arm64|universal|debug)

Örnekler:
  npm run package:deb
  npm run package:windows
  npm run package:apk
  ./scripts/package.sh apk universal
EOF
}

case "$target" in
  ""|-h|--help|help)
    usage
    exit 0
    ;;
  linux|deb)
    exec bash "${SCRIPT_DIR}/package-linux.sh"
    ;;
  windows|both)
    exec bash "${SCRIPT_DIR}/package-windows.sh" both
    ;;
  nsis|exe)
    exec bash "${SCRIPT_DIR}/package-windows.sh" nsis
    ;;
  msi)
    exec bash "${SCRIPT_DIR}/package-windows.sh" msi
    ;;
  macos|dmg)
    exec bash "${SCRIPT_DIR}/package-macos.sh"
    ;;
  android|apk)
    exec bash "${SCRIPT_DIR}/package-android.sh" "$@"
    ;;
  *)
    echo "Bilinmeyen hedef: $target"
    echo ""
    usage
    exit 1
    ;;
esac
