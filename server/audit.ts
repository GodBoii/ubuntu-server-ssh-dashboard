import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./ssh.js";

export type AuditOutcome = "success" | "failure";

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  outcome: AuditOutcome;
  detail: string;
  durationMs: number | null;
};

const historyLimit = 400;
const dataDirectory = path.join(projectRoot, "data", "audit");
const auditFile = path.join(dataDirectory, "actions.jsonl");

/** Newest first. Kept in memory so the 10s dashboard poll never re-reads the file. */
let history: AuditEntry[] = [];
let loaded: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Log lines are external input: an older or hand-edited row must not crash the read. */
function parseEntry(line: string): AuditEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const id = readString(parsed, "id");
  const timestamp = readString(parsed, "timestamp");
  const action = readString(parsed, "action");
  const target = readString(parsed, "target");
  if (!id || !timestamp || !action || !target) return null;
  const outcome: AuditOutcome = parsed.outcome === "failure" ? "failure" : "success";
  const detail = typeof parsed.detail === "string" ? parsed.detail : "";
  const durationMs = typeof parsed.durationMs === "number" && Number.isFinite(parsed.durationMs) ? parsed.durationMs : null;
  return { id, timestamp, action, target, outcome, detail, durationMs };
}

function loadHistory(): Promise<void> {
  loaded ??= readFile(auditFile, "utf8")
    .then((content) => {
      history = content
        .split("\n")
        .slice(-historyLimit)
        .map(parseEntry)
        .filter((entry): entry is AuditEntry => entry !== null)
        .reverse();
    })
    .catch(() => {
      history = [];
    });
  return loaded;
}

export async function recordAudit(entry: Omit<AuditEntry, "id" | "timestamp" | "durationMs"> & { durationMs?: number }): Promise<AuditEntry> {
  await loadHistory();
  const complete: AuditEntry = {
    ...entry,
    durationMs: entry.durationMs ?? null,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  history = [complete, ...history].slice(0, historyLimit);
  await mkdir(dataDirectory, { recursive: true });
  await appendFile(auditFile, `${JSON.stringify(complete)}\n`, "utf8");
  return complete;
}

export async function recentAudit(limit = 120): Promise<AuditEntry[]> {
  await loadHistory();
  return history.slice(0, Math.min(Math.max(limit, 1), historyLimit));
}
