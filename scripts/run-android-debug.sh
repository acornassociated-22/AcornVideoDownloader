#!/usr/bin/env bash
# Acorn Video Downloader — Android debug modda telefonda aç.
#
# Usage:
#   ./scripts/run-android-debug.sh              # canlı dev (hot reload) + logcat
#   ./scripts/run-android-debug.sh dev          # aynı
#   ./scripts/run-android-debug.sh apk        # debug APK derle, kur, aç, logcat
#   ./scripts/run-android-debug.sh release    # release APK derle, kur, aç, logcat
#   ./scripts/run-android-debug.sh logcat       # yalnızca indirme logları
#   ./scripts/run-android-debug.sh dev --no-logcat
#
# Gereksinimler: USB debug açık telefon, adb, Android SDK/NDK (package-android ile aynı).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_android_common.sh"

PACKAGE_ID="com.acorn.videodownloader"
MAIN_ACTIVITY="${PACKAGE_ID}/.MainActivity"
LOG_TAGS=(YtdlpPlugin AcornYtdlpExecutor FfmpegHelper ExportHelper)

MODE="dev"
WITH_LOGCAT=1
EXTRA_ARGS=()

usage() {
  cat <<'EOF'
Kullanım: ./scripts/run-android-debug.sh [komut] [seçenekler]

Komutlar:
  dev          Canlı geliştirme — tauri android dev, bağlı telefonda çalıştır
  apk          Debug APK derle, kur, uygulamayı başlat, logcat
  release      Release APK derle, kur, uygulamayı başlat, logcat (FATAL)
  logcat       İndirme eklentisi loglarını izle (YtdlpPlugin, ffmpeg, export)

Seçenekler (dev):
  --no-logcat  Arka planda logcat başlatma
  -h, --help   Bu yardım

Örnekler:
  npm run android:debug
  ./scripts/run-android-debug.sh
  ./scripts/run-android-debug.sh apk
  ./scripts/run-android-debug.sh logcat

Not:
  dev modu fiziksel cihazda Vite hot-reload için --host kullanır.
  İndirme testi için apk modu (gerçek debug APK) daha güvenilir.
EOF
}

parse_args() {
  if [[ $# -gt 0 && "$1" != -* ]]; then
    case "$1" in
      dev|apk|install|release|logcat)
        MODE="$1"
        shift
        ;;
    esac
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help|help)
        usage
        exit 0
        ;;
      --no-logcat)
        WITH_LOGCAT=0
        shift
        ;;
      --)
        shift
        EXTRA_ARGS+=("$@")
        break
        ;;
      *)
        EXTRA_ARGS+=("$1")
        shift
        ;;
    esac
  done
}

require_adb() {
  command -v adb >/dev/null || die "adb bulunamadı. Android SDK platform-tools PATH'e ekleyin."
  local serial count
  count="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" { c++ } END { print c+0 }')"
  if [[ "${count:-0}" -lt 1 ]]; then
    die "Bağlı Android cihaz yok.
  USB hata ayıklama açık mı? Kontrol: adb devices"
  fi
  serial="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" { print $1; exit }')"
  info "ADB cihaz: ${serial:-?}"
}

prepare_debug_project() {
  OUT_LABEL="debug-aarch64"
  IS_DEBUG=1
  android_prepare_project
}

LOGCAT_PID=""

start_logcat_background() {
  info "Logcat (indirme): ${LOG_TAGS[*]}"
  adb logcat -c >/dev/null 2>&1 || true
  adb logcat -s "${LOG_TAGS[@]}" &
  LOGCAT_PID="$!"
}

stop_logcat_background() {
  if [[ -n "$LOGCAT_PID" ]] && kill -0 "$LOGCAT_PID" 2>/dev/null; then
    kill "$LOGCAT_PID" 2>/dev/null || true
    wait "$LOGCAT_PID" 2>/dev/null || true
  fi
}

