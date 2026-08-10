#!/usr/bin/env bash
# Shared Android SDK/NDK preflight and project repair (sourced by package-android.sh, run-android-debug.sh).

_ANDROID_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="${SCRIPT_DIR:-$_ANDROID_COMMON_DIR}"

if [[ -z "${ROOT:-}" ]]; then
  # shellcheck disable=SC1091
  source "${_ANDROID_COMMON_DIR}/_env.sh"
fi

GRADLE_TEMPLATE="${SCRIPT_DIR}/templates/android-app.build.gradle.kts"
ANDROID_PROJECT="${ROOT}/src-tauri/gen/android"
SIGNING_DIR="${ROOT}/src-tauri/android-signing"
KEYSTORE_PROPS="${SIGNING_DIR}/keystore.properties"
RELEASES_DIR="${ROOT}/releases"
APK_OUT_ROOT="${ANDROID_PROJECT}/app/build/outputs/apk"

: "${OUT_LABEL:=aarch64}"
: "${IS_DEBUG:=0}"

die() {
  echo "HATA: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

# Tauri Gradle rustBuild talks to a short-lived WebSocket started by `tauri android build`.
# A stale /tmp/*-server-addr file from a crashed build causes "Connection refused".
clean_stale_tauri_android_ipc() {
  local identifier addr_file tmp_dir
  identifier="$(node -p "require('./src-tauri/tauri.conf.json').identifier" 2>/dev/null || echo 'com.acorn.videodownloader')"
  for tmp_dir in "${TMPDIR:-/tmp}" "${XDG_RUNTIME_DIR:-}"; do
    [[ -n "$tmp_dir" && -d "$tmp_dir" ]] || continue
    addr_file="${tmp_dir}/${identifier}-server-addr"
    if [[ -f "$addr_file" ]]; then
      rm -f "$addr_file"
      info "Eski Tauri Android IPC dosyası silindi: $addr_file"
    fi
  done
}

resolve_android_sdk() {
  if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]]; then
    printf '%s\n' "$ANDROID_HOME"
    return 0
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "$ANDROID_SDK_ROOT" ]]; then
    printf '%s\n' "$ANDROID_SDK_ROOT"
    return 0
  fi
  local candidate
  for candidate in \
    "${HOME}/Android/Sdk" \
    "${HOME}/Android/sdk" \
    "/opt/android-sdk" \
    "${HOME}/Library/Android/sdk"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_android_ndk() {
  local sdk="$1"
  if [[ -n "${ANDROID_NDK_HOME:-}" && -d "$ANDROID_NDK_HOME" ]]; then
    printf '%s\n' "$ANDROID_NDK_HOME"
    return 0
  fi
  if [[ -n "${NDK_HOME:-}" && -d "$NDK_HOME" ]]; then
    printf '%s\n' "$NDK_HOME"
    return 0
  fi
  local ndk_root="${sdk}/ndk"
  [[ -d "$ndk_root" ]] || return 1
  local latest
  latest="$(find "$ndk_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)"
  [[ -n "$latest" && -d "$latest" ]] || return 1
  printf '%s\n' "$latest"
}

resolve_ndk_toolchain_bin() {
  local ndk="$1"
  local prebuilt
  prebuilt="$(find "${ndk}/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1 || true)"
  [[ -n "$prebuilt" && -d "${prebuilt}/bin" ]] || return 1
  printf '%s\n' "${prebuilt}/bin"
}

