import { ArrowDown, Download, Eraser, Pause, Play, RotateCcw, Search, WrapText } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Act, Empty, Field, Lamp, Picker } from "../components/kit";
import type { LogLine } from "../hooks/useLogStream";
import { useLogStream } from "../hooks/useLogStream";
import { containerHealth } from "../lib/telemetry";
import type { ContainerInfo } from "../types";

const depths = [
  { value: "200", label: "200 lines" },
  { value: "500", label: "500 lines" },
  { value: "1000", label: "1000 lines" },
  { value: "2000", label: "2000 lines" },
] as const;

const renderWindow = 1500;
const pinnedSlack = 40;

const Row = memo(function Row({ line, needle }: { line: LogLine; needle: string }) {
  return (
    <div className={`line ${line.level}`}>
      <span className="line-no">{line.id + 1}</span>
      <span className="line-time">{line.time ?? ""}</span>
      <code>{needle ? <Hit text={line.text} needle={needle} /> : line.text}</code>
    </div>
  );
});

function Hit({ text, needle }: { text: string; needle: string }) {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

export default function LogsApp({
  containers,
  token,
  initialContainer,
  notify,
}: {
  containers: ContainerInfo[];
  token: string;
  initialContainer: string | null;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const fallback = containers.find((container) => container.state === "running") ?? containers[0];
  const [picked, setPicked] = useState(() => initialContainer ?? fallback?.name ?? "");
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [needle, setNeedle] = useState("");
  const [streamQuery, setStreamQuery] = useState("");
  const [depth, setDepth] = useState<string>("500");
  const [pinned, setPinned] = useState(true);
  const viewRef = useRef<HTMLDivElement>(null);

  const { state, lines, buffered, clear, reconnect } = useLogStream({
    container: picked,
    token,
    tail: Number(depth),
    paused,
  });

  useEffect(() => {
    if (initialContainer) setPicked(initialContainer);
  }, [initialContainer]);

  useEffect(() => {
    if (!picked && fallback) setPicked(fallback.name);
  }, [fallback, picked]);

  const streams = useMemo(() => {
    const filter = streamQuery.trim().toLowerCase();
    return containers.filter((container) => !filter || container.name.toLowerCase().includes(filter));
  }, [containers, streamQuery]);

  const shown = useMemo(() => {
    const filter = needle.trim().toLowerCase();
    const matched = filter ? lines.filter((line) => line.text.toLowerCase().includes(filter)) : lines;
    return matched.length > renderWindow ? matched.slice(matched.length - renderWindow) : matched;
  }, [lines, needle]);

  const onScroll = useCallback(() => {
    const node = viewRef.current;
    if (!node) return;
    setPinned(node.scrollHeight - node.scrollTop - node.clientHeight <= pinnedSlack);
  }, []);

  useLayoutEffect(() => {
    const node = viewRef.current;
    if (node && pinned) node.scrollTop = node.scrollHeight;
  }, [pinned, shown]);

  const save = () => {
    if (lines.length === 0) return;
    const body = lines.map((line) => `${line.time ?? ""} ${line.text}`.trim()).join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${picked || "container"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`saved ${lines.length} lines`, "info");
  };

  const status = state.kind === "streaming"
    ? paused ? `paused${buffered > 0 ? ` · ${buffered} held` : ""}` : "following"
    : state.kind === "connecting" ? "attaching"
    : state.kind === "closed" ? state.message
    : "pick a stream";

  return (
    <div className="logs">
      <aside className="streams" aria-label="Log streams">
        <div className="streams-head">
          <Field value={streamQuery} onChange={setStreamQuery} label="Filter streams" placeholder="filter" icon={<Search size={12} />} width="sm" />
        </div>
        <div className="streams-list">
          {streams.length === 0 ? (
            <p className="note" style={{ padding: "8px 12px" }}>No name matches.</p>
          ) : streams.map((container) => {
            const health = containerHealth(container);
            return (
              <button
                key={container.id}
                type="button"
                className="stream"
                aria-current={picked === container.name ? "true" : undefined}
                onClick={() => setPicked(container.name)}
              >
                <Lamp level={health === "healthy" ? "ok" : health === "degraded" ? "warn" : health === "connecting" ? "live" : "fail"} />
                <span>{container.name}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="log-view">
        <header className="app-head">
          <div className="app-title">
            <h1>{picked || "logs"}</h1>
            <p>{status}</p>
          </div>
          <div className="app-tools">
            <Field value={needle} onChange={setNeedle} label="Filter lines" placeholder="filter lines" icon={<Search size={13} />} />
            <Picker label="History depth" value={depth} onChange={setDepth} options={depths} />
            <div className="acts">
              <Act
                label={paused ? "Resume" : "Pause"}
                icon={paused ? <Play size={13} /> : <Pause size={13} />}
                pressed={paused}
                onClick={() => setPaused((value) => !value)}
              />
              <Act label="Wrap long lines" icon={<WrapText size={13} />} pressed={wrap} onClick={() => setWrap((value) => !value)} />
              <Act label="Clear the view" icon={<Eraser size={13} />} onClick={clear} disabled={lines.length === 0} />
              <Act label="Download buffer" icon={<Download size={13} />} onClick={save} disabled={lines.length === 0} />
              <Act label="Reattach" icon={<RotateCcw size={13} />} onClick={reconnect} />
            </div>
          </div>
        </header>

        <div
          className={`log-lines${wrap ? " wrap" : ""}`}
          ref={viewRef}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          aria-label={`Output for ${picked || "no container"}`}
          tabIndex={0}
        >
          {shown.length === 0 ? (
            <Empty
              title={needle.trim() ? "no line matches" : "waiting for output"}
              note={needle.trim()
                ? `${lines.length} lines buffered, none containing "${needle.trim()}".`
                : "Docker is attached to this container. Lines appear the moment they are written."}
            />
          ) : (
            shown.map((line) => <Row key={line.id} line={line} needle={needle.trim()} />)
          )}
        </div>

        {!pinned && (
          <button type="button" className="tail-jump" onClick={() => setPinned(true)}>
            <ArrowDown size={12} aria-hidden="true" />
            follow tail
          </button>
        )}

        <footer className="log-foot">
          <span>{lines.length} buffered</span>
          {needle.trim() && <span>{shown.length} matching</span>}
          <span className="legend">
            <span><i style={{ background: "var(--lamp-fail)" }} /> error</span>
            <span><i style={{ background: "var(--lamp-warn)" }} /> warn</span>
            <span><i style={{ background: "var(--rule-hi)" }} /> info</span>
          </span>
        </footer>
      </section>
    </div>
  );
}
