# Acorn Video Downloader — User Guide

Welcome to **Acorn Video Downloader**. This guide explains every screen and common tasks on **Android** and **desktop** (Linux, Windows, macOS).

---

## Getting started

### Android

1. Download the latest **APK** from [GitHub Releases](https://github.com/acornassociated-22/AcornVideoDownloader/releases).
2. Install the APK (allow “Install unknown apps” if prompted).
3. Open Acorn, paste a YouTube link on **Home**, pick quality and format, then tap **Start download** or **Add to queue**.
4. Optional: allow notifications and disable battery optimization for Acorn (see [Android tips](#android-tips)).

### Desktop (Linux / Windows / macOS)

1. Download the installer for your platform from [Releases](https://github.com/acornassociated-22/AcornVideoDownloader/releases).
2. Install and launch Acorn.
3. Paste a YouTube URL, follow the download wizard, and save the file to your chosen folder.

---

## Home

The home screen is where every download begins.

- **Paste a link** — YouTube video or playlist URL in the search bar. Tap **Paste** to pull from the clipboard.
- **Single video** — After metadata loads, the download wizard opens automatically.
- **Playlist** — Acorn lists all entries. Select individual videos or use **Select all**, then **Add selected to queue** or **Add all to queue**.
- **Instagram** — Public Instagram posts and carousels are supported; private profiles need browser cookies in Settings.

### Download wizard (3 steps)

| Step | What you choose |
|------|-----------------|
| 1 · Quality | Best, 2160p, 1080p, 720p (video) or best audio |
| 2 · Format | MP4, WEBM, MKV (video) or MP3, M4A, OPUS, WAV (audio) |
| 3 · Start | **Start download** (immediate) or **Add to queue** (background) |

**More options** (expandable):

- Save thumbnail alongside the video
- Download subtitles (Turkish, English, or all languages)

---

## Queue

Downloads run **one at a time** in order. The queue shows progress, speed, and status for each item.

### Status labels

| Status | Meaning |
|--------|---------|
| Queued | Waiting for its turn |
| Downloading | Active download |
| Paused | You paused this item (Android) |
| Completed | Finished successfully |
| Error | Failed — see the error message |
| Cancelled | Stopped or removed by you |

### Actions

| Action | When available |
|--------|----------------|
| **Cancel** | While downloading or paused |
| **Remove** | While queued (not yet started) |
| **Pause / Resume / Retry** | Android — active or paused jobs |
| **Dismiss** | Completed, failed, or cancelled rows |
| **Clear finished** | Removes all completed, failed, and cancelled items |
| **Remove all from queue** | Empties the entire queue (with confirmation) |

### YouTube bot blocks

If YouTube rate-limits a download, Acorn may:

- Retry automatically with fresh cookies (up to 3 attempts)
- Show a cooldown timer before the next attempt
- Offer **Retry with fresh cookies**, **Enable safe bulk mode**, or **Import cookies in Settings**

For long playlists (50+ videos), enable **Safe bulk mode** in Settings.

---

## History

Every successful download is listed here with:

- Title, date, and type (video / audio)
- **Download again** — re-queue the same URL with current defaults
- **Open** — open the file with your system player
- **Delete** — remove the history entry (does not delete the file from disk)

Use **Clear history** to remove all entries from the list.

---

## Settings

### Appearance

- **Theme** — System, Light, or Dark
- **Language** — 11 languages: English, Turkish, Arabic, Kurdish, Russian, French, Persian, German, Vietnamese, Japanese, Chinese (Arabic and Persian use RTL layout)

### Downloads (desktop)

- **Save folder** — where finished files are written
- **Default quality / format / type** — pre-fill the wizard
- **Save thumbnail / subtitles by default** — toggles for new downloads

### YouTube session

YouTube may block automated downloads (“Sign in to confirm you're not a bot”).

**Desktop options:**

- Import cookies from your browser (Auto, Firefox, Chrome, etc.)
- Pick a `cookies.txt` file exported from a signed-in browser

**Android options:**

- **Sign in to YouTube** — in-app login WebView
- **Import cookies.txt** — transfer a file from desktop (see the step-by-step guide in Settings)
- **Refresh cookies** — reload session before a retry

### Android-only settings

| Setting | Purpose |
|---------|---------|
| Save folder | Public Downloads/Acorn or a custom folder (SAF) |
| Pause between videos (2–5 s) | Small delay between queue items |
| Safe bulk mode | Longer pause every 10 videos — for large playlists |
| Guest slow mode | 15–30 s between videos when not signed in |
| Auto-update yt-dlp | Updates the extraction engine when the queue is idle |
| Battery optimization guide | Steps for Samsung, Xiaomi, Huawei, and system settings |

---

## Android tips

1. **Battery** — Aggressive power savers stop background downloads. Open Settings → Battery optimization guide and exclude Acorn from sleeping apps.
2. **Notifications** — Allow notifications to see progress when the app is in the background.
3. **Share intent** — Share a YouTube link from another app directly into Acorn.
4. **yt-dlp updates** — If downloads fail with extraction errors, check Settings → yt-dlp engine or the banner on the Queue screen.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| “YouTube blocked this request” | Wait 30–60 s, switch Wi‑Fi/mobile data, sign in or import cookies |
| “Sign-in required” | Settings → Sign in to YouTube or import cookies.txt |
| “Video unavailable” | Video may be private, region-locked, or not yet premiered |
| Empty file | Sign in to YouTube and retry |
| Network / DNS error | Check internet connection |
| FFmpeg / engine not ready | Wait a few seconds after launch and retry |
| Export failed (Android) | File may still be in app storage — check Settings save folder |
| Instagram private profile | Sign in via browser cookies in Settings |

---

## FAQ

**Can I download entire playlists?**  
Yes. Paste a playlist URL, select videos, and add them to the queue.

**Does Acorn work offline?**  
No. Metadata and downloads require an internet connection.

**Where are files saved on Android?**  
By default: public **Downloads/Acorn**. You can pick a custom folder in Settings.

**Is Acorn free?**  
Yes. Support development via the **About → Donate** tab.

**Which sites are supported?**  
Primarily YouTube and public Instagram content. Support depends on yt-dlp extractors.

---

## Support

### Websites

- [www.Acornik.com](https://www.acornik.com)
- [acornassociated.org](https://acornassociated.org/)

### Contact

| Channel | Email |
|---------|-------|
| Info | [Info@acornassociated.org](mailto:Info@acornassociated.org) |
| Sales | [Sales@acornassociated.org](mailto:Sales@acornassociated.org) |
| Support | [Support@acornassociated.org](mailto:Support@acornassociated.org) |
| PayPal / Donate | [acornassociatedorg@gmail.com](mailto:acornassociatedorg@gmail.com) |

### Social media

[Facebook](https://www.facebook.com/share/1BHdij74U4/) · [X](https://x.com/Acornassociate2) · [Instagram](https://www.instagram.com/acornassociated) · [YouTube](https://youtube.com/@acornassociated) · [Telegram](https://t.me/acornassociated) · [LinkedIn](https://www.linkedin.com/in/acorn-associated-4715b4424) · [GitHub](https://github.com/acornassociated-22) · [Medium](https://medium.com/@social_3025) · [Reddit](https://www.reddit.com/user/Acorn_Associated) · [Pinterest](https://pin.it/6aHftNn8p)

### Donate

- **$5** — [Stripe](https://donate.stripe.com/test_6oU6oH2ac2dpaOl9uRfQI00)
- **$10** — [Stripe](https://donate.stripe.com/test_5kQ28r168dW71dLgXjfQI01)
- **$100** — [Stripe](https://donate.stripe.com/test_14A6oH6qs7xJbSp9uRfQI03)
- **Other** — [Stripe custom amount](https://donate.stripe.com/test_3cI4gzg1219lcWtfTffQI02)
- **PayPal** — [acornassociatedorg@gmail.com](mailto:acornassociatedorg@gmail.com)

- **GitHub:** [acornassociated-22/AcornVideoDownloader](https://github.com/acornassociated-22/AcornVideoDownloader)
- **About tab in app** — Donate, contact form, social links

---

## Legal notice

Acorn Video Downloader is a tool for personal use. You are responsible for complying with YouTube’s Terms of Service, copyright laws, and the laws in your country. Only download content you have the right to access.
