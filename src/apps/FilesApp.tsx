import {
  ChevronLeft,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderPlus,
  RotateCcw,
  Save,
  Search,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { Act, Btn, Busy, Empty, Field } from "../components/kit";
import { formatBytes, formatTimestamp } from "../lib/format";
import type { DirectoryListing, FileEntry } from "../types";

const root = "/home/arun/apps";
const nameRule = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

type Tree =
  | { kind: "loading"; path: string }
  | { kind: "ready"; listing: DirectoryListing }
  | { kind: "failed"; path: string; message: string };

type Editor =
  | { kind: "idle" }
  | { kind: "loading"; entry: FileEntry }
  | { kind: "ready"; entry: FileEntry; original: string; draft: string; modified: number }
  | { kind: "failed"; entry: FileEntry; message: string };

type Target = { kind: "directory"; path: string } | { kind: "file"; entry: FileEntry };

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "the controller could not reach that path";
}

function glyph(entry: FileEntry): ReactNode {
  if (entry.kind === "directory") return <Folder size={13} />;
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["json", "lock"].includes(extension)) return <FileJson size={13} />;
  if (["yml", "yaml", "toml", "ini", "conf", "cfg", "env"].includes(extension)) return <Settings2 size={13} />;
  if (["py", "ts", "tsx", "js", "jsx", "sh", "go", "rs", "sql"].includes(extension)) return <FileCode2 size={13} />;
  if (["md", "txt", "log"].includes(extension)) return <FileText size={13} />;
  return <File size={13} />;
}

function crumbs(path: string): Array<{ label: string; path: string }> {
  const trail = [{ label: "apps", path: root }];
  if (!path.startsWith(root) || path === root) return trail;
  let walked = root;
  for (const segment of path.slice(root.length).split("/").filter(Boolean)) {
    walked = `${walked}/${segment}`;
    trail.push({ label: segment, path: walked });
  }
  return trail;
}

