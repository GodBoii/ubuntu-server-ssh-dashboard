import { CheckCircle2, History, Search, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, EmptyState, SearchField, SegmentedControl, type Segment } from "../components/primitives";
import { formatLatency, formatRelativeTime, formatTimestamp, humanize } from "../lib/format";
import type { AuditEntry } from "../types";

type OutcomeFilter = "all" | "success" | "failure";

const filters: ReadonlyArray<Segment<OutcomeFilter>> = [
  { value: "all", label: "All" },
  { value: "success", label: "Succeeded" },
  { value: "failure", label: "Failed" },
];

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function dayKey(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown date" : dayFormatter.format(date);
}

export default function ActivityApp({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  const counts = useMemo(() => ({
    all: entries.length,
    success: entries.filter((entry) => entry.outcome === "success").length,
    failure: entries.filter((entry) => entry.outcome === "failure").length,
  }), [entries]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (outcome !== "all" && entry.outcome !== outcome) return false;
      if (!needle) return true;
      return `${entry.action} ${entry.target} ${entry.detail}`.toLowerCase().includes(needle);
    });
  }, [entries, outcome, query]);

  const days = useMemo(() => {
    const grouped: Array<{ day: string; items: AuditEntry[] }> = [];
    for (const entry of visible) {
      const day = dayKey(entry.timestamp);
      const bucket = grouped.find((item) => item.day === day);
      if (bucket) bucket.items.push(entry);
      else grouped.push({ day, items: [entry] });
    }
    return grouped;
  }, [visible]);

  const filtersActive = Boolean(query.trim()) || outcome !== "all";

  return (
    <div className="app-column">
      <header className="app-toolbar">
        <div className="toolbar-identity">
          <h1>Activity</h1>
          <p>Every container, stack and file change this controller performed{counts.failure > 0 ? ` · ${counts.failure} failed` : ""}</p>
        </div>
        <div className="toolbar-controls">
          <SegmentedControl
            label="Filter by outcome"
            options={filters.map((filter) => ({ ...filter, count: counts[filter.value] }))}
            value={outcome}
            onChange={setOutcome}
          />
          <SearchField value={query} onChange={setQuery} label="Search activity" placeholder="Search action or target" icon={<Search size={15} />} />
        </div>
      </header>

      <div className="activity-scroll">
        {visible.length === 0 ? (
          <EmptyState
            icon={<History size={22} />}
            title={filtersActive ? "No matching activity" : "No management actions yet"}
            detail={filtersActive
              ? "Nothing in the local audit log matches this search."
              : "Container restarts, stack changes and file saves are appended to data/audit/actions.jsonl as they happen."}
            action={filtersActive ? <Button variant="secondary" size="compact" onClick={() => { setQuery(""); setOutcome("all"); }}>Clear filters</Button> : undefined}
          />
        ) : (
          days.map((group) => (
            <section className="activity-day" key={group.day}>
              <h2>{group.day}</h2>
              {group.items.map((entry) => (
                <article key={entry.id} className={`activity-row ${entry.outcome}`}>
                  <span className="activity-mark" aria-hidden="true">
                    {entry.outcome === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  </span>
                  <div className="activity-body">
                    <p className="activity-headline">
                      <strong>{humanize(entry.action)}</strong>
                      <span className="mono-cell">{entry.target}</span>
                    </p>
                    <p className="activity-detail">{entry.detail}</p>
                  </div>
                  <div className="activity-meta">
                    <time dateTime={entry.timestamp} title={formatTimestamp(new Date(entry.timestamp))}>
                      {formatRelativeTime(new Date(entry.timestamp).getTime())}
                    </time>
                    {entry.durationMs !== null && <span>{formatLatency(entry.durationMs)}</span>}
                  </div>
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
