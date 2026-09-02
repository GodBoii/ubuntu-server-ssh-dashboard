import { useCallback, useEffect, useRef, useState } from "react";

export type LogLevel = "error" | "warn" | "info" | "debug" | "plain";

export type LogLine = {
  id: number;
  /** Docker's `--timestamps` prefix, split out so the gutter can align. */
  time: string | null;
  text: string;
  level: LogLevel;
};

export type LogStreamState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "streaming" }
  | { kind: "closed"; message: string };

const errorPattern = /\b(error|fatal|critical|exception|panic|traceback)\b/i;
const warnPattern = /\b(warn|warning|deprecated|retry|retrying)\b/i;
const infoPattern = /\b(info|started|listening|ready|connected)\b/i;
const debugPattern = /\b(debug|trace|verbose)\b/i;
const timestampPattern = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s(.*)$/;

function classify(text: string): LogLevel {
  if (errorPattern.test(text)) return "error";
  if (warnPattern.test(text)) return "warn";
  if (debugPattern.test(text)) return "debug";
  if (infoPattern.test(text)) return "info";
  return "plain";
}

function parseLine(raw: string, id: number): LogLine {
  const match = timestampPattern.exec(raw);
  const time = match?.[1] ?? null;
  const text = match?.[2] ?? raw;
  return { id, time: time ? time.slice(11, 19) : null, text, level: classify(text) };
}

function readMessage(raw: unknown): { type: string; data?: string; message?: string; code?: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const type = Reflect.get(raw, "type");
  if (typeof type !== "string") return null;
  const data = Reflect.get(raw, "data");
  const message = Reflect.get(raw, "message");
  const code = Reflect.get(raw, "code");
  return {
    type,
    data: typeof data === "string" ? data : undefined,
    message: typeof message === "string" ? message : undefined,
    code: typeof code === "number" ? code : undefined,
  };
}

const reconnectDelaysMs = [1_500, 3_000, 6_000, 12_000];

export function useLogStream({
  container,
  token,
  tail,
  paused,
  limit = 4000,
}: {
  container: string;
  token: string;
  tail: number;
  paused: boolean;
  limit?: number;
}): { state: LogStreamState; lines: LogLine[]; buffered: number; clear: () => void; reconnect: () => void } {
  const [state, setState] = useState<LogStreamState>({ kind: "idle" });
  const [lines, setLines] = useState<LogLine[]>([]);
  const [buffered, setBuffered] = useState(0);
  const [generation, setGeneration] = useState(0);

  const pending = useRef<LogLine[]>([]);
  const nextId = useRef(0);
  const frame = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Chunks arrive faster than React should re-render. Buffer them and flush on a
  // frame boundary so a chatty container costs one render per frame, not per chunk.
  const flush = useCallback(() => {
    frame.current = 0;
    if (pending.current.length === 0) return;
    if (pausedRef.current) {
      setBuffered(pending.current.length);
      return;
    }
    const incoming = pending.current;
    pending.current = [];
    setBuffered(0);
    setLines((current) => {
      const next = current.length === 0 ? incoming : [...current, ...incoming];
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
  }, [limit]);

  const schedule = useCallback(() => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(flush);
  }, [flush]);

  // Resuming releases whatever piled up while paused.
  useEffect(() => {
    if (!paused) schedule();
  }, [paused, schedule]);

  const clear = useCallback(() => {
    pending.current = [];
    setBuffered(0);
    setLines([]);
  }, []);

  const reconnect = useCallback(() => {
    clear();
    setGeneration((value) => value + 1);
  }, [clear]);

  useEffect(() => {
    if (!container || !token) {
      setState({ kind: "idle" });
      return;
    }
    pending.current = [];
    nextId.current = 0;
    setBuffered(0);
    setLines([]);
    setState({ kind: "connecting" });

    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let attempt = 0;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws/logs?container=${encodeURIComponent(container)}&token=${encodeURIComponent(token)}&tail=${tail}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        setState({ kind: "streaming" });
      };

      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const message = readMessage(parsed);
        if (!message) return;
        if (message.type === "data" && message.data) {
          for (const raw of message.data.split(/\r?\n/)) {
            if (!raw) continue;
            pending.current.push(parseLine(raw, nextId.current));
            nextId.current += 1;
          }
          if (pending.current.length > limit) pending.current = pending.current.slice(-limit);
          schedule();
          return;
        }
        if (message.type === "error") setState({ kind: "closed", message: message.message ?? "The log stream failed" });
      };

      socket.onclose = () => {
        if (disposed) return;
        const delay = reconnectDelaysMs[Math.min(attempt, reconnectDelaysMs.length - 1)] ?? 12_000;
        attempt += 1;
        setState({ kind: "closed", message: `Stream ended. Reconnecting in ${Math.round(delay / 1000)}s.` });
        retryTimer = window.setTimeout(open, delay);
      };
    };

    open();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      if (frame.current !== 0) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [container, generation, limit, schedule, tail, token]);

  return { state, lines, buffered, clear, reconnect };
}
