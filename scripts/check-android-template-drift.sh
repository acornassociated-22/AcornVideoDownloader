#!/usr/bin/env bash
# Verify generated Android Kotlin matches scripts/templates/android-kotlin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_env.sh"

ANDROID_PROJECT="${ROOT}/src-tauri/gen/android"
TEMPLATE_DIR="${SCRIPT_DIR}/templates/android-kotlin"
DEST_DIR="${ANDROID_PROJECT}/app/src/main/java/com/acorn/videodownloader"

if [[ ! -d "$ANDROID_PROJECT" ]]; then
  echo "Android project not generated yet — run npm run build or package-android.sh first." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/dest"
cp -f "${TEMPLATE_DIR}/"*.kt "$TMP/dest/"

echo "==> Comparing templates → gen/android Kotlin sources"
diff -ru "$TMP/dest" "$DEST_DIR"
echo "==> No Kotlin template drift detected"