run_dev() {
  prepare_debug_project
  require_adb

  if [[ "$WITH_LOGCAT" -eq 1 ]]; then
    start_logcat_background
    trap stop_logcat_background EXIT INT TERM
  fi

  info "Android dev başlatılıyor (hot reload, telefonda aç)…"
  echo "    Durdurmak için Ctrl+C"
  echo ""

  # --host [<IP>] = telefonun Vite'e erişeceği PC adresi (seri numarası DEĞİL).
  # Seri numarası --host'tan sonra ayrı positional [DEVICE] argümanı olmalı.
  local serial lan_ip dev_args=(android dev)
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "$lan_ip" ]]; then
    dev_args+=(--host "$lan_ip")
    info "Dev server host: $lan_ip (telefon bu adrese bağlanır)"
  else
    dev_args+=(--host)
    info "Dev server host: otomatik (--host)"
  fi

  serial="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" { print $1; exit }')"
  if [[ -n "$serial" ]]; then
    dev_args+=("$serial")
  fi
  if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    dev_args+=("${EXTRA_ARGS[@]}")
  fi

  exec bash "${SCRIPT_DIR}/tauri.sh" "${dev_args[@]}"
}

find_debug_apk() {
  local apk=""
  if compgen -G "${RELEASES_DIR}/acorn-video-downloader_*_debug-aarch64.apk" >/dev/null; then
    apk="$(ls -t "${RELEASES_DIR}"/acorn-video-downloader_*_debug-aarch64.apk 2>/dev/null | head -1)"
  fi
  if [[ -z "$apk" && -d "$APK_OUT_ROOT" ]]; then
    apk="$(find "$APK_OUT_ROOT" -type f -name '*debug*.apk' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
  fi
  [[ -n "$apk" && -f "$apk" ]] || return 1
  printf '%s\n' "$apk"
}

find_release_apk() {
  local apk=""
  if compgen -G "${RELEASES_DIR}/acorn-video-downloader_*_aarch64.apk" >/dev/null; then
    apk="$(ls -t "${RELEASES_DIR}"/acorn-video-downloader_*_aarch64.apk 2>/dev/null | head -1)"
  fi
  if [[ -z "$apk" && -d "$APK_OUT_ROOT" ]]; then
    apk="$(find "$APK_OUT_ROOT" -type f -path '*release*' -name '*.apk' ! -name '*debug*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
  fi
  [[ -n "$apk" && -f "$apk" ]] || return 1
  printf '%s\n' "$apk"
}

run_release() {
  require_adb
  info "Release APK derleniyor…"
  bash "${SCRIPT_DIR}/package-android.sh"

  local apk
  apk="$(find_release_apk)" || die "Release APK bulunamadı."

  info "Kuruluyor: $apk"
  adb install -r "$apk"

  info "Uygulama açılıyor: $MAIN_ACTIVITY"
  adb shell am start -n "$MAIN_ACTIVITY" >/dev/null

  info "Logcat — çökme için FATAL EXCEPTION satırlarına bakın"
  adb logcat -c
  exec adb logcat -s AndroidRuntime:E Rust:E EngineBootstrap:E CookieBootstrap:E "${LOG_TAGS[@]}"
}

run_apk() {
  require_adb
  info "Debug APK derleniyor…"
  bash "${SCRIPT_DIR}/package-android.sh" debug

  local apk
  apk="$(find_debug_apk)" || die "Debug APK bulunamadı. Derleme başarısız olabilir."

  info "Kuruluyor: $apk"
  adb install -r "$apk"

  info "Uygulama açılıyor: $MAIN_ACTIVITY"
  adb shell am start -n "$MAIN_ACTIVITY" >/dev/null

  info "Logcat — indirme testi için youtu.be linki deneyin"
  adb logcat -c
  exec adb logcat -s "${LOG_TAGS[@]}"
}

run_logcat_only() {
  require_adb
  info "Logcat — ${LOG_TAGS[*]}"
  adb logcat -c
  exec adb logcat -s "${LOG_TAGS[@]}"
}

parse_args "$@"

case "$MODE" in
  dev|""|"")
    run_dev
    ;;
  apk|install)
    run_apk
    ;;
  release)
    run_release
    ;;
  logcat)
    run_logcat_only
    ;;
  *)
    echo "Bilinmeyen komut: $MODE" >&2
    usage
    exit 1
    ;;
esac
