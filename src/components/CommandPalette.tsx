import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlay } from "../hooks/useOverlay";
import { Empty } from "./kit";

export type PaletteCommand = {
  id: string;
  group: string;
  /** Two or three characters shown in the gutter: 03, ↻, ⏻. Cheaper to scan than an icon. */
  mark: string;
  label: string;
  detail: string;
  shortcut?: string;
  keywords?: string;
  tone?: "default" | "danger";
  run: () => void;
};

/**
 * Ranks by where the query lands: a label prefix beats a label hit, which beats
 * a keyword hit. Cheap enough to run on every keystroke for a few dozen entries.
 */
function score(command: PaletteCommand, needle: string): number {
  if (!needle) return 1;
  const label = command.label.toLowerCase();
  if (label.startsWith(needle)) return 100 - label.length;
  const inLabel = label.indexOf(needle);
  if (inLabel >= 0) return 60 - inLabel;
  const rest = `${command.detail} ${command.keywords ?? ""} ${command.group}`.toLowerCase();
  const inRest = rest.indexOf(needle);
  return inRest >= 0 ? 30 - Math.min(inRest, 20) : 0;
}

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const { containerRef, open, requestClose } = useOverlay({ onClose });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return commands
      .map((command) => ({ command, rank: score(command, needle) }))
      .filter((entry) => entry.rank > 0)
      .sort((left, right) => right.rank - left.rank)
      .map((entry) => entry.command);
  }, [commands, query]);

  const groups = useMemo(() => {
    const ordered: Array<{ name: string; items: PaletteCommand[] }> = [];
    for (const command of matches) {
      const bucket = ordered.find((group) => group.name === command.group);
      if (bucket) bucket.items.push(command);
      else ordered.push({ name: command.group, items: [command] });
    }
    return ordered;
  }, [matches]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  const runAt = (index: number) => {
    const command = matches[index];
    if (!command) return;
    command.run();
    requestClose();
  };

  return (
    <div
      className="veil top"
      data-open={open}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className="sheet-surface palette"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={containerRef}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (matches.length ? (index + 1) % matches.length : 0));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (matches.length ? (index - 1 + matches.length) % matches.length : 0));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            runAt(active);
          }
        }}
      >
        <div className="palette-input">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={matches[active] ? `cmd-${matches[active].id}` : undefined}
            aria-label="Search applications and actions"
            placeholder="go to, restart, stop, tail…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" id="palette-list" role="listbox" aria-label="Results" ref={listRef}>
          {matches.length === 0 ? (
            <Empty title="no match" note={`Nothing in this console answers to "${query.trim()}".`} />
          ) : (
            groups.map((group) => (
              <div className="palette-group" key={group.name}>
                <span className="label">{group.name}</span>
                {group.items.map((command) => {
                  const index = matches.indexOf(command);
                  const selected = index === active;
                  return (
                    <button
                      key={command.id}
                      id={`cmd-${command.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-active={selected}
                      className={`palette-item${command.tone === "danger" ? " danger" : ""}`}
                      tabIndex={-1}
                      onMouseMove={() => setActive(index)}
                      onClick={() => runAt(index)}
                    >
                      <span className="palette-kind" aria-hidden="true">{command.mark}</span>
                      <span className="palette-copy">
                        <b>{command.label}</b>
                        <span>{command.detail}</span>
                      </span>
                      {command.shortcut && <kbd>{command.shortcut}</kbd>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <footer className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>Alt</kbd><kbd>1</kbd>–<kbd>7</kbd> jump</span>
          <span className="push">{matches.length} of {commands.length}</span>
        </footer>
      </div>
    </div>
  );
}
