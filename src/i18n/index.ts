import { ar } from "./locales/ar";
import { de } from "./locales/de";
import { en } from "./locales/en";
import { fa } from "./locales/fa";
import { fr } from "./locales/fr";
import { ja } from "./locales/ja";
import { ku } from "./locales/ku";
import { ru } from "./locales/ru";
import { tr } from "./locales/tr";
import { vi } from "./locales/vi";
import { zh } from "./locales/zh";
import type { Locale, MessageKey, Messages } from "./types";

export type { Locale, MessageKey, Messages };

/** All locale dictionaries. */
export const messages: Record<Locale, Messages> = {
  ku,
  tr,
  ar,
  en,
  ru,
  fr,
  fa,
  de,
  vi,
  ja,
  zh,
};

/** Native language labels for the settings picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ku: "Kurmancî",
  tr: "Türkçe",
  ar: "العربية",
  en: "English",
  ru: "Русский",
  fr: "Français",
  fa: "فارسی",
  de: "Deutsch",
  vi: "Tiếng Việt",
  ja: "日本語",
  zh: "中文",
};

/**
 * Flag marker per locale.
 * `kurdish` renders a custom green/yellow/red flag (no emoji available).
 */
export const LOCALE_FLAGS: Record<Locale, string> = {
  ku: "kurdish",
  tr: "🇹🇷",
  ar: "🇸🇦",
  en: "🇬🇧",
  ru: "🇷🇺",
  fr: "🇫🇷",
  fa: "🇮🇷",
  de: "🇩🇪",
  vi: "🇻🇳",
  ja: "🇯🇵",
  zh: "🇨🇳",
};

/** BCP-47 tags for date/number formatting. */
export const LOCALE_TAGS: Record<Locale, string> = {
  ku: "ku",
  tr: "tr-TR",
  ar: "ar",
  en: "en-US",
  ru: "ru-RU",
  fr: "fr-FR",
  fa: "fa-IR",
  de: "de-DE",
  vi: "vi-VN",
  ja: "ja-JP",
  zh: "zh-CN",
};

export const LOCALES = Object.keys(LOCALE_LABELS) as Locale[];

/** Short meta line under each language option (Hejar-style picker). */
export const LOCALE_META: Record<Locale, string> = {
  ku: "Kurmanji · Latin script",
  tr: "Official language of Türkiye",
  ar: "Right-to-left (RTL) layout",
  en: "International UI",
  ru: "Русский интерфейс",
  fr: "Interface française",
  fa: "Right-to-left (RTL) layout",
  de: "Deutsche Oberfläche",
  vi: "Giao diện tiếng Việt",
  ja: "日本語インターフェース",
  zh: "中文界面",
};

/** Whether the locale is right-to-left. */
export function isRtl(locale: Locale): boolean {
  return locale === "ar" || locale === "fa";
}

/** Translate a message key for a locale with optional `{param}` substitution. */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let text = messages[locale]?.[key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
