import { ArrowUpRight, Play, Power, RotateCw, SquareTerminal, TriangleAlert } from "lucide-react";
import { Act, Bar, Btn, Figure, Label, Section, Spec, State, toneForLoad } from "../components/kit";
import { Trace } from "../components/Trace";
import { formatBytes, formatClock, formatDuration, formatPercent, formatRate } from "../lib/format";
import { seriesOf, summarize } from "../lib/telemetry";
import type { AppId, Overview, StackInfo, Telemetry } from "../types";

type StackAction = "start" | "stop" | "restart";

function Vital({ name, used, total, percent, detail }: { name: string; used: number; total: number; percent: number; detail: string }) {
  return (
    <article className="vital">
      <div className="vital-head"><Label>{name}</Label><span>{formatPercent(percent)}</span></div>
      <Figure value={formatBytes(used)} unit={`/ ${formatBytes(total)}`} />
      <Bar percent={percent} tone={toneForLoad(percent)} label={`${name} usage`} />
      <span className="vital-detail">{detail}</span>
    </article>
  );
}

function StackLine({ stack, onAction }: { stack: StackInfo; onAction: (stack: StackInfo, action: StackAction) => void }) {
  const stopped = stack.status === "stopped";
  return (
    <div className="stack-line">
      <div className="stack-name"><b>{stack.name}</b><span>{stack.path}</span></div>
      <State level={stack.status === "healthy" ? "ok" : stack.status === "degraded" ? "warn" : "idle"}>{stack.status}</State>
      <span className="stack-count">{stack.running}<span> / {stack.total}</span></span>
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

export default function OverviewApp({ overview, telemetry, onStackAction, onOpenApp }: {
  overview: Overview;
  telemetry: Telemetry[];
  onStackAction: (stack: StackInfo, action: StackAction) => void;
  onOpenApp: (app: AppId) => void;
}) {
  const summary = summarize(overview);
  const latest = telemetry.at(-1) ?? null;
  const cpuPercent = latest?.cpuPercent ?? null;
  const cpuSeries = seriesOf(telemetry, (sample) => sample.cpuPercent);
  const memoryPercent = overview.memory.total ? overview.memory.used / overview.memory.total * 100 : 0;
  const diskPercent = overview.disk.total ? overview.disk.used / overview.disk.total * 100 : 0;
  const firstCpuSample = telemetry.find((sample) => sample.cpuPercent !== null);

  return (
    <div className="sheet">
      <header className="sheet-title">
        <div>
          <span className="eyebrow">01 / Host overview</span>
          <h1>Machine</h1>
          <p>{overview.host}<span>Running for {formatDuration(overview.uptimeSeconds)}</span></p>
        </div>
        <Btn variant="line" icon={<SquareTerminal size={14} />} onClick={() => onOpenApp("terminal")}>Open terminal <ArrowUpRight size={13} aria-hidden="true" /></Btn>
      </header>

      {(summary.unhealthy > 0 || summary.inactiveServices.length > 0) && (
        <div className="banner" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <p>
            {summary.unhealthy > 0 && `${summary.unhealthy} container${summary.unhealthy === 1 ? "" : "s"} reporting unhealthy. `}
            {summary.inactiveServices.length > 0 && `Units not active: ${summary.inactiveServices.join(", ")}.`}
          </p>
          <button type="button" className="link with-icon" onClick={() => onOpenApp(summary.unhealthy > 0 ? "containers" : "services")}>Inspect <ArrowUpRight size={12} aria-hidden="true" /></button>
        </div>
      )}

      <div className="instrument-grid">
        <section className="processor" aria-label="Processor history">
          <div className="processor-top"><Label>Processor</Label><span className="cpu-threads">{overview.cpuCount} threads</span></div>
          <div className="processor-reading">
            <Figure value={cpuPercent === null ? "—" : formatPercent(cpuPercent)} size="lg" />
            <span>{cpuPercent === null ? "Waiting for a second sample" : "CPU utilization"}</span>
          </div>
          <div className="processor-chart">
            <div className="chart-scale" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
            <Trace series={cpuSeries} label="CPU utilization" />
          </div>
          <div className="chart-caption"><span>{firstCpuSample ? formatClock(firstCpuSample.at) : "Collecting history"}</span><span>{cpuSeries.length} samples<span className="caption-divider">/</span>now</span></div>
          <div className="processor-foot"><span>Load average</span><b>{overview.load.map((value) => value.toFixed(2)).join(" / ")}</b><span className="load-periods">1 / 5 / 15 min</span></div>
        </section>
        <div className="storage-vitals">
          <Vital name="Memory" used={overview.memory.used} total={overview.memory.total} percent={memoryPercent} detail={`${formatBytes(overview.memory.available)} available${overview.memory.swapTotal > 0 ? ` · ${formatBytes(overview.memory.swapUsed)} swap used` : ""}`} />
          <Vital name="Root disk" used={overview.disk.used} total={overview.disk.total} percent={diskPercent} detail={`${formatBytes(overview.disk.available)} free`} />
        </div>
      </div>

      <div className="overview-workloads">
        <section className="workload-section">
          <Section title="Compose stacks" aside={`${summary.healthyStacks} / ${summary.totalStacks} healthy`} />
          <div className="stack-columns" aria-hidden="true"><span>Project</span><span>State</span><span>Running</span><span /></div>
          {overview.stacks.length > 0 ? overview.stacks.map((stack) => <StackLine key={stack.id} stack={stack} onAction={onStackAction} />) : <p className="note section-note">No compose stacks reported by this host.</p>}
          <button type="button" className="section-link" onClick={() => onOpenApp("containers")}><span>View containers <span className="link-count">{summary.running} / {summary.total} running</span></span><ArrowUpRight size={14} aria-hidden="true" /></button>
        </section>
        <section className="process-section">
          <Section title="Busiest processes" aside="CPU share" />
          <div className="process-columns" aria-hidden="true"><span>Command</span><span>PID</span><span>CPU</span></div>
          {overview.processes.length === 0 ? <p className="note section-note">Process data is unavailable. Update the host helper to report processes.</p> : overview.processes.map((process) => (
            <div className="proc" key={process.pid}><b title={process.command}>{process.command}</b><span>{process.pid}</span><u>{process.cpu.toFixed(1)}%</u></div>
          ))}
        </section>
      </div>

      <section className="host-details">
        <Section title="Host details" aside={`protocol ${overview.protocol}`} />
        <Spec rows={[
          { term: "Kernel", value: overview.kernel },
          { term: "Temperature", value: overview.temperature === null ? <em>Sensor unavailable</em> : `${overview.temperature.toFixed(1)} °C` },
          { term: "Network in / out", value: latest?.receivedBytesPerSecond == null ? <em>Waiting for a second sample</em> : `${formatRate(latest.receivedBytesPerSecond)} / ${formatRate(latest.transmittedBytesPerSecond)}` },
          { term: "System services", value: <button type="button" className="link" onClick={() => onOpenApp("services")}>{overview.services.filter((service) => service.active).length} / {overview.services.length} active</button> },
        ]} />
      </section>
    </div>
  );
}
