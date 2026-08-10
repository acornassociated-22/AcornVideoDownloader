/**
 * Contact form → Support inbox via Web3Forms (client-side HTTP POST).
 * FormSubmit was abandoned: its API keeps returning “needs Activation” even with the hash.
 * Access keys are public by design (alias for the inbox). Create one at https://web3forms.com
 */

/** Destination inbox for Contact Form display / mail cards. */
export const SUPPORT_EMAIL = "Support@acornassociated.org";

/**
 * Web3Forms access key for Support@acornassociated.org.
 * Create at https://web3forms.com (enter Support email) → copy key from the email.
 */
export const WEB3FORMS_ACCESS_KEY = "3ffb0230-9f18-4cf4-bdac-86591f933bee";

/** Fixed subject line for Contact Form emails. */
export const CONTACT_SUBJECT = "Acorn Video Downloader";

export type ContactPayload = {
  name: string;
  email: string;
  message: string;
};

export class ContactSendError extends Error {
  readonly code?: "SETUP_REQUIRED";

  constructor(message: string, code?: "SETUP_REQUIRED") {
    super(message);
    this.name = "ContactSendError";
    this.code = code;
  }
}

/**
 * Send a contact message to Support via Web3Forms (no mail client).
 * Uses WebView fetch — Web3Forms free plan rejects server-side calls.
 */
export async function sendContactMessage(payload: ContactPayload): Promise<void> {
  const name = payload.name.trim();
  const email = payload.email.trim();
  const message = payload.message.trim();
  if (!name || !email || !message) {
    throw new ContactSendError("Please fill in all fields.");
  }

  const accessKey = WEB3FORMS_ACCESS_KEY.trim();
  if (!accessKey) {
    throw new ContactSendError("SETUP_REQUIRED", "SETUP_REQUIRED");
  }

  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      access_key: accessKey,
      subject: CONTACT_SUBJECT,
      from_name: "Acorn Video Downloader",
      name,
      email,
      message,
      replyto: email,
      botcheck: false,
    }),
  });

  let data: { success?: boolean | string; message?: string } = {};
  try {
    data = (await response.json()) as typeof data;
  } catch {
    data = {};
  }

  const ok =
    response.ok &&
    (data.success === true || data.success === "true" || data.success === "True");

  if (!ok) {
    throw new ContactSendError(
      data.message || `Contact send failed (${response.status})`,
    );
  }
}
