import { useEffect, useRef, useState } from "react";
import logo from "../assets/logo.svg";
import { UrlBar } from "../components/UrlBar";
import { VideoDetail, type DownloadDraft } from "../components/VideoDetail";
import { useT } from "../i18n/useT";
import { isSecretStorageError, isYoutubeBotError } from "../lib/errors";
import { fetchTimeoutMs } from "../lib/fetchTimeout";
import { createId } from "../lib/format";
import { resolveYoutubeEntryUrl } from "../lib/youtube";
import { fetchMetadata, isTauri } from "../lib/tauri";
import { useQueueStore } from "../store/queue";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import type { QueueItem, VideoEntry } from "../types";

/** Resolve a playable watch URL from a playlist/flat entry. */
function entryUrl(entry: VideoEntry, fallback: string): string {
  return resolveYoutubeEntryUrl(entry, fallback);
}

/** Stable row key for playlist checkbox selection. */
function entryKey(entry: VideoEntry, index: number): string {
  return `${entry.id}::${index}`;
}

/** Shared default draft for bulk playlist queue actions. */
function defaultDraft(settings: {
  defaultQuality: string;
  writeThumbnailDefault: boolean;
}): DownloadDraft {
  return {
    quality: settings.defaultQuality,
    audioOnly: false,
    audioFormat: "mp3",
    container: "mp4",
    writeSubs: false,
    subLangs: "tr",
    writeThumbnail: settings.writeThumbnailDefault,
  };
}

