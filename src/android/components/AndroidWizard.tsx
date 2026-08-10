import { useState } from "react";
import type { MediaContainer, VideoEntry } from "../../types";
import { formatDuration } from "../../lib/format";
import { useT } from "../../i18n/useT";
import { useSettingsStore } from "../../store/settings";
import type { DownloadDraft } from "../../components/VideoDetail";

export type AndroidDownloadDraft = DownloadDraft;

/** Build a download draft from persisted settings defaults. */
function draftFromSettings(settings: ReturnType<typeof useSettingsStore.getState>) {
  return {
    quality: settings.defaultQuality,
    audioOnly: settings.defaultAudioOnly,
    container: settings.defaultContainer,
    audioFormat: settings.defaultAudioOnly ? settings.defaultContainer : "mp3",
    writeSubs: settings.writeSubsDefault,
    subLangs: "tr.*,tr",
    writeThumbnail: settings.writeThumbnailDefault,
  } satisfies AndroidDownloadDraft;
}

/** Resolve a human-readable quality label for the summary badges. */
function qualityLabel(
  quality: string,
  audioOnly: boolean,
  translate: (key: "wizard.best" | "wizard.bestAudio") => string,
): string {
  if (audioOnly) return translate("wizard.bestAudio");
  if (quality === "best") return translate("wizard.best");
  return `${quality}p`;
}

