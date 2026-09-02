import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import * as pty from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { recentAudit, recordAudit } from "./audit.js";
import {
  closeRemoteChannels,
  ensureRemoteHelper,
  projectRoot,
  remoteMutate,
  remoteQuery,
  RemoteHelperError,
  RemoteTimeoutError,
  sshHost,
  streamContainerLogs,
} from "./ssh.js";

const production = process.env.NODE_ENV === "production";
const port = production ? 3000 : 4310;
const bindAddress = "127.0.0.1";
const sessionToken = crypto.randomBytes(32).toString("hex");
const startedAt = Date.now();
const allowedOrigins = new Set(["http://127.0.0.1:3000", "http://localhost:3000"]);

function log(event: string, fields: Record<string, unknown> = {}): void {
  const parts = Object.entries(fields).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  process.stdout.write(`${new Date().toISOString()} ${event}${parts.length ? ` ${parts.join(" ")}` : ""}\n`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown controller error";
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (production) {
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' ws://127.0.0.1:3000 ws://localhost:3000",
        "form-action 'none'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join("; "),
    );
  }
  if (request.method !== "GET") {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      response.status(403).json({ error: "Origin rejected" });
      return;
    }
    if (request.headers["x-control-token"] !== sessionToken) {
      response.status(403).json({ error: "Session rejected" });
      return;
    }
  }
  next();
});

