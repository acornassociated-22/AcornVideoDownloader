#!/usr/bin/env bash
# Install Linux deps + npm packages and check tools.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_env.sh"

ensure_tools

echo "==> Linux Tauri bağımlılıkları"
bash "$ROOT/scripts/setup-linux-deps.sh"
apply_linux_lib_env

echo "==> npm install"
npm install

echo "==> Araç kontrolü"
for bin in yt-dlp ffmpeg; do
  if command -v "$bin" >/dev/null; then
    echo "  OK  $bin → $(command -v "$bin")"
  else
    echo "  UYARI  $bin bulunamadı (indirme için gerekli)"
  fi
done

# Chrome/Chromium cookie decrypt on Linux needs secretstorage (yt-dlp).
if python3 -c "import secretstorage" >/dev/null 2>&1; then
  echo "  OK  python3 secretstorage"
else
  echo "  … Chrome çerezleri için secretstorage kuruluyor"
  if command -v apt-get >/dev/null && sudo -n true 2>/dev/null; then
    sudo apt-get install -y python3-secretstorage || true
  fi
  if ! python3 -c "import secretstorage" >/dev/null 2>&1; then
    python3 -m pip install --user --break-system-packages secretstorage || true
  fi
  if python3 -c "import secretstorage" >/dev/null 2>&1; then
    echo "  OK  python3 secretstorage"
  else
    echo "  UYARI  secretstorage yok — Chrome çerezleri çalışmaz:"
    echo "         sudo apt install python3-secretstorage"
    echo "         veya: python3 -m pip install --user --break-system-packages secretstorage"
  fi
fi

if command -v rustc >/dev/null && command -v cargo >/dev/null; then
  echo "  OK  rustc $(rustc --version | awk '{print $2}')"
else
  echo "  UYARI  Rust yok — https://rustup.rs"
fi

if verify_link_libs; then
  echo "  OK  GTK/WebKit link kütüphaneleri"
else
  echo "  UYARI  Link kütüphaneleri eksik — ./scripts/setup-linux-deps.sh"
fi

echo "==> Kurulum tamam"
echo "Çalıştır: ./scripts/run.sh   veya   npm start"
