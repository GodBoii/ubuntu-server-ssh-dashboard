const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${byteUnits[unit]}`;
}

export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "-";
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

/** Coarse, dashboard-style duration. `formatPreciseDuration` keeps minutes visible for short spans. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "-";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.floor(totalSeconds)}s`;
}

export function formatLatency(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "-";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "-";
  return `${clampPercent(value).toFixed(digits)}%`;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  // Intl throws a RangeError on NaN, and one bad timestamp must not take down a screen.
  if (!Number.isFinite(timestamp)) return "-";
  const seconds = (timestamp - now) / 1000;
  let value = seconds;
  for (const [unit, step] of relativeUnits) {
    if (Math.abs(value) < step) return relativeFormatter.format(Math.round(value), unit);
    value /= step;
  }
  return relativeFormatter.format(Math.round(value), "year");
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** `Intl.DateTimeFormat.format` throws on an invalid date, so every caller goes through this. */
function safeFormat(formatter: Intl.DateTimeFormat, value: number | Date): string {
  const time = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(time) ? formatter.format(time) : "-";
}

export const formatClock = (value: number | Date) => safeFormat(timeFormatter, value);
export const formatTimestamp = (value: number | Date) => safeFormat(dateTimeFormatter, value);
export const formatDay = (value: number | Date) => safeFormat(dayFormatter, value);

/** Turns `container-restart` into `Container restart` for audit rows and dialogs. */
export function humanize(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
