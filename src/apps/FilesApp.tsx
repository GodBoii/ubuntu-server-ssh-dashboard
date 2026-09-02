import {
  ChevronLeft,
  ChevronRight,
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
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, IconButton, LoadingState, SearchField } from "../components/primitives";
import { formatBytes, formatTimestamp } from "../lib/format";
import type { DirectoryListing, FileEntry } from "../types";

const rootPath = "/home/arun/apps";
const folderNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

type Browser =
  | { kind: "loading"; path: string }
  | { kind: "ready"; listing: DirectoryListing }
  | { kind: "failed"; path: string; message: string };

type Editor =
  | { kind: "empty" }
  | { kind: "loading"; entry: FileEntry }
  | { kind: "ready"; entry: FileEntry; original: string; draft: string; modified: number }
  | { kind: "failed"; entry: FileEntry; message: string };

type Pending = { kind: "directory"; path: string } | { kind: "file"; entry: FileEntry };

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The controller could not reach that path";
}

function iconFor(entry: FileEntry): ReactNode {
  if (entry.kind === "directory") return <Folder size={16} />;
  const extension = entry.name.includes(".") ? entry.name.split(".").pop()?.toLowerCase() ?? "" : "";
  if (["json", "lock"].includes(extension)) return <FileJson size={16} />;
  if (["yml", "yaml", "toml", "ini", "conf", "cfg", "env"].includes(extension)) return <Settings2 size={16} />;
  if (["py", "ts", "tsx", "js", "jsx", "sh", "go", "rs", "sql"].includes(extension)) return <FileCode2 size={16} />;
  if (["md", "txt", "log"].includes(extension)) return <FileText size={16} />;
  return <File size={16} />;
}

function crumbsFor(path: string): Array<{ label: string; path: string }> {
  const crumbs = [{ label: "apps", path: rootPath }];
  if (!path.startsWith(rootPath) || path === rootPath) return crumbs;
  let walked = rootPath;
  for (const segment of path.slice(rootPath.length).split("/").filter(Boolean)) {
    walked = `${walked}/${segment}`;
    crumbs.push({ label: segment, path: walked });
  }
  return crumbs;
}

