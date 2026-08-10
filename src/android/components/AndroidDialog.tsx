import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Hejar-style centered spring dialog with semantic icon well. */
export function AndroidDialog({
  open,
  title,
  message,
  icon = "warning",
  tone = "danger",
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message?: string;
  icon?: string;
  tone?: "danger" | "primary" | "accent";
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    /** Close dialog on Escape. */
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mounted, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div className={`a-overlay a-overlay-center ${visible ? "is-open" : ""}`} role="presentation">
      <button
        type="button"
        className="a-scrim a-scrim-deep"
        aria-label="Close"
        onClick={onCancel}
      />
      <div
        className={`a-dialog ${visible ? "is-open" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="a-dialog-title"
        aria-describedby={message ? "a-dialog-msg" : undefined}
      >
        <div className={`a-dialog-icon is-${tone}`} aria-hidden="true">
          <span className="material-symbols-rounded">{icon}</span>
        </div>
        <h2 id="a-dialog-title" className="a-dialog-title">
          {title}
        </h2>
        {message ? (
          <p id="a-dialog-msg" className="a-dialog-msg">
            {message}
          </p>
        ) : null}
        <div className="a-dialog-actions">
          <button type="button" className="a-btn a-btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`a-btn ${tone === "danger" ? "a-btn-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