java_major_version() {
  local line major
  line="$(java -version 2>&1 | head -1 || true)"
  if [[ "$line" =~ \"([0-9]+)\.([0-9]+) ]]; then
    if [[ "${BASH_REMATCH[1]}" == "1" ]]; then
      major="${BASH_REMATCH[2]}"
    else
      major="${BASH_REMATCH[1]}"
    fi
    printf '%s\n' "$major"
    return 0
  fi
  return 1
}

preflight() {
  clean_stale_tauri_android_ipc
  ensure_tools
  ensure_node_modules

  command -v cargo >/dev/null || die "Rust/cargo yok. Kur: curl https://sh.rustup.rs -sSf | sh"
  command -v rustup >/dev/null || die "rustup yok. Kur: curl https://sh.rustup.rs -sSf | sh"
  command -v java >/dev/null || die "Java yok. Örn: sudo apt install -y openjdk-17-jdk"

  local major
  major="$(java_major_version || true)"
  if [[ -z "${major:-}" ]]; then
    die "Java sürümü okunamadı. OpenJDK 17+ kurun."
  fi
  if [[ "$major" -lt 17 ]]; then
    die "Java ${major} yetersiz — OpenJDK 17+ gerekli. Örn: sudo apt install -y openjdk-17-jdk"
  fi
  info "Java ${major}"

  [[ -f "$GRADLE_TEMPLATE" ]] || die "Gradle şablonu yok: $GRADLE_TEMPLATE"

  if ! ANDROID_SDK="$(resolve_android_sdk)"; then
    die "Android SDK bulunamadı.
  ANDROID_HOME veya ~/Android/Sdk ayarla.
  https://developer.android.com/studio#command-tools"
  fi

  [[ -d "${ANDROID_SDK}/platform-tools" ]] || die "SDK eksik: ${ANDROID_SDK}/platform-tools
  sdkmanager \"platform-tools\""
  if ! compgen -G "${ANDROID_SDK}/platforms/android-*" >/dev/null; then
    die "SDK platforms yok: ${ANDROID_SDK}/platforms
  sdkmanager \"platforms;android-36\""
  fi
  if ! compgen -G "${ANDROID_SDK}/build-tools/*" >/dev/null; then
    die "SDK build-tools yok: ${ANDROID_SDK}/build-tools
  sdkmanager \"build-tools;36.0.0\""
  fi

  if ! ANDROID_NDK="$(resolve_android_ndk "$ANDROID_SDK")"; then
    die "Android NDK yok (${ANDROID_SDK}/ndk).
  sdkmanager \"ndk;27.1.12297006\""
  fi

  if ! NDK_BIN="$(resolve_ndk_toolchain_bin "$ANDROID_NDK")"; then
    die "NDK llvm toolchain bulunamadı: ${ANDROID_NDK}/toolchains/llvm/prebuilt"
  fi

  if [[ ! -x "${NDK_BIN}/aarch64-linux-android24-clang" ]] \
    && ! compgen -G "${NDK_BIN}/aarch64-linux-android*-clang" >/dev/null; then
    die "NDK clang yok: ${NDK_BIN}/aarch64-linux-android*-clang"
  fi

  export ANDROID_HOME="$ANDROID_SDK"
  export ANDROID_SDK_ROOT="$ANDROID_SDK"
  export ANDROID_NDK_HOME="$ANDROID_NDK"
  export NDK_HOME="$ANDROID_NDK"

  info "Android SDK: $ANDROID_HOME"
  info "Android NDK: $ANDROID_NDK_HOME"
  info "NDK toolchain: $NDK_BIN"
}

setup_env() {
  clear_desktop_linux_lib_env
  export PATH="${NDK_BIN}:${PATH}"
  if [[ -x "${NDK_BIN}/aarch64-linux-android24-clang" ]]; then
    export CC_aarch64_linux_android="${NDK_BIN}/aarch64-linux-android24-clang"
    export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${NDK_BIN}/aarch64-linux-android24-clang"
  fi
}

ensure_rust_android_targets() {
  local triple needed=()
  case "$OUT_LABEL" in
    aarch64|debug-aarch64) needed=(aarch64-linux-android) ;;
    armv7) needed=(armv7-linux-androideabi) ;;
    i686) needed=(i686-linux-android) ;;
    x86_64) needed=(x86_64-linux-android) ;;
    *)
      needed=(
        aarch64-linux-android
        armv7-linux-androideabi
        i686-linux-android
        x86_64-linux-android
      )
      ;;
  esac
  for triple in "${needed[@]}"; do
    if ! rustup target list --installed 2>/dev/null | grep -qx "$triple"; then
      info "rustup target add $triple"
      rustup target add "$triple"
    fi
  done
}

