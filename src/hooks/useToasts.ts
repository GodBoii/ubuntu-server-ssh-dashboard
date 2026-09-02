import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ToastTone = "success" | "error" | "info";

export type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  /** Set while the exit transition plays so the DOM node can animate out. */
  leaving: boolean;
};

export type ToastController = {
  toasts: Toast[];
  notify: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
};

const visibleLimit = 3;
const holdMs = { success: 3_600, info: 4_200, error: 6_500 } as const;
const exitMs = 260;

export function useToasts(): ToastController {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    clearTimer(id);
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
    const removal = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      timers.current.delete(-id);
    }, exitMs);
    timers.current.set(-id, removal);
  }, [clearTimer]);

  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => {
      const next = [...current.filter((toast) => !toast.leaving), { id, tone, message, leaving: false }];
      return next.slice(-visibleLimit);
    });
    const timer = window.setTimeout(() => dismiss(id), holdMs[tone]);
    timers.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  return useMemo(() => ({ toasts, notify, dismiss }), [dismiss, notify, toasts]);
}
