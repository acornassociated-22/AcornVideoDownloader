import { useState, type FormEvent } from "react";
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
} from "../components/SocialIcons";
import type { MessageKey } from "../i18n/types";
import { useT } from "../i18n/useT";
import {
  ContactSendError,
  sendContactMessage,
  SUPPORT_EMAIL,
} from "../lib/contact";
import {
  cardPaymentUrl,
  hasCardCheckout,
  PAYPAL_EMAIL,
  paypalPaymentUrl,
  type DonateChoice,
  type PayMethod,
} from "../lib/payments";
import { SOCIAL_LINKS } from "../lib/social";
import { openExternalUrl } from "../lib/tauri";

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

const DONATE_AMOUNTS = [5, 10, 100] as const;

type AboutTab = "donate" | "social" | "form" | "mail";

const TABS: { id: AboutTab; labelKey: MessageKey; icon: string }[] = [
  { id: "donate", labelKey: "about.tab.donate", icon: "volunteer_activism" },
  { id: "social", labelKey: "about.tab.social", icon: "share" },
  { id: "form", labelKey: "about.tab.form", icon: "mail" },
  { id: "mail", labelKey: "about.tab.mail", icon: "alternate_email" },
];

const EMAILS = [
  {
    key: "about.emailInfo" as const,
    address: "Info@acornassociated.org",
    icon: "info",
  },
  {
    key: "about.emailSales" as const,
    address: "Sales@acornassociated.org",
    icon: "storefront",
  },
  {
    key: "about.emailSupport" as const,
    address: SUPPORT_EMAIL,
    icon: "support_agent",
  },
  {
    key: "about.paypal" as const,
    address: PAYPAL_EMAIL,
    icon: "payments",
  },
];

