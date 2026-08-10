# Build from source

Acorn Video Downloader is a [Tauri 2](https://v2.tauri.app/) app with a React + TypeScript UI and yt-dlp as the download engine.

## Requirements

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| Rust | stable (via rustup) |
| yt-dlp + ffmpeg | on PATH for desktop dev (bundled in release builds) |

### Linux build dependencies

**Option A — system packages (recommended if you have sudo):**

```bash
sudo apt install -y libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libdbus-1-dev pkg-config build-essential
```

**Option B — no sudo (local prefix):**

```bash
./scripts/setup-linux-deps.sh
```

### Android build dependencies

- Android SDK + NDK (Android Studio or command-line tools)
- Java 17+
- USB debugging enabled for on-device testing

The packaging scripts in `scripts/_android_common.sh` verify and repair the generated Android project.

## Install dependencies

```bash
./scripts/install.sh
# or: npm install
```

## Develop (desktop)

```bash
./scripts/run.sh
# or: npm start
```

These scripts set `PKG_CONFIG_PATH` / `LIBRARY_PATH` and fix GTK link libraries. Prefer them over bare `npx tauri dev`.

### UI-only preview (no downloads)

```bash
./scripts/ui-dev.sh
# or: npm run ui
```

### Engine smoke test

Metadata → download → file on disk:

```bash
./scripts/smoke-test.sh
# or: npm run smoke
```

## Package installers

Run on the **target host OS** (Linux packages on Linux, Windows on Windows, etc.).

| Command | Output |
|---------|--------|
| `npm run package:deb` | `releases/acorn-video-downloader_<version>_amd64.deb` |
| `npm run package:windows` | NSIS `.exe` + MSI under `src-tauri/target/release/bundle/` |
| `npm run package:macos` | `.dmg` under bundle folder |
| `npm run package:apk` | `releases/acorn-video-downloader_<version>_<label>.apk` |
| `npm run package:apk universal` | Universal APK (all ABIs) |

Dispatcher:

```bash
npm run package deb
npm run package apk universal
```

### Android signing (release APK)

Release builds expect signing material in `src-tauri/android-signing/` (gitignored):

- `acorn-release.jks`
- `keystore.properties`

Never commit keystore files or passwords.

### Android on device (debug)

```bash
npm run android:debug
# or: ./scripts/run-android-debug.sh
```

## Project layout

| Path | Purpose |
|------|---------|
| `src/` | React UI (desktop + shared) |
| `src/android/` | Android shell (pages, dock, sheets) |
| `src/store/` | Zustand state (queue, settings, history) |
| `src-tauri/` | Rust backend + Tauri config |
| `scripts/templates/android-kotlin/` | Kotlin source of truth for Android native code |
| `src-tauri/gen/android/` | Generated Android project (synced from templates) |

After editing Kotlin templates, run:

```bash
bash scripts/check-android-template-drift.sh
```

## CI

- `.github/workflows/android.yml` — frontend build + Android template drift check on push/PR
- `.github/workflows/release.yml` — tagged releases (Linux `.deb` + optional signed APK)