ensure_project() {
  if [[ ! -d "$ANDROID_PROJECT" ]]; then
    info "Android proje yok — tauri android init"
    npx tauri android init --ci
  fi
  [[ -d "$ANDROID_PROJECT" ]] || die "Android proje oluşturulamadı: $ANDROID_PROJECT"
  [[ -x "${ANDROID_PROJECT}/gradlew" ]] || die "gradlew yok: ${ANDROID_PROJECT}/gradlew"

  local local_props="${ANDROID_PROJECT}/local.properties"
  {
    echo "## Generated by Acorn Android scripts — do not edit by hand"
    printf 'sdk.dir=%s\n' "$(printf '%s' "$ANDROID_SDK" | sed 's/\\/\\\\/g; s/ /\\ /g')"
  } >"$local_props"
  info "local.properties yazıldı"
}

ensure_gradle_app() {
  local dest="${ANDROID_PROJECT}/app/build.gradle.kts"
  local line_no
  mkdir -p "$(dirname "$dest")"
  cp -f "$GRADLE_TEMPLATE" "$dest"
  if ! head -1 "$dest" | grep -q '^import '; then
    die "Gradle şablonu bozuk (import en üstte değil): $GRADLE_TEMPLATE"
  fi
  if grep -n '^plugins ' "$dest" >/dev/null; then
    line_no="$(grep -n '^plugins ' "$dest" | head -1 | cut -d: -f1)"
    if [[ "${line_no:-0}" -lt 2 ]]; then
      die "Gradle şablonunda plugins{} import'lardan önce — template düzeltin: $GRADLE_TEMPLATE"
    fi
  fi
  info "app/build.gradle.kts şablondan yazıldı"
}

ensure_android_theme() {
  local res="${ANDROID_PROJECT}/app/src/main/res"
  local tpl="${SCRIPT_DIR}/templates"
  mkdir -p "${res}/values" "${res}/values-night"
  cp -f "${tpl}/android-colors.xml" "${res}/values/colors.xml"
  cp -f "${tpl}/android-themes.xml" "${res}/values/themes.xml"
  cp -f "${tpl}/android-colors-night.xml" "${res}/values-night/colors.xml"
  cp -f "${tpl}/android-themes-night.xml" "${res}/values-night/themes.xml"
  info "Android theme/colors şablondan yazıldı (status bar = chrome)"
}

ensure_android_manifest() {
  local dest="${ANDROID_PROJECT}/app/src/main/AndroidManifest.xml"
  local tpl="${SCRIPT_DIR}/templates/AndroidManifest.xml"
  [[ -f "$tpl" ]] || die "AndroidManifest şablonu yok: $tpl"
  mkdir -p "$(dirname "$dest")"
  cp -f "$tpl" "$dest"
  grep -q 'extractNativeLibs="true"' "$dest" || die "Manifest extractNativeLibs=true eksik: $dest"
  info "AndroidManifest.xml şablondan yazıldı (extractNativeLibs=true)"
}

