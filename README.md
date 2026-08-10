<p align="center">
  <img src="docs/assets/hero-endcard.png" width="480" alt="Acorn Video Downloader" />
</p>

<h1 align="center">Acorn Video Downloader</h1>

<p align="center">
  <strong>Paste a link. Pick quality. Download.</strong><br/>
  Cross-platform YouTube downloader — Tauri 2 · React · yt-dlp
</p>

<p align="center">
  <a href="https://github.com/acornassociated-22/AcornVideoDownloader/releases"><img src="https://img.shields.io/github/v/release/acornassociated-22/AcornVideoDownloader?label=release&color=695CFE" alt="Release" /></a>
  <a href="https://github.com/acornassociated-22/AcornVideoDownloader"><img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS%20%7C%20Android-242430" alt="Platforms" /></a>
  <a href="https://v2.tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React" /></a>
</p>

<p align="center">
  <a href="https://github.com/acornassociated-22/AcornVideoDownloader/releases/latest"><strong>⬇ Download latest release</strong></a>
  &nbsp;·&nbsp;
  <a href="docs/USER_GUIDE.md">User guide</a>
  &nbsp;·&nbsp;
  <a href="docs/BUILD.md">Build from source</a>
</p>

---

<p align="center">
  <img src="docs/assets/splash.png" width="720" alt="Acorn Video Downloader splash" />
</p>

## Download

Get the latest installers from **[GitHub Releases](https://github.com/acornassociated-22/AcornVideoDownloader/releases/latest)**.

| Platform | Format | Status |
|----------|--------|--------|
| **Android** | `.apk` | Available in Releases |
| **Linux** (amd64) | `.deb` / `.zip` | Available in Releases |
| **Linux** (aarch64) | `.zip` | Available in Releases |
| **Windows** | `.exe` / `.msi` | Build from source ([BUILD.md](docs/BUILD.md)) |
| **macOS** | `.dmg` | Build from source ([BUILD.md](docs/BUILD.md)) |

> New to Acorn? Read the full **[User Guide](docs/USER_GUIDE.md)** — setup, queue, cookies, troubleshooting, and FAQ.

---

## Features

<p align="center">
  <img src="docs/assets/features.png" width="720" alt="Acorn features — best quality, formats, queue, history" />
</p>

- **Best quality, every time** — Best resolution or pick 2160p / 1080p / 720p
- **Popular formats** — MP4 · WEBM · MKV (video) · MP3 · M4A · OPUS · WAV (audio)
- **Smart queue** — Add playlists, download steadily one by one with live progress
- **History** — Find every save, open, re-download, or delete entries
- **11 languages** — EN · TR · AR · KU · RU · FR · FA · DE · VI · JA · ZH
- **Light / dark / system theme** — Hejar-inspired dark UI on Android
- **YouTube cookies** — Browser import (desktop) · sign-in WebView · cookies.txt (Android)
- **Android extras** — Foreground service, notifications, share intent, safe bulk mode, yt-dlp auto-update
- **Privacy-minded** — No tracking. Downloads stay on your device.

---

## Screenshots

<table>
  <tr>
    <td align="center"><strong>Home</strong><br/><img src="docs/assets/home.png" width="400" alt="Home screen" /></td>
    <td align="center"><strong>Download</strong><br/><img src="docs/assets/download.png" width="400" alt="Quality and format picker" /></td>
  </tr>
  <tr>
    <td align="center"><strong>History</strong><br/><img src="docs/assets/history.png" width="400" alt="Download history" /></td>
    <td align="center"><strong>Settings</strong><br/><img src="docs/assets/settings.png" width="400" alt="Settings screen" /></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><strong>About &amp; Support</strong><br/><img src="docs/assets/about.png" width="400" alt="About and donate" /></td>
  </tr>
</table>

---

## Quick start

### Android

1. Install the APK from [Releases](https://github.com/acornassociated-22/AcornVideoDownloader/releases/latest).
2. Open Acorn → paste a YouTube URL → choose quality & format → **Start download**.
3. For playlists: select videos → **Add to queue**.
4. If YouTube blocks a download: **Settings → Sign in to YouTube** or import `cookies.txt`.

### Desktop

1. Install the package for your OS (or build from source).
2. Launch Acorn, paste a link, follow the 3-step wizard.
3. Set your save folder and default quality in **Settings**.

<details>
<summary><strong>Queue tips</strong></summary>

- Downloads run **one at a time** — add many items, Acorn handles the rest.
- **Clear finished** removes completed / failed / cancelled rows.
- **Cancel** stops the active job; **Remove** drops a queued item before it starts.
- On Android, allow notifications and disable battery optimization for reliable background downloads.

</details>

---

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/USER_GUIDE.md) | Complete end-user manual — every screen, settings, troubleshooting |
| [Build guide](docs/BUILD.md) | Developer setup, packaging, Android signing |
| [Release notes v0.1.0](docs/RELEASE_NOTES_v0.1.0.md) | First release changelog and install notes |

---

## Build from source

```bash
git clone https://github.com/acornassociated-22/AcornVideoDownloader.git
cd AcornVideoDownloader
./scripts/install.sh
./scripts/run.sh          # desktop dev
npm run package:apk       # Android APK
npm run package:deb       # Linux .deb
```

See **[docs/BUILD.md](docs/BUILD.md)** for full requirements (Rust, Node 20+, Android SDK, Linux GTK deps).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 19 · TypeScript · Tailwind CSS 4 |
| Shell | Tauri 2 |
| State | Zustand (persisted queue & settings) |
| Engine | yt-dlp · FFmpeg (bundled sidecars) |
| Android native | Kotlin orchestrator · foreground service |

---

## Support Acorn Associated

Acorn is built by **[Acorn Associated](https://github.com/acornassociated-22)** — Qamishli.

- **Email:** [Support@acornassociated.org](mailto:Support@acornassociated.org)
- **Donate:** in-app **About → Donate** tab
- **Social:** [GitHub](https://github.com/acornassociated-22) · [YouTube](https://youtube.com/@acornassociated) · [Instagram](https://www.instagram.com/acornassociated) · [Telegram](https://t.me/acornassociated)

Found a bug? [Open an issue](https://github.com/acornassociated-22/AcornVideoDownloader/issues).

---

## Legal

Acorn Video Downloader is a tool for **personal use**. You are responsible for complying with YouTube's Terms of Service, copyright laws, and applicable regulations in your country. Only download content you have the right to access.

---

<p align="center">
  <sub>© Acorn Associated. All rights reserved.</sub>
</p>
