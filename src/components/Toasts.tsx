import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import type { Toast, ToastTone } from "../hooks/useToasts";

const toneClass: Record<ToastTone, string> = { success: "ok", error: "fail", info: "info" };
const toneIcon = { success: CircleCheck, error: CircleAlert, info: Info } as const;

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => {
        const Icon = toneIcon[toast.tone];
        return (
          <div
            key={toast.id}
            className={`toast ${toneClass[toast.tone]}`}
            data-open={!toast.leaving}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <span className="toast-icon" aria-hidden="true">
              <Icon size={15} strokeWidth={2} />
            </span>
            <p>{toast.message}</p>
            <button type="button" className="act" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
              <X size={13} />
            </button>
            {/* Drains over the same hold time useToasts uses before dismissing. */}
            <i className="toast-timer" aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}