export default function FilesApp({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  const [browser, setBrowser] = useState<Browser>({ kind: "loading", path: rootPath });
  const [editor, setEditor] = useState<Editor>({ kind: "empty" });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const dirty = editor.kind === "ready" && editor.draft !== editor.original;

  const loadDirectory = useCallback(async (path: string) => {
    setBrowser({ kind: "loading", path });
    try {
      const listing = await api.files(path);
      setBrowser({ kind: "ready", listing });
      setEditor({ kind: "empty" });
      setQuery("");
    } catch (error) {
      setBrowser({ kind: "failed", path, message: describe(error) });
    }
  }, []);

  useEffect(() => { void loadDirectory(rootPath); }, [loadDirectory]);

  const openFile = useCallback(async (entry: FileEntry) => {
    setEditor({ kind: "loading", entry });
    try {
      const file = await api.file(entry.path);
      setEditor({ kind: "ready", entry, original: file.content, draft: file.content, modified: file.modified });
    } catch (error) {
      setEditor({ kind: "failed", entry, message: describe(error) });
    }
  }, []);

  const navigate = (target: Pending) => {
    if (dirty) {
      setPending(target);
      return;
    }
    if (target.kind === "directory") void loadDirectory(target.path);
    else void openFile(target.entry);
  };

  const resolvePending = (choice: "discard" | "stay") => {
    const target = pending;
    setPending(null);
    if (choice === "stay" || !target) return;
    if (target.kind === "directory") void loadDirectory(target.path);
    else void openFile(target.entry);
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

  const createFolder = async () => {
    if (browser.kind !== "ready") return;
    const name = folderName.trim();
    if (!folderNamePattern.test(name)) {
      notify("Folder names may use letters, numbers, dot, dash and underscore", "error");
      return;
    }
    try {
      await api.createDirectory(`${browser.listing.path}/${name}`);
      setCreating(false);
      setFolderName("");
      notify(`Created ${name}`);
      await loadDirectory(browser.listing.path);
    } catch (error) {
      notify(describe(error), "error");
    }
  };

  const entries = useMemo(() => {
    if (browser.kind !== "ready") return [];
    const needle = query.trim().toLowerCase();
    return needle ? browser.listing.entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : browser.listing.entries;
  }, [browser, query]);

  const currentPath = browser.kind === "ready" ? browser.listing.path : browser.path;
  const parent = browser.kind === "ready" ? browser.listing.parent : null;
  const selectedPath = editor.kind === "empty" ? null : editor.entry.path;

  const moveFocus = (direction: 1 | -1) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".file-row") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = buttons[Math.min(Math.max(index + direction, 0), buttons.length - 1)];
    next?.focus();
  };

  return (
    <div className={`files-layout${selectedPath ? " has-selection" : ""}`}>
      <section className="file-browser" aria-label="Application files">
        <header className="file-toolbar">
          <IconButton
            label="Parent directory"
            icon={<ChevronLeft size={16} />}
            disabled={!parent}
            onClick={() => parent && navigate({ kind: "directory", path: parent })}
          />
          <nav className="breadcrumbs" aria-label="Current path">
            {crumbsFor(currentPath).map((crumb, index, all) => (
              <span key={crumb.path}>
                {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                {index === all.length - 1 ? (
                  <b aria-current="page">{crumb.label}</b>
                ) : (
                  <button type="button" onClick={() => navigate({ kind: "directory", path: crumb.path })}>{crumb.label}</button>
                )}
              </span>
            ))}
          </nav>
          <IconButton
            label="New folder"
            icon={<FolderPlus size={16} />}
            active={creating}
            disabled={browser.kind !== "ready"}
            onClick={() => setCreating((value) => !value)}
          />
        </header>

        <div className="file-filter">
          <SearchField value={query} onChange={setQuery} label="Filter this directory" placeholder="Filter files" icon={<Search size={14} />} />
        </div>

        {creating && (
          <form
            className="inline-create"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <label className="sr-only" htmlFor="new-folder">Folder name</label>
            <input
              id="new-folder"
              autoFocus
              value={folderName}
              placeholder="new-folder"
              spellCheck={false}
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setCreating(false)}
            />
            <Button variant="primary" size="compact" type="submit" disabled={!folderName.trim()}>Create</Button>
            <Button variant="ghost" size="compact" onClick={() => { setCreating(false); setFolderName(""); }}>Cancel</Button>
          </form>
        )}

        <div className="file-list" ref={listRef} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
          if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
        }}>
          {browser.kind === "loading" && <LoadingState label="Reading the remote directory" />}
          {browser.kind === "failed" && (
            <EmptyState
              icon={<TriangleAlert size={20} />}
              title="Could not read this directory"
              detail={browser.message}
              action={<Button variant="secondary" size="compact" onClick={() => void loadDirectory(browser.path)}>Try again</Button>}
            />
          )}
          {browser.kind === "ready" && entries.length === 0 && (
            <EmptyState
              icon={<Folder size={20} />}
              title={query.trim() ? "Nothing matches that filter" : "Empty directory"}
              detail={query.trim() ? `No entry in this folder contains "${query.trim()}".` : "This folder has no files or subfolders yet."}
            />
          )}
          {browser.kind === "ready" && entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`file-row${selectedPath === entry.path ? " is-selected" : ""}`}
              onClick={() => navigate(entry.kind === "directory" ? { kind: "directory", path: entry.path } : { kind: "file", entry })}
            >
              <span className="file-icon" aria-hidden="true">{iconFor(entry)}</span>
              <span className="file-name">
                <strong>{entry.name}</strong>
                <small>{entry.kind === "directory" ? "folder" : formatBytes(entry.size)}</small>
              </span>
              <time dateTime={new Date(entry.modified).toISOString()}>{formatTimestamp(entry.modified)}</time>
            </button>
          ))}
        </div>
      </section>

      <section className="file-editor" aria-label="File editor">
        {editor.kind === "empty" && (
          <EmptyState
            icon={<FileCode2 size={22} />}
            title="Pick a text file"
            detail="Files inside /home/arun/apps up to 2 MB open here. Save writes atomically and keeps the original permissions."
          />
        )}

        {editor.kind === "loading" && <LoadingState label={`Opening ${editor.entry.name}`} />}

        {editor.kind === "failed" && (
          <EmptyState
            icon={<TriangleAlert size={22} />}
            title={`Could not open ${editor.entry.name}`}
            detail={editor.message}
            action={<Button variant="secondary" size="compact" onClick={() => void openFile(editor.entry)}>Try again</Button>}
          />
        )}

        {editor.kind === "ready" && (
          <>
            <header className="editor-head">
              <div className="editor-identity">
                <IconButton label="Back to the file list" icon={<ChevronLeft size={16} />} onClick={() => setEditor({ kind: "empty" })} />
                <span className="editor-icon" aria-hidden="true">{iconFor(editor.entry)}</span>
                <span className="editor-name">
                  <strong>{editor.entry.name}</strong>
                  <small title={editor.entry.path}>{editor.entry.path}</small>
                </span>
                {dirty && <span className="pill warn">Unsaved</span>}
              </div>
              <div className="row-actions">
                <IconButton
                  label="Discard your edits"
                  icon={<RotateCcw size={15} />}
                  disabled={!dirty || saving}
                  onClick={() => setEditor({ ...editor, draft: editor.original })}
                />
                <Button variant="primary" size="compact" icon={<Save size={14} />} busy={saving} disabled={!dirty} onClick={() => void save()}>
                  Save
                </Button>
              </div>
            </header>

            {pending && (
              <div className="editor-guard" role="alert">
                <TriangleAlert size={15} aria-hidden="true" />
                <p>{editor.entry.name} has unsaved changes.</p>
                <Button variant="primary" size="compact" onClick={() => void save().then(() => resolvePending("discard"))}>Save and continue</Button>
                <Button variant="ghost" size="compact" onClick={() => resolvePending("discard")}>Discard</Button>
                <Button variant="ghost" size="compact" onClick={() => resolvePending("stay")}>Keep editing</Button>
              </div>
            )}

            <textarea
              className="editor-surface"
              aria-label={`Edit ${editor.entry.name}`}
              spellCheck={false}
              wrap="off"
              value={editor.draft}
              onChange={(event) => setEditor({ ...editor, draft: event.target.value })}
            />

            <footer className="editor-footer">
              <span>{editor.draft.split("\n").length} lines</span>
              <span>{formatBytes(new TextEncoder().encode(editor.draft).length)}</span>
              <span>Saved {formatTimestamp(editor.modified)}</span>
              <span className="editor-hint"><kbd>Ctrl</kbd> + <kbd>S</kbd></span>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
