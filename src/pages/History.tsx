import { LOCALE_TAGS } from "../i18n";
import { useT } from "../i18n/useT";
import { openPath, isTauri } from "../lib/tauri";
import { useHistoryStore } from "../store/history";
import { useQueueStore } from "../store/queue";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import { createId } from "../lib/format";

/** Local download history with re-download and open actions. */
export function History() {
  const t = useT();
  const items = useHistoryStore((s) => s.items);
  const remove = useHistoryStore((s) => s.remove);
  const clear = useHistoryStore((s) => s.clear);
  const addItems = useQueueStore((s) => s.addItems);
  const settings = useSettingsStore();
  const setPage = useUiStore((s) => s.setPage);
  const dateLocale = LOCALE_TAGS[settings.locale];

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

  /** Open the download folder (reveals the file when the path is known). */
  async function handleOpen(path?: string | null, fallbackDir?: string) {
    if (!isTauri()) return;
    const folder = fallbackDir || settings.outputDir;
    const target = path || folder;
    if (!target) return;
    try {
      await openPath(target);
    } catch {
      if (folder && folder !== target) {
        try {
          await openPath(folder);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return (
    <section className="panel soft-panel animate-rise-in">
      <div className="page-head">
        <div>
          <h2 className="section-title">{t("history.title")}</h2>
          <p className="section-sub">{t("history.sub")}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={clear}>
          {t("history.clear")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="empty-hint">{t("history.empty")}</p>
      ) : (
        <div className="history-list">
          {items.map((item, index) => (
            <div
              key={`${item.id}-${item.completedAt}`}
              className="history-row animate-slide-row"
              style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
            >
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" />
              ) : (
                <div className="thumb-fallback" />
              )}
              <div>
                <p className="row-title">{item.title}</p>
                <p className="row-meta">
                  {new Date(item.completedAt).toLocaleString(dateLocale)}
                  {item.audioOnly
                    ? ` · ${t("history.audio")}`
                    : ` · ${t("history.video")}`}
                </p>
              </div>
              <div className="row-buttons">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleRedownload(item.id)}
                >
                  {t("history.redownload")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleOpen(item.filename, item.outputDir)}
                >
                  {t("history.open")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => remove(item.id)}
                >
                  {t("history.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
