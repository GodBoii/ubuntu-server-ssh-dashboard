import {
  Activity,
  ArrowUpRight,
  Cpu,
  Gauge as GaugeIcon,
  HardDrive,
  Layers,
  LockKeyhole,
  MemoryStick,
  Play,
  Power,
  RotateCw,
  Server,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Act, Bar, Figure, Gauge, Label, Lamp, Section, Spec, toneForLoad } from "../components/kit";
import { formatBytes, formatDuration, formatPercent, formatRate, humanize } from "../lib/format";
import { summarize } from "../lib/telemetry";
import type { AppId, Overview, StackInfo, Telemetry } from "../types";

type StackAction = "start" | "stop" | "restart";

function Vital({
  name,
  icon: Icon,
  value,
  unit,
  percent,
  detail,
}: {
  name: string;
  icon: LucideIcon;
  value: string;
  unit?: string;
  percent: number;
  detail: string;
}) {
  const tone = toneForLoad(percent);
  return (
    <article className={`vital ${tone}`}>
      <header className="vital-head">
        <span className="vital-icon" aria-hidden="true">
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <Label>{name}</Label>
      </header>
      <div className="vital-reading">
        <Figure value={value} unit={unit} size="md" />
        <Gauge percent={percent} tone={tone} />
      </div>
      <Bar percent={percent} tone={tone} label={`${name} usage`} />
      <span className="vital-detail">{detail}</span>
    </article>
  );
}

function StackLine({ stack, onAction }: { stack: StackInfo; onAction: (stack: StackInfo, action: StackAction) => void }) {
  const stopped = stack.status === "stopped";
  const lamp = stack.status === "healthy" ? "ok" : stack.status === "degraded" ? "warn" : "fail";
  return (
    <div className="stack-line">
      <Lamp level={lamp} />
      <div className="stack-name">
        <b>{stack.name}</b>
        <span>{stack.path}</span>
      </div>
      <div className="tally" role="img" aria-label={`${stack.running} of ${stack.total} running`}>
        {Array.from({ length: Math.max(stack.total, 1) }, (_, index) => (
          <i key={index} className={index < stack.running ? "on" : ""} />
        ))}
      </div>
      <div className="members">
        {stack.containers.length === 0
          ? <span>no containers defined</span>
          : stack.containers.map((name) => <span key={name}>{name}</span>)}
      </div>
      <div className="acts">
        {stopped ? (
          <Act label={`Start ${stack.name}`} icon={<Play size={14} />} tone="go" onClick={() => onAction(stack, "start")} />
        ) : (
          <>
            <Act label={`Restart ${stack.name}`} icon={<RotateCw size={14} />} onClick={() => onAction(stack, "restart")} />
            <Act label={`Stop ${stack.name}`} icon={<Power size={14} />} tone="danger" onClick={() => onAction(stack, "stop")} />
          </>
        )}
      </div>
    </div>
  );
}

