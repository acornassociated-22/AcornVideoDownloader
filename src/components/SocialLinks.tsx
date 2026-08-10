import { useT } from "../i18n/useT";
import { openExternalUrl } from "../lib/tauri";
import { SOCIAL_LINKS } from "../lib/social";
import {
  IconFacebook,
  IconGithub,
  IconInstagram,
  IconLinkedin,
  IconMedium,
  IconPinterest,
  IconReddit,
  IconTelegram,
  IconX,
  IconYoutube,
} from "./SocialIcons";

const ICONS = {
  facebook: IconFacebook,
  x: IconX,
  instagram: IconInstagram,
  youtube: IconYoutube,
  telegram: IconTelegram,
  linkedin: IconLinkedin,
  github: IconGithub,
  medium: IconMedium,
  reddit: IconReddit,
  pinterest: IconPinterest,
} as const;

/** Right-edge collapsible icon rail for Acorn Associated social profiles. */
export function SocialLinks({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const t = useT();

  /** Open a profile in the system browser. */
  function handleOpen(href: string) {
    return openExternalUrl(href);
  }

  return (
    <aside
      className={`social-rail ${collapsed ? "collapsed" : ""}`}
      aria-label={t("social.aria")}
    >
      <button
        type="button"
        className="social-rail-toggler"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("social.expand") : t("social.collapse")}
        title={collapsed ? t("social.expand") : t("social.collapse")}
      >
        <span className="material-symbols-rounded">chevron_right</span>
        <span className="social-rail-toggler-label">{t("social.chip")}</span>
      </button>

      <ul className="social-rail-list" aria-hidden={collapsed}>
        {SOCIAL_LINKS.map((link, index) => {
          const Icon = ICONS[link.id as keyof typeof ICONS];
          return (
            <li
              key={link.id}
              className="social-rail-item"
              style={{ ["--rail-index" as string]: index }}
            >
              <button
                type="button"
                className={`social-rail-btn connect-${link.id}`}
                style={{ ["--social-accent" as string]: link.color }}
                title={link.label}
                aria-label={link.label}
                tabIndex={collapsed ? -1 : 0}
                onClick={() => void handleOpen(link.href)}
              >
                <Icon className="social-rail-icon" />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
