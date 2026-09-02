import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useOverlay } from "../hooks/useOverlay";
import { Act, Btn } from "./kit";

export type ConfirmRequest = {
  title: string;
  detail: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  /** Concrete consequences, listed so nothing has to be guessed. */
  effects?: string[];
  onConfirm: () => Promise<void>;
};

export function ConfirmDialog({ request, busy, onClose }: { request: ConfirmRequest; busy: boolean; onClose: () => void }) {
  const { containerRef, open, requestClose } = useOverlay({ onClose, locked: busy });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const danger = request.tone === "danger";

  // Destructive actions land on Cancel, so a stray Enter cannot stop a stack.
  useEffect(() => {
    (danger ? cancelRef.current : confirmRef.current)?.focus({ preventScroll: true });
  }, [danger]);

  return (
    <div
      className="veil centre"
      data-open={open}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className={`sheet-surface ask${danger ? " danger" : ""}`}
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        aria-describedby="ask-detail"
        ref={containerRef}
      >
        <header className="sheet-head">
          <h2 id="ask-title">{request.title}</h2>
          <Act label="Close" icon={<X size={14} />} onClick={requestClose} disabled={busy} />
        </header>

        <div className="ask-body">
          <p id="ask-detail">{request.detail}</p>
          {request.effects && request.effects.length > 0 && (
            <ul className="ask-effects">
              {request.effects.map((effect) => <li key={effect}>{effect}</li>)}
            </ul>
          )}
        </div>

        <footer className="ask-foot">
          <Btn ref={cancelRef} variant="quiet" onClick={requestClose} disabled={busy}>Cancel</Btn>
          <Btn
            ref={confirmRef}
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={() => void request.onConfirm()}
          >
            {busy ? "Working" : request.confirmLabel}
          </Btn>
        </footer>
      </div>
    </div>
  );
}
