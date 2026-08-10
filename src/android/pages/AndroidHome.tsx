import { useEffect, useRef, useState } from "react";
import logo from "../../assets/logo.svg";
import {
  AndroidPlaylistPanel,
  AndroidPlaylistSkeleton,
  playlistEntryKey,
} from "../components/AndroidPlaylistPanel";
import {
  AndroidWizard,
  type AndroidDownloadDraft,
} from "../components/AndroidWizard";
import { useT } from "../../i18n/useT";
import { isSecretStorageError, isYoutubeBotError } from "../../lib/errors";
import { fetchTimeoutMs, looksLikePlaylist } from "../../lib/fetchTimeout";
import { createId } from "../../lib/format";
import {
  hasQueueableYoutubeUrl,
  resolveYoutubeEntryUrl,
} from "../../lib/youtube";
import {
  fetchMetadata,
  isTauri,
  readClipboard,
} from "../../lib/tauri";
import { useQueueStore } from "../../store/queue";
import { useSettingsStore } from "../../store/settings";
import { useUiStore } from "../../store/ui";
import type { QueueItem, VideoEntry } from "../../types";

/** Resolve a playable watch URL from a playlist/flat entry. */
function entryUrl(entry: VideoEntry, fallback: string): string {
  return resolveYoutubeEntryUrl(entry, fallback);
}

/** Stable row key for playlist checkbox selection. */
function entryKey(entry: VideoEntry, index: number): string {
  return playlistEntryKey(entry, index);
}

/** Shared default draft for bulk playlist queue actions. */
function defaultDraft(settings: {
  defaultQuality: string;
  defaultContainer: string;
  defaultAudioOnly: boolean;
  writeThumbnailDefault: boolean;
  writeSubsDefault: boolean;
}): AndroidDownloadDraft {
  return {
    quality: settings.defaultQuality,
    audioOnly: settings.defaultAudioOnly,
    audioFormat: settings.defaultAudioOnly ? settings.defaultContainer : "mp3",
    container: settings.defaultContainer,
    writeSubs: settings.writeSubsDefault,
    subLangs: "tr.*,tr",
    writeThumbnail: settings.writeThumbnailDefault,
  };
}

