import { useState, type KeyboardEvent } from "react";
import { useT } from "../i18n/useT";
import { readClipboard } from "../lib/tauri";

/** URL field: paste from clipboard and immediately fetch metadata. */
export function UrlBar({
  value,
  loading,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (url?: string) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [pasteError, setPasteError] = useState(false);

  /** Handle Enter to fetch the typed URL. */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !loading && value.trim()) onSubmit();
  }

  /** Paste clipboard text into the field and fetch metadata. */
  async function handlePasteAndFetch() {
    setPasteError(false);
    try {
      const text = (await readClipboard()).trim();
      if (!text) {
        setPasteError(true);
        window.setTimeout(() => setPasteError(false), 1800);
        return;
      }
      onChange(text);
      onSubmit(text);
    } catch {
      setPasteError(true);
      window.setTimeout(() => setPasteError(false), 1800);
    }
  }

  return (
    <div className="url-bar animate-rise-in" style={{ animationDelay: "120ms" }}>
      <input
        type="url"
        placeholder={t("url.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={t("url.aria")}
        disabled={loading}
        autoFocus
      />
      {loading ? (
        <button type="button" className="btn btn-danger" onClick={onCancel}>
          {t("url.cancel")}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handlePasteAndFetch()}
          title={pasteError ? t("url.pasteTitleError") : t("url.pasteTitle")}
        >
          {pasteError ? t("url.pasteError") : t("url.paste")}
        </button>
      )}
    </div>
  );
}
