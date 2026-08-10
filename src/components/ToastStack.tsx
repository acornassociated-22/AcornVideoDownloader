import { useEffect } from "react";
import { useT } from "../i18n/useT";
import {
  useNotificationsStore,
  type ToastItem,
} from "../store/notifications";

const AUTO_DISMISS_MS = 15_000;

/** Popup stack for download success (green) and failure (red) toasts. */
export function ToastStack() {
  const t = useT();
  const toasts = useNotificationsStore((s) => s.toasts);
  const dismiss = useNotificationsStore((s) => s.dismiss);

  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          title={
            toast.kind === "success" ? t("toast.success") : t("toast.error")
          }
          message={
            toast.kind === "success"
              ? t("toast.successMessage")
              : t("toast.errorMessage")
          }
          dismissLabel={t("toast.dismiss")}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}

/** Single animated toast popup with auto-dismiss. */
function ToastCard({
  toast,
  title,
  message,
  dismissLabel,
  onDismiss,
}: {
  toast: ToastItem;
  title: string;
  message: string;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id]);

  const isSuccess = toast.kind === "success";

  return (
    <article
      className={`toast toast-${toast.kind}`}
      role={isSuccess ? "status" : "alert"}
    >
      <span className="toast-icon material-symbols-rounded filled" aria-hidden="true">
        {isSuccess ? "check_circle" : "error"}
      </span>
      <div className="toast-copy">
        <p className="toast-title">{title}</p>
        <p className="toast-message">{message}</p>
      </div>
      <button
        type="button"
        className="toast-close"
        aria-label={dismissLabel}
        onClick={() => onDismiss(toast.id)}
      >
        <span className="material-symbols-rounded">close</span>
      </button>
    </article>
  );
}