export default function OverviewApp({
  overview,
  telemetry,
  onStackAction,
  onOpenApp,
}: {
  overview: Overview;
  telemetry: Telemetry[];
  onStackAction: (stack: StackInfo, action: StackAction) => void;
  onOpenApp: (app: AppId) => void;
}) {
  const summary = summarize(overview);
  const latest = telemetry.at(-1) ?? null;
  const cpuPercent = latest?.cpuPercent ?? (overview.load[0] / overview.cpuCount) * 100;
  const memoryPercent = overview.memory.total ? (overview.memory.used / overview.memory.total) * 100 : 0;
  const diskPercent = overview.disk.total ? (overview.disk.used / overview.disk.total) * 100 : 0;
  const persistent = overview.containers.filter(
    (container) => container.restartPolicy === "always" || container.restartPolicy === "unless-stopped",
  ).length;

  return (
    <div className="sheet">
      <header className="sheet-title">
        <span className="app-icon" aria-hidden="true"><GaugeIcon size={16} strokeWidth={1.75} /></span>
        <div>
          <h1>Machine</h1>
          <p>{overview.host} · {summary.running}/{summary.total} containers up · {summary.healthyStacks}/{summary.totalStacks} stacks healthy</p>
        </div>
      </header>

      {(summary.unhealthy > 0 || summary.inactiveServices.length > 0) && (
        <div className="banner" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <p>
            {summary.unhealthy > 0 && `${summary.unhealthy} container${summary.unhealthy === 1 ? "" : "s"} reporting unhealthy. `}
            {summary.inactiveServices.length > 0 && `Units not active: ${summary.inactiveServices.join(", ")}.`}
          </p>
          <button type="button" className="link with-icon" onClick={() => onOpenApp(summary.unhealthy > 0 ? "containers" : "services")}>
            open <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="vitals">
        <Vital
          name="Processor"
          icon={Cpu}
          value={formatPercent(cpuPercent)}
          percent={cpuPercent}
          detail={`${overview.cpuCount} threads · load ${overview.load.map((value) => value.toFixed(2)).join(" ")}`}
        />
        <Vital
          name="Memory"
          icon={MemoryStick}
          value={formatBytes(overview.memory.used)}
          unit={`of ${formatBytes(overview.memory.total)}`}
          percent={memoryPercent}
          detail={overview.memory.swapTotal > 0
            ? `${formatBytes(overview.memory.available)} available · swap ${formatBytes(overview.memory.swapUsed)}`
            : `${formatBytes(overview.memory.available)} available`}
        />
        <Vital
          name="Root disk"
          icon={HardDrive}
          value={formatBytes(overview.disk.used)}
          unit={`of ${formatBytes(overview.disk.total)}`}
          percent={diskPercent}
          detail={`${formatBytes(overview.disk.available)} free`}
        />
      </div>

      <div className="split">
        <section className="panel">
          <Section title="Machine" icon={<Server size={13} strokeWidth={1.75} />} />
          <Spec
            rows={[
              { term: "Kernel", value: overview.kernel },
              { term: "Uptime", value: formatDuration(overview.uptimeSeconds) },
              { term: "Thermal", value: overview.temperature === null ? <em>sensor not exposed</em> : `${overview.temperature.toFixed(1)} °C peak` },
              {
                term: "Network",
                value: latest?.receivedBytesPerSecond === null || latest === null
                  ? <em>waiting for a second sample</em>
                  : `${formatRate(latest.receivedBytesPerSecond)} in · ${formatRate(latest.transmittedBytesPerSecond)} out`,
              },
              { term: "Containers", value: `${summary.running} running of ${summary.total}` },
              { term: "Auto restart", value: `${persistent} of ${summary.total} containers` },
              { term: "Units", value: `${overview.services.filter((service) => service.active).length} of ${overview.services.length} active` },
              { term: "Helper", value: `ops.py protocol ${overview.protocol}` },
            ]}
          />
        </section>

        <section className="panel">
          <Section title="Busiest processes" aside="cpu share" icon={<Activity size={13} strokeWidth={1.75} />} />
          {overview.processes.length === 0 ? (
            <p className="note">This host&apos;s helper does not report process data. Update the controller to refresh ops.py.</p>
          ) : (
            <div className="stack">
              {overview.processes.map((process) => (
                <div className="proc" key={process.pid}>
                  <b title={process.command}>{process.command}</b>
                  <span>{process.pid}</span>
                  <u>{process.cpu.toFixed(1)}%</u>
                  <i className="proc-share" aria-hidden="true" style={{ transform: `scaleX(${Math.min(process.cpu, 100) / 100})` }} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="block panel">
        <Section
          title="Compose stacks"
          aside={`${summary.healthyStacks} of ${summary.totalStacks} healthy`}
          icon={<Layers size={13} strokeWidth={1.75} />}
        />
        <div className="stack">
          {overview.stacks.map((stack) => <StackLine key={stack.id} stack={stack} onAction={onStackAction} />)}
        </div>
      </section>

      <section className="block panel">
        <Section title="Boundaries" icon={<LockKeyhole size={13} strokeWidth={1.75} />} />
        <ul className="note stack">
          <li>The controller binds to 127.0.0.1 only. Nothing on the Wi-Fi can reach it.</li>
          <li>File access is limited to /home/arun/apps and text files up to 2 MB.</li>
          <li>systemd stays read-only. Privileged work goes through {humanize("terminal")} and Ubuntu&apos;s own sudo prompt.</li>
        </ul>
      </section>
    </div>
  );
}
