#!/usr/bin/env bash
# Build Linux .deb installer (Linux host only).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_package_common.sh"

package_require_host linux
ensure_linux_build_deps
echo "==> Desktop sidecars hazırlanıyor…"
bash "${SCRIPT_DIR}/prepare-desktop-binaries.sh" "x86_64-unknown-linux-gnu"
package_require_sidecars "x86_64-unknown-linux-gnu"
package_build_frontend
package_run_tauri_build "deb"
package_finalize_linux_deb
