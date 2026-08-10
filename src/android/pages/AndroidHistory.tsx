import { useState } from "react";
import logo from "../../assets/logo.svg";
import { LOCALE_TAGS } from "../../i18n";
import { useT } from "../../i18n/useT";
import { createId } from "../../lib/format";
import { openExportFolder } from "../../lib/androidStorage";
import { isTauri } from "../../lib/tauri";
import { useHistoryStore } from "../../store/history";
import { useQueueStore } from "../../store/queue";
import { useSettingsStore } from "../../store/settings";
import { useUiStore } from "../../store/ui";
import { AndroidDialog } from "../components/AndroidDialog";

/** Android history: archive reel with date groups. */
export function AndroidHistory() {
  const t = useT();
  const items = useHistoryStore((s) => s.items);
  const remove = useHistoryStore((s) => s.remove);
  const clear = useHistoryStore((s) => s.clear);
  const addItems = useQueueStore((s) => s.addItems);
  const settings = useSettingsStore();
  const setPage = useUiStore((s) => s.setPage);
  const dateLocale = LOCALE_TAGS[settings.locale];
  const [confirmClear, setConfirmClear] = useState(false);

  /** Re-queue a previous download. */
  function handleRedownload(id: string) {
    const item = items.find((h) => h.id === id);
    if (!item) return;
    addItems([
      {
        id: createId(),
        url: item.url,
        title: item.title,
        thumbnail: item.thumbnail,
        format: settings.defaultQuality,
        audioOnly: item.audioOnly,
        audioFormat: "mp3",
        container: item.audioOnly ? "mp3" : "mp4",
        writeSubs: settings.writeSubsDefault,
        subLangs: "tr.*,tr",
        writeThumbnail: settings.writeThumbnailDefault,
        status: "queued",
        percent: 0,
        createdAt: Date.now(),
      },
    ]);
    setPage("queue");
  }

  /** Open the configured export folder (SAF tree or Downloads/Acorn). */
  async function handleOpenFolder() {
    if (!isTauri()) return;
    try {
      await openExportFolder();
    } catch {
      /* no native file manager */
    }
  }

  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = new Date(item.completedAt).toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return (
    <div className="a-stack">
      <div className="a-page-head">
        <div>
          <h1 className="a-greeting">{t("history.title")}</h1>
          <p className="a-section-sub">{t("history.sub")}</p>
        </div>
        {items.length > 0 ? (
          <button
            type="button"
            className="a-btn a-btn-ghost"
            onClick={() => setConfirmClear(true)}
          >
            {t("history.clear")}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="a-empty">
          <div className="a-empty-logo">
            <img src={logo} alt="" />
          </div>
          <p>{t("history.empty")}</p>
        </div>
      ) : (
        [...groups.entries()].map(([dateLabel, rows]) => (
          <div key={dateLabel} className="a-stack">
            <p className="a-section-label">{dateLabel}</p>
            {rows.map((item, index) => (
              <article
                key={`${item.id}-${item.completedAt}`}
                className="a-history-card"
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              >
                <div className="a-history-card__head">
                  <span className="a-media-bar is-completed" aria-hidden="true" />
                  <div className="a-history-card__thumb">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" />
                    ) : (
                      <div className="a-thumb-fallback">
                        <span className="material-symbols-rounded">movie</span>
                      </div>
                    )}
                  </div>
                  <div className="a-history-card__copy">
                    <strong>{item.title}</strong>
                    <small>
                      {new Date(item.completedAt).toLocaleTimeString(dateLocale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      <span className="a-tag">
                        {item.audioOnly ? t("history.audio") : t("history.video")}
                      </span>
                    </small>
                  </div>
                </div>
                <div className="a-history-toolbar" role="toolbar">
                  <button
                    type="button"
                    className="a-history-tool a-history-tool--replay"
                    onClick={() => handleRedownload(item.id)}
                    aria-label={t("history.redownload")}
                  >
                    <span className="a-history-tool__icon material-symbols-rounded">
                      replay
                    </span>
                    <span className="a-history-tool__label">{t("history.redownload")}</span>
                  </button>
                  <button
                    type="button"
                    className="a-history-tool a-history-tool--folder"
                    onClick={() => void handleOpenFolder()}
                    aria-label={t("history.open")}
                  >
                    <span className="a-history-tool__icon material-symbols-rounded">
                      folder_open
                    </span>
                    <span className="a-history-tool__label">{t("history.open")}</span>
                  </button>
                  <button
                    type="button"
                    className="a-history-tool a-history-tool--delete"
                    onClick={() => remove(item.id)}
                    aria-label={t("history.delete")}
                  >
                    <span className="a-history-tool__icon material-symbols-rounded">
                      delete
                    </span>
                    <span className="a-history-tool__label">{t("history.delete")}</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        ))
      )}

      <AndroidDialog
        open={confirmClear}
        title={t("history.clear")}
        message={t("history.clearConfirm")}
        icon="delete_forever"
        tone="danger"
        cancelLabel={t("url.cancel")}
        confirmLabel={t("history.clear")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