ensure_android_kotlin() {
  local src="${SCRIPT_DIR}/templates/android-kotlin"
  local dest="${ANDROID_PROJECT}/app/src/main/java/com/acorn/videodownloader"
  [[ -d "$src" ]] || die "Android Kotlin şablonu yok: $src"
  mkdir -p "$dest"
  cp -f "${src}/MainActivity.kt" "$dest/"
  cp -f "${src}/EngineBootstrap.kt" "$dest/"
  cp -f "${src}/CookieBootstrap.kt" "$dest/"
  cp -f "${src}/ExportHelper.kt" "$dest/"
  cp -f "${src}/FfmpegHelper.kt" "$dest/"
  cp -f "${src}/AcornYtdlpExecutor.kt" "$dest/"
  cp -f "${src}/YtdlpPlugin.kt" "$dest/"
  cp -f "${src}/StoragePlugin.kt" "$dest/"
  cp -f "${src}/DownloadForegroundService.kt" "$dest/"
  cp -f "${src}/DownloadNotificationManager.kt" "$dest/"
  cp -f "${src}/DownloadWakeLock.kt" "$dest/"
  cp -f "${src}/DownloadServiceHolder.kt" "$dest/"
  cp -f "${src}/DownloadOrchestrator.kt" "$dest/"
  cp -f "${src}/DownloadPlugin.kt" "$dest/"
  cp -f "${src}/YoutubeLoginActivity.kt" "$dest/"
  cp -f "${src}/PoTokenStore.kt" "$dest/"
  cp -f "${src}/YtdlpUpdater.kt" "$dest/"
  info "Android Kotlin kaynakları şablondan yazıldı"
}

ensure_android_proguard() {
  local tpl="${SCRIPT_DIR}/templates/android-proguard-rules.pro"
  local dest="${ANDROID_PROJECT}/app/proguard-rules.pro"
  [[ -f "$tpl" ]] || die "ProGuard şablonu yok: $tpl"
  cp -f "$tpl" "$dest"
  info "proguard-rules.pro şablondan yazıldı"
}

ensure_gradle_properties() {
  local props="${ANDROID_PROJECT}/gradle.properties"
  [[ -f "$props" ]] || die "gradle.properties yok: $props"
  if grep -q 'android.bundle.enableUncompressedNativeLibs' "$props"; then
    local tmp
    tmp="$(mktemp)"
    grep -v 'android.bundle.enableUncompressedNativeLibs' "$props" | grep -v 'youtubedl-android needs extracted' >"$tmp" || true
    mv -f "$tmp" "$props"
    info "gradle.properties: deprecated enableUncompressedNativeLibs kaldırıldı"
  fi
}

ensure_signing() {
  if [[ "$IS_DEBUG" -eq 1 ]]; then
    info "Debug mod — release imza zorunlu değil"
    return 0
  fi

  [[ -d "$SIGNING_DIR" ]] || die "İmza klasörü yok: $SIGNING_DIR
  Release için keystore.properties + .jks gerekli."

  [[ -f "$KEYSTORE_PROPS" ]] || die "keystore.properties yok: $KEYSTORE_PROPS"

  local store_file key_alias
  store_file="$(grep -E '^storeFile=' "$KEYSTORE_PROPS" | head -1 | cut -d= -f2- || true)"
  key_alias="$(grep -E '^keyAlias=' "$KEYSTORE_PROPS" | head -1 | cut -d= -f2- || true)"

  [[ -n "$store_file" ]] || die "keystore.properties içinde storeFile= eksik"
  [[ -n "$key_alias" ]] || die "keystore.properties içinde keyAlias= eksik"

  if [[ "$store_file" != /* ]]; then
    store_file="${SIGNING_DIR}/${store_file}"
  fi
  [[ -f "$store_file" ]] || die "Keystore dosyası yok: $store_file"

  local tmp
  tmp="$(mktemp)"
  awk -v sf="$store_file" '
    BEGIN { done=0 }
    /^storeFile=/ { print "storeFile=" sf; done=1; next }
    { print }
    END { if (!done) print "storeFile=" sf }
  ' "$KEYSTORE_PROPS" >"$tmp"
  mv -f "$tmp" "$KEYSTORE_PROPS"

  info "Release imza: $store_file (alias=$key_alias)"
}

# Sync templates, Gradle, Kotlin — shared by dev and APK builds.
android_prepare_project() {
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
  info "Acorn launcher ikonları senkronize ediliyor…"
  node "${SCRIPT_DIR}/generate-app-icon.mjs" || die "İkon üretimi başarısız (npm run icons)"
}