/** Android Home: Signal input, cinematic frame, tune wizard, playlist. */
export function AndroidHome() {
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

  /** Paste clipboard URL and fetch; fall back to field URL when clipboard is empty. */
  async function handlePaste() {
    try {
      const fromClipboard = (await readClipboard()).trim();
      const text = fromClipboard || url.trim();
      if (!text) return;
      setUrl(text);
      await handleFetch(text);
    } catch {
      // ignore clipboard errors
    }
  }

  /** Select a playlist item and enrich flat entries. */
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

    const needsEnrich =
      (metadata?.entries?.length ?? 0) <= 1 &&
      (!entry.formats?.length || !entry.webpageUrl?.startsWith("http"));
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
  function toQueueItem(entry: VideoEntry, draft: AndroidDownloadDraft): QueueItem {
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

  function handleSelectAll() {
    if (!metadata?.entries?.length) return;
    setCheckedKeys(
      new Set(metadata.entries.map((entry, index) => entryKey(entry, index))),
    );
  }

  function handleClearSelection() {
    setCheckedKeys(new Set());
  }

  function handleAddQueue(draft: AndroidDownloadDraft) {
    if (!selectedEntry) return;
    addItems([toQueueItem(selectedEntry, draft)]);
    setPage("queue");
  }

  function handleDownload(draft: AndroidDownloadDraft) {
    handleAddQueue(draft);
  }

  function handleQueueAll(draft: AndroidDownloadDraft) {
    if (!metadata?.entries?.length) return;
    const fallback = url.trim();
    const valid = metadata.entries.filter((entry) =>
      hasQueueableYoutubeUrl(entry, fallback),
    );
    const skipped = metadata.entries.length - valid.length;
    if (!valid.length) {
      setError(t("home.skippedInvalidEntries", { count: skipped || metadata.entries.length }));
      return;
    }
    addItems(valid.map((entry) => toQueueItem(entry, draft)));
    if (skipped > 0) {
      setError(t("home.skippedInvalidEntries", { count: skipped }));
    }
    setPage("queue");
  }

  function handleQueueSelected() {
    if (!metadata?.entries?.length || checkedKeys.size === 0) return;
    const draft = defaultDraft(settings);
    const fallback = url.trim();
    const selected = metadata.entries
      .map((entry, index) => ({ entry, key: entryKey(entry, index) }))
      .filter(({ key }) => checkedKeys.has(key));
    const valid = selected.filter(({ entry }) =>
      hasQueueableYoutubeUrl(entry, fallback),
    );
    const skipped = selected.length - valid.length;
    const items = valid.map(({ entry }) => toQueueItem(entry, draft));
    if (!items.length) {
      setError(t("home.skippedInvalidEntries", { count: skipped || selected.length }));
      return;
    }
    addItems(items);
    if (skipped > 0) {
      setError(t("home.skippedInvalidEntries", { count: skipped }));
    }
    setPage("queue");
  }

  const isPlaylist =
    metadata?.kind === "playlist" || (metadata?.entries?.length ?? 0) > 1;

  return (
    <div className={["a-stack", selectedEntry ? "a-home-has-wizard" : ""].filter(Boolean).join(" ")}>
      <div className="a-home-brand">
        <img className="a-home-logo" src={logo} alt="" />
        <h1 className="a-home-title">
          Acorn <span>{t("brand.subtitle")}</span>
        </h1>
      </div>

      <div className={`a-url-bar ${error ? "is-error" : ""}`}>
        <label className="a-url-input">
          <span className="material-symbols-rounded" aria-hidden="true">
            link
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("url.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleFetch();
            }}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            aria-label={t("url.aria")}
            disabled={loading}
          />
        </label>
        <div className="a-url-actions">
          {loading ? (
            <button
              type="button"
              className="a-btn a-btn-danger a-btn-block"
              onClick={handleCancel}
            >
              {t("url.cancel")}
            </button>
          ) : (
            <button
              type="button"
              className="a-btn a-btn-block"
              onClick={() => void handlePaste()}
              title={t("url.pasteTitle")}
            >
              <span className="material-symbols-rounded">content_paste</span>
              {t("url.paste")}
            </button>
          )}
        </div>
        {loading && !metadata ? (
          <div className="a-signal-bar" aria-hidden="true">
            <span />
          </div>
        ) : null}
        {error ? <p className="a-error">{error}</p> : null}
      </div>

      {selectedEntry ? (
        <div ref={wizardRef} className={loading && metadata ? "a-wizard-busy" : ""}>
          <AndroidWizard
            key={`${selectedEntry.id}-${selectedEntry.webpageUrl}`}
            entry={selectedEntry}
            onDownload={handleDownload}
            onAddQueue={handleAddQueue}
          />
          {loading && metadata ? (
            <p className="a-playlist-enrich-note" aria-live="polite">
              <span className="material-symbols-rounded" aria-hidden="true">
                sync
              </span>
              {t("home.loading")}
            </p>
          ) : null}
        </div>
      ) : null}

      {loading && !metadata ? (
        <>
          {looksLikePlaylist(url.trim()) ? (
            <p className="a-playlist-loading-note" aria-live="polite">
              <span className="material-symbols-rounded" aria-hidden="true">
                playlist_play
              </span>
              {t("home.playlistLoading")}
            </p>
          ) : null}
          <AndroidPlaylistSkeleton />
        </>
      ) : null}

      {isPlaylist && metadata ? (
        <AndroidPlaylistPanel
          metadata={metadata}
          checkedKeys={checkedKeys}
          selectedEntry={selectedEntry}
          onToggleCheck={handleToggleCheck}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onQueueSelected={handleQueueSelected}
          onQueueAll={() => handleQueueAll(defaultDraft(settings))}
          onSelectEntry={(entry) => void handleSelectEntry(entry)}
        />
      ) : null}
    </div>
  );
}