export default function FilesApp({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  const [tree, setTree] = useState<Tree>({ kind: "loading", path: root });
  const [editor, setEditor] = useState<Editor>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [folder, setFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Target | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const dirty = editor.kind === "ready" && editor.draft !== editor.original;

  const load = useCallback(async (path: string) => {
    setTree({ kind: "loading", path });
    try {
      const listing = await api.files(path);
      setTree({ kind: "ready", listing });
      setEditor({ kind: "idle" });
      setQuery("");
    } catch (error) {
      setTree({ kind: "failed", path, message: describe(error) });
    }
  }, []);

  useEffect(() => { void load(root); }, [load]);

  const open = useCallback(async (entry: FileEntry) => {
    setEditor({ kind: "loading", entry });
    try {
      const file = await api.file(entry.path);
      setEditor({ kind: "ready", entry, original: file.content, draft: file.content, modified: file.modified });
    } catch (error) {
      setEditor({ kind: "failed", entry, message: describe(error) });
    }
  }, []);

  const go = (target: Target) => {
    if (dirty) {
      setPending(target);
      return;
    }
    if (target.kind === "directory") void load(target.path);
    else void open(target.entry);
  };

  const settle = (choice: "leave" | "stay") => {
    const target = pending;
    setPending(null);
    if (choice === "stay" || !target) return;
    if (target.kind === "directory") void load(target.path);
    else void open(target.entry);
  };

  const save = useCallback(async () => {
    if (editor.kind !== "ready" || editor.draft === editor.original) return;
    setSaving(true);
    try {
      const result = await api.saveFile(editor.entry.path, editor.draft);
      setEditor({ ...editor, original: editor.draft, modified: result.modified });
      notify(result.message);
    } catch (error) {
      notify(describe(error), "error");
    } finally {
      setSaving(false);
    }
  }, [editor, notify]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const create = async () => {
    if (tree.kind !== "ready") return;
    const name = folder.trim();
    if (!nameRule.test(name)) {
      notify("letters, numbers, dot, dash and underscore only", "error");
      return;
    }
    try {
      await api.createDirectory(`${tree.listing.path}/${name}`);
      setCreating(false);
      setFolder("");
      notify(`created ${name}`);
      await load(tree.listing.path);
    } catch (error) {
      notify(describe(error), "error");
    }
  };

  const entries = useMemo(() => {
    if (tree.kind !== "ready") return [];
    const needle = query.trim().toLowerCase();
    return needle ? tree.listing.entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : tree.listing.entries;
  }, [query, tree]);

  const path = tree.kind === "ready" ? tree.listing.path : tree.path;
  const parent = tree.kind === "ready" ? tree.listing.parent : null;
  const picked = editor.kind === "idle" ? null : editor.entry.path;
  const lineCount = editor.kind === "ready" ? editor.draft.split("\n").length : 0;

  const moveFocus = (step: 1 | -1) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".entry") ?? [])];
    const index = rows.findIndex((row) => row === document.activeElement);
    rows[Math.min(Math.max(index + step, 0), rows.length - 1)]?.focus();
  };

  return (
    <div className={`files${picked ? " picked" : ""}`}>
      <section className="tree" aria-label="Application files">
        <header className="tree-head">
          <Act label="Parent directory" icon={<ChevronLeft size={13} />} disabled={!parent} onClick={() => parent && go({ kind: "directory", path: parent })} />
          <nav className="crumbs" aria-label="Current path">
            {crumbs(path).map((crumb, index, all) => (
              <span key={crumb.path}>
                {index > 0 && <i aria-hidden="true">/</i>}
                {index === all.length - 1
                  ? <b aria-current="page">{crumb.label}</b>
                  : <button type="button" onClick={() => go({ kind: "directory", path: crumb.path })}>{crumb.label}</button>}
              </span>
            ))}
          </nav>
          <Act label="New folder" icon={<FolderPlus size={13} />} pressed={creating} disabled={tree.kind !== "ready"} onClick={() => setCreating((value) => !value)} />
        </header>

        <div className="tree-filter">
          <Field value={query} onChange={setQuery} label="Filter this directory" placeholder="filter" icon={<Search size={12} />} width="sm" />
        </div>

        {creating && (
          <form className="tree-new" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label className="sr-only" htmlFor="new-folder">Folder name</label>
            <input
              id="new-folder"
              autoFocus
              value={folder}
              placeholder="new-folder"
              spellCheck={false}
              onChange={(event) => setFolder(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setCreating(false)}
            />
            <Btn variant="primary" type="submit" disabled={!folder.trim()}>Create</Btn>
          </form>
        )}

        <div
          className="tree-list"
          ref={listRef}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
            if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
          }}
        >
          {tree.kind === "loading" && <Busy label="reading directory" />}
          {tree.kind === "failed" && (
            <Empty title="cannot read" note={tree.message} action={<Btn variant="line" onClick={() => void load(tree.path)}>Retry</Btn>} />
          )}
          {tree.kind === "ready" && entries.length === 0 && (
            <Empty
              title={query.trim() ? "no match" : "empty"}
              note={query.trim() ? `Nothing here contains "${query.trim()}".` : "This folder has no files or subfolders."}
            />
          )}
          {tree.kind === "ready" && entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="entry"
              aria-current={picked === entry.path ? "true" : undefined}
              onClick={() => go(entry.kind === "directory" ? { kind: "directory", path: entry.path } : { kind: "file", entry })}
            >
              {glyph(entry)}
              <b>{entry.name}</b>
              <span>{entry.kind === "directory" ? "dir" : formatBytes(entry.size)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="pane" aria-label="File editor">
        {editor.kind === "idle" && (
          <Empty
            title="pick a text file"
            note="Files under /home/arun/apps up to 2 MB open here. Saving writes atomically through a temp file and keeps the original permissions."
          />
        )}

        {editor.kind === "loading" && <Busy label={`opening ${editor.entry.name}`} />}

        {editor.kind === "failed" && (
          <Empty
            title={`cannot open ${editor.entry.name}`}
            note={editor.message}
            action={<Btn variant="line" onClick={() => void open(editor.entry)}>Retry</Btn>}
          />
        )}

        {editor.kind === "ready" && (
          <>
            <header className="pane-head">
              <div className="pane-id">
                <Act label="Back to the file list" icon={<ChevronLeft size={13} />} onClick={() => setEditor({ kind: "idle" })} />
                <b>{editor.entry.name}</b>
                <span title={editor.entry.path}>{editor.entry.path}</span>
                {dirty && <span className="dirty">modified</span>}
              </div>
              <div className="acts">
                <Act
                  label="Discard edits"
                  icon={<RotateCcw size={13} />}
                  disabled={!dirty || saving}
                  onClick={() => setEditor({ ...editor, draft: editor.original })}
                />
                <Btn variant="primary" icon={<Save size={13} />} disabled={!dirty || saving} onClick={() => void save()}>
                  {saving ? "Saving" : "Save"}
                </Btn>
              </div>
            </header>

            {pending && (
              <div className="guard" role="alert">
                <p>{editor.entry.name} has unsaved changes.</p>
                <Btn variant="primary" onClick={() => void save().then(() => settle("leave"))}>Save and go</Btn>
                <Btn variant="quiet" onClick={() => settle("leave")}>Discard</Btn>
                <Btn variant="quiet" onClick={() => settle("stay")}>Stay</Btn>
              </div>
            )}

            <div className="editor">
              {/* Gutter scrolls by transform, driven by the textarea, so the two
                  never disagree about which line is which. */}
              <div className="editor-gutter" aria-hidden="true">
                <div ref={gutterRef}>
                  {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
                </div>
              </div>
              <textarea
                aria-label={`Edit ${editor.entry.name}`}
                spellCheck={false}
                wrap="off"
                value={editor.draft}
                onChange={(event) => setEditor({ ...editor, draft: event.target.value })}
                onScroll={(event) => {
                  const node = gutterRef.current;
                  if (node) node.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
                }}
              />
            </div>

            <footer className="pane-foot">
              <span>{lineCount} lines</span>
              <span>{formatBytes(new TextEncoder().encode(editor.draft).length)}</span>
              <span>saved {formatTimestamp(editor.modified)}</span>
              <span className="push">ctrl+s</span>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
