#!/usr/bin/env bash
# Env-aware Tauri CLI wrapper: ./scripts/tauri.sh dev | build | android …
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_env.sh"

ensure_tools
ensure_node_modules

if ! command -v cargo >/dev/null; then
  echo "Rust/cargo bulunamadı. Kurulum: curl https://sh.rustup.rs -sSf | sh"
  exit 1
fi

CMD="${1:-}"

# Mobile builds must not inherit desktop GTK/WebKit link env.
if [[ "$CMD" == "android" || "$CMD" == "ios" ]]; then
  clear_desktop_linux_lib_env

  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  if [[ -d "$SDK" ]]; then
    export ANDROID_HOME="$SDK"
    export ANDROID_SDK_ROOT="$SDK"
  fi

  NDK="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
  if [[ -z "$NDK" || ! -d "$NDK" ]]; then
    if [[ -d "${SDK}/ndk" ]]; then
      NDK="$(find "${SDK}/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)"
    fi
  fi
  if [[ -n "${NDK:-}" && -d "$NDK" ]]; then
    export ANDROID_NDK_HOME="$NDK"
    export NDK_HOME="$NDK"
    PREBUILT_BIN="$(find "${NDK}/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1 || true)"
    if [[ -n "${PREBUILT_BIN:-}" && -d "${PREBUILT_BIN}/bin" ]]; then
      export PATH="${PREBUILT_BIN}/bin:${PATH}"
    fi
  fi

  echo "==> Acorn Tauri mobile ($*)"
  echo "    Desktop lib env temiz; NDK PATH hazır."
  exec npx tauri "$@"
fi

ensure_linux_build_deps

echo "==> Acorn Tauri ($*)"
echo "    PKG_CONFIG_PATH / LIBRARY_PATH hazır; link kütüphaneleri doğrulandı."
exec npx tauri "$@"
