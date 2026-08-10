#!/usr/bin/env bash
# Build a signed Android APK (Tauri 2) with full preflight + project repair.
#
# Usage:
#   ./scripts/package-android.sh              # release APK (aarch64 — telefon)
#   ./scripts/package-android.sh universal    # tüm ABI
#   ./scripts/package-android.sh debug        # debug APK (aarch64)
#   ./scripts/package-android.sh -- aarch64 armv7
#
# Env (optional):
#   ANDROID_HOME / ANDROID_SDK_ROOT
#   ANDROID_NDK_HOME / NDK_HOME
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_android_common.sh"

MODE="${1:-arm64}"
shift || true
IS_DEBUG=0
OUT_LABEL="aarch64"
TAURI_ARGS=(android build --apk --ci)
BUILD_STARTED_AT=0

usage() {
  cat <<'EOF'
Kullanım: ./scripts/package-android.sh [mod] [-- hedef…]

  (yok) | arm64 | aarch64   Release APK — yalnızca aarch64 (telefon)
  universal | all           Release APK — tüm ABI
  debug                     Debug APK — aarch64
  -h | --help               Bu yardım

Örnekler:
  npm run package:apk
  ./scripts/package-android.sh universal
  ./scripts/package-android.sh -- aarch64 armv7

Çıktı:
  releases/acorn-video-downloader_<version>_<label>.apk
EOF
}

# —— Mode parsing ——
case "$MODE" in
  -h|--help|help)
    usage
    exit 0
    ;;
  arm64|aarch64)
    TAURI_ARGS+=(--target aarch64)
    OUT_LABEL="aarch64"
    ;;
  universal|all)
    OUT_LABEL="universal"
    ;;
  debug)
    IS_DEBUG=1
    TAURI_ARGS+=(--debug --target aarch64)
    OUT_LABEL="debug-aarch64"
    ;;
  --)
    [[ "$#" -gt 0 ]] || die "-- sonrası en az bir hedef gerekli (aarch64|armv7|i686|x86_64)"
    TAURI_ARGS+=(--target "$@")
    OUT_LABEL="custom"
    ;;
  armv7|i686|x86_64)
    TAURI_ARGS+=(--target "$MODE")
    OUT_LABEL="$MODE"
    ;;
  *)
    echo "Bilinmeyen mod: $MODE" >&2
    usage
    exit 1
    ;;
esac

clean_apk_outputs() {
  if [[ -d "$APK_OUT_ROOT" ]]; then
    info "Eski APK çıktıları temizleniyor…"
    find "$APK_OUT_ROOT" -type f -name '*.apk' -delete 2>/dev/null || true
  fi
}

run_build() {
  info "Tauri: npx tauri ${TAURI_ARGS[*]}"
  BUILD_STARTED_AT="$(date +%s)"
  npx tauri "${TAURI_ARGS[@]}"
}

# Pick newest APK produced at/after BUILD_STARTED_AT.
publish_apk() {
  local version dest pick="" pick_mtime=0 candidate c_mtime base
  version="$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")"
  mkdir -p "$RELEASES_DIR"

  [[ -d "$APK_OUT_ROOT" ]] || die "APK çıktı klasörü yok: $APK_OUT_ROOT"

  mapfile -t APKS < <(find "$APK_OUT_ROOT" -type f -name '*.apk' 2>/dev/null | sort)
  [[ "${#APKS[@]}" -gt 0 ]] || die "APK üretilmedi: $APK_OUT_ROOT
  Gradle/Tauri loguna bakın."

  echo ""
  info "Üretilen APK(lar):"
  for candidate in "${APKS[@]}"; do
    echo "   $candidate"
  done

  for candidate in "${APKS[@]}"; do
    c_mtime="$(stat -c %Y "$candidate" 2>/dev/null || echo 0)"
    if [[ "$c_mtime" -lt $((BUILD_STARTED_AT - 60)) ]]; then
      continue
    fi
    base="$(basename "$candidate")"
    case "$OUT_LABEL" in
      universal)
        [[ "$base" == *universal* ]] || continue
        ;;
      aarch64)
        [[ "$base" == *arm64* || "$base" == *aarch64* || "$base" == *universal* ]] || continue
        ;;
      debug-aarch64)
        [[ "$base" == *debug* ]] || continue
        ;;
    esac
    if [[ "$IS_DEBUG" -eq 0 && "$base" == *debug* ]]; then
      continue
    fi
    if [[ "$c_mtime" -ge "$pick_mtime" ]]; then
      pick="$candidate"
      pick_mtime="$c_mtime"
    fi
  done

  if [[ -z "$pick" ]]; then
    for candidate in "${APKS[@]}"; do
      c_mtime="$(stat -c %Y "$candidate" 2>/dev/null || echo 0)"
      if [[ "$c_mtime" -lt $((BUILD_STARTED_AT - 60)) ]]; then
        continue
      fi
      if [[ "$c_mtime" -ge "$pick_mtime" ]]; then
        pick="$candidate"
        pick_mtime="$c_mtime"
      fi
    done
  fi

  [[ -n "$pick" ]] || die "Yeni APK bulunamadı (stale koruması). Build gerçekten başarılı mı?"

  dest="${RELEASES_DIR}/acorn-video-downloader_${version}_${OUT_LABEL}.apk"
  cp -f "$pick" "$dest"

  echo ""
  info "Kurulum APK hazır:"
  echo "   $dest"
  echo "   kaynak: $pick"
  if command -v adb >/dev/null; then
    echo ""
    echo "Telefona kur (USB debug):"
    echo "  adb install -r \"$dest\""
    echo ""
    echo "Veya debug modda aç:"
    echo "  ./scripts/run-android-debug.sh apk"
  fi
  echo ""
}

# —— Main ——
preflight
setup_env
ensure_rust_android_targets
ensure_project
ensure_gradle_app
ensure_android_manifest
ensure_android_kotlin
ensure_android_proguard
ensure_gradle_properties
ensure_android_theme
ensure_signing

info "Acorn launcher ikonları senkronize ediliyor…"
node "${SCRIPT_DIR}/generate-app-icon.mjs" || die "İkon üretimi başarısız (npm run icons)"

clean_apk_outputs
run_build
publish_apk
