import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, initializeSession } from "../api";
import { appendTelemetry, deriveTelemetry } from "../lib/telemetry";
import type { AuditEntry, Overview, Telemetry } from "../types";

/**
 * Connection to the local controller, modelled as four exclusive states.
 *
 * `degraded` is the important one: a poll failed but the previous reading is
 * still on screen, so the operator keeps their context instead of watching the
 * dashboard collapse into a spinner every time the tunnel hiccups.
 */
export type HostLink =
  | { kind: "connecting" }
  | { kind: "live"; overview: Overview; sampledAt: number }
  | { kind: "degraded"; overview: Overview; sampledAt: number; message: string }
  | { kind: "offline"; message: string };

export type HostLinkController = {
  link: HostLink;
  overview: Overview | null;
  telemetry: Telemetry[];
  audit: AuditEntry[];
  token: string;
  latencyMs: number | null;
  refreshing: boolean;
  paused: boolean;
  refresh: (options?: { force?: boolean }) => Promise<void>;
  refreshAudit: () => Promise<void>;
};

const basePollMs = 8_000;
const maxBackoffMs = 30_000;
const auditEveryNthPoll = 4;

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The Ubuntu host is unreachable";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useHostLink(): HostLinkController {
  const [link, setLink] = useState<HostLink>({ kind: "connecting" });
  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [token, setToken] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paused, setPaused] = useState(() => typeof document !== "undefined" && document.hidden);

  const previousOverview = useRef<Overview | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const failures = useRef(0);
  const pollCount = useRef(0);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    inFlight.current?.abort();
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const entries = await api.audit();
      if (mounted.current) setAudit(entries);
    } catch (error) {
      if (isAbort(error)) return;
      // The overview poll already reports controller failures to the operator.
      // Keeping the last known audit list beats blanking the rail on one miss.
      return;
    }
  }, []);

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);
    const began = performance.now();
    try {
      const overview = await api.overview({ force, signal: controller.signal });
      if (!mounted.current) return;
      setLatencyMs(performance.now() - began);
      setTelemetry((history) => appendTelemetry(history, deriveTelemetry(previousOverview.current, overview)));
      previousOverview.current = overview;
      failures.current = 0;
      setLink({ kind: "live", overview, sampledAt: overview.timestamp });
    } catch (error) {
      if (isAbort(error) || !mounted.current) return;
      failures.current += 1;
      const message = describe(error);
      setLink((current) =>
        current.kind === "live" || current.kind === "degraded"
          ? { kind: "degraded", overview: current.overview, sampledAt: current.sampledAt, message }
          : { kind: "offline", message },
      );
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  // Session first: every other request needs the token for mutations and sockets.
  useEffect(() => {
    let cancelled = false;
    void initializeSession()
      .then((session) => {
        if (cancelled) return;
        setToken(session.token);
        return Promise.all([refresh({ force: true }), refreshAudit()]);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLink({ kind: "offline", message: describe(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, refreshAudit]);

  // A hidden tab has no reason to keep an SSH channel busy.
  useEffect(() => {
    const onVisibilityChange = () => {
      const hidden = document.hidden;
      setPaused(hidden);
      if (!hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  useEffect(() => {
    if (!token || paused) return;
    let timer = 0;
    const tick = async () => {
      pollCount.current += 1;
      await refresh();
      if (pollCount.current % auditEveryNthPoll === 0) await refreshAudit();
      if (!mounted.current) return;
      const delay = failures.current === 0
        ? basePollMs
        : Math.min(basePollMs * 2 ** failures.current, maxBackoffMs);
      timer = window.setTimeout(() => void tick(), delay);
    };
    timer = window.setTimeout(() => void tick(), basePollMs);
    return () => window.clearTimeout(timer);
  }, [paused, refresh, refreshAudit, token]);

  const overview = link.kind === "live" || link.kind === "degraded" ? link.overview : null;

  return useMemo(
    () => ({ link, overview, telemetry, audit, token, latencyMs, refreshing, paused, refresh, refreshAudit }),
    [audit, latencyMs, link, overview, paused, refresh, refreshAudit, refreshing, telemetry, token],
  );
}
