import { useId } from "react";

const width = 240;
const height = 60;
const pad = 4;

/**
 * Stepped CPU trace bled into the header. Steps rather than a smooth curve
 * because the data is discrete samples. A faint fill under the line gives the
 * reading weight without competing with it.
 */
export function Trace({ series, ceiling = 100, label }: { series: number[]; ceiling?: number; label: string }) {
  // React ids contain characters that break `url(#...)` references.
  const gradientId = `trace-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (series.length < 2) {
    return (
      <div className="trace trace-waiting" role="img" aria-label={`${label}: waiting for a second sample`}>
        <span className="trace-empty">waiting for a second sample</span>
      </div>
    );
  }

  const usable = height - pad * 2;
  const step = width / (series.length - 1);
  const y = (value: number) => pad + usable - (Math.min(Math.max(value, 0), ceiling) / ceiling) * usable;

  // Step-after path: hold each sample until the next one arrives.
  const points: string[] = [`0,${y(series[0] ?? 0).toFixed(2)}`];
  for (let index = 1; index < series.length; index += 1) {
    const x = (index * step).toFixed(2);
    const current = y(series[index] ?? 0).toFixed(2);
    points.push(`${x},${points[points.length - 1]?.split(",")[1] ?? current}`, `${x},${current}`);
  }

  const latest = series[series.length - 1] ?? 0;
  const ticks = [0.25, 0.5, 0.75];
  const base = height - pad;
  const area = `M0,${base} L${points.join(" L")} L${width},${base} Z`;
  const tone = latest >= 90 ? "fail" : latest >= 75 ? "warn" : "ok";

  return (
    <svg
      className={`trace ${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${Math.round(latest)} of ${ceiling}, ${series.length} samples`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((fraction) => (
        <line
          key={fraction}
          className="trace-tick"
          x1={0}
          x2={width}
          y1={pad + usable * fraction}
          y2={pad + usable * fraction}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="1 5"
        />
      ))}
      <line className="trace-base" x1={0} x2={width} y1={base} y2={base} vectorEffect="non-scaling-stroke" />
      <path className="trace-area" d={area} fill={`url(#${gradientId})`} />
      <polyline className="trace-line" points={points.join(" ")} vectorEffect="non-scaling-stroke" />
      <rect className="trace-head" x={width - 2.5} y={y(latest) - 1.5} width={2.5} height={3} rx={1} />
    </svg>
  );
}
