#!/usr/bin/env bash
# Build macOS .dmg installer (macOS host only).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_package_common.sh"

package_require_host macos

# Prefer Apple Silicon triple when on arm64, else Intel.
arch="$(uname -m 2>/dev/null || echo x86_64)"
if [[ "$arch" == "arm64" ]]; then
  triple="aarch64-apple-darwin"
else
  triple="x86_64-apple-darwin"
fi
echo "==> Desktop sidecars hazırlanıyor…"
bash "${SCRIPT_DIR}/prepare-desktop-binaries.sh" "$triple"
package_require_sidecars "$triple"

package_build_frontend
package_run_tauri_build "dmg"
package_print_bundle_dir "dmg"
