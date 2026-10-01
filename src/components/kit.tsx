import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { clampPercent } from "../lib/format";

export type LampLevel = "ok" | "warn" | "fail" | "idle" | "live";
export type BarTone = "ok" | "warn" | "fail" | "signal" | "idle";

/** Square indicator lamp. Always paired with a word: colour never carries meaning alone. */
export function Lamp({ level }: { level: LampLevel }) {
  return <span className={`lamp ${level}`} aria-hidden="true" />;
}

export function State({ level, children }: { level: LampLevel; children: ReactNode }) {
  return (
    <span className="state">
      <Lamp level={level} />
      {children}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>;
}

/** Section heading: an optional icon, a label, and a hairline running off to the right edge. */
export function Section({ title, aside, icon }: { title: string; aside?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="section">
      {icon && <span className="section-icon" aria-hidden="true">{icon}</span>}
      <span className="label">{title}</span>
      {aside && <span className="push">{aside}</span>}
    </div>
  );
}

/** Large mono reading with a small unit. The unit never competes with the number. */
export function Figure({ value, unit, size = "md" }: { value: string; unit?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`figure ${size}`}>
      {value}
      {unit && <em>{unit}</em>}
    </span>
  );
}

export function toneForLoad(percent: number): BarTone {
  if (percent >= 90) return "fail";
  if (percent >= 75) return "warn";
  return "signal";
}

export function Bar({ percent, tone = "signal", label }: { percent: number; tone?: BarTone; label: string }) {
  const value = clampPercent(percent);
  return (
    <div
      className={`bar ${tone}`}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ transform: `scaleX(${value / 100})` }} />
    </div>
  );
}

const gaugeRadius = 22;
const gaugeLength = 2 * Math.PI * gaugeRadius;

/** Ring reading for a percentage. Decorative: the figure beside it carries the value. */
export function Gauge({ percent, tone = "signal" }: { percent: number; tone?: BarTone }) {
  const value = clampPercent(percent);
  return (
    <svg className={`gauge ${tone}`} viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
      <circle className="gauge-track" cx="28" cy="28" r={gaugeRadius} />
      <circle
        className="gauge-fill"
        cx="28"
        cy="28"
        r={gaugeRadius}
        strokeDasharray={gaugeLength}
        strokeDashoffset={gaugeLength * (1 - value / 100)}
      />
      <text x="28" y="31.5" textAnchor="middle">{Math.round(value)}</text>
    </svg>
  );
}

type ButtonBase = Omit<ComponentPropsWithRef<"button">, "className" | "children">;

export function Btn({
  children,
  icon,
  variant = "line",
  wide = false,
  ...rest
}: ButtonBase & {
  children: ReactNode;
  icon?: ReactNode;
  variant?: "primary" | "line" | "quiet" | "danger";
  wide?: boolean;
}) {
  return (
    <button type="button" className={`btn ${variant}${wide ? " wide" : ""}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/**
 * Icon-only action. `label` is the accessible name and the tooltip text, so an
 * icon cannot ship without one.
 */
export function Act({
  label,
  icon,
  tone = "plain",
  side = "top",
  pressed,
  ...rest
}: ButtonBase & {
  label: string;
  icon: ReactNode;
  tone?: "plain" | "danger" | "go";
  side?: "top" | "right";
  pressed?: boolean;
}) {
  return (
    <span className={`tip${side === "right" ? " right" : ""}`}>
      <button
        type="button"
        className={`act${tone === "plain" ? "" : ` ${tone}`}`}
        aria-label={label}
        aria-pressed={pressed}
        {...rest}
      >
        {icon}
      </button>
      <span className="tip-body" aria-hidden="true">{label}</span>
    </span>
  );
}

/** Underline input. Boxed fields everywhere is the look this console avoids. */
export function Field({
  value,
  onChange,
  placeholder,
  label,
  icon,
  width = "md",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  icon: ReactNode;
  width?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div className={`field w-${width}`}>
      {icon}
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
      />
    </div>
  );
}

export function Picker<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  label: string;
}) {
  const id = useId();
  return (
    <span className="picker">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </span>
  );
}

export type Choice<T extends string> = { value: T; label: string; count?: number };

/** Filter row: text toggles with a count, underlined when checked. */
export function Choices<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const move = (step: 1 | -1) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      className="choices"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className="choice"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && <u>{option.count}</u>}
          </button>
        );
      })}
    </div>
  );
}

export type SpecRow = { term: string; value: ReactNode };

/** The replacement for a card: label and value on a hairline row. */
export function Spec({ rows }: { rows: SpecRow[] }) {
  return (
    <dl className="spec">
      {rows.map((row) => (
        <div key={row.term}>
          <dt>{row.term}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ title, note, action, icon }: { title: string; note: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">{icon ?? <Inbox size={18} strokeWidth={1.75} />}</span>
      <b>{title}</b>
      <p>{note}</p>
      {action}
    </div>
  );
}

export function Busy({ label = "reading the ubuntu host" }: { label?: string }) {
  return (
    <div className="busy" role="status">
      <span className="busy-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
      <span className="busy-rows" aria-hidden="true"><i /><i /><i /><i /></span>
    </div>
  );
}

export function Skeleton({ width }: { width: number }) {
  return <span className="skeleton" style={{ width: `${width}px` }} aria-hidden="true" />;
}

/**
 * Tracks the offset of the current item so a single marker can slide between
 * entries instead of seven independent highlights fading in and out.
 */
export function useSlidingMarker(activeKey: string): {
  listRef: React.RefObject<HTMLDivElement | null>;
  offset: number;
} {
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) setOffset(active.offsetTop);
  }, []);

  useLayoutEffect(measure, [activeKey, measure]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);

  return { listRef, offset };
}