/** Home hero with URL fetch, video detail, and playlist actions. */
export function Home() {
  const t = useT();
  const {
    url,
    loading,
    error,
    metadata,
    selectedEntry,
    setUrl,
    setError,
    setMetadata,
    setSelectedEntry,
    setPage,
    setLoading,
    beginFetch,
    cancelFetch,
  } = useUiStore();
  const settings = useSettingsStore();
  const addItems = useQueueStore((s) => s.addItems);
  const activeGeneration = useRef(0);
  const wizardRef = useRef<HTMLDivElement>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set());

  /** Clear multi-select whenever playlist metadata changes. */
  useEffect(() => {
    setCheckedKeys(new Set());
  }, [metadata]);

  /** Scroll the download wizard into view. */
  function scrollToWizard() {
    window.setTimeout(() => {
      wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  /** Fetch metadata for the pasted URL with timeout + stale-response guard. */
  async function handleFetch(nextUrl?: string) {
    const trimmed = (nextUrl ?? url).trim();
    if (!trimmed) return;
    if (nextUrl !== undefined) setUrl(trimmed);

    const generation = beginFetch();
    activeGeneration.current = generation;

    try {
      if (!isTauri()) {
        throw new Error(t("home.tauriRequired"));
      }

      const timeoutMs = fetchTimeoutMs(trimmed);
      const result = await Promise.race([
        fetchMetadata(
          trimmed,
          settings.ytdlpPath,
          settings.cookiesFromBrowser,
          settings.cookiesFile,
        ),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error(t("home.timeout")));
          }, timeoutMs);
        }),
      ]);

      if (useUiStore.getState().fetchGeneration !== generation) return;

      setMetadata(result);
      if (result.kind === "video" && result.entries[0]) {
        setSelectedEntry(result.entries[0]);
        scrollToWizard();
      } else {
        setSelectedEntry(null);
      }
      setLoading(false);
    } catch (err) {
      if (useUiStore.getState().fetchGeneration !== generation) return;
      const raw = err instanceof Error ? err.message : String(err);
      setError(
        isSecretStorageError(raw)
          ? t("errors.secretStorage")
          : isYoutubeBotError(raw)
            ? t("errors.youtubeBot")
            : raw,
      );
      setLoading(false);
    }
  }

  /** Cancel in-flight fetch UI state. */
  function handleCancel() {
    cancelFetch();
    activeGeneration.current = useUiStore.getState().fetchGeneration;
  }

  /**
   * Select a playlist item: show wizard immediately, then enrich with full
   * video metadata when the flat-playlist entry has no formats.
   */
  async function handleSelectEntry(entry: VideoEntry) {
    const watchUrl = entryUrl(entry, url.trim());
    const preview: VideoEntry = {
      ...entry,
      webpageUrl: watchUrl,
      formats: entry.formats ?? [],
      subtitles: entry.subtitles ?? [],
    };

    setError(null);
    setSelectedEntry(preview);
    scrollToWizard();

    // Flat playlist rows lack formats — fetch the single video in the background.
    const needsEnrich =
      !entry.formats?.length || !entry.webpageUrl?.startsWith("http");
    if (!needsEnrich || !isTauri()) return;

    setLoading(true);
    try {
      const result = await fetchMetadata(
        watchUrl,
        settings.ytdlpPath,
        settings.cookiesFromBrowser,
        settings.cookiesFile,
      );
      const full = result.entries[0];
      if (full) {
        setSelectedEntry({
          ...full,
          webpageUrl: entryUrl(full, watchUrl),
          formats: full.formats ?? [],
          subtitles: full.subtitles ?? [],
        });
        scrollToWizard();
      }
    } catch (err) {
      // Keep the flat preview; user can still pick quality/extension.
      setError(
        err instanceof Error
          ? t("home.previewFailed", { message: err.message })
          : String(err),
      );
    } finally {
      setLoading(false);
    }
  }

  /** Build a queue item from a video entry and draft options. */
  function toQueueItem(entry: VideoEntry, draft: DownloadDraft): QueueItem {
    return {
      id: createId(),
      url: entryUrl(entry, url.trim()),
      title: entry.title,
      thumbnail: entry.thumbnail,
      format: draft.quality,
      audioOnly: draft.audioOnly,
      audioFormat: draft.audioFormat,
      container: draft.container,
      writeSubs: draft.writeSubs,
      subLangs: draft.subLangs,
      writeThumbnail: draft.writeThumbnail,
      status: "queued",
      percent: 0,
      createdAt: Date.now(),
    };
  }

  /** Toggle a playlist row checkbox. */
  function handleToggleCheck(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Check every playlist entry. */
  function handleSelectAll() {
    if (!metadata?.entries?.length) return;
    setCheckedKeys(
      new Set(metadata.entries.map((entry, index) => entryKey(entry, index))),
    );
  }

  /** Clear all playlist checkboxes. */
  function handleClearSelection() {
    setCheckedKeys(new Set());
  }

  /** Queue a single video and jump to the queue page. */
  function handleAddQueue(draft: DownloadDraft) {
    if (!selectedEntry) return;
    addItems([toQueueItem(selectedEntry, draft)]);
    setPage("queue");
  }

  /** Queue then let the runner pick it up immediately. */
  function handleDownload(draft: DownloadDraft) {
    handleAddQueue(draft);
  }

  /** Queue every playlist entry with shared options. */
  function handleQueueAll(draft: DownloadDraft) {
    if (!metadata?.entries?.length) return;
    addItems(metadata.entries.map((entry) => toQueueItem(entry, draft)));
    setPage("queue");
  }

  /** Queue only checkbox-selected playlist entries. */
  function handleQueueSelected() {
    if (!metadata?.entries?.length || checkedKeys.size === 0) return;
    const draft = defaultDraft(settings);
    const items = metadata.entries
      .map((entry, index) => ({ entry, key: entryKey(entry, index) }))
      .filter(({ key }) => checkedKeys.has(key))
      .map(({ entry }) => toQueueItem(entry, draft));
    if (!items.length) return;
    addItems(items);
    setPage("queue");
  }

  const showHero = !metadata && !loading && !selectedEntry;
  const isPlaylist =
    metadata?.kind === "playlist" || (metadata?.entries?.length ?? 0) > 1;
  const checkedCount = checkedKeys.size;
  const allChecked =
    !!metadata?.entries?.length && checkedCount === metadata.entries.length;

  return (
    <div className="home">
      {showHero ? (
        <section className="hero">
          <img className="hero-logo animate-logo-in" src={logo} alt="Acorn" />
          <h1 className="animate-rise-in">
            <em>Acorn</em>
          </h1>
          <p className="animate-rise-in" style={{ animationDelay: "80ms" }}>
            {t("home.tagline")}
          </p>
          <UrlBar
            value={url}
            loading={loading}
            onChange={setUrl}
            onSubmit={handleFetch}
            onCancel={handleCancel}
          />
        </section>
      ) : (
        <section className="compact-search animate-rise-in">
          <button
            type="button"
            className="compact-brand"
            onClick={() => useUiStore.getState().goHomeFresh()}
            aria-label={t("nav.homeAria")}
          >
            <img src={logo} alt="" />
            <span>Acorn</span>
          </button>
          <UrlBar
            value={url}
            loading={loading}
            onChange={setUrl}
            onSubmit={handleFetch}
            onCancel={handleCancel}
          />
          {loading ? (
            <div className="loading-banner" aria-live="polite">
              <span className="spinner" />
              {t("home.loading")}
            </div>
          ) : null}
        </section>
      )}

      {error ? <div className="error-banner">{error}</div> : null}

      {selectedEntry ? (
        <div ref={wizardRef} className="wizard-anchor" style={{ marginTop: "1.25rem" }}>
          <VideoDetail
            key={`${selectedEntry.id}-${selectedEntry.webpageUrl}`}
            entry={selectedEntry}
            onDownload={handleDownload}
            onAddQueue={handleAddQueue}
          />
        </div>
      ) : null}

      {isPlaylist && metadata ? (
        <section className="panel soft-panel" style={{ marginTop: "1.25rem" }}>
          <h2 className="section-title">{metadata.title}</h2>
          <p className="section-sub">
            {t("home.playlistCount", { count: metadata.entries.length })}
            {selectedEntry ? t("home.playlistPickOther") : t("home.playlistPick")}
          </p>
          <div className="actions playlist-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={allChecked ? handleClearSelection : handleSelectAll}
            >
              {allChecked ? t("home.clearSelection") : t("home.selectAll")}
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={checkedCount === 0}
              onClick={handleQueueSelected}
            >
              {t("home.queueSelected", { count: checkedCount })}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleQueueAll(defaultDraft(settings))}
            >
              {t("home.queueAll")}
            </button>
          </div>
          <div className="playlist">
            {metadata.entries.map((entry, index) => {
              const key = entryKey(entry, index);
              const selected = selectedEntry?.id === entry.id;
              const checked = checkedKeys.has(key);
              return (
                <div
                  key={key}
                  className={[
                    "playlist-item",
                    "animate-slide-row",
                    selected ? "selected" : "",
                    checked ? "checked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
                >
                  <label className="playlist-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleCheck(key)}
                      aria-label={entry.title || entry.id}
                    />
                    <span className="playlist-check-mark" aria-hidden="true" />
                  </label>
                  {entry.thumbnail ? (
                    <img src={entry.thumbnail} alt="" />
                  ) : (
                    <div className="thumb-fallback" />
                  )}
                  <div>
                    <p className="row-title">{entry.title || entry.id}</p>
                    <p className="row-meta">
                      {entry.channel || entry.uploader || t("home.playlistItem")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`btn ${selected ? "btn-accent" : "btn-ghost"}`}
                    onClick={() => void handleSelectEntry(entry)}
                  >
                    {selected ? t("home.selected") : t("home.select")}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
