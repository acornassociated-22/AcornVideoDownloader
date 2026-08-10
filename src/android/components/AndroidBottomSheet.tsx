import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** Hejar-style slide-up bottom sheet with scrim. */
export function AndroidBottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Double rAF: paint closed translateY(100%) before is-open (WebView skips otherwise).
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    /** Close sheet on Escape. */
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={`a-overlay ${visible ? "is-open" : ""}`} role="presentation">
      <button
        type="button"
        className="a-scrim"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`a-sheet ${visible ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="a-sheet-handle" aria-hidden="true" />
        <h2 className="a-sheet-title">{title}</h2>
        <div className="a-sheet-body">{children}</div>
        {footer ? <div className="a-sheet-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