const asyncRoute = (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

/**
 * Overview is polled by every open tab and re-read after each action. One shared
 * short-lived result keeps that traffic down to a single SSH round trip, and
 * concurrent callers wait on the same promise instead of queuing behind each other.
 */
const overviewCacheMs = 1_500;
let overviewCache: { sampledAt: number; value: unknown } | null = null;
let overviewInFlight: Promise<unknown> | null = null;

function readOverview(force: boolean): Promise<unknown> {
  const cached = overviewCache;
  if (!force && cached && Date.now() - cached.sampledAt < overviewCacheMs) return Promise.resolve(cached.value);
  overviewInFlight ??= remoteQuery("overview", {}, 45_000)
    .then((value) => {
      overviewCache = { sampledAt: Date.now(), value };
      return value;
    })
    .finally(() => {
      overviewInFlight = null;
    });
  return overviewInFlight;
}

function invalidateOverview(): void {
  overviewCache = null;
}

app.get("/api/session", (_request, response) => {
  response.json({ token: sessionToken, host: sshHost, startedAt });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
});

app.get("/api/overview", asyncRoute(async (request, response) => {
  response.json(await readOverview(request.query.force === "1"));
}));

app.get("/api/audit", asyncRoute(async (_request, response) => {
  response.json(await recentAudit());
}));

const tailSchema = z.coerce.number().int().min(20).max(2000).catch(300);
app.get("/api/logs/:name", asyncRoute(async (request, response) => {
  const tail = tailSchema.parse(request.query.tail ?? 300);
  response.json(await remoteQuery("logs", { name: request.params.name, tail }, 60_000));
}));

app.get("/api/files", asyncRoute(async (request, response) => {
  response.json(await remoteQuery("list_files", { path: String(request.query.path ?? "/home/arun/apps") }));
}));

app.get("/api/file", asyncRoute(async (request, response) => {
  response.json(await remoteQuery("read_file", { path: String(request.query.path ?? "") }, 45_000));
}));

/** Runs a mutation, records the outcome with its duration, and refreshes the overview. */
async function auditedMutation(
  { action, target }: { action: string; target: string },
  operation: () => Promise<unknown>,
): Promise<unknown> {
  const began = Date.now();
  try {
    const result = await operation();
    await recordAudit({ action, target, outcome: "success", detail: "Completed", durationMs: Date.now() - began });
    invalidateOverview();
    log("action.ok", { action, target, ms: Date.now() - began });
    return result;
  } catch (error) {
    await recordAudit({ action, target, outcome: "failure", detail: describe(error), durationMs: Date.now() - began });
    invalidateOverview();
    log("action.fail", { action, target, ms: Date.now() - began, reason: describe(error) });
    throw error;
  }
}

const containerActionSchema = z.object({
  name: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Invalid container name"),
  action: z.enum(["start", "stop", "restart"]),
});
app.post("/api/container/action", asyncRoute(async (request, response) => {
  const input = containerActionSchema.parse(request.body);
  response.json(await auditedMutation(
    { action: `container-${input.action}`, target: input.name },
    () => remoteMutate("container_action", input, 120_000),
  ));
}));

const stackActionSchema = z.object({
  id: z.enum(["ai-os", "delta-exchange", "trader"]),
  action: z.enum(["start", "stop", "restart"]),
});
app.post("/api/stack/action", asyncRoute(async (request, response) => {
  const input = stackActionSchema.parse(request.body);
  response.json(await auditedMutation(
    { action: `stack-${input.action}`, target: input.id },
    () => remoteMutate("stack_action", input, 240_000),
  ));
}));

const writeFileSchema = z.object({ path: z.string().min(1), content: z.string().max(2_000_000) });
app.put("/api/file", asyncRoute(async (request, response) => {
  const input = writeFileSchema.parse(request.body);
  response.json(await auditedMutation(
    { action: "save-file", target: input.path },
    () => remoteMutate("write_file", input, 60_000),
  ));
}));

const directorySchema = z.object({ path: z.string().min(1) });
app.post("/api/directory", asyncRoute(async (request, response) => {
  const input = directorySchema.parse(request.body);
  response.json(await auditedMutation(
    { action: "create-directory", target: input.path },
    () => remoteMutate("create_directory", input, 45_000),
  ));
}));

if (production) {
  const distDirectory = path.join(projectRoot, "dist");
  app.use(express.static(distDirectory, { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(distDirectory, "index.html")));
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const status = error instanceof RemoteTimeoutError ? 504 : error instanceof RemoteHelperError ? 422 : 502;
  response.status(status).json({ error: describe(error) });
});

const server = createServer(app);
const terminalServer = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
const logsServer = new WebSocketServer({ noServer: true, maxPayload: 64_000 });

server.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? bindAddress}`);
  if (!origin || !allowedOrigins.has(origin) || url.searchParams.get("token") !== sessionToken) {
    socket.destroy();
    return;
  }
  if (url.pathname === "/ws/terminal") {
    terminalServer.handleUpgrade(request, socket, head, (webSocket) => terminalServer.emit("connection", webSocket, request));
  } else if (url.pathname === "/ws/logs") {
    logsServer.handleUpgrade(request, socket, head, (webSocket) => logsServer.emit("connection", webSocket, request));
  } else {
    socket.destroy();
  }
});

/** Drops sockets whose browser tab vanished without a close frame. */
function keepAlive(wss: WebSocketServer, intervalMs = 30_000): () => void {
  const alive = new WeakSet<WebSocket>();
  wss.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
  });
  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

const stopTerminalHeartbeat = keepAlive(terminalServer);
const stopLogsHeartbeat = keepAlive(logsServer);

function resolveSshExecutable(): string {
  const candidates = [process.env.UBUNTU_CONTROL_SSH, "C:\\Windows\\System32\\OpenSSH\\ssh.exe"];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "ssh";
}

const sshExecutable = resolveSshExecutable();

const terminalMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string().max(8192) }),
  z.object({ type: z.literal("resize"), cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(200) }),
]);

function readDimension(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

terminalServer.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? bindAddress}`);
  const shell = pty.spawn(sshExecutable, [sshHost], {
    name: "xterm-256color",
    cols: readDimension(url.searchParams.get("cols"), 110, 20, 500),
    rows: readDimension(url.searchParams.get("rows"), 30, 5, 200),
    cwd: process.env.USERPROFILE,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  // Terminal output arrives in tiny chunks. Coalescing on a frame boundary cuts
  // frame count hard without adding noticeable input latency.
  let batch = "";
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    if (!batch) return;
    const data = batch;
    batch = "";
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "data", data }));
  };

  shell.onData((data) => {
    batch += data;
    if (batch.length > 32_000) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }
    timer ??= setTimeout(flush, 12);
  });
  shell.onExit(({ exitCode }) => {
    if (timer) clearTimeout(timer);
    flush();
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "exit", code: exitCode }));
  });

  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      socket.close(1003, "Invalid terminal message");
      return;
    }
    const message = terminalMessageSchema.safeParse(parsed);
    if (!message.success) return;
    if (message.data.type === "input") shell.write(message.data.data);
    else shell.resize(message.data.cols, message.data.rows);
  });

  socket.on("close", () => {
    if (timer) clearTimeout(timer);
    shell.kill();
  });
});

logsServer.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? bindAddress}`);
  const stop = streamContainerLogs(
    socket,
    url.searchParams.get("container") ?? "",
    readDimension(url.searchParams.get("tail"), 300, 20, 2000),
  );
  socket.on("close", stop);
});

// A missing or unreachable Ubuntu host must not stop the controller: the browser
// needs to load so it can show why the connection failed.
void ensureRemoteHelper()
  .then(() => log("helper.installed", { host: sshHost }))
  .catch((error: unknown) => log("helper.install-failed", { reason: describe(error) }));

server.listen(port, bindAddress, () => {
  log("listening", { url: `http://${bindAddress}:${port}`, mode: production ? "production" : "development" });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown", { signal });
  stopTerminalHeartbeat();
  stopLogsHeartbeat();
  for (const socket of [...terminalServer.clients, ...logsServer.clients]) socket.terminate();
  closeRemoteChannels();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