/** About page with segment tabs and premium panel content. */
export function About() {
  const t = useT();
  const [tab, setTab] = useState<AboutTab>("donate");
  const [amount, setAmount] = useState<DonateChoice>(5);
  const [payMethod, setPayMethod] = useState<PayMethod>(
    hasCardCheckout() ? "card" : "paypal",
  );
  const [donateError, setDonateError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [formNoticeError, setFormNoticeError] = useState(false);
  const [formSending, setFormSending] = useState(false);
  const [paypalCopied, setPaypalCopied] = useState(false);
  const cardReady = hasCardCheckout();

  /** Open an external URL via the system handler (browser, mail app, etc.). */
  function handleOpen(href: string) {
    return openExternalUrl(href);
  }

  /** Copy the personal PayPal email for manual Send Money. */
  async function handleCopyPaypalEmail() {
    try {
      await navigator.clipboard.writeText(PAYPAL_EMAIL);
      setPaypalCopied(true);
      window.setTimeout(() => setPaypalCopied(false), 2000);
    } catch {
      setDonateError(PAYPAL_EMAIL);
    }
  }

  /** Continue to card checkout or personal PayPal Send Money. */
  async function handlePay() {
    setDonateError(null);

    if (payMethod === "card") {
      const href = cardPaymentUrl(amount);
      if (!href) {
        setDonateError(t("about.payCardMissing"));
        return;
      }
      await handleOpen(href);
      return;
    }

    await handleOpen(paypalPaymentUrl(amount === "other" ? null : amount));
  }

  /** Submit contact form; delivers name/email/message to Support automatically. */
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      setFormNoticeError(true);
      setFormNotice(t("about.formRequired"));
      return;
    }

    setFormSending(true);
    setFormNotice(null);
    setFormNoticeError(false);
    const payload = {
      name: trimmedName,
      email: trimmedEmail,
      message: trimmedMessage,
    };
    try {
      await sendContactMessage(payload);
      setName("");
      setEmail("");
      setMessage("");
      setFormNoticeError(false);
      setFormNotice(t("about.formThanks"));
    } catch (error) {
      setFormNoticeError(true);
      const setup =
        error instanceof ContactSendError && error.code === "SETUP_REQUIRED";
      setFormNotice(setup ? t("about.formActivate") : t("about.formError"));
    } finally {
      setFormSending(false);
    }
  }

  return (
    <div className="about">
      <header className="page-head">
        <div>
          <h1>{t("about.title")}</h1>
          <p className="section-sub">{t("about.sub")}</p>
        </div>
      </header>

      <div className="about-shell panel soft-panel">
        <div className="about-tabs-wrap">
          <div
            className="settings-segment about-segment"
            role="tablist"
            aria-label={t("about.title")}
          >
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`about-tab-${item.id}`}
                  aria-selected={active}
                  aria-controls={`about-panel-${item.id}`}
                  className={`settings-segment-btn ${active ? "is-active" : ""}`}
                  onClick={() => setTab(item.id)}
                >
                  <span className="material-symbols-rounded">{item.icon}</span>
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="about-panels">
          {tab === "donate" ? (
            <section
              className="about-panel"
              role="tabpanel"
              id="about-panel-donate"
              aria-labelledby="about-tab-donate"
            >
              <div className="about-pay-card">
                <div className="about-pay-card-head">
                  <span className="about-pay-badge" aria-hidden="true">
                    <span className="material-symbols-rounded">credit_card</span>
                  </span>
                  <div>
                    <h2 className="about-panel-title">{t("about.donateTitle")}</h2>
                    <p className="about-panel-sub">{t("about.donateLead")}</p>
                  </div>
                </div>

                <div className="about-pay-block">
                  <p className="about-field-label">{t("about.payAmount")}</p>
                  <div className="about-donate" role="group" aria-label={t("about.payAmount")}>
                    {DONATE_AMOUNTS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`about-amount ${amount === value ? "is-active" : ""}`}
                        onClick={() => {
                          setAmount(value);
                          setDonateError(null);
                        }}
                      >
                        <strong>${value}</strong>
                        <span>USD</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`about-amount ${amount === "other" ? "is-active" : ""}`}
                      onClick={() => {
                        setAmount("other");
                        setDonateError(null);
                      }}
                    >
                      <strong>{t("about.donateOther")}</strong>
                      <span>USD</span>
                    </button>
                  </div>
                </div>

                <div className="about-pay-block">
                  <p className="about-field-label">{t("about.payMethod")}</p>
                  <div
                    className="settings-segment about-pay-segment"
                    role="group"
                    aria-label={t("about.payMethod")}
                  >
                    <button
                      type="button"
                      className={`settings-segment-btn ${payMethod === "card" ? "is-active" : ""}`}
                      onClick={() => {
                        setPayMethod("card");
                        setDonateError(null);
                      }}
                    >
                      <span className="material-symbols-rounded">credit_card</span>
                      <span>{t("about.payCard")}</span>
                      <small>{t("about.payCardHint")}</small>
                    </button>
                    <button
                      type="button"
                      className={`settings-segment-btn ${payMethod === "paypal" ? "is-active" : ""}`}
                      onClick={() => {
                        setPayMethod("paypal");
                        setDonateError(null);
                      }}
                    >
                      <span className="material-symbols-rounded">account_balance_wallet</span>
                      <span>{t("about.payPaypal")}</span>
                      <small>{t("about.payPaypalHint")}</small>
                    </button>
                  </div>
                </div>

                {payMethod === "paypal" ? (
                  <p className="about-paypal-line">
                    <span className="material-symbols-rounded" aria-hidden="true">
                      payments
                    </span>
                    <span className="about-paypal-email">{PAYPAL_EMAIL}</span>
                    <button
                      type="button"
                      className="btn btn-ghost about-paypal-copy"
                      onClick={() => void handleCopyPaypalEmail()}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        {paypalCopied ? "check" : "content_copy"}
                      </span>
                      {paypalCopied ? t("about.donateCopied") : t("about.donateCopy")}
                    </button>
                  </p>
                ) : null}

                {!cardReady && payMethod === "card" ? (
                  <p className="about-notice about-notice-error">{t("about.payCardMissing")}</p>
                ) : null}

                <div className="about-pay-actions">
                  <button
                    type="button"
                    className="btn btn-primary about-pay-cta"
                    onClick={() => void handlePay()}
                    disabled={payMethod === "card" && !cardReady}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      lock
                    </span>
                    {t("about.payContinue")}
                  </button>
                </div>

                {donateError ? (
                  <p className="about-notice about-notice-error">{donateError}</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {tab === "social" ? (
            <section
              className="about-panel"
              role="tabpanel"
              id="about-panel-social"
              aria-labelledby="about-tab-social"
            >
              <h2 className="about-panel-title">{t("about.socialTitle")}</h2>
              <p className="about-panel-sub">{t("social.tagline")}</p>
              <ul className="about-social-cards" aria-label={t("social.aria")}>
                {SOCIAL_LINKS.map((link) => {
                  const Icon = ICONS[link.id as keyof typeof ICONS];
                  return (
                    <li key={link.id}>
                      <button
                        type="button"
                        className="about-social-card"
                        style={{ ["--social-accent" as string]: link.color }}
                        onClick={() => void handleOpen(link.href)}
                      >
                        <span className="about-social-card-mark" aria-hidden="true">
                          <Icon className="about-social-icon" />
                        </span>
                        <span className="about-social-card-copy">
                          <strong>{link.label}</strong>
                          <small>{t("about.socialOpen")}</small>
                        </span>
                        <span
                          className="material-symbols-rounded about-social-card-arrow"
                          aria-hidden="true"
                        >
                          north_east
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {tab === "form" ? (
            <section
              className="about-panel"
              role="tabpanel"
              id="about-panel-form"
              aria-labelledby="about-tab-form"
            >
              <div className="about-form-card">
                <div className="about-form-card-head">
                  <span className="about-form-badge" aria-hidden="true">
                    <span className="material-symbols-rounded">mail</span>
                  </span>
                  <div>
                    <h2 className="about-panel-title">{t("about.formTitle")}</h2>
                    <p className="about-panel-sub">{t("about.formLead")}</p>
                  </div>
                </div>
                <form className="about-form" onSubmit={(e) => void handleSubmit(e)}>
                  <div className="about-form-grid">
                    <label className="about-field">
                      <span className="about-field-label">{t("about.formName")}</span>
                      <input
                        className="about-input"
                        type="text"
                        name="name"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </label>
                    <label className="about-field">
                      <span className="about-field-label">{t("about.formEmail")}</span>
                      <input
                        className="about-input"
                        type="email"
                        name="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  <label className="about-field">
                    <span className="about-field-label">{t("about.formMessage")}</span>
                    <textarea
                      className="about-input about-textarea"
                      name="message"
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                    />
                  </label>
                  <div className="about-form-actions">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={formSending}
                    >
                      {formSending ? t("about.formSending") : t("about.formSend")}
                    </button>
                    {formNotice ? (
                      <p
                        className={`about-notice ${formNoticeError ? "about-notice-error" : ""}`}
                      >
                        {formNotice}
                      </p>
                    ) : null}
                  </div>
                </form>
              </div>
            </section>
          ) : null}

          {tab === "mail" ? (
            <section
              className="about-panel"
              role="tabpanel"
              id="about-panel-mail"
              aria-labelledby="about-tab-mail"
            >
              <h2 className="about-panel-title">{t("about.mailTitle")}</h2>
              <p className="about-panel-sub">{t("about.mailLead")}</p>
              <ul className="about-mail-cards">
                {EMAILS.map((row) => (
                  <li key={row.address}>
                    <button
                      type="button"
                      className="about-mail-card"
                      onClick={() => void handleOpen(`mailto:${row.address}`)}
                    >
                      <span className="about-mail-card-icon" aria-hidden="true">
                        <span className="material-symbols-rounded">{row.icon}</span>
                      </span>
                      <span className="about-mail-card-copy">
                        <strong>{t(row.key)}</strong>
                        <small>{row.address}</small>
                      </span>
                      <span className="about-mail-card-cta">
                        {t("about.mailAction")}
                        <span className="material-symbols-rounded" aria-hidden="true">
                          arrow_forward
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
