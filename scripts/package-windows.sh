#!/usr/bin/env bash
# Build Windows NSIS (.exe) and/or MSI installers (Windows host only).
# Usage:
#   ./scripts/package-windows.sh           # nsis + msi
#   ./scripts/package-windows.sh exe       # nsis only
#   ./scripts/package-windows.sh nsis
#   ./scripts/package-windows.sh msi
#   ./scripts/package-windows.sh both
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_package_common.sh"

package_require_host windows
echo "==> Desktop sidecars hazırlanıyor…"
bash "${SCRIPT_DIR}/prepare-desktop-binaries.sh" "x86_64-pc-windows-msvc"
package_require_sidecars "x86_64-pc-windows-msvc"

mode="${1:-both}"
bundles=""
case "$mode" in
  exe|nsis)
    bundles="nsis"
    ;;
  msi)
    bundles="msi"
    ;;
  both|all|"")
    bundles="nsis,msi"
    ;;
  *)
    echo "Kullanım: $0 [exe|nsis|msi|both]"
    exit 1
    ;;
esac

package_build_frontend

echo "==> Tauri build --bundles ${bundles}"
set +e
npx tauri build --bundles "$bundles"
status=$?
set -e

if [[ "$status" -ne 0 && "$bundles" == "nsis,msi" ]]; then
  echo ""
  echo "Uyarı: nsis+msi birlikte başarısız (WiX eksik olabilir). Yalnızca NSIS (.exe) deneniyor…"
  npx tauri build --bundles nsis
  package_print_bundle_dir "nsis"
  exit 0
fi

if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi

if [[ "$bundles" == *nsis* ]]; then
  package_print_bundle_dir "nsis"
fi
if [[ "$bundles" == *msi* ]]; then
  package_print_bundle_dir "msi"
fi
