import { clampPercent } from "./format";
import type { ContainerInfo, HealthLevel, Overview, Telemetry } from "../types";

export const telemetryHistoryLimit = 90;

/**
 * Turns two consecutive host samples into rates. CPU comes from /proc/stat
 * jiffies and network from /proc/net/dev counters, so both need a previous
 * sample. The first reading after a reconnect reports `null` rather than a
 * fabricated zero.
 */
export function deriveTelemetry(previous: Overview | null, current: Overview): Telemetry {
  const elapsedSeconds = previous ? (current.timestamp - previous.timestamp) / 1000 : 0;
  return {
    at: current.timestamp,
    cpuPercent: cpuPercent(previous, current),
    memoryPercent: ratio(current.memory.used, current.memory.total),
    diskPercent: ratio(current.disk.used, current.disk.total),
    loadPercent: clampPercent((current.load[0] / current.cpuCount) * 100),
    receivedBytesPerSecond: rate(previous?.network?.receivedBytes, current.network?.receivedBytes, elapsedSeconds),
    transmittedBytesPerSecond: rate(previous?.network?.transmittedBytes, current.network?.transmittedBytes, elapsedSeconds),
  };
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? clampPercent((part / whole) * 100) : 0;
}

function cpuPercent(previous: Overview | null, current: Overview): number | null {
  const before = previous?.cpuSample;
  const after = current.cpuSample;
  if (!before || !after) return null;
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  // Counters reset when the host reboots.
  if (totalDelta <= 0 || idleDelta < 0) return null;
  return clampPercent(((totalDelta - idleDelta) / totalDelta) * 100);
}

function rate(before: number | undefined, after: number | undefined, elapsedSeconds: number): number | null {
  if (before === undefined || after === undefined || elapsedSeconds <= 0) return null;
  const delta = after - before;
  if (delta < 0) return null;
  return delta / elapsedSeconds;
}

export function appendTelemetry(history: Telemetry[], sample: Telemetry): Telemetry[] {
  const last = history.at(-1);
  if (last && last.at === sample.at) return history;
  const next = [...history, sample];
  return next.length > telemetryHistoryLimit ? next.slice(next.length - telemetryHistoryLimit) : next;
}

export function seriesOf(history: Telemetry[], pick: (sample: Telemetry) => number | null): number[] {
  const values: number[] = [];
  for (const sample of history) {
    const value = pick(sample);
    if (value !== null) values.push(value);
  }
  return values;
}

/** The single status word for one container, used by dots, filters and counters. */
export function containerHealth(container: ContainerInfo): HealthLevel {
  if (container.state === "restarting") return "degraded";
  if (container.state !== "running") return "stopped";
  if (container.health === null) return "healthy";
  if (container.health === "healthy") return "healthy";
  if (container.health === "starting") return "connecting";
  return "degraded";
}

export function containerStatusLabel(container: ContainerInfo): string {
  if (container.state === "running" && container.health) return container.health;
  return container.state;
}

export type HostSummary = {
  running: number;
  total: number;
  unhealthy: number;
  healthyStacks: number;
  totalStacks: number;
  inactiveServices: string[];
};

export function summarize(overview: Overview): HostSummary {
  const running = overview.containers.filter((container) => container.state === "running").length;
  const unhealthy = overview.containers.filter((container) => containerHealth(container) === "degraded").length;
  return {
    running,
    total: overview.containers.length,
    unhealthy,
    healthyStacks: overview.stacks.filter((stack) => stack.status === "healthy").length,
    totalStacks: overview.stacks.length,
    inactiveServices: overview.services.filter((service) => !service.active).map((service) => service.name),
  };
}
