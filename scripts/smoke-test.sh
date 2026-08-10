#!/usr/bin/env bash
# Smoke-test the same yt-dlp flow Acorn uses: metadata → download → file on disk.
set -euo pipefail

URL="${1:-https://www.youtube.com/watch?v=jNQXAC9IVRw}"
OUT="${TMPDIR:-/tmp}/acorn-smoke-$$"
mkdir -p "$OUT"

echo "==> metadata"
yt-dlp -J --no-warnings --no-playlist "$URL" >"$OUT/meta.json"
python3 - <<PY
import json
d=json.load(open("$OUT/meta.json"))
assert d.get("title") and d.get("formats")
print("title:", d["title"])
print("formats:", len(d["formats"]))
PY

echo "==> download (audio)"
yt-dlp --newline --no-playlist --no-warnings \
  -x --audio-format mp3 -f bestaudio/best \
  -o "$OUT/%(title).200B [%(id)s].%(ext)s" \
  --progress \
  "$URL"

FILE="$(find "$OUT" -type f \( -name '*.mp3' -o -name '*.m4a' -o -name '*.webm' -o -name '*.mp4' \) | head -1)"
test -n "$FILE"
test -s "$FILE"
echo "==> OK: $FILE"
echo "Frontend build check: npm run build"
cd "$(dirname "$0")/.."
npm run build >/dev/null
echo "==> OK: frontend build"
