import type { ReactNode } from "react";

export type GuideStepItem = {
  icon?: string;
  /** Short OEM badge when Material icon is unavailable (e.g. MI). */
  brand?: string;
  brandTone?: "samsung" | "xiaomi" | "huawei";
  title: string;
  body: string;
};

/** Accent intro callout for guide sheets. */
export function AndroidGuideIntro({
  icon = "info",
  children,
}: {
  icon?: string;
  children: ReactNode;
}) {
  return (
    <div className="a-guide-intro">
      <span className="a-guide-intro__icon material-symbols-rounded" aria-hidden="true">
        {icon}
      </span>
      <p className="a-guide-intro__text">{children}</p>
    </div>
  );
}

/** Numbered step list for cookie / setup guides. */
export function AndroidGuideSteps({ steps }: { steps: GuideStepItem[] }) {
  return (
    <ol className="a-guide-steps">
      {steps.map((step, index) => (
        <li key={step.title} className="a-guide-step">
          <span className="a-guide-step__num" aria-hidden="true">
            {index + 1}
          </span>
          <span className="a-icon-well a-guide-step__icon" aria-hidden="true">
            <span className="material-symbols-rounded">{step.icon}</span>
          </span>
          <div className="a-guide-step__copy">
            <strong>{step.title}</strong>
            <p>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** OEM-specific cards for battery optimization paths. */
export function AndroidGuideOemCards({ cards }: { cards: GuideStepItem[] }) {
  return (
    <div className="a-guide-oem-list">
      {cards.map((card) => (
        <article key={card.title} className="a-guide-oem">
          {card.brand ? (
            <span
              className={`a-guide-oem__brand${
                card.brandTone ? ` is-${card.brandTone}` : ""
              }`}
              aria-hidden="true"
            >
              {card.brand}
            </span>
          ) : (
            <span className="a-icon-well a-guide-oem__icon" aria-hidden="true">
              <span className="material-symbols-rounded">{card.icon}</span>
            </span>
          )}
          <div className="a-guide-oem__copy">
            <strong>{card.title}</strong>
            <p>{card.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

/** Closing tip card with accent stripe; optional tap action. */
export function AndroidGuideTip({
  icon,
  title,
  body,
  onClick,
  actionLabel,
}: {
  icon: string;
  title: string;
  body: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const interactive = Boolean(onClick);
  const Tag = interactive ? "button" : "article";

  return (
    <Tag
      type={interactive ? "button" : undefined}
      className={`a-guide-tip${interactive ? " is-action" : ""}`}
      onClick={onClick}
    >
      <span className="a-icon-well a-guide-tip__icon" aria-hidden="true">
        <span className="material-symbols-rounded">{icon}</span>
      </span>
      <div className="a-guide-tip__copy">
        <strong>{title}</strong>
        <p>{body}</p>
        {interactive && actionLabel ? (
          <span className="a-guide-tip__cta">{actionLabel}</span>
        ) : null}
      </div>
    </Tag>
  );
}
