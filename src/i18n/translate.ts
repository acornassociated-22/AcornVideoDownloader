import { useSettingsStore } from "../store/settings";
import { t, type MessageKey } from "./index";

/** Translate using the current persisted locale (for non-React call sites). */
export function translate(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return t(useSettingsStore.getState().locale, key, params);
}
