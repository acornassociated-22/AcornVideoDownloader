#!/usr/bin/env bash
# Create GitHub repo, push main, tag v0.1.0, and upload local release artifacts.
# Prerequisites: gh auth login  (do NOT put passwords in this script)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GH="${GH:-gh}"
REPO="${GITHUB_REPO:-acornassociated22/AcornVideoDownloader}"
TAG="${RELEASE_TAG:-v0.1.0}"
VERSION="${TAG#v}"

if ! command -v "$GH" >/dev/null 2>&1; then
  echo "GitHub CLI (gh) not found. Install: https://cli.github.com/" >&2
  exit 1
fi

if ! "$GH" auth status >/dev/null 2>&1; then
  echo "Not logged in. Run: gh auth login" >&2
  exit 1
fi

if ! "$GH" repo view "$REPO" >/dev/null 2>&1; then
  echo "==> Creating public repo $REPO"
  "$GH" repo create "$REPO" --public --source=. --remote=origin --description "Cross-platform YouTube downloader — Tauri 2 · React · yt-dlp"
else
  echo "==> Repo $REPO exists"
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/${REPO}.git"
  fi
fi

echo "==> Pushing main"
git push -u origin main

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "==> Tag $TAG already exists locally"
else
  git tag -a "$TAG" -m "Acorn Video Downloader $VERSION"
fi

git push origin "$TAG" 2>/dev/null || git push origin "$TAG" --force-with-lease

NOTES="docs/RELEASE_NOTES_${VERSION}.md"
ASSETS=()
shopt -s nullglob
for f in releases/acorn-video-downloader_"${VERSION}"_*; do
  ASSETS+=("$f")
done
shopt -u nullglob

if ((${#ASSETS[@]} == 0)); then
  echo "==> No local artifacts in releases/ — creating release without files"
  "$GH" release create "$TAG" \
    --title "Acorn Video Downloader $VERSION" \
    --notes-file "$NOTES"
else
  echo "==> Creating release $TAG with ${#ASSETS[@]} artifact(s)"
  "$GH" release create "$TAG" \
    --title "Acorn Video Downloader $VERSION" \
    --notes-file "$NOTES" \
    "${ASSETS[@]}"
fi

echo "==> Done: https://github.com/${REPO}/releases/tag/${TAG}"
