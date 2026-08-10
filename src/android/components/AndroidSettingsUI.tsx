import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useT } from "../../i18n/useT";
import { checkBinaries } from "../../lib/tauri";
import type { BinaryCheck } from "../../types";

/** Page header with optional live summary badges. */
export function DeckHeader({
  title,
  subtitle,
  badges,
}: {
  title: string;
  subtitle: string;
  badges?: ReactNode;
}) {
  return (
    <header className="a-deck-header">
      <h1 className="a-greeting">{title}</h1>
      <p className="a-deck-header__sub">{subtitle}</p>
      {badges ? <div className="a-deck-badges">{badges}</div> : null}
    </header>
  );
}

/** Grouped settings panel with accent rail. */
export function DeckModule({
  label,
  children,
  delay = 0,
  action,
}: {
  label: string;
  children: ReactNode;
  delay?: number;
  action?: ReactNode;
}) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };

  return (
    <section className="a-deck-module" style={style}>
      <div className="a-deck-module__head">
        <p className="a-section-label">{label}</p>
        {action}
      </div>
      <div className="a-deck-module__body">{children}</div>
    </section>
  );
}

/** Inline field label inside a deck module. */
export function DeckFieldLabel({ children }: { children: ReactNode }) {
  return <p className="a-deck-field-label">{children}</p>;
}

