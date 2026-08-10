# Acorn Video Downloader v0.1.0

First public release of Acorn — a cross-platform YouTube downloader built with Tauri 2, React, and yt-dlp.

## Highlights

- Paste a YouTube link, pick quality and format, download in one flow
- Smart queue — add playlists, download one by one with progress
- Download history — find, re-download, or open past saves
- 11 languages with light/dark/system themes
- YouTube cookie support to reduce bot-check blocks
- Android shell with foreground downloads, notifications, and share intent

## Downloads

| Platform | File | Notes |
|----------|------|-------|
| Linux (amd64) | `acorn-video-downloader_0.1.0_amd64.deb` | Debian/Ubuntu installer |
| Linux (amd64) | `acorn-video-downloader_0.1.0_amd64.zip` | Portable archive |
| Linux (aarch64) | `acorn-video-downloader_0.1.0_aarch64.zip` | ARM64 portable archive |
| Android | APK (when attached) | Install from Releases; enable unknown sources if needed |

Windows and macOS installers will be added in a future release. Build from source — see [BUILD.md](BUILD.md).

## Install

### Linux (.deb)

```bash
sudo dpkg -i acorn-video-downloader_0.1.0_amd64.deb
sudo apt-get install -f   # fix dependencies if needed
```

Launch **Acorn Video Downloader** from your app menu.

### Linux (.zip)

Extract and run the `acorn-video-downloader` binary inside.

### Android (APK)

1. Download the APK from this release.
2. Open the file and tap **Install**.
3. If blocked, allow installs from your browser or file manager in Android settings.

## Known limitations

- iOS backend is not yet implemented (UI stub only).
- Very large playlists may take several minutes to scan metadata.
- YouTube may rate-limit guest sessions — sign in or import cookies for best results.
- Some phone manufacturers aggressively kill background downloads — see battery guide in Settings.

## Documentation

- [User Guide](USER_GUIDE.md) — full end-user documentation
- [Build from source](BUILD.md) — developer setup and packaging

## Support

Questions or issues: [GitHub Issues](https://github.com/acornassociated-22/AcornVideoDownloader/issues) or [Support@acornassociated.org](mailto:Support@acornassociated.org).
