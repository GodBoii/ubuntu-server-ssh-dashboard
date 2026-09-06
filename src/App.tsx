import { Copy, Keyboard, RefreshCw, ScrollText, Search, TriangleAlert, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { Act, Btn, Busy, Label, Lamp, Skeleton, Spec, State, useSlidingMarker } from "./components/kit";
import { ShortcutsDialog, type ShortcutGroup } from "./components/ShortcutsDialog";
import { Toasts } from "./components/Toasts";
import { Trace } from "./components/Trace";
import { useHostLink, type HostLink } from "./hooks/useHostLink";
import { useToasts } from "./hooks/useToasts";
import { formatBytes, formatClock, formatDuration, formatLatency, formatPercent, formatRelativeTime } from "./lib/format";
import { containerHealth, containerStatusLabel, seriesOf, summarize } from "./lib/telemetry";
import OverviewApp from "./apps/OverviewApp";
import type { AppId, ContainerInfo, StackInfo } from "./types";

const ActivityApp = lazy(() => import("./apps/ActivityApp"));
const ContainersApp = lazy(() => import("./apps/ContainersApp"));
const FilesApp = lazy(() => import("./apps/FilesApp"));
const LogsApp = lazy(() => import("./apps/LogsApp"));
const ServicesApp = lazy(() => import("./apps/ServicesApp"));
const TerminalApp = lazy(() => import("./apps/TerminalApp"));

type Entry = { id: AppId; name: string; purpose: string };

/**
 * The index is numbered rather than iconified: the number is also the Alt
 * shortcut, so the ornament and the affordance are the same thing.
 */
const entries: Entry[] = [
  { id: "overview", name: "Machine", purpose: "Vitals, compose stacks and busiest processes" },
  { id: "containers", name: "Containers", purpose: "Inspect, start, stop and restart workloads" },
  { id: "logs", name: "Logs", purpose: "Follow live output from any container" },
  { id: "terminal", name: "Terminal", purpose: "Interactive shell on the Ubuntu host" },
  { id: "files", name: "Files", purpose: "Browse and edit files under /home/arun/apps" },
  { id: "services", name: "Services", purpose: "systemd state for ssh, docker and cloudflared" },
  { id: "activity", name: "Activity", purpose: "Local ledger of every action taken here" },
];

const numberOf = (id: AppId) => String(entries.findIndex((entry) => entry.id === id) + 1).padStart(2, "0");

const shortcutGroups: ShortcutGroup[] = [
  {
    name: "Move",
    items: [
      { keys: ["Ctrl", "K"], description: "Command palette" },
      { keys: ["Alt", "1-7"], description: "Jump to a section" },
      { keys: ["?"], description: "This sheet" },
      { keys: ["Esc"], description: "Close the top layer" },
    ],
  },
  {
    name: "Work",
    items: [
      { keys: ["Ctrl", "R"], description: "Resample the host now" },
      { keys: ["Ctrl", "S"], description: "Save the open file" },
    ],
  },
];

type HopState = "ok" | "wait" | "warn" | "down";

function hopStates(link: HostLink): [HopState, HopState, HopState] {
  switch (link.kind) {
    case "live": return ["ok", "ok", "ok"];
    case "connecting": return ["ok", "wait", "wait"];
    case "degraded": return ["ok", "warn", "warn"];
    case "offline": return ["ok", "down", "down"];
    default: {
      const exhaustive: never = link;
      return exhaustive;
    }
  }
}

const lampForHop = { ok: "ok", wait: "live", warn: "warn", down: "fail" } as const;

/** The real route this console takes. Each hop reports for itself. */
function LinkPath({ link, host, latencyMs }: { link: HostLink; host: string; latencyMs: number | null }) {
  const [laptop, tunnel, remote] = hopStates(link);
  const hops = [
    { key: "laptop", title: "controller", note: "127.0.0.1:3000", state: laptop },
    { key: "tunnel", title: "cloudflare", note: "access + tunnel", state: tunnel },
    { key: "host", title: host, note: latencyMs === null ? "runs as arun" : `${formatLatency(latencyMs)} round trip`, state: remote },
  ];
  return (
    <div className="hops">
      {hops.map((hop) => (
        <div className="hop" key={hop.key}>
          <Lamp level={lampForHop[hop.state]} />
          <span className="hop-copy">
            <b>{hop.title}</b>
            <span>{hop.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState<AppId>("overview");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [logTarget, setLogTarget] = useState<string | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);

  const { link, overview, telemetry, audit, token, latencyMs, refreshing, paused, refresh, refreshAudit } = useHostLink();
  const { toasts, notify, dismiss } = useToasts();
  const { listRef, offset } = useSlidingMarker(active);

  const copy = useCallback(async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`copied ${what}`, "info");
    } catch {
      notify("the browser blocked clipboard access", "error");
    }
  }, [notify]);

  const openLogs = useCallback((name: string) => {
    setLogTarget(name);
    setActive("logs");
  }, []);

  const ask = useCallback((request: Omit<ConfirmRequest, "onConfirm">, operation: () => Promise<{ message: string }>) => {
    setConfirm({
      ...request,
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          const result = await operation();
          notify(result.message);
          setConfirm(null);
          await Promise.all([refresh({ force: true }), refreshAudit()]);
        } catch (error) {
          notify(error instanceof Error ? error.message : "the action failed", "error");
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  }, [notify, refresh, refreshAudit]);

  const containerAction = useCallback((container: ContainerInfo, action: "start" | "stop" | "restart") => {
    const wording = {
      start: {
        detail: `Docker starts ${container.name} again from its existing configuration.`,
        effects: [`image ${container.image} runs again`, container.ports ? `ports ${container.ports} answer again` : "no published ports change"],
        confirmLabel: "Start",
        tone: "default" as const,
      },
      restart: {
        detail: `${container.name} stops and starts again. Requests in flight to it will fail during the swap.`,
        effects: ["open connections drop", "volumes and container state are kept"],
        confirmLabel: "Restart",
        tone: "default" as const,
      },
      stop: {
        detail: `${container.name} goes down and stays down until something starts it.`,
        effects: [
          container.ports ? `ports ${container.ports} stop answering` : "internal traffic to it starts failing",
          container.restartPolicy === "no" ? "no restart policy will bring it back" : `restart policy is ${container.restartPolicy}`,
        ],
        confirmLabel: "Stop",
        tone: "danger" as const,
      },
    }[action];

    ask({ title: `${action} ${container.name}`, ...wording }, () => api.containerAction(container.name, action));
  }, [ask]);

  const stackAction = useCallback((stack: StackInfo, action: "start" | "stop" | "restart") => {
    const wording = {
      start: {
        detail: `docker compose up -d runs in ${stack.path}. Images already on the host are reused, nothing is built or pulled.`,
        effects: [`${stack.total || "all"} services come up`, "no image is built or pulled"],
        confirmLabel: "Start stack",
        tone: "default" as const,
      },
      restart: {
        detail: `Every container in ${stack.name} restarts, one after another.`,
        effects: [`${stack.running} running container${stack.running === 1 ? "" : "s"} bounce`, "traffic through the tunnel drops briefly"],
        confirmLabel: "Restart stack",
        tone: "default" as const,
      },
      stop: {
        detail: `docker compose stop runs in ${stack.path}. ${stack.name} stays down until you start it again.`,
        effects: [`${stack.running} container${stack.running === 1 ? "" : "s"} stop`, "anything depending on this stack starts failing"],
        confirmLabel: "Stop stack",
        tone: "danger" as const,
      },
    }[action];

    ask({ title: `${action} ${stack.name}`, ...wording }, () => api.stackAction(stack.id, action));
  }, [ask]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const sections: PaletteCommand[] = entries.map((entry) => ({
      id: `go-${entry.id}`,
      group: "Sections",
      mark: numberOf(entry.id),
      label: entry.name,
      detail: entry.purpose,
      shortcut: `Alt ${numberOf(entry.id).slice(1)}`,
      run: () => setActive(entry.id),
    }));

    const controls: PaletteCommand[] = [
      {
        id: "resample",
        group: "Controller",
        mark: "↻",
        label: "Resample now",
        detail: "Force a fresh read instead of waiting for the next poll",
        shortcut: "Ctrl R",
        run: () => void refresh({ force: true }),
      },
      {
        id: "keys",
        group: "Controller",
        mark: "⌨",
        label: "Keyboard",
        detail: "Every shortcut this console understands",
        shortcut: "?",
        run: () => setKeysOpen(true),
      },
      {
        id: "copy-host",
        group: "Controller",
        mark: "⧉",
        label: "Copy host name",
        detail: overview?.host ?? "arun-H110",
        run: () => void copy(overview?.host ?? "arun-H110", "host name"),
      },
    ];

    const stacks: PaletteCommand[] = (overview?.stacks ?? []).flatMap((stack) =>
      stack.status === "stopped"
        ? [{
            id: `stack-start-${stack.id}`,
            group: "Stacks",
            mark: "▶",
            label: `Start ${stack.name}`,
            detail: `compose up -d in ${stack.path}`,
            keywords: stack.id,
            run: () => stackAction(stack, "start"),
          }]
        : [
            {
              id: `stack-restart-${stack.id}`,
              group: "Stacks",
              mark: "↻",
              label: `Restart ${stack.name}`,
              detail: `${stack.running} of ${stack.total} containers running`,
              keywords: stack.id,
              run: () => stackAction(stack, "restart"),
            },
            {
              id: `stack-stop-${stack.id}`,
              group: "Stacks",
              mark: "⏻",
              label: `Stop ${stack.name}`,
              detail: `takes ${stack.running} container${stack.running === 1 ? "" : "s"} down`,
              keywords: stack.id,
              tone: "danger" as const,
              run: () => stackAction(stack, "stop"),
            },
          ],
    );

    const tails: PaletteCommand[] = (overview?.containers ?? []).slice(0, 30).map((container) => ({
      id: `tail-${container.id}`,
      group: "Tail a container",
      mark: "≡",
      label: container.name,
      detail: container.image,
      keywords: `${container.project ?? ""} ${container.service ?? ""} logs`,
      run: () => openLogs(container.name),
    }));

    return [...sections, ...controls, ...stacks, ...tails];
  }, [copy, openLogs, overview, refresh, stackAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement
        && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      const meta = event.ctrlKey || event.metaKey;

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (meta && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refresh({ force: true });
        return;
      }
      if (event.altKey && !meta) {
        const entry = entries[Number(event.key) - 1];
        if (entry && event.key >= "1" && event.key <= "7") {
          event.preventDefault();
          setActive(entry.id);
        }
        return;
      }
      if (event.key === "?" && !typing) {
        event.preventDefault();
        setKeysOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refresh]);

  const summary = overview ? summarize(overview) : null;
  const cpuSeries = seriesOf(telemetry, (sample) => sample.cpuPercent ?? sample.loadPercent);
  const cpuNow = cpuSeries.at(-1) ?? null;
  const selectedContainer = overview?.containers.find((container) => container.name === inspected) ?? null;
  const showInspector = active === "containers" && selectedContainer !== null;

  const counts: Partial<Record<AppId, string>> = {
    overview: summary ? `${summary.healthyStacks}/${summary.totalStacks}` : "",
    containers: summary ? `${summary.running}/${summary.total}` : "",
    logs: overview ? String(overview.containers.length) : "",
    services: overview ? `${overview.services.filter((service) => service.active).length}/${overview.services.length}` : "",
    activity: audit.length ? String(audit.length) : "",
  };

  const body = ((): ReactNode => {
    if (!overview) {
      return link.kind === "offline"
        ? <Offline message={link.message} onRetry={() => void refresh({ force: true })} />
        : <Busy label="reading the ubuntu host" />;
    }
    switch (active) {
      case "overview":
        return <OverviewApp overview={overview} telemetry={telemetry} onStackAction={stackAction} onOpenApp={setActive} />;
      case "containers":
        return (
          <ContainersApp
            containers={overview.containers}
            selected={inspected}
            onSelect={setInspected}
            onAction={containerAction}
            onInspectLogs={openLogs}
          />
        );
      case "logs":
        return <LogsApp containers={overview.containers} token={token} initialContainer={logTarget} notify={notify} />;
      case "terminal":
        return <TerminalApp token={token} notify={notify} />;
      case "files":
        return <FilesApp notify={notify} />;
      case "services":
        return <ServicesApp services={overview.services} />;
      case "activity":
        return <ActivityApp entries={audit} />;
      default: {
        const exhaustive: never = active;
        return exhaustive;
      }
    }
  })();

  return (
    <div className="shell">
      <a className="skip-link" href="#work">Skip to the active section</a>

      <header className="header">
        <div className="header-id">
          <svg className="mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4.4 1.5H1.5v15h2.9M13.6 1.5h2.9v15h-2.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <rect x="6.6" y="5" width="4.8" height="1.5" fill="currentColor" />
            <rect x="6.6" y="8.25" width="4.8" height="1.5" fill="currentColor" />
            <rect x="6.6" y="11.5" width="2.6" height="1.5" fill="currentColor" />
          </svg>
          <span className="header-name">
            <b>{overview?.host ?? "arun-H110"}</b>
            <span>
              {overview ? overview.kernel : "connecting"}
              <i>·</i>
              {overview ? `up ${formatDuration(overview.uptimeSeconds)}` : "cloudflare tunnel"}
            </span>
          </span>
        </div>

        <div className="header-trace">
          <span className="trace-readout">
            <b>
              {cpuNow === null ? "—" : formatPercent(cpuNow)}
              <em>cpu</em>
            </b>
            <span className="label">{telemetry.length} samples</span>
          </span>
          <Trace series={cpuSeries} ceiling={100} label="Processor load" />
        </div>

        <div className="header-tools">
          <span className="link-state">
            <Lamp level={link.kind === "live" ? "ok" : link.kind === "connecting" ? "live" : link.kind === "degraded" ? "warn" : "fail"} />
            <span>{link.kind === "live" ? "linked" : link.kind === "degraded" ? "stale" : link.kind === "offline" ? "no link" : "linking"}</span>
            <em>{formatLatency(latencyMs)}</em>
          </span>
          <Btn variant="quiet" icon={<Search size={13} />} onClick={() => setPaletteOpen(true)}>
            find <kbd>Ctrl K</kbd>
          </Btn>
          <Act
            label={paused ? "Polling is paused while this tab is hidden" : "Resample the host"}
            icon={<RefreshCw size={13} />}
            disabled={refreshing}
            onClick={() => void refresh({ force: true })}
          />
          <Act label="Keyboard shortcuts" icon={<Keyboard size={13} />} onClick={() => setKeysOpen(true)} />
        </div>
      </header>

      <div className={`shell-body${showInspector ? " has-inspector" : ""}`}>
        <nav className="index" aria-label="Sections">
          <div className="index-list" ref={listRef}>
            <span className="index-marker" style={{ transform: `translateY(${offset}px)` }} aria-hidden="true" />
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="index-item"
                aria-label={entry.name}
                aria-current={active === entry.id ? "page" : undefined}
                onClick={() => setActive(entry.id)}
              >
                <span className="index-num">{numberOf(entry.id)}</span>
                <span className="index-name">{entry.name}</span>
                <span className="index-count">{counts[entry.id] ?? ""}</span>
              </button>
            ))}
          </div>

          <div className="index-section">
            <Label>Link path</Label>
            <LinkPath link={link} host={overview?.host ?? "arun-H110"} latencyMs={latencyMs} />
          </div>

          <p className="index-foot">
            bound to 127.0.0.1 only
            <br />
            no inbound port on the host
          </p>
        </nav>

        <main className="content" id="work" aria-label={entries.find((entry) => entry.id === active)?.name}>
          {link.kind === "degraded" && (
            <div className="banner" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <p>
                <b>Showing the last good reading.</b> {link.message} Sampled {formatRelativeTime(link.sampledAt)}.
              </p>
              <button type="button" className="link" onClick={() => void refresh({ force: true })}>retry</button>
            </div>
          )}
          <div className="content-body" key={active}>
            <Suspense fallback={<Busy label={`opening ${entries.find((entry) => entry.id === active)?.name.toLowerCase()}`} />}>
              {body}
            </Suspense>
          </div>
        </main>

        {showInspector && selectedContainer && (
          <aside className="inspector" aria-label={`Detail for ${selectedContainer.name}`}>
            <div className="inspector-head">
              <Label>Container</Label>
              <span className="acts">
                <Act label="Copy name" icon={<Copy size={13} />} onClick={() => void copy(selectedContainer.name, "container name")} />
                <Act label="Close detail" icon={<X size={13} />} onClick={() => setInspected(null)} />
              </span>
            </div>
            <div className="inspector-title">
              <b>{selectedContainer.name}</b>
              <State level={containerHealth(selectedContainer) === "healthy" ? "ok" : containerHealth(selectedContainer) === "degraded" ? "warn" : containerHealth(selectedContainer) === "connecting" ? "live" : "fail"}>
                {containerStatusLabel(selectedContainer)}
              </State>
            </div>
            <div className="inspector-block">
              <Spec
                rows={[
                  { term: "Image", value: selectedContainer.image },
                  { term: "Project", value: selectedContainer.project ?? <em>standalone</em> },
                  { term: "Service", value: selectedContainer.service ?? <em>none</em> },
                  { term: "Ports", value: selectedContainer.ports || <em>internal only</em> },
                  { term: "Restart", value: selectedContainer.restartPolicy || <em>no</em> },
                  { term: "Status", value: selectedContainer.status || <em>unknown</em> },
                  {
                    term: "Started",
                    value: selectedContainer.startedAt
                      ? formatRelativeTime(Date.parse(selectedContainer.startedAt))
                      : <em>not running</em>,
                  },
                  { term: "Id", value: selectedContainer.id.slice(0, 12) },
                ]}
              />
            </div>
            <div className="inspector-actions">
              <Btn variant="line" icon={<ScrollText size={13} />} onClick={() => openLogs(selectedContainer.name)}>Tail logs</Btn>
              {selectedContainer.state === "running" ? (
                <Btn variant="danger" onClick={() => containerAction(selectedContainer, "stop")}>Stop</Btn>
              ) : (
                <Btn variant="primary" onClick={() => containerAction(selectedContainer, "start")}>Start</Btn>
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="status-bar">
        <span>protocol <b>{overview?.protocol ?? "—"}</b></span>
        <span>poll <b>{paused ? "paused" : "8s"}</b></span>
        <span>memory <b>{overview ? formatBytes(overview.memory.used) : <Skeleton width={40} />}</b></span>
        <span>rtt <b>{formatLatency(latencyMs)}</b></span>
        <span className="status-spacer" />
        <span>last sample <b>{overview ? formatClock(overview.timestamp) : "—"}</b></span>
        <span className="status-hint"><kbd>?</kbd> keys</span>
      </footer>

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {keysOpen && <ShortcutsDialog groups={shortcutGroups} onClose={() => setKeysOpen(false)} />}
      {confirm && <ConfirmDialog request={confirm} busy={confirmBusy} onClose={() => !confirmBusy && setConfirm(null)} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Offline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="offline">
      <h2>no link to the host</h2>
      <p>{message}</p>
      <ol>
        <li>For the Windows controller, check <code>ssh -o BatchMode=yes ubuntu-server &quot;whoami&quot;</code> in PowerShell. On Ubuntu, check <code>systemctl --user status ubuntu-control</code>.</li>
        <li>Confirm <code>cloudflared</code> is up on the host and your Access session has not expired.</li>
        <li>The controller keeps retrying with a backoff, so this clears itself once the tunnel is back.</li>
      </ol>
      <Btn variant="primary" icon={<RefreshCw size={13} />} onClick={onRetry}>Retry now</Btn>
    </div>
  );
}
