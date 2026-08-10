import { useState } from "react";
import type { MediaContainer, VideoEntry } from "../types";
import { formatDuration } from "../lib/format";
import { useT } from "../i18n/useT";
import { useSettingsStore } from "../store/settings";
import type { DownloadDraft } from "./VideoDetail";

/** Step wizard: quality → extension → download CTA with animated cards (desktop). */
export function DownloadWizard({
  entry,
  onDownload,
  onAddQueue,
}: {
  entry: VideoEntry;
  onDownload: (draft: DownloadDraft) => void;
  onAddQueue: (draft: DownloadDraft) => void;
}) {
  const t = useT();
  const settings = useSettingsStore();
  const [audioOnly, setAudioOnly] = useState(false);
  const [quality, setQuality] = useState<string | null>(null);
  const [container, setContainer] = useState<string | null>(null);
  const [writeSubs, setWriteSubs] = useState(false);
  const [subLangs, setSubLangs] = useState("tr");
  const [writeThumbnail, setWriteThumbnail] = useState(
    settings.writeThumbnailDefault,
  );
  const [moreOpen, setMoreOpen] = useState(false);

  const videoExts: { id: MediaContainer; label: string; hint: string }[] = [
    { id: "mp4", label: "MP4", hint: t("wizard.hint.mp4") },
    { id: "webm", label: "WEBM", hint: t("wizard.hint.webm") },
    { id: "mkv", label: "MKV", hint: t("wizard.hint.mkv") },
  ];
  const audioExts: { id: MediaContainer; label: string; hint: string }[] = [
    { id: "mp3", label: "MP3", hint: t("wizard.hint.mp3") },
    { id: "m4a", label: "M4A", hint: t("wizard.hint.m4a") },
    { id: "opus", label: "OPUS", hint: t("wizard.hint.opus") },
    { id: "wav", label: "WAV", hint: t("wizard.hint.wav") },
  ];

  const qualityOptions = [
    { value: "best", label: t("wizard.best") },
    { value: "2160", label: "2160p" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
  ];
  const extOptions = audioOnly ? audioExts : videoExts;

  const step = !quality ? 1 : !container ? 2 : 3;

  const draft: DownloadDraft = {
    quality: quality || settings.defaultQuality || "1080",
    audioOnly,
    audioFormat: audioOnly ? container || "mp3" : "mp3",
    container: container || (audioOnly ? "mp3" : "mp4"),
    writeSubs,
    subLangs,
    writeThumbnail,
  };

  function handleMode(nextAudio: boolean) {
    setAudioOnly(nextAudio);
    setQuality(nextAudio ? "best" : null);
    setContainer(null);
  }

  /** Select quality and clear extension so step 2 reappears. */
  function handleQuality(value: string) {
    setQuality(value);
    setContainer(null);
  }

  const morePanel = (
    <>
      <button
        type="button"
        className="more-toggle"
        onClick={() => setMoreOpen((v) => !v)}
      >
        {moreOpen ? t("wizard.less") : t("wizard.more")}
      </button>
      {moreOpen ? (
        <div className="more-panel">
          <label className="check-row">
            <input
              type="checkbox"
              checked={writeThumbnail}
              onChange={(e) => setWriteThumbnail(e.target.checked)}
            />
            {t("wizard.saveThumb")}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={writeSubs}
              onChange={(e) => setWriteSubs(e.target.checked)}
              disabled={(entry.subtitles ?? []).length === 0}
            />
            {t("wizard.downloadSubs")}
          </label>
          {writeSubs && (entry.subtitles ?? []).length > 0 ? (
            <div className="field">
              <label htmlFor="subs">{t("wizard.subLang")}</label>
              <select
                id="subs"
                value={subLangs}
                onChange={(e) => setSubLangs(e.target.value)}
              >
                <option value="tr.*,tr">{t("wizard.subTr")}</option>
                <option value="en.*,en">{t("wizard.subEn")}</option>
                <option value="all">{t("wizard.subAll")}</option>
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <div className="detail-card wizard animate-rise-in">
      <div className="wizard-media">
        {entry.thumbnail ? (
          <img className="thumb" src={entry.thumbnail} alt="" />
        ) : (
          <div className="thumb" />
        )}
        <div>
          <h2 className="section-title">{entry.title}</h2>
          <p className="meta-line">
            {entry.channel || entry.uploader || t("wizard.unknownChannel")} ·{" "}
            {formatDuration(entry.duration)}
          </p>
        </div>
      </div>

      <div className="step-indicator" aria-label={t("wizard.stepsAria")}>
        <span className={step >= 1 ? "on" : ""}>{t("wizard.step1")}</span>
        <span className="step-sep" />
        <span className={step >= 2 ? "on" : ""}>{t("wizard.step2")}</span>
        <span className="step-sep" />
        <span className={step >= 3 ? "on" : ""}>{t("wizard.step3")}</span>
      </div>

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

      <section
        className={`wizard-step ${step === 1 ? "step-active" : "step-done"}`}
        key={`q-${audioOnly}`}
      >
        <p className="picker-label">{t("wizard.pickQuality")}</p>
        <div className="card-grid">
          {(audioOnly
            ? [{ value: "best", label: t("wizard.bestAudio") }]
            : qualityOptions
          ).map((opt, index) => (
            <button
              key={opt.value}
              type="button"
              className={`select-card ${quality === opt.value ? "selected" : ""}`}
              style={{ animationDelay: `${index * 45}ms` }}
              onClick={() => handleQuality(opt.value)}
            >
              <strong>{opt.label}</strong>
              <span>
                {audioOnly ? t("wizard.audioQuality") : t("wizard.resolution")}
              </span>
            </button>
          ))}
        </div>
      </section>

      {quality ? (
        <section className="wizard-step step-active" key={`e-${audioOnly}-${quality}`}>
          <p className="picker-label">{t("wizard.pickExt")}</p>
          <div className="card-grid">
            {extOptions.map((opt, index) => (
              <button
                key={opt.id}
                type="button"
                className={`select-card ${container === opt.id ? "selected" : ""}`}
                style={{ animationDelay: `${index * 45}ms` }}
                onClick={() => setContainer(opt.id)}
              >
                <strong>{opt.label}</strong>
                <span>{opt.hint}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {quality && container ? (
        <section className="wizard-step step-active" key="download">
          <p className="picker-label">{t("wizard.pickStart")}</p>
          <div className="actions actions-primary">
            <button
              type="button"
              className="btn btn-accent btn-lg"
              onClick={() => onDownload(draft)}
            >
              {t("wizard.start")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onAddQueue(draft)}
            >
              {t("wizard.addQueue")}
            </button>
          </div>
          {morePanel}
        </section>
      ) : null}
    </div>
  );
}
