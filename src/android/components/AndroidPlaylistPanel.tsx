import { useT } from "../../i18n/useT";
import type { MetadataResult, VideoEntry } from "../../types";
import { AndroidCard } from "./AndroidCard";

const SKELETON_ROWS = 6;

/** Stable row key for playlist checkbox selection. */
export function playlistEntryKey(entry: VideoEntry, index: number): string {
  return `${entry.id}::${index}`;
}

/** Skeleton shown while playlist metadata is loading. */
export function AndroidPlaylistSkeleton() {
  const t = useT();

  return (
    <AndroidCard className="a-playlist-card is-loading" aria-busy="true">
      <div className="a-playlist-head">
        <div className="a-playlist-skeleton-title" />
        <div className="a-playlist-skeleton-sub" />
      </div>
      <div className="a-history-toolbar a-playlist-toolbar a-playlist-skeleton-toolbar" aria-hidden="true">
        <span className="a-playlist-skeleton-tool" />
        <span className="a-playlist-skeleton-tool" />
        <span className="a-playlist-skeleton-tool" />
      </div>
      <div className="a-playlist-scroll">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="a-playlist-skeleton-row">
            <span className="a-playlist-skeleton-thumb" />
            <span className="a-playlist-skeleton-lines">
              <span />
              <span />
            </span>
          </div>
        ))}
      </div>
      <p className="a-playlist-loading-note">
        <span className="material-symbols-rounded" aria-hidden="true">
          hourglass_top
        </span>
        {t("home.loading")}
      </p>
    </AndroidCard>
  );
}

/** History-style bulk action bar for playlist queueing. */
export function PlaylistToolbar({
  allChecked,
  checkedCount,
  onSelectAll,
  onClearSelection,
  onQueueSelected,
  onQueueAll,
}: {
  allChecked: boolean;
  checkedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onQueueSelected: () => void;
  onQueueAll: () => void;
}) {
  const t = useT();

  return (
    <div className="a-history-toolbar a-playlist-toolbar" role="toolbar">
      <button
        type="button"
        className="a-history-tool a-history-tool--dismiss"
        onClick={allChecked ? onClearSelection : onSelectAll}
        aria-label={
          allChecked ? t("home.playlistToolbarClear") : t("home.playlistToolbarSelect")
        }
      >
        <span className="a-history-tool__icon material-symbols-rounded">
          {allChecked ? "remove_done" : "select_all"}
        </span>
        <span className="a-history-tool__label">
          {allChecked ? t("home.playlistToolbarClear") : t("home.playlistToolbarSelect")}
        </span>
      </button>
      <button
        type="button"
        className="a-history-tool a-history-tool--folder"
        disabled={checkedCount === 0}
        onClick={onQueueSelected}
        aria-label={t("home.playlistToolbarSelected", { count: checkedCount })}
      >
        <span className="a-history-tool__icon material-symbols-rounded">playlist_add</span>
        <span className="a-history-tool__label">
          {t("home.playlistToolbarSelected", { count: checkedCount })}
        </span>
      </button>
      <button
        type="button"
        className="a-history-tool a-history-tool--replay"
        onClick={onQueueAll}
        aria-label={t("home.playlistToolbarAll")}
      >
        <span className="a-history-tool__icon material-symbols-rounded">download</span>
        <span className="a-history-tool__label">{t("home.playlistToolbarAll")}</span>
      </button>
    </div>
  );
}

/** Scrollable playlist picker with bulk queue actions. */
export function AndroidPlaylistPanel({
  metadata,
  checkedKeys,
  selectedEntry,
  onToggleCheck,
  onSelectAll,
  onClearSelection,
  onQueueSelected,
  onQueueAll,
  onSelectEntry,
}: {
  metadata: MetadataResult;
  checkedKeys: Set<string>;
  selectedEntry: VideoEntry | null;
  onToggleCheck: (key: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onQueueSelected: () => void;
  onQueueAll: () => void;
  onSelectEntry: (entry: VideoEntry) => void;
}) {
  const t = useT();
  const checkedCount = checkedKeys.size;
  const allChecked =
    metadata.entries.length > 0 && checkedCount === metadata.entries.length;

  return (
    <AndroidCard className="a-playlist-card">
      <div className="a-playlist-head">
        <p className="a-section-label a-playlist-title">{metadata.title}</p>
        <p className="a-section-sub a-playlist-meta">
          {t("home.playlistCount", { count: metadata.entries.length })}
          {selectedEntry ? t("home.playlistPickOther") : t("home.playlistPick")}
        </p>
      </div>

      <PlaylistToolbar
        allChecked={allChecked}
        checkedCount={checkedCount}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onQueueSelected={onQueueSelected}
        onQueueAll={onQueueAll}
      />

      <div className="a-playlist-scroll" role="list">
        {metadata.entries.map((entry, index) => {
          const key = playlistEntryKey(entry, index);
          const checked = checkedKeys.has(key);
          const isActive =
            !!selectedEntry &&
            selectedEntry.id === entry.id &&
            (selectedEntry.webpageUrl === entry.webpageUrl ||
              selectedEntry.title === entry.title);

          return (
            <div
              key={key}
              role="listitem"
              className={[
                "a-playlist-row",
                checked ? "is-checked" : "",
                isActive ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <label className="a-playlist-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleCheck(key)}
                  aria-label={entry.title || entry.id}
                />
              </label>

              <button
                type="button"
                className="a-playlist-body"
                onClick={() => onSelectEntry(entry)}
              >
                {entry.thumbnail ? (
                  <img src={entry.thumbnail} alt="" className="a-playlist-thumb" />
                ) : (
                  <div className="a-thumb-fallback a-playlist-thumb">
                    <span className="material-symbols-rounded">movie</span>
                  </div>
                )}
                <span className="a-playlist-copy">
                  <strong>{entry.title || entry.id}</strong>
                  <small>
                    {entry.channel || entry.uploader || t("home.playlistItem")}
                  </small>
                </span>
                <span className="a-playlist-chevron material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </AndroidCard>
  );
}
