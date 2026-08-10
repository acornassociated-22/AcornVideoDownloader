import { useState, type CSSProperties, type FormEvent } from "react";
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
} from "../../components/SocialIcons";
import { useT } from "../../i18n/useT";
import {
  ContactSendError,
  sendContactMessage,
  SUPPORT_EMAIL,
} from "../../lib/contact";
import {
  cardPaymentUrl,
  hasCardCheckout,
  PAYPAL_EMAIL,
  paypalPaymentUrl,
  type DonateChoice,
  type PayMethod,
} from "../../lib/payments";
import { SOCIAL_LINKS } from "../../lib/social";
import { openExternalUrl } from "../../lib/tauri";
import { AndroidBottomSheet } from "../components/AndroidBottomSheet";
import {
  DeckHeader,
  DeckHubStack,
  DeckHubTile,
  DeckToast,
} from "../components/AndroidSettingsUI";

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

type SheetId = "donate" | "social" | "form" | "mail" | null;

const EMAILS = [
  {
    key: "about.emailInfo" as const,
    address: "Info@acornassociated.org",
    icon: "info",
    color: "#033d8c",
  },
  {
    key: "about.emailSales" as const,
    address: "Sales@acornassociated.org",
    icon: "storefront",
    color: "#145425",
  },
  {
    key: "about.emailSupport" as const,
    address: SUPPORT_EMAIL,
    icon: "support_agent",
    color: "#0d9488",
  },
  {
    key: "about.paypal" as const,
    address: PAYPAL_EMAIL,
    icon: "payments",
    color: "#003087",
  },
];

/** Android About — premium settings-style cards + sheets. */
export function AndroidAbout() {
  const t = useT();
  const [sheet, setSheet] = useState<SheetId>(null);
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

  /** Submit contact form. */
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
    try {
      await sendContactMessage({
        name: trimmedName,
        email: trimmedEmail,
        message: trimmedMessage,
      });
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
    <div className="a-stack a-deck-page">
      <DeckHeader title={t("about.title")} subtitle={t("about.sub")} />

      <DeckHubStack>
        <DeckHubTile
          icon="volunteer_activism"
          title={t("about.tab.donate")}
          subtitle={t("about.donateLead")}
          tone="violet"
          delay={30}
          onClick={() => setSheet("donate")}
        />
        <DeckHubTile
          icon="share"
          title={t("about.tab.social")}
          subtitle={t("about.socialOpen")}
          tone="teal"
          delay={60}
          onClick={() => setSheet("social")}
        />
        <DeckHubTile
          icon="mail"
          title={t("about.tab.form")}
          subtitle={t("about.formLead")}
          tone="amber"
          delay={90}
          onClick={() => setSheet("form")}
        />
        <DeckHubTile
          icon="alternate_email"
          title={t("about.tab.mail")}
          subtitle={t("about.mailLead")}
          tone="rose"
          delay={120}
          onClick={() => setSheet("mail")}
        />
      </DeckHubStack>

      <AndroidBottomSheet
        open={sheet === "donate"}
        title={t("about.donateTitle")}
        onClose={() => setSheet(null)}
      >
        <div className="a-stack">
          <p className="a-section-sub">{t("about.donateLead")}</p>
          <div className="a-chips">
            {DONATE_AMOUNTS.map((value) => (
              <button
                key={value}
                type="button"
                className={`a-chip ${amount === value ? "is-active" : ""}`}
                onClick={() => {
                  setAmount(value);
                  setDonateError(null);
                }}
              >
                ${value}
              </button>
            ))}
            <button
              type="button"
              className={`a-chip ${amount === "other" ? "is-active" : ""}`}
              onClick={() => {
                setAmount("other");
                setDonateError(null);
              }}
            >
              {t("about.donateOther")}
            </button>
          </div>
          <div className="a-segment">
            <button
              type="button"
              className={payMethod === "card" ? "is-active" : undefined}
              onClick={() => setPayMethod("card")}
            >
              {t("about.payCard")}
            </button>
            <button
              type="button"
              className={payMethod === "paypal" ? "is-active" : undefined}
              onClick={() => setPayMethod("paypal")}
            >
              {t("about.payPaypal")}
            </button>
          </div>
          {payMethod === "paypal" ? (
            <button
              type="button"
              className="a-btn a-btn-ghost a-btn-block"
              onClick={() => void handleCopyPaypalEmail()}
            >
              {paypalCopied ? t("about.donateCopied") : t("about.donateCopy")}
            </button>
          ) : null}
          <button
            type="button"
            className="a-btn a-btn-block"
            onClick={() => void handlePay()}
            disabled={payMethod === "card" && !cardReady}
          >
            {t("about.payContinue")}
          </button>
          {donateError ? <p className="a-error">{donateError}</p> : null}
        </div>
      </AndroidBottomSheet>

      <AndroidBottomSheet
        open={sheet === "social"}
        title={t("about.socialTitle")}
        onClose={() => setSheet(null)}
        footer={
          <button type="button" className="a-btn a-btn-block" onClick={() => setSheet(null)}>
            {t("settings.langDone")}
          </button>
        }
      >
        <div className="a-sheet-list">
          {SOCIAL_LINKS.map((link) => {
            const Icon = ICONS[link.id as keyof typeof ICONS];
            return (
              <button
                key={link.id}
                type="button"
                className="a-sheet-row"
                style={{ "--social-accent": link.color } as CSSProperties}
                onClick={() => void handleOpen(link.href)}
              >
                <span className="a-icon-well a-icon-well-social">
                  <Icon />
                </span>
                <span className="a-sheet-row-label">{link.label}</span>
                <span className="material-symbols-rounded a-sheet-check">chevron_right</span>
              </button>
            );
          })}
        </div>
      </AndroidBottomSheet>

      <AndroidBottomSheet
        open={sheet === "form"}
        title={t("about.formTitle")}
        onClose={() => setSheet(null)}
      >
        <form className="a-stack" onSubmit={(e) => void handleSubmit(e)}>
          <label className="a-field">
            <span>{t("about.formName")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="a-field">
            <span>{t("about.formEmail")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="a-field">
            <span>{t("about.formMessage")}</span>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="a-btn a-btn-block" disabled={formSending}>
            {formSending ? t("about.formSending") : t("about.formSend")}
          </button>
          {formNotice ? <DeckToast message={formNotice} ok={!formNoticeError} /> : null}
        </form>
      </AndroidBottomSheet>

      <AndroidBottomSheet
        open={sheet === "mail"}
        title={t("about.mailTitle")}
        onClose={() => setSheet(null)}
        footer={
          <button type="button" className="a-btn a-btn-block" onClick={() => setSheet(null)}>
            {t("settings.langDone")}
          </button>
        }
      >
        <div className="a-sheet-list">
          {EMAILS.map((row) => (
            <button
              key={row.address}
              type="button"
              className="a-sheet-row"
              style={{ "--social-accent": row.color } as CSSProperties}
              onClick={() => void handleOpen(`mailto:${row.address}`)}
            >
              <span className="a-icon-well a-icon-well-social">
                <span className="material-symbols-rounded">{row.icon}</span>
              </span>
              <span className="a-sheet-row-text">
                <span className="a-sheet-row-label">{t(row.key)}</span>
                <small className="a-sheet-row-sub">{row.address}</small>
              </span>
              <span className="material-symbols-rounded a-sheet-check">chevron_right</span>
            </button>
          ))}
        </div>
      </AndroidBottomSheet>
    </div>
  );
}
