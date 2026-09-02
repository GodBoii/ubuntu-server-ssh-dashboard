import { CircleStop, Play, RotateCw, ScrollText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Act, Btn, Choices, Empty, Field, Lamp, Picker, State, type Choice } from "../components/kit";
import { formatRelativeTime } from "../lib/format";
import { containerHealth, containerStatusLabel } from "../lib/telemetry";
import type { ContainerInfo } from "../types";

type ContainerAction = "start" | "stop" | "restart";
type StateFilter = "all" | "running" | "stopped" | "attention";
type SortKey = "state" | "name" | "project" | "image";

const filters: ReadonlyArray<Choice<StateFilter>> = [
  { value: "all", label: "all" },
  { value: "running", label: "running" },
  { value: "stopped", label: "stopped" },
  { value: "attention", label: "attention" },
];

function keep(container: ContainerInfo, filter: StateFilter): boolean {
  if (filter === "running") return container.state === "running";
  if (filter === "stopped") return container.state !== "running";
  if (filter === "attention") return containerHealth(container) === "degraded";
  return true;
}

function order(left: ContainerInfo, right: ContainerInfo, key: SortKey): number {
  const byName = left.name.localeCompare(right.name);
  if (key === "state") return (left.state === "running" ? 0 : 1) - (right.state === "running" ? 0 : 1) || byName;
  if (key === "project") return (left.project ?? "~").localeCompare(right.project ?? "~") || byName;
  if (key === "image") return left.image.localeCompare(right.image) || byName;
  return byName;
}

function uptime(container: ContainerInfo): string {
  if (container.state !== "running" || !container.startedAt) return "—";
  const started = Date.parse(container.startedAt);
  return Number.isFinite(started) ? formatRelativeTime(started) : "—";
}

export default function ContainersApp({
  containers,
  selected,
  onSelect,
  onAction,
  onInspectLogs,
}: {
  containers: ContainerInfo[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  onAction: (container: ContainerInfo, action: ContainerAction) => void;
  onInspectLogs: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [filter, setFilter] = useState<StateFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "state", descending: false });

  const projects = useMemo(
    () => [...new Set(containers.map((item) => item.project).filter((value): value is string => Boolean(value)))].sort(),
    [containers],
  );

  const counts = useMemo(() => ({
    all: containers.length,
    running: containers.filter((container) => container.state === "running").length,
    stopped: containers.filter((container) => container.state !== "running").length,
    attention: containers.filter((container) => containerHealth(container) === "degraded").length,
  }), [containers]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = containers.filter((container) => {
      if (!keep(container, filter)) return false;
      if (project !== "all" && container.project !== project) return false;
      if (!needle) return true;
      return `${container.name} ${container.image} ${container.service ?? ""} ${container.project ?? ""}`.toLowerCase().includes(needle);
    });
    const sorted = [...kept].sort((left, right) => order(left, right, sort.key));
    return sort.descending ? sorted.reverse() : sorted;
  }, [containers, filter, project, query, sort.descending, sort.key]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => current.key === key ? { key, descending: !current.descending } : { key, descending: false });
  const sortState = (key: SortKey) => sort.key === key ? (sort.descending ? "descending" : "ascending") : "none";

  const filtered = Boolean(query.trim()) || project !== "all" || filter !== "all";
  const reset = () => {
    setQuery("");
    setProject("all");
    setFilter("all");
  };

  return (
    <div className="app">
      <header className="app-head">
        <div className="app-title">
          <h1>Containers</h1>
          <p>{counts.running}/{counts.all} up{counts.attention > 0 ? ` · ${counts.attention} unhealthy` : ""}</p>
        </div>
        <div className="app-tools">
          <Choices label="Filter by state" options={filters.map((item) => ({ ...item, count: counts[item.value] }))} value={filter} onChange={setFilter} />
          {projects.length > 0 && (
            <Picker
              label="Filter by compose project"
              value={project}
              onChange={setProject}
              options={[{ value: "all", label: "all projects" }, ...projects.map((item) => ({ value: item, label: item }))]}
            />
          )}
          <Field value={query} onChange={setQuery} label="Search containers" placeholder="name, image, service" icon={<Search size={13} />} />
        </div>
      </header>

      <div className="scroller">
        {rows.length === 0 ? (
          <Empty
            title={filtered ? "nothing matches" : "no containers"}
            note={filtered
              ? "Docker reported containers, but none of them pass the current state, project and search filters."
              : "Docker is reachable and reports no containers. Start a stack from the machine sheet."}
            action={filtered ? <Btn variant="line" onClick={reset}>Clear filters</Btn> : undefined}
          />
        ) : (
          <table className="grid">
            <colgroup>
              <col style={{ width: "112px" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "140px" }} />
              <col />
              <col style={{ width: "150px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "120px" }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" aria-sort={sortState("state")}><button type="button" className="sortable" onClick={() => toggleSort("state")}>State</button></th>
                <th scope="col" aria-sort={sortState("name")}><button type="button" className="sortable" onClick={() => toggleSort("name")}>Container</button></th>
                <th scope="col" aria-sort={sortState("project")}><button type="button" className="sortable" onClick={() => toggleSort("project")}>Project</button></th>
                <th scope="col" aria-sort={sortState("image")}><button type="button" className="sortable" onClick={() => toggleSort("image")}>Image</button></th>
                <th scope="col">Ports</th>
                <th scope="col">Started</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((container) => {
                const health = containerHealth(container);
                const running = container.state === "running";
                const picked = selected === container.name;
                return (
                  <tr key={container.id} aria-selected={picked}>
                    <td><State level={health === "connecting" ? "live" : health === "healthy" ? "ok" : health === "degraded" ? "warn" : "fail"}>{containerStatusLabel(container)}</State></td>
                    <td className="name">
                      <button
                        type="button"
                        className="cell-btn"
                        aria-expanded={picked}
                        onClick={() => onSelect(picked ? null : container.name)}
                      >
                        {container.name}
                      </button>
                    </td>
                    <td className="dim">{container.project ?? "—"}{container.service ? ` / ${container.service}` : ""}</td>
                    <td className="dim" title={container.image}>{container.image}</td>
                    <td className="dim" title={container.ports || "no published ports"}>{container.ports || "—"}</td>
                    <td className="dim num">{uptime(container)}</td>
                    <td>
                      <div className="acts">
                        <Act label={`Tail ${container.name}`} icon={<ScrollText size={13} />} onClick={() => onInspectLogs(container.name)} />
                        {running ? (
                          <>
                            <Act label={`Restart ${container.name}`} icon={<RotateCw size={13} />} onClick={() => onAction(container, "restart")} />
                            <Act label={`Stop ${container.name}`} icon={<CircleStop size={13} />} tone="danger" onClick={() => onAction(container, "stop")} />
                          </>
                        ) : (
                          <Act label={`Start ${container.name}`} icon={<Play size={13} />} tone="go" onClick={() => onAction(container, "start")} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="foot">
        <span>{rows.length} of {containers.length} shown</span>
        <span className="legend">
          <span><Lamp level="ok" /> healthy</span>
          <span><Lamp level="warn" /> unhealthy</span>
          <span><Lamp level="fail" /> stopped</span>
        </span>
      </footer>
    </div>
  );
}
