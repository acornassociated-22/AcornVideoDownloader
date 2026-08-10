import { ProgressRing } from "../components/ProgressRing";
import { requestCancel } from "../hooks/useDownloadRunner";
import { useT } from "../i18n/useT";
import type { MessageKey } from "../i18n";
import {
  isFfmpegMissingError,
  isHttp403Error,
  isExportError,
  isOutputNotFoundError,
  isOutputPathError,
  isYoutubeBotError,
} from "../lib/errors";
import { useQueueStore } from "../store/queue";

/** Map queue error text to a short user-facing message. */
function friendlyQueueError(
  raw: string | null | undefined,
  translate: (k: MessageKey) => string,
): string | undefined {
  if (!raw) return undefined;
  if (isFfmpegMissingError(raw)) return translate("errors.ffmpegMissing");
  if (isOutputNotFoundError(raw)) return translate("errors.outputNotFound");
  if (isExportError(raw)) return translate("errors.exportFailed");
  if (isOutputPathError(raw)) return translate("errors.outputPath");
  if (isYoutubeBotError(raw) || isHttp403Error(raw)) {
    return translate("errors.youtubeBot");
  }
  // Never dump multi-line yt-dlp stderr into the card.
  const first = raw.split(/\n/).map((s) => s.trim()).find(Boolean);
  if (first && first.length > 140) return `${first.slice(0, 137)}…`;
  return first ?? raw;
}

const STATUS_KEYS: Record<string, MessageKey> = {
  queued: "queue.status.queued",
  downloading: "queue.status.downloading",
  completed: "queue.status.completed",
  error: "queue.status.error",
  cancelled: "queue.status.cancelled",
};

/** Live download queue with progress and cancel actions. */
export function Queue() {
  const t = useT();
  const items = useQueueStore((s) => s.items);
  const activeId = useQueueStore((s) => s.activeId);
  const removeItem = useQueueStore((s) => s.removeItem);
  const clearFinished = useQueueStore((s) => s.clearFinished);
  const clearAll = useQueueStore((s) => s.clearAll);
  const updateItem = useQueueStore((s) => s.updateItem);

  /** Cancel active download (if any) and empty the whole queue. */
  async function handleClearAll() {
    if (activeId) {
      await requestCancel(activeId);
    }
    clearAll();
  }

  /** Cancel one active download. */
  function handleCancel(id: string) {
    void requestCancel(id);
  }

  /** Mark a waiting job as cancelled. */
  function handleRemoveQueued(id: string) {
    updateItem(id, {
      status: "cancelled",
      error: t("queue.removed"),
    });
  }

  return (
    <section className="panel soft-panel animate-rise-in">
      <div className="page-head">
        <div>
          <h2 className="section-title">{t("queue.title")}</h2>
          <p className="section-sub">{t("queue.sub")}</p>
        </div>
        <div className="row-buttons">
          <button type="button" className="btn btn-ghost" onClick={clearFinished}>
            {t("queue.clearFinished")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void handleClearAll()}
            disabled={items.length === 0}
          >
            {t("queue.clearAll")}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="empty-hint">{t("queue.empty")}</p>
      ) : (
        <div className="queue-list">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="queue-row animate-slide-row"
              style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
            >
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" />
              ) : (
                <div className="thumb-fallback" />
              )}
              <div>
                <p className="row-title">{item.title}</p>
                <p className={`row-meta status-${item.status}`}>
                  {STATUS_KEYS[item.status]
                    ? t(STATUS_KEYS[item.status])
                    : item.status}
                  {item.container ? ` · ${item.container.toUpperCase()}` : ""}
                  {item.speed ? ` · ${item.speed}` : ""}
                  {item.eta ? ` · ${item.eta}` : ""}
                  {item.error
                    ? ` · ${friendlyQueueError(item.error, t) ?? item.error}`
                    : ""}
                </p>
                {(item.status === "downloading" || item.percent > 0) && (
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="row-actions">
                {item.status === "downloading" ? (
                  <ProgressRing percent={item.percent} />
                ) : (
                  <span className="badge">{Math.round(item.percent)}%</span>
                )}
                <div className="row-buttons">
                  {item.status === "downloading" ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleCancel(item.id)}
                    >
                      {t("queue.cancel")}
                    </button>
                  ) : null}
                  {item.status === "queued" ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleRemoveQueued(item.id)}
                    >
                      {t("queue.remove")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeItem(item.id)}
                    >
                      {t("queue.close")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
