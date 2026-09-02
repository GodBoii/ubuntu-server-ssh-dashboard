import {
  boolean,
  DecodeError,
  list,
  literal,
  loadTriple,
  nullableNumber,
  nullableText,
  number,
  optionalList,
  optionalNumber,
  optionalText,
  record,
  text,
} from "./lib/decode";
import type {
  ActionResult,
  AuditEntry,
  ContainerInfo,
  CpuSample,
  DirectoryListing,
  DiskUsage,
  FileContent,
  FileEntry,
  MemoryUsage,
  NetworkSample,
  Overview,
  ProcessInfo,
  ServiceInfo,
  Session,
  StackInfo,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let controlToken = "";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  signal?: AbortSignal;
};

function readErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const value = Reflect.get(payload, "error");
    if (typeof value === "string" && value.length > 0) return value;
  }
  return `The controller answered with ${status}`;
}

async function request<T>(url: string, decode: (payload: unknown) => T, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (method !== "GET") {
    headers.set("Content-Type", "application/json");
    headers.set("X-Control-Token", controlToken);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      signal: options.signal ?? null,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("The local controller is not answering", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`The controller returned a malformed response (${response.status})`, response.status);
  }

  if (!response.ok) throw new ApiError(readErrorMessage(payload, response.status), response.status);

  try {
    return decode(payload);
  } catch (error) {
    if (error instanceof DecodeError) throw new ApiError(error.message, response.status);
    throw error;
  }
}

// ------------------------------------------------------------------- decoders

function decodeContainer(raw: unknown, path: string): ContainerInfo {
  const source = record(raw, path);
  return {
    id: text(source, "id", path),
    name: text(source, "name", path),
    image: optionalText(source, "image"),
    state: optionalText(source, "state", "unknown"),
    status: optionalText(source, "status"),
    health: nullableText(source, "health"),
    ports: optionalText(source, "ports"),
    project: nullableText(source, "project"),
    service: nullableText(source, "service"),
    restartPolicy: optionalText(source, "restartPolicy"),
    startedAt: nullableText(source, "startedAt"),
  };
}

function decodeStack(raw: unknown, path: string): StackInfo {
  const source = record(raw, path);
  return {
    id: literal(source, "id", ["ai-os", "delta-exchange", "trader"] as const, "trader"),
    name: text(source, "name", path),
    path: optionalText(source, "path"),
    running: optionalNumber(source, "running", 0),
    total: optionalNumber(source, "total", 0),
    status: literal(source, "status", ["healthy", "degraded", "stopped"] as const, "stopped"),
    containers: optionalList(source, "containers", path, (item, itemPath) => {
      if (typeof item !== "string") throw new DecodeError(`${itemPath} should be a string`);
      return item;
    }),
  };
}

function decodeService(raw: unknown, path: string): ServiceInfo {
  const source = record(raw, path);
  return {
    name: text(source, "name", path),
    enabled: boolean(source, "enabled", path),
    active: boolean(source, "active", path),
    state: optionalText(source, "state", "unknown"),
    subState: optionalText(source, "subState"),
    loaded: source.loaded === undefined ? true : boolean(source, "loaded", path),
    activeSeconds: nullableNumber(source, "activeSeconds"),
  };
}

function decodeProcess(raw: unknown, path: string): ProcessInfo {
  const source = record(raw, path);
  return {
    pid: number(source, "pid", path),
    cpu: optionalNumber(source, "cpu", 0),
    memory: optionalNumber(source, "memory", 0),
    command: optionalText(source, "command", "unknown"),
  };
}

function decodeMemory(raw: unknown, path: string): MemoryUsage {
  const source = record(raw, path);
  return {
    total: number(source, "total", path),
    used: number(source, "used", path),
    available: number(source, "available", path),
    swapTotal: optionalNumber(source, "swapTotal", 0),
    swapUsed: optionalNumber(source, "swapUsed", 0),
  };
}

function decodeDisk(raw: unknown, path: string): DiskUsage {
  const source = record(raw, path);
  return {
    total: number(source, "total", path),
    used: number(source, "used", path),
    available: number(source, "available", path),
  };
}

function decodeCpuSample(raw: unknown): CpuSample | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = record(raw, "cpuSample");
  const total = optionalNumber(source, "total", 0);
  const idle = optionalNumber(source, "idle", 0);
  return total > 0 ? { total, idle } : null;
}

function decodeNetworkSample(raw: unknown): NetworkSample | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = record(raw, "network");
  return {
    receivedBytes: optionalNumber(source, "receivedBytes", 0),
    transmittedBytes: optionalNumber(source, "transmittedBytes", 0),
  };
}

