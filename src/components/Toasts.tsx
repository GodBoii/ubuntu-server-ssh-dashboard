import { X } from "lucide-react";
import type { Toast, ToastTone } from "../hooks/useToasts";

const lampFor: Record<ToastTone, string> = { success: "ok", error: "fail", info: "info" };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${lampFor[toast.tone]}`}
          data-open={!toast.leaving}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span className={`lamp ${toast.tone === "error" ? "fail" : toast.tone === "info" ? "live" : "ok"}`} aria-hidden="true" />
          <p>{toast.message}</p>
          <button type="button" className="act" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
