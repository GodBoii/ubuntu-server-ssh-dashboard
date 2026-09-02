import { useCallback, useEffect, useRef, useState } from "react";
import { readMotionMs } from "../lib/motion";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export type Overlay = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** False for the first paint and while closing, so CSS can play both directions. */
  open: boolean;
  requestClose: () => void;
};

/**
 * Shared behaviour for the confirm dialog, command palette and shortcut sheet:
 * enter and exit transitions, escape to dismiss, a real focus trap, and focus
 * handed back to whatever opened the overlay.
 */
export function useOverlay({ onClose, locked = false }: { onClose: () => void; locked?: boolean }): Overlay {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => {
      cancelAnimationFrame(frame);
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const requestClose = useCallback(() => {
    if (locked || closing.current) return;
    closing.current = true;
    setOpen(false);
    const delay = readMotionMs("--t-fast", 120);
    window.setTimeout(() => closeRef.current(), delay);
  }, [locked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [requestClose]);

  return { containerRef, open, requestClose };
}
