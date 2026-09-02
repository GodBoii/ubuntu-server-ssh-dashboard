import {
  Activity,
  Boxes,
  Command,
  Copy,
  FolderTree,
  Gauge,
  History,
  Keyboard,
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  ServerCog,
  TerminalSquare,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { IconButton, LoadingState, Skeleton, Sparkline, StatusDot } from "./components/primitives";
import { ShortcutsDialog, type ShortcutGroup } from "./components/ShortcutsDialog";
import { Toasts } from "./components/Toasts";
import { useHostLink, type HostLink } from "./hooks/useHostLink";
import { useToasts } from "./hooks/useToasts";
import { formatClock, formatDay, formatLatency, formatRelativeTime } from "./lib/format";
import { seriesOf, summarize } from "./lib/telemetry";
import OverviewApp from "./apps/OverviewApp";
import type { AppId, ContainerInfo, StackInfo } from "./types";

const ActivityApp = lazy(() => import("./apps/ActivityApp"));
const ContainersApp = lazy(() => import("./apps/ContainersApp"));
const FilesApp = lazy(() => import("./apps/FilesApp"));
const LogsApp = lazy(() => import("./apps/LogsApp"));
const ServicesApp = lazy(() => import("./apps/ServicesApp"));
const TerminalApp = lazy(() => import("./apps/TerminalApp"));

type Application = {
  id: AppId;
  label: string;
  purpose: string;
  icon: typeof Gauge;
  shortcut: string;
};

const applications: Application[] = [
  { id: "overview", label: "Overview", purpose: "Host metrics, stacks and busiest processes", icon: LayoutDashboard, shortcut: "1" },
  { id: "containers", label: "Containers", purpose: "Inspect, start, stop and restart Docker workloads", icon: Boxes, shortcut: "2" },
  { id: "logs", label: "Logs", purpose: "Follow live output from any container", icon: ScrollText, shortcut: "3" },
  { id: "terminal", label: "Terminal", purpose: "Interactive shell on the Ubuntu host", icon: TerminalSquare, shortcut: "4" },
  { id: "files", label: "Files", purpose: "Browse and edit files under /home/arun/apps", icon: FolderTree, shortcut: "5" },
  { id: "services", label: "Services", purpose: "systemd boot state for ssh, docker and cloudflared", icon: ServerCog, shortcut: "6" },
  { id: "activity", label: "Activity", purpose: "Local audit trail of management actions", icon: History, shortcut: "7" },
];

const shortcutGroups: ShortcutGroup[] = [
  {
    name: "Navigation",
    items: [
      { keys: ["Ctrl", "K"], description: "Open the command palette" },
      { keys: ["Alt", "1-7"], description: "Jump straight to an application" },
      { keys: ["?"], description: "Show this sheet" },
      { keys: ["Esc"], description: "Close whatever is on top" },
    ],
  },
  {
    name: "Working",
    items: [
      { keys: ["Ctrl", "R"], description: "Resample the host now" },
      { keys: ["Ctrl", "S"], description: "Save the open file" },
      { keys: ["Ctrl", "B"], description: "Show or hide the live host rail" },
    ],
  },
];

const railStorageKey = "ubuntu-control.rail-visible";

function readRailPreference(): boolean {
  try {
    return window.localStorage.getItem(railStorageKey) !== "hidden";
  } catch {
    return true;
  }
}

type TraceState = "ok" | "pending" | "warn" | "down";

function traceStates(link: HostLink): [TraceState, TraceState, TraceState] {
  switch (link.kind) {
    case "live": return ["ok", "ok", "ok"];
    case "connecting": return ["ok", "pending", "pending"];
    case "degraded": return ["ok", "warn", "warn"];
    case "offline": return ["ok", "down", "down"];
    default: {
      const exhaustive: never = link;
      return exhaustive;
    }
  }
}

/** The real path this app takes to the host. Each hop shows its own state. */
function ConnectionTrace({ link, host, latencyMs }: { link: HostLink; host: string; latencyMs: number | null }) {
  const [laptop, tunnel, remote] = traceStates(link);
  const hops: Array<{ label: string; note: string; state: TraceState }> = [
    { label: "This laptop", note: "127.0.0.1:3000", state: laptop },
    { label: "Cloudflare", note: "access + tunnel", state: tunnel },
    { label: host, note: latencyMs === null ? "ssh as arun" : `${formatLatency(latencyMs)} round trip`, state: remote },
  ];
  return (
    <ol className="connection-trace" aria-label="Connection path">
      {hops.map((hop) => (
        <li key={hop.label} className={`hop is-${hop.state}`}>
          <span className="hop-dot" aria-hidden="true" />
          <span className="hop-copy">
            <strong>{hop.label}</strong>
            <small>{hop.note}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function App() {
  const [activeApp, setActiveApp] = useState<AppId>("overview");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [railVisible, setRailVisible] = useState(readRailPreference);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [logTarget, setLogTarget] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const { link, overview, telemetry, audit, token, latencyMs, refreshing, paused, refresh, refreshAudit } = useHostLink();
  const { toasts, notify, dismiss } = useToasts();

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(railStorageKey, railVisible ? "visible" : "hidden");
    } catch {
      // Private browsing blocks storage. The preference simply will not persist.
    }
  }, [railVisible]);

  const copy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`Copied ${label}`, "info");
    } catch {
      notify("The browser blocked clipboard access", "error");
    }
  }, [notify]);

  const openLogsFor = useCallback((name: string) => {
    setLogTarget(name);
    setActiveApp("logs");
  }, []);

  const run = useCallback((request: Omit<ConfirmRequest, "onConfirm">, operation: () => Promise<{ message: string }>) => {
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
          notify(error instanceof Error ? error.message : "The action failed", "error");
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  }, [notify, refresh, refreshAudit]);

  const containerAction = useCallback((container: ContainerInfo, action: "start" | "stop" | "restart") => {
    const copyByAction = {
      start: {
        detail: `Docker will start ${container.name} using its existing configuration.`,
        effects: [`Image ${container.image} runs again`, container.ports ? `Ports ${container.ports} answer again` : "No published ports change"],
        confirmLabel: "Start container",
        tone: "default" as const,
      },
      restart: {
        detail: `${container.name} stops and starts again. In-flight requests to it will fail during the swap.`,
        effects: ["Existing connections drop", "Container state and volumes are kept"],
        confirmLabel: "Restart container",
        tone: "default" as const,
      },
      stop: {
        detail: `${container.name} stops and stays down until something starts it again.`,
        effects: [
          container.ports ? `Ports ${container.ports} stop answering` : "Internal traffic to this container fails",
          container.restartPolicy === "no" ? "No restart policy will bring it back" : `Restart policy is ${container.restartPolicy}`,
        ],
        confirmLabel: "Stop container",
        tone: "danger" as const,
      },
    }[action];

    run(
      { title: `${action[0]?.toUpperCase()}${action.slice(1)} ${container.name}?`, ...copyByAction },
      () => api.containerAction(container.name, action),
    );
  }, [run]);

  const stackAction = useCallback((stack: StackInfo, action: "start" | "stop" | "restart") => {
    const copyByAction = {
      start: {
        detail: `docker compose up -d runs in ${stack.path}. Images already on the host are reused, nothing is rebuilt.`,
        effects: [`${stack.total || "All"} services for ${stack.name} come up`, "No image is pulled or built"],
        confirmLabel: "Start stack",
        tone: "default" as const,
      },
      restart: {
        detail: `Every container in ${stack.name} restarts one after another.`,
        effects: [`${stack.running} running container${stack.running === 1 ? "" : "s"} bounce`, "Connections through the tunnel drop briefly"],
        confirmLabel: "Restart stack",
        tone: "default" as const,
      },
      stop: {
        detail: `docker compose stop runs in ${stack.path}. ${stack.name} stays down until you start it again.`,
        effects: [`${stack.running} container${stack.running === 1 ? "" : "s"} stop`, "Anything depending on this stack starts failing"],
        confirmLabel: "Stop stack",
        tone: "danger" as const,
      },
    }[action];

    run(
      { title: `${action[0]?.toUpperCase()}${action.slice(1)} ${stack.name}?`, ...copyByAction },
      () => api.stackAction(stack.id, action),
    );
  }, [run]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const appCommands: PaletteCommand[] = applications.map((application) => ({
      id: `app-${application.id}`,
      group: "Applications",
      label: application.label,
      detail: application.purpose,
      icon: <application.icon size={16} />,
      shortcut: `Alt ${application.shortcut}`,
      run: () => setActiveApp(application.id),
    }));

    const controlCommands: PaletteCommand[] = [
      {
        id: "refresh",
        group: "Controller",
        label: "Resample the host",
        detail: "Force a fresh read instead of waiting for the next poll",
        icon: <RefreshCw size={16} />,
        shortcut: "Ctrl R",
        run: () => void refresh({ force: true }),
      },
      {
        id: "rail",
        group: "Controller",
        label: railVisible ? "Hide the live host rail" : "Show the live host rail",
        detail: "Toggle the right-hand telemetry column",
        icon: railVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />,
        shortcut: "Ctrl B",
        run: () => setRailVisible((value) => !value),
      },
      {
        id: "shortcuts",
        group: "Controller",
        label: "Keyboard shortcuts",
        detail: "Every shortcut this console understands",
        icon: <Keyboard size={16} />,
        shortcut: "?",
        run: () => setShortcutsOpen(true),
      },
      {
        id: "copy-host",
        group: "Controller",
        label: "Copy the host name",
        detail: overview ? overview.host : "arun-H110",
        icon: <Copy size={16} />,
        run: () => void copy(overview?.host ?? "arun-H110", "host name"),
      },
    ];

    const stackCommands: PaletteCommand[] = (overview?.stacks ?? []).flatMap((stack) => {
      const entries: PaletteCommand[] = [];
      if (stack.status === "stopped") {
        entries.push({
          id: `stack-start-${stack.id}`,
          group: "Stacks",
          label: `Start ${stack.name}`,
          detail: `docker compose up -d in ${stack.path}`,
          keywords: stack.id,
          icon: <Play size={16} />,
          run: () => stackAction(stack, "start"),
        });
      } else {
        entries.push({
          id: `stack-restart-${stack.id}`,
          group: "Stacks",
          label: `Restart ${stack.name}`,
          detail: `${stack.running} of ${stack.total} containers running`,
          keywords: stack.id,
          icon: <RotateCw size={16} />,
          run: () => stackAction(stack, "restart"),
        });
        entries.push({
          id: `stack-stop-${stack.id}`,
          group: "Stacks",
          label: `Stop ${stack.name}`,
          detail: `Takes ${stack.running} container${stack.running === 1 ? "" : "s"} down`,
          keywords: stack.id,
          icon: <Power size={16} />,
          tone: "danger",
          run: () => stackAction(stack, "stop"),
        });
      }
      return entries;
    });

    const logCommands: PaletteCommand[] = (overview?.containers ?? []).slice(0, 24).map((container) => ({
      id: `logs-${container.id}`,
      group: "Logs",
      label: `Logs: ${container.name}`,
      detail: container.image,
      keywords: `${container.project ?? ""} ${container.service ?? ""}`,
      icon: <ScrollText size={16} />,
      run: () => openLogsFor(container.name),
    }));

    return [...appCommands, ...controlCommands, ...stackCommands, ...logCommands];
  }, [copy, openLogsFor, overview, railVisible, refresh, stackAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLElement
        && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refresh({ force: true });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setRailVisible((value) => !value);
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const application = applications.find((item) => item.shortcut === event.key);
        if (application) {
          event.preventDefault();
          setActiveApp(application.id);
        }
        return;
      }
      if (event.key === "?" && !editing) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refresh]);

  const current = applications.find((item) => item.id === activeApp) ?? applications[0]!;
  const summary = overview ? summarize(overview) : null;
  const cpuSeries = seriesOf(telemetry, (sample) => sample.cpuPercent ?? sample.loadPercent);

  const workspace = ((): ReactNode => {
    if (!overview) {
      return link.kind === "offline"
        ? <OfflinePlaceholder message={link.message} onRetry={() => void refresh({ force: true })} />
        : <LoadingState label="Reading the Ubuntu host" />;
    }
    switch (activeApp) {
      case "overview":
        return <OverviewApp overview={overview} telemetry={telemetry} onStackAction={stackAction} onOpenApp={setActiveApp} />;
      case "containers":
        return <ContainersApp containers={overview.containers} onAction={containerAction} onInspectLogs={openLogsFor} onCopy={(value, label) => void copy(value, label)} />;
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
        const exhaustive: never = activeApp;
        return exhaustive;
      }
    }
  })();

  return (
    <div className="desktop-shell">
      <a className="skip-link" href="#workspace">Skip to the active application</a>

      <header className="system-bar">
        <div className="brand-lockup">
          <span className="brand-symbol" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" role="presentation">
              <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.5 3.1" />
              <circle cx="12" cy="12" r="3.4" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-copy">
            <strong>Ubuntu Control</strong>
            <small>local console</small>
          </span>
        </div>

        <button type="button" className="command-trigger" onClick={() => setPaletteOpen(true)}>
          <Command size={14} aria-hidden="true" />
          <span>Search applications and actions</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="system-status">
          <span className={`connection-pill is-${link.kind}`}>
            {link.kind === "live" ? <Wifi size={13} /> : link.kind === "offline" ? <WifiOff size={13} /> : link.kind === "degraded" ? <TriangleAlert size={13} /> : <Activity size={13} />}
            {link.kind === "live" ? "Host online" : link.kind === "degraded" ? "Last read failed" : link.kind === "offline" ? "Disconnected" : "Connecting"}
          </span>
          <span className="latency-readout" title="Round trip for the last host read">{formatLatency(latencyMs)}</span>
          <IconButton
            label={paused ? "Polling paused while this tab is hidden" : "Resample the host"}
            icon={<RefreshCw size={15} />}
            busy={refreshing}
            onClick={() => void refresh({ force: true })}
          />
          <IconButton label="Keyboard shortcuts" icon={<Keyboard size={15} />} onClick={() => setShortcutsOpen(true)} />
          <IconButton
            label={railVisible ? "Hide the live host rail" : "Show the live host rail"}
            icon={railVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            onClick={() => setRailVisible((value) => !value)}
          />
          <time dateTime={new Date(clock).toISOString()}>{formatDay(clock)}</time>
        </div>
      </header>

      <main className={`desktop-main${railVisible ? "" : " rail-hidden"}`}>
        <nav className="app-dock" aria-label="Applications">
          <span className="dock-mark" aria-hidden="true"><Gauge size={17} /></span>
          {applications.map((application) => {
            const Icon = application.icon;
            const active = activeApp === application.id;
            return (
              <span className="t-tt-wrap tt-right dock-slot" key={application.id}>
                <button
                  type="button"
                  className={`dock-button t-tt-trigger${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  aria-label={application.label}
                  onClick={() => setActiveApp(application.id)}
                >
                  <Icon size={19} />
                </button>
                <span className="t-tt" role="tooltip">
                  {application.label}
                  <kbd>Alt {application.shortcut}</kbd>
                </span>
              </span>
            );
          })}
        </nav>

        <section className="workspace-window" id="workspace" aria-label={current.label}>
          <div className="window-chrome">
            <span className="window-controls" aria-hidden="true"><i /><i /><i /></span>
            <p className="window-title"><current.icon size={14} aria-hidden="true" />{current.label}</p>
            <p className="window-context mono-cell">{overview?.host ?? "arun-H110"}</p>
          </div>

          {link.kind === "degraded" && (
            <div className="link-banner is-warning" role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              <div>
                <strong>Showing the last good reading</strong>
                <span>{link.message} Sampled {formatRelativeTime(link.sampledAt, clock)}.</span>
              </div>
              <button type="button" className="link-button" onClick={() => void refresh({ force: true })}>Retry now</button>
            </div>
          )}

          <div className="workspace-content" key={activeApp}>
            <Suspense fallback={<LoadingState label={`Opening ${current.label}`} />}>{workspace}</Suspense>
          </div>
        </section>

        {railVisible && (
          <aside className="telemetry-rail" aria-label="Live host summary">
            <div className="rail-block">
              <p className="rail-heading">Link path</p>
              <ConnectionTrace link={link} host={overview?.host ?? "arun-H110"} latencyMs={latencyMs} />
            </div>

            <div className="rail-block">
              <p className="rail-heading">Host</p>
              <p className="rail-host">
                <strong>{overview?.host ?? "arun-H110"}</strong>
                <small>{overview?.kernel ?? "Connecting through Cloudflare"}</small>
              </p>
              <dl className="rail-figures">
                <div>
                  <dt>Running</dt>
                  <dd>{summary ? summary.running : <Skeleton width={28} height={16} />}</dd>
                </div>
                <div>
                  <dt>Load</dt>
                  <dd>{overview ? overview.load[0].toFixed(2) : <Skeleton width={34} height={16} />}</dd>
                </div>
                <div>
                  <dt>Stacks</dt>
                  <dd>{summary ? `${summary.healthyStacks}/${summary.totalStacks}` : <Skeleton width={30} height={16} />}</dd>
                </div>
              </dl>
              <div className="rail-chart">
                <Sparkline values={cpuSeries} tone="accent" ceiling={100} label="CPU history" />
                <span>CPU, last {Math.max(cpuSeries.length, 1)} samples</span>
              </div>
            </div>

            <div className="rail-block">
              <p className="rail-heading">Recent activity</p>
              {audit.length === 0 ? (
                <p className="rail-empty">Nothing recorded yet. Actions you take here show up instantly.</p>
              ) : (
                <ul className="rail-activity">
                  {audit.slice(0, 5).map((entry) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => setActiveApp("activity")}>
                        <StatusDot state={entry.outcome === "success" ? "healthy" : "stopped"} />
                        <span>
                          <strong>{entry.action}</strong>
                          <small>{entry.target}</small>
                        </span>
                        <time dateTime={entry.timestamp}>{formatClock(new Date(entry.timestamp))}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </main>

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog groups={shortcutGroups} onClose={() => setShortcutsOpen(false)} />}
      {confirm && <ConfirmDialog request={confirm} busy={confirmBusy} onClose={() => !confirmBusy && setConfirm(null)} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function OfflinePlaceholder({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="offline-placeholder">
      <span className="offline-mark" aria-hidden="true"><WifiOff size={22} /></span>
      <h2>The Ubuntu host is not answering</h2>
      <p>{message}</p>
      <ul>
        <li>Check that <code>ssh -o BatchMode=yes ubuntu-server &quot;whoami&quot;</code> still works in PowerShell.</li>
        <li>Confirm <code>cloudflared</code> is running on the host and your Access session has not expired.</li>
        <li>The controller keeps retrying with a backoff, so this clears on its own once the tunnel is back.</li>
      </ul>
      <button type="button" className="button primary" onClick={onRetry}>
        <span className="button-icon" aria-hidden="true"><RefreshCw size={15} /></span>
        <span className="button-label">Try again now</span>
      </button>
    </div>
  );
}