/** Premium toolbar button matching history card actions. */
function WizardTool({
  icon,
  label,
  variant,
  onClick,
  ariaLabel,
}: {
  icon: string;
  label: string;
  variant: "replay" | "folder" | "delete" | "dismiss";
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={`a-history-tool a-history-tool--${variant}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="a-history-tool__icon material-symbols-rounded">{icon}</span>
      <span className="a-history-tool__label">{label}</span>
    </button>
  );
}

/** Mobile download panel: cinematic hero + premium toolbar actions. */
export function AndroidWizard({
  entry,
  onDownload,
  onAddQueue,
}: {
  entry: VideoEntry;
  onDownload: (draft: AndroidDownloadDraft) => void;
  onAddQueue: (draft: AndroidDownloadDraft) => void;
}) {
  const t = useT();
  const settings = useSettingsStore();
  const [customizeMode, setCustomizeMode] = useState(false);
  const [audioOnly, setAudioOnly] = useState(settings.defaultAudioOnly);
  const [quality, setQuality] = useState<string | null>(null);
  const [container, setContainer] = useState<string | null>(null);

  const videoExts: { id: MediaContainer; label: string }[] = [
    { id: "mp4", label: "MP4" },
    { id: "webm", label: "WEBM" },
    { id: "mkv", label: "MKV" },
  ];
  const audioExts: { id: MediaContainer; label: string }[] = [
    { id: "mp3", label: "MP3" },
    { id: "m4a", label: "M4A" },
    { id: "opus", label: "OPUS" },
    { id: "wav", label: "WAV" },
  ];

  const qualityOptions = [
    { value: "best", label: t("wizard.best") },
    { value: "2160", label: "2160p" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
  ];
  const extOptions = audioOnly ? audioExts : videoExts;
  const customizeStep = !quality ? 1 : !container ? 2 : 3;

  const settingsDraft = draftFromSettings(settings);
  const customizeDraft: AndroidDownloadDraft = {
    quality: quality || settings.defaultQuality || "1080",
    audioOnly,
    audioFormat: audioOnly ? container || "mp3" : "mp3",
    container: container || (audioOnly ? "mp3" : "mp4"),
    writeSubs: settings.writeSubsDefault,
    subLangs: "tr.*,tr",
    writeThumbnail: settings.writeThumbnailDefault,
  };

  const summaryQuality = qualityLabel(
    settings.defaultQuality,
    settings.defaultAudioOnly,
    t,
  );
  const summaryFormat = settings.defaultContainer.toUpperCase();
  const customizeQuality = qualityLabel(
    customizeDraft.quality,
    customizeDraft.audioOnly,
    t,
  );
  const customizeFormat = (
    customizeDraft.audioOnly ? customizeDraft.audioFormat : customizeDraft.container
  ).toUpperCase();

  /** Enter customize flow and seed from current settings. */
  function handleCustomize() {
    setCustomizeMode(true);
    setAudioOnly(settings.defaultAudioOnly);
    setQuality(null);
    setContainer(null);
  }

  /** Leave customize flow and restore quick panel. */
  function handleCancelCustomize() {
    setCustomizeMode(false);
    setQuality(null);
    setContainer(null);
  }

  /** Switch video/audio mode and reset tune steps. */
  function handleMode(nextAudio: boolean) {
    setAudioOnly(nextAudio);
    setQuality(nextAudio ? "best" : null);
    setContainer(null);
  }

  /** Select quality and advance to format step. */
  function handleQuality(value: string) {
    setQuality(value);
    setContainer(null);
  }

  /** Primary download toolbar: start, queue, customize or back. */
  function renderDownloadToolbar(
    draft: AndroidDownloadDraft,
    options: { customize?: boolean; back?: () => void } = {},
  ) {
    const { customize = false, back } = options;
    return (
      <div className="a-history-toolbar" role="toolbar">
        <WizardTool
          icon="download"
          label={t("wizard.start")}
          variant="replay"
          onClick={() => onDownload(draft)}
          ariaLabel={t("wizard.start")}
        />
        <WizardTool
          icon="playlist_add"
          label={t("wizard.addQueue")}
          variant="folder"
          onClick={() => onAddQueue(draft)}
          ariaLabel={t("wizard.addQueue")}
        />
        {customize ? (
          <WizardTool
            icon="tune"
            label={t("wizard.customize")}
            variant="dismiss"
            onClick={handleCustomize}
            ariaLabel={t("wizard.customize")}
          />
        ) : (
          <WizardTool
            icon="arrow_back"
            label={t("wizard.back")}
            variant="dismiss"
            onClick={back ?? (() => setContainer(null))}
            ariaLabel={t("wizard.back")}
          />
        )}
      </div>
    );
  }

  const channel = entry.channel || entry.uploader || t("wizard.unknownChannel");
  const duration = formatDuration(entry.duration);

  return (
    <div className="a-card a-download-card">
      <div className="a-frame a-download-hero">
        {entry.thumbnail ? (
          <img src={entry.thumbnail} alt="" />
        ) : (
          <div className="a-frame-fallback">
            <span className="material-symbols-rounded">movie</span>
          </div>
        )}
        <span className="a-download-duration">{duration}</span>
        <div className="a-frame-overlay">
          <strong>{entry.title}</strong>
          <small>{channel}</small>
        </div>
      </div>

      {!customizeMode ? (
        <>
          <div className="a-download-meta">
            <div className="a-download-badges">
              <span className="a-tag is-accent">{summaryQuality}</span>
              <span className="a-tag">{summaryFormat}</span>
            </div>
          </div>
          {renderDownloadToolbar(settingsDraft, { customize: true })}
        </>
      ) : (
        <>
          <div className="a-download-body">
            <div className="a-wizard-stage">
              {customizeStep === 1 ? (
                <div className="a-wizard-panel" key="step-quality">
                  <div className="a-segment" role="group" aria-label={t("wizard.typeAria")}>
                    <button
                      type="button"
                      className={!audioOnly ? "is-active" : undefined}
                      onClick={() => handleMode(false)}
                    >
                      {t("wizard.video")}
                    </button>
                    <button
                      type="button"
                      className={audioOnly ? "is-active" : undefined}
                      onClick={() => handleMode(true)}
                    >
                      {t("wizard.audio")}
                    </button>
                  </div>
                  <p className="a-section-label">{t("wizard.pickQuality")}</p>
                  <div className="a-chips">
                    {(audioOnly
                      ? [{ value: "best", label: t("wizard.bestAudio") }]
                      : qualityOptions
                    ).map((opt, index) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`a-chip ${quality === opt.value ? "is-active" : ""}`}
                        style={{ animationDelay: `${index * 40}ms` }}
                        onClick={() => handleQuality(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {customizeStep === 2 ? (
                <div className="a-wizard-panel" key="step-format">
                  <p className="a-section-label">{t("wizard.pickExt")}</p>
                  <div className="a-chips">
                    {extOptions.map((opt, index) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`a-chip ${container === opt.id ? "is-active" : ""}`}
                        style={{ animationDelay: `${index * 40}ms` }}
                        onClick={() => setContainer(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {customizeStep === 3 ? (
                <div className="a-wizard-panel" key="step-start">
                  <p className="a-section-label">{t("wizard.pickStart")}</p>
                  <div className="a-download-badges">
                    <span className="a-tag is-accent">{customizeQuality}</span>
                    <span className="a-tag">{customizeFormat}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {customizeStep === 3 ? (
            renderDownloadToolbar(customizeDraft, {
              back: () => setContainer(null),
            })
          ) : (
            <div className="a-queue-toolbar a-queue-toolbar--1" role="toolbar">
              <WizardTool
                icon={customizeStep === 1 ? "close" : "arrow_back"}
                label={customizeStep === 1 ? t("wizard.cancelCustomize") : t("wizard.back")}
                variant="dismiss"
                onClick={
                  customizeStep === 1
                    ? handleCancelCustomize
                    : () => setQuality(null)
                }
                ariaLabel={
                  customizeStep === 1 ? t("wizard.cancelCustomize") : t("wizard.back")
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
