import { useCallback } from "react";
import { useSettingsStore } from "../store/settings";
import { t, type MessageKey } from "./index";

/** Hook returning a translator bound to the current settings locale. */
export function useT() {
  const locale = useSettingsStore((s) => s.locale);

  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) =>
      t(locale, key, params),
    [locale],
  );
}
