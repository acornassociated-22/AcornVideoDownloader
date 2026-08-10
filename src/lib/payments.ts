/** Personal PayPal inbox (Send Money / PayPal.Me). */
export const PAYPAL_EMAIL = "acornassociatedorg@gmail.com";

/**
 * PayPal.Me username only (no @, no URL).
 * Example: "AcornAssociated" → paypal.me/AcornAssociated
 */
export const PAYPAL_ME = "";

/**
 * Stripe Payment Links for card checkout (guest can pay without a PayPal account).
 * Create at https://dashboard.stripe.com/payment-links — one link per amount,
 * plus an optional “customer chooses amount” link for Other.
 */
export const CARD_PAYMENT_LINKS: {
  5?: string;
  10?: string;
  100?: string;
  /** Adjustable-amount Payment Link used for custom / fallback. */
  other?: string;
} = {
  5: "https://donate.stripe.com/test_6oU6oH2ac2dpaOl9uRfQI00",
  10: "https://donate.stripe.com/test_5kQ28r168dW71dLgXjfQI01",
  100: "https://donate.stripe.com/test_14A6oH6qs7xJbSp9uRfQI03",
  other: "https://donate.stripe.com/test_3cI4gzg1219lcWtfTffQI02",
};

export type PayMethod = "card" | "paypal";
export type DonateChoice = 5 | 10 | 100 | "other";

/** Resolve a Stripe Payment Link for a preset amount or the Other (customer-amount) link. */
export function cardPaymentUrl(choice: DonateChoice): string | null {
  if (choice === "other") {
    return CARD_PAYMENT_LINKS.other?.trim() || null;
  }
  const byAmount =
    choice === 5
      ? CARD_PAYMENT_LINKS[5]
      : choice === 10
        ? CARD_PAYMENT_LINKS[10]
        : CARD_PAYMENT_LINKS[100];
  const href = (byAmount || CARD_PAYMENT_LINKS.other || "").trim();
  return href || null;
}

/**
 * Build a personal PayPal Send Money / PayPal.Me URL (USD).
 * Merchant buttons fail on personal accounts.
 * Pass null for Other — recipient opens PayPal and chooses the amount there.
 */
export function paypalPaymentUrl(amount: number | null): string {
  const me = PAYPAL_ME.trim();
  if (me) {
    if (amount == null) {
      return `https://www.paypal.com/paypalme/${encodeURIComponent(me)}`;
    }
    const rounded = Math.round(amount * 100) / 100;
    return `https://www.paypal.com/paypalme/${encodeURIComponent(me)}/${rounded}`;
  }

  const params = new URLSearchParams({
    recipient: PAYPAL_EMAIL,
    currencyCode: "USD",
    note: "Acorn Associated support",
  });
  if (amount != null) {
    params.set("amount", String(Math.round(amount * 100) / 100));
  }
  return `https://www.paypal.com/myaccount/transfer/send/?${params.toString()}`;
}

/** Whether any card Payment Link is configured. */
export function hasCardCheckout(): boolean {
  return Boolean(
    CARD_PAYMENT_LINKS[5]?.trim() ||
      CARD_PAYMENT_LINKS[10]?.trim() ||
      CARD_PAYMENT_LINKS[100]?.trim() ||
      CARD_PAYMENT_LINKS.other?.trim(),
  );
}
