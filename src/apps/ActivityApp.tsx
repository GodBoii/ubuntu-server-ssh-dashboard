import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Choices, Empty, Field, Lamp, type Choice } from "../components/kit";
import { formatClock, formatLatency, formatTimestamp, humanize } from "../lib/format";
import type { AuditEntry } from "../types";

type OutcomeFilter = "all" | "success" | "failure";

const filters: ReadonlyArray<Choice<OutcomeFilter>> = [
  { value: "all", label: "all" },
  { value: "success", label: "done" },
  { value: "failure", label: "failed" },
];

const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "2-digit", month: "short" });

export default function ActivityApp({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  const counts = useMemo(() => ({
    all: entries.length,
    success: entries.filter((entry) => entry.outcome === "success").length,
    failure: entries.filter((entry) => entry.outcome === "failure").length,
  }), [entries]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (outcome !== "all" && entry.outcome !== outcome) return false;
      if (!needle) return true;
      return `${entry.action} ${entry.target} ${entry.detail}`.toLowerCase().includes(needle);
    });
  }, [entries, outcome, query]);

  const days = useMemo(() => {
    const grouped: Array<{ key: string; label: string; items: AuditEntry[] }> = [];
    for (const entry of rows) {
      const date = new Date(entry.timestamp);
      const key = Number.isNaN(date.getTime()) ? "unknown" : date.toDateString();
      const bucket = grouped.find((group) => group.key === key);
      if (bucket) bucket.items.push(entry);
      else grouped.push({ key, label: Number.isNaN(date.getTime()) ? "unknown date" : dayLabel.format(date), items: [entry] });
    }
    return grouped;
  }, [rows]);

  const filtered = Boolean(query.trim()) || outcome !== "all";

  return (
    <div className="app">
      <header className="app-head">
        <div className="app-title">
          <h1>Activity</h1>
          <p>{counts.all} recorded{counts.failure > 0 ? ` · ${counts.failure} failed` : ""}</p>
        </div>
        <div className="app-tools">
          <Choices label="Filter by outcome" options={filters.map((item) => ({ ...item, count: counts[item.value] }))} value={outcome} onChange={setOutcome} />
          <Field value={query} onChange={setQuery} label="Search activity" placeholder="action or target" icon={<Search size={13} />} />
        </div>
      </header>

      <div className="ledger">
        {rows.length === 0 ? (
          <Empty
            title={filtered ? "nothing matches" : "no actions yet"}
            note={filtered
              ? "Nothing in the local ledger matches this filter."
              : "Container restarts, stack changes and file saves are appended to data/audit/actions.jsonl as they happen."}
            action={filtered ? <Btn variant="line" onClick={() => { setQuery(""); setOutcome("all"); }}>Clear filters</Btn> : undefined}
          />
        ) : (
          days.map((day) => (
            <section key={day.key}>
              <h2 className="ledger-day">
                {day.label}
                <span>{day.items.length} entries</span>
              </h2>
              {day.items.map((entry) => (
                <article className="ledger-row" key={entry.id}>
                  <time dateTime={entry.timestamp} title={formatTimestamp(new Date(entry.timestamp))}>
                    {formatClock(new Date(entry.timestamp))}
                  </time>
                  <Lamp level={entry.outcome === "success" ? "ok" : "fail"} />
                  <div className="ledger-what">
                    <b>
                      {humanize(entry.action)}
                      <i>{entry.target}</i>
                    </b>
                    <span>{entry.detail}</span>
                  </div>
                  <u>{entry.durationMs === null ? "" : formatLatency(entry.durationMs)}</u>
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