/** Three-way theme picker with mini UI previews. */
export function DeckThemePicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; tone: "system" | "light" | "dark"; icon: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="a-deck-theme" role="radiogroup">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={[
              "a-deck-theme__btn",
              `a-deck-theme__btn--${option.tone}`,
              active ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(option.value)}
          >
            <span className="a-deck-theme__frame">
              <span className={`a-deck-theme__preview is-${option.tone}`} aria-hidden="true">
                <span className="a-deck-theme__preview-bar" />
                <span className="a-deck-theme__preview-dot" />
              </span>
              <span className="a-deck-theme__glyph material-symbols-rounded">{option.icon}</span>
            </span>
            <span className="a-deck-theme__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal locale picker with flag chips. */
export function DeckLocalePicker<T extends string>({
  locales,
  value,
  onChange,
  renderFlag,
  renderLabel,
}: {
  locales: T[];
  value: T;
  onChange: (value: T) => void;
  renderFlag: (code: T) => ReactNode;
  renderLabel: (code: T) => string;
}) {
  return (
    <div className="a-deck-locale-scroll" role="listbox" aria-label="Language">
      {locales.map((code) => {
        const active = value === code;
        return (
          <button
            key={code}
            type="button"
            role="option"
            aria-selected={active}
            className={`a-deck-locale ${active ? "is-active" : ""}`}
            onClick={() => onChange(code)}
            title={renderLabel(code)}
          >
            <span className="a-deck-locale__flag">{renderFlag(code)}</span>
            <span className="a-deck-locale__code">{renderLabel(code)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Visual feature toggle with media preview mockup. */
export function DeckFeatureToggle({
  kind,
  title,
  checked,
  onChange,
}: {
  kind: "thumb" | "subs";
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`a-deck-feature is-${kind} ${checked ? "is-on" : ""}`}>
      <span className="a-deck-feature__preview" aria-hidden="true">
        <span className="a-deck-feature__screen">
          {kind === "thumb" ? (
            <>
              <span className="a-deck-feature__thumb-art" />
              <span className="material-symbols-rounded a-deck-feature__thumb-icon">image</span>
            </>
          ) : (
            <>
              <span className="a-deck-feature__subs-line" />
              <span className="a-deck-feature__subs-line is-short" />
            </>
          )}
        </span>
        <span className={`a-deck-feature__status ${checked ? "is-on" : ""}`} />
      </span>
      <span className="a-deck-feature__body">
        <strong>{title}</strong>
        <span className="a-switch">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="a-switch-track" />
        </span>
      </span>
    </label>
  );
}

/** Pair of download extra feature toggles. */
export function DeckFeaturePair({
  thumbTitle,
  subsTitle,
  thumbChecked,
  subsChecked,
  onThumbChange,
  onSubsChange,
}: {
  thumbTitle: string;
  subsTitle: string;
  thumbChecked: boolean;
  subsChecked: boolean;
  onThumbChange: (checked: boolean) => void;
  onSubsChange: (checked: boolean) => void;
}) {
  return (
    <div className="a-deck-features">
      <DeckFeatureToggle
        kind="thumb"
        title={thumbTitle}
        checked={thumbChecked}
        onChange={onThumbChange}
      />
      <DeckFeatureToggle
        kind="subs"
        title={subsTitle}
        checked={subsChecked}
        onChange={onSubsChange}
      />
    </div>
  );
}

/** Full-width storage / path row. */
export function DeckStorageRow({
  icon,
  title,
  path,
  onClick,
}: {
  icon: string;
  title: string;
  path: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="a-deck-storage" onClick={onClick}>
      <span className="a-deck-storage__icon material-symbols-rounded">{icon}</span>
      <span className="a-deck-storage__copy">
        <strong>{title}</strong>
        <small>{path}</small>
      </span>
      <span className="material-symbols-rounded a-chevron">chevron_right</span>
    </button>
  );
}

/** Full-width single action (legacy toolbar). */
export function DeckActionBar({
  icon,
  label,
  onClick,
  variant = "replay",
  disabled = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: "replay" | "folder" | "dismiss";
  disabled?: boolean;
}) {
  return (
    <div className="a-history-toolbar a-deck-toolbar a-queue-toolbar--1" role="toolbar">
      <button
        type="button"
        className={`a-history-tool a-history-tool--${variant}`}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="a-history-tool__icon material-symbols-rounded">{icon}</span>
        <span className="a-history-tool__label">{label}</span>
      </button>
    </div>
  );
}

export type DeckActionGridItem = {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

/** 2-column action tile grid for settings modules. */
export function DeckActionGrid({ items }: { items: DeckActionGridItem[] }) {
  return (
    <div className="a-deck-action-grid" role="toolbar" aria-label="Actions">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className="a-deck-action-tile"
          disabled={item.disabled}
          onClick={item.onClick}
        >
          <span className="a-deck-action-tile__icon material-symbols-rounded" aria-hidden="true">
            {item.icon}
          </span>
          <span className="a-deck-action-tile__label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Hub navigation tile for About actions. */
export function DeckHubTile({
  icon,
  title,
  subtitle,
  tone = "violet",
  onClick,
  delay = 0,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tone?: "violet" | "teal" | "amber" | "rose";
  onClick: () => void;
  delay?: number;
}) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };

  return (
    <button
      type="button"
      className={`a-deck-tile is-${tone}`}
      style={style}
      onClick={onClick}
    >
      <span className="a-deck-tile__icon material-symbols-rounded">{icon}</span>
      <span className="a-deck-tile__copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <span className="material-symbols-rounded a-deck-tile__chevron">north_east</span>
    </button>
  );
}

/** Compact engine readiness strip for Settings footer. */
export function DeckEngineModule({ delay = 150 }: { delay?: number }) {
  const t = useT();
  const [engine, setEngine] = useState<BinaryCheck | null>(null);
  const style: CSSProperties = { animationDelay: `${delay}ms` };

  useEffect(() => {
    let cancelled = false;
    void checkBinaries()
      .then((info) => {
        if (!cancelled) setEngine(info);
      })
      .catch(() => {
        if (!cancelled) setEngine(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ytdlpReady = !!engine?.ytdlp && !engine?.ytdlpError;
  const ffmpegReady = !!engine?.ffmpegReady;
  const readyLabel = t("about.engineReady");
  const notReadyLabel = t("about.engineNotReady");

  return (
    <div className="a-deck-engine" style={style} aria-label={t("about.engineTitle")}>
      <span className="a-deck-engine__item">
        <strong>yt-dlp</strong>
        <span className={ytdlpReady ? "is-ready" : "is-warn"}>
          {ytdlpReady ? readyLabel : notReadyLabel}
        </span>
      </span>
      <span className="a-deck-engine__sep" aria-hidden="true" />
      <span className="a-deck-engine__item">
        <strong>FFmpeg</strong>
        <span className={ffmpegReady ? "is-ready" : "is-warn"}>
          {ffmpegReady ? readyLabel : notReadyLabel}
        </span>
      </span>
    </div>
  );
}

/** Vertical stack wrapper for full-width hub tiles. */
export function DeckHubStack({ children }: { children: ReactNode }) {
  return <div className="a-deck-stack">{children}</div>;
}

/** Inline feedback banner. */
export function DeckToast({ message, ok }: { message: string; ok: boolean }) {
  return (
    <p className={`a-deck-toast ${ok ? "is-ok" : "is-warn"}`} role="status">
      <span className="material-symbols-rounded a-deck-toast__icon" aria-hidden="true">
        {ok ? "check_circle" : "error"}
      </span>
      {message}
    </p>
  );
}
