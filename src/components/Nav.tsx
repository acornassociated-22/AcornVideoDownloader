import { useT } from "../i18n/useT";
import type { PageId } from "../types";
import { useQueueStore } from "../store/queue";

/** Primary navigation for app pages. */
export function Nav({
  page,
  onNavigate,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
}) {
  const t = useT();
  const activeCount = useQueueStore(
    (s) =>
      s.items.filter(
        (i) => i.status === "queued" || i.status === "downloading",
      ).length,
  );

  const links: { id: PageId; label: string }[] = [
    { id: "home", label: t("nav.home") },
    { id: "queue", label: t("nav.queue") },
    { id: "history", label: t("nav.history") },
    { id: "settings", label: t("nav.settings") },
    { id: "about", label: t("nav.about") },
  ];

  return (
    <nav className="nav" aria-label={t("nav.mainMenu")}>
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          className={page === link.id ? "active" : undefined}
          onClick={() => onNavigate(link.id)}
        >
          {link.label}
          {link.id === "queue" && activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      ))}
    </nav>
  );
}
