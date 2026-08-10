import { useState } from "react";
import { useT } from "../i18n/useT";
import type { MediaContainer, SubtitleTrack, VideoEntry } from "../types";

const VIDEO_EXTS: { id: MediaContainer; label: string }[] = [
  { id: "mp4", label: "MP4" },
  { id: "webm", label: "WEBM" },
  { id: "mkv", label: "MKV" },
];

const AUDIO_EXTS: { id: MediaContainer; label: string }[] = [
  { id: "mp3", label: "MP3" },
  { id: "m4a", label: "M4A" },
  { id: "opus", label: "OPUS" },
  { id: "wav", label: "WAV" },
];

/** Chip-based quality, extension, and optional extras picker. */
export function FormatPicker({
  entry,
  quality,
  audioOnly,
  container,
  writeSubs,
  subLangs,
  writeThumbnail,
  onQuality,
  onAudioOnly,
  onContainer,
  onWriteSubs,
  onSubLangs,
  onWriteThumbnail,
}: {
  entry: VideoEntry;
  quality: string;
  audioOnly: boolean;
  container: string;
  writeSubs: boolean;
  subLangs: string;
  writeThumbnail: boolean;
  onQuality: (value: string) => void;
  onAudioOnly: (value: boolean) => void;
  onContainer: (value: string) => void;
  onWriteSubs: (value: boolean) => void;
  onSubLangs: (value: string) => void;
  onWriteThumbnail: (value: boolean) => void;
}) {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const subs: SubtitleTrack[] = entry.subtitles ?? [];
  const qualityOptions = [
    { value: "best", label: t("wizard.best") },
    { value: "2160", label: "2160p" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
  ];
  const extOptions = audioOnly ? AUDIO_EXTS : VIDEO_EXTS;

  /** Switch between video and audio modes and reset extension. */
  function handleMode(nextAudio: boolean) {
    onAudioOnly(nextAudio);
    onContainer(nextAudio ? "mp3" : "mp4");
  }

  return (
    <div className="picker">
      <div className="segment" role="group" aria-label={t("wizard.typeAria")}>
        <button
          type="button"
          className={!audioOnly ? "active" : undefined}
          onClick={() => handleMode(false)}
        >
          {t("wizard.video")}
        </button>
        <button
          type="button"
          className={audioOnly ? "active" : undefined}
          onClick={() => handleMode(true)}
        >
          {t("wizard.audio")}
        </button>
      </div>

      {!audioOnly ? (
        <div className="picker-block">
          <p className="picker-label">{t("wizard.quality")}</p>
          <div className="chip-row">
            {qualityOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chip ${quality === opt.value ? "chip-active" : ""}`}
                onClick={() => onQuality(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="picker-block">
        <p className="picker-label">{t("wizard.extension")}</p>
        <div className="chip-row">
          {extOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`chip ${container === opt.id ? "chip-active" : ""}`}
              onClick={() => onContainer(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="more-toggle"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
      >
        {moreOpen ? t("wizard.less") : t("wizard.more")}
      </button>

      {moreOpen ? (
        <div className="more-panel">
          <label className="check-row">
            <input
              type="checkbox"
              checked={writeThumbnail}
              onChange={(e) => onWriteThumbnail(e.target.checked)}
            />
            {t("wizard.saveThumb")}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={writeSubs}
              onChange={(e) => onWriteSubs(e.target.checked)}
              disabled={subs.length === 0}
            />
            {t("wizard.downloadSubs")}
          </label>
          {writeSubs && subs.length > 0 ? (
            <div className="field">
              <label htmlFor="subs">{t("wizard.subLang")}</label>
              <select
                id="subs"
                value={subLangs}
                onChange={(e) => onSubLangs(e.target.value)}
              >
                <option value="tr.*,tr">{t("wizard.subTr")}</option>
                <option value="en.*,en">{t("wizard.subEn")}</option>
                <option value="all">{t("wizard.subAll")}</option>
                {subs.map((sub) => (
                  <option key={sub.language} value={sub.language}>
                    {sub.name || sub.language}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