function decodeOverview(raw: unknown): Overview {
  const source = record(raw, "overview");
  return {
    protocol: optionalNumber(source, "protocol", 1),
    host: text(source, "host", "overview"),
    kernel: optionalText(source, "kernel", "unknown kernel"),
    uptimeSeconds: optionalNumber(source, "uptimeSeconds", 0),
    load: loadTriple(source.load, "overview.load"),
    cpuCount: Math.max(1, optionalNumber(source, "cpuCount", 1)),
    cpuSample: decodeCpuSample(source.cpuSample),
    memory: decodeMemory(source.memory, "overview.memory"),
    disk: decodeDisk(source.disk, "overview.disk"),
    network: decodeNetworkSample(source.network),
    temperature: nullableNumber(source, "temperature"),
    containers: list(source.containers, "overview.containers", decodeContainer),
    stacks: list(source.stacks, "overview.stacks", decodeStack),
    services: list(source.services, "overview.services", decodeService),
    processes: optionalList(source, "processes", "overview", decodeProcess),
    timestamp: optionalNumber(source, "timestamp", Date.now()),
  };
}

function decodeAuditEntry(raw: unknown, path: string): AuditEntry {
  const source = record(raw, path);
  return {
    id: text(source, "id", path),
    timestamp: text(source, "timestamp", path),
    action: optionalText(source, "action", "action"),
    target: optionalText(source, "target"),
    outcome: literal(source, "outcome", ["success", "failure"] as const, "success"),
    detail: optionalText(source, "detail"),
    durationMs: nullableNumber(source, "durationMs"),
  };
}

function decodeFileEntry(raw: unknown, path: string): FileEntry {
  const source = record(raw, path);
  return {
    name: text(source, "name", path),
    path: text(source, "path", path),
    kind: literal(source, "kind", ["directory", "file"] as const, "file"),
    size: optionalNumber(source, "size", 0),
    modified: optionalNumber(source, "modified", 0),
  };
}

function decodeListing(raw: unknown): DirectoryListing {
  const source = record(raw, "listing");
  return {
    path: text(source, "path", "listing"),
    parent: nullableText(source, "parent"),
    entries: list(source.entries, "listing.entries", decodeFileEntry),
  };
}

function decodeFileContent(raw: unknown): FileContent {
  const source = record(raw, "file");
  return {
    path: text(source, "path", "file"),
    content: optionalText(source, "content"),
    modified: optionalNumber(source, "modified", 0),
    size: optionalNumber(source, "size", 0),
  };
}

function decodeSaveResult(raw: unknown): { message: string; modified: number; size: number } {
  const source = record(raw, "save");
  return {
    message: optionalText(source, "message", "Saved"),
    modified: optionalNumber(source, "modified", Date.now()),
    size: optionalNumber(source, "size", 0),
  };
}

function decodeActionResult(raw: unknown): ActionResult {
  const source = record(raw, "result");
  return { message: optionalText(source, "message", "Done") };
}

function decodeSession(raw: unknown): Session {
  const source = record(raw, "session");
  return {
    token: text(source, "token", "session"),
    host: optionalText(source, "host", "ubuntu-server"),
    startedAt: optionalNumber(source, "startedAt", Date.now()),
  };
}

function decodeLogSnapshot(raw: unknown): { name: string; lines: string[] } {
  const source = record(raw, "logs");
  return {
    name: optionalText(source, "name"),
    lines: optionalList(source, "lines", "logs", (item, itemPath) => {
      if (typeof item !== "string") throw new DecodeError(`${itemPath} should be a string`);
      return item;
    }),
  };
}

// --------------------------------------------------------------------- client

export async function initializeSession(signal?: AbortSignal): Promise<Session> {
  const session = await request("/api/session", decodeSession, { signal });
  controlToken = session.token;
  return session;
}

export const api = {
  overview: (options: { force?: boolean; signal?: AbortSignal } = {}) =>
    request(`/api/overview${options.force ? "?force=1" : ""}`, decodeOverview, { signal: options.signal }),
  audit: (signal?: AbortSignal) =>
    request("/api/audit", (payload) => list(payload, "audit", decodeAuditEntry), { signal }),
  logSnapshot: (name: string, tail = 300, signal?: AbortSignal) =>
    request(`/api/logs/${encodeURIComponent(name)}?tail=${tail}`, decodeLogSnapshot, { signal }),
  files: (path: string, signal?: AbortSignal) =>
    request(`/api/files?path=${encodeURIComponent(path)}`, decodeListing, { signal }),
  file: (path: string, signal?: AbortSignal) =>
    request(`/api/file?path=${encodeURIComponent(path)}`, decodeFileContent, { signal }),
  containerAction: (name: string, action: "start" | "stop" | "restart") =>
    request("/api/container/action", decodeActionResult, { method: "POST", body: { name, action } }),
  stackAction: (id: string, action: "start" | "stop" | "restart") =>
    request("/api/stack/action", decodeActionResult, { method: "POST", body: { id, action } }),
  saveFile: (path: string, content: string) =>
    request("/api/file", decodeSaveResult, { method: "PUT", body: { path, content } }),
  createDirectory: (path: string) =>
    request("/api/directory", decodeActionResult, { method: "POST", body: { path } }),
};
