const width = 240;
const pad = 3;

/**
 * The signature element: a stepped CPU trace bled into the header, so the top
 * edge of the app is the instrument itself. Steps rather than a smooth curve
 * because the data is discrete samples, and no area fill because a filled
 * sparkline says nothing the line does not.
 */
export function Trace({ series, ceiling = 100, label }: { series: number[]; ceiling?: number; label: string }) {
  if (series.length < 2) {
    return (
      <div className="trace" role="img" aria-label={`${label}: waiting for a second sample`}>
        <span className="trace-empty" />
      </div>
    );
  }

  const height = 56;
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

  return (
    <svg
      className="trace"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${Math.round(latest)} of ${ceiling}, ${series.length} samples`}
    >
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
      <line className="trace-base" x1={0} x2={width} y1={height - pad} y2={height - pad} vectorEffect="non-scaling-stroke" />
      <polyline className="trace-line" points={points.join(" ")} vectorEffect="non-scaling-stroke" />
      <rect className="trace-head" x={width - 2} y={y(latest) - 1} width={2} height={2} />
    </svg>
  );
}
