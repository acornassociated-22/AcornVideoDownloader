#!/usr/bin/env bash
# Prepare desktop sidecars as real files named acorn-* (never /usr/bin symlinks).
# Bundled names avoid dpkg conflicts with system ffmpeg / yt-dlp packages.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

triple="${1:-}"
if [[ -z "$triple" ]]; then
  case "$(uname -s)" in
    Linux) triple="x86_64-unknown-linux-gnu" ;;
    Darwin)
      if [[ "$(uname -m)" == "arm64" ]]; then
        triple="aarch64-apple-darwin"
      else
        triple="x86_64-apple-darwin"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) triple="x86_64-pc-windows-msvc" ;;
    *)
      echo "Host desteklenmiyor; triple verin: $0 <rust-target-triple>"
      exit 1
      ;;
  esac
fi

echo "==> Desktop sidecars for $triple"

# --- yt-dlp (prefer official GitHub binary) ---
ytdlp_out="$BIN_DIR/acorn-yt-dlp-${triple}"
case "$triple" in
  x86_64-unknown-linux-gnu)
    url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    ;;
  aarch64-unknown-linux-gnu)
    url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
    ;;
  x86_64-apple-darwin|aarch64-apple-darwin)
    url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    ;;
  x86_64-pc-windows-msvc)
    url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    ytdlp_out="${ytdlp_out}.exe"
    ;;
  *)
    echo "Bilinmeyen triple yt-dlp için: $triple"
    exit 1
    ;;
esac

echo "  yt-dlp ← $url"
curl -fsSL -o "$ytdlp_out" "$url"
chmod +x "$ytdlp_out"

# --- ffmpeg (copy real binary; never symlink into package) ---
ffmpeg_out="$BIN_DIR/acorn-ffmpeg-${triple}"
ffmpeg_src="$(command -v ffmpeg || true)"
if [[ -z "$ffmpeg_src" ]]; then
  echo "HATA: Sistemde ffmpeg yok. Kurun: sudo apt install ffmpeg"
  exit 1
fi
# Resolve symlinks to a real file before copying into the bundle.
ffmpeg_real="$(readlink -f "$ffmpeg_src" 2>/dev/null || echo "$ffmpeg_src")"
echo "  ffmpeg ← $ffmpeg_real (copy)"
cp -f "$ffmpeg_real" "$ffmpeg_out"
chmod +x "$ffmpeg_out"

# Remove old conflicting sidecar names if present
rm -f \
  "$BIN_DIR/ffmpeg-${triple}" \
  "$BIN_DIR/yt-dlp-${triple}" \
  "$BIN_DIR/ffmpeg" \
  "$BIN_DIR/yt-dlp" 2>/dev/null || true

echo "==> Hazır:"
ls -lh "$ytdlp_out" "$ffmpeg_out"
