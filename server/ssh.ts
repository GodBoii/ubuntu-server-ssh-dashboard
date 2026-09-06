import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import { config } from "./config.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(moduleDirectory, "..");

const helperSourcePath = path.join(moduleDirectory, "remote_ops.py");
const helperDirectory = "/home/arun/.ubuntu-control";
const helperRemotePath = `${helperDirectory}/ops.py`;
export const sshHost = "ubuntu-server";

function helperCommand(persistent: boolean): { executable: string; args: string[] } {
  if (config.mode === "local") {
    return { executable: "python3", args: [helperSourcePath, ...(persistent ? ["--serve"] : [])] };
  }
  return { executable: "ssh", args: [...sshOptions, sshHost, `python3 ${helperRemotePath}${persistent ? " --serve" : ""}`] };
}

/** Keepalives matter here: the hop runs through cloudflared, which drops idle channels. */
const sshOptions = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=20",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3",
];

/** The remote helper refused the request. Retrying on another channel changes nothing. */
export class RemoteHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteHelperError";
  }
}

/** The request never came back in time. A retry would just wait again. */
export class RemoteTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteTimeoutError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function lastJsonLine(text: string): unknown {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) continue;
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  throw new Error("The Ubuntu helper returned output that is not JSON");
}

/** Unwraps `{ok: true, data}` / `{ok: false, error}`. Returns `unknown`: callers validate. */
function unwrapEnvelope(payload: unknown): unknown {
  if (!isRecord(payload) || typeof payload.ok !== "boolean") {
    throw new Error("The Ubuntu helper returned an unexpected response shape");
  }
  if (payload.ok) return payload.data;
  throw new RemoteHelperError(typeof payload.error === "string" ? payload.error : "The Ubuntu helper reported a failure");
}

type ProcessResult = { stdout: string; stderr: string; code: number | null };

/**
 * Resolves for any exit code. The helper deliberately exits 1 while still
 * printing a JSON error envelope, so the caller decides what a non-zero code
 * means instead of losing the message.
 */
function runProcess(executable: string, args: string[], stdin?: string, timeoutMs = 30_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish(() => reject(new RemoteTimeoutError(`${executable} did not finish within ${Math.round(timeoutMs / 1000)}s`)));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => resolve({ stdout, stderr, code })));
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
}

async function runOrThrow(executable: string, args: string[], stdin: string | undefined, timeoutMs: number): Promise<ProcessResult> {
  const result = await runProcess(executable, args, stdin, timeoutMs);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${executable} exited with code ${result.code}`);
  }
  return result;
}

type PendingRequest = {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * One long-lived `ssh host python3 ops.py --serve` process carrying
 * newline-delimited JSON. Reusing the channel removes the Cloudflare Access
 * handshake from every request, which is the bulk of the round-trip cost.
 *
 * The helper answers one request at a time, so callers that can block for
 * minutes (stack restarts) use a separate channel from the dashboard reads.
 */
class RemoteChannel {
  readonly #label: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #pending = new Map<number, PendingRequest>();
  #stdout = "";
  #stderrTail = "";
  #nextId = 1;
  #disposed = false;

  constructor(label: string) {
    this.#label = label;
  }

  async send(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.#disposed) throw new Error("Controller is shutting down");
    const child = this.#ensureChild();
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RemoteTimeoutError(`${action} did not answer within ${Math.round(timeoutMs / 1000)}s`));
        // The helper is sequential, so a stuck request would block every later
        // one. Drop the channel and let the next call open a fresh one.
        this.#destroy(`${action} timed out`);
      }, timeoutMs);
      this.#pending.set(id, { action, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, action, payload })}\n`, (error) => {
        if (!error) return;
        this.#settleWith(id, () => reject(error));
      });
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#destroy("Controller is shutting down");
  }

  #ensureChild(): ChildProcessWithoutNullStreams {
    const existing = this.#child;
    if (existing && existing.stdin.writable && existing.exitCode === null) return existing;
    const command = helperCommand(true);
    const child = spawn(command.executable, command.args, { windowsHide: true });
    this.#child = child;
    this.#stdout = "";
    this.#stderrTail = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(chunk));
    child.stderr.on("data", (chunk: string) => { this.#stderrTail = (this.#stderrTail + chunk).slice(-400); });
    child.stdin.on("error", () => undefined);
    child.once("error", (error) => this.#retire(child, error.message));
    child.once("close", (code) => this.#retire(child, this.#stderrTail.trim() || `SSH channel closed with code ${code}`));
    return child;
  }

  #consume(chunk: string): void {
    this.#stdout += chunk;
    let breakIndex = this.#stdout.indexOf("\n");
    while (breakIndex >= 0) {
      const line = this.#stdout.slice(0, breakIndex).trim();
      this.#stdout = this.#stdout.slice(breakIndex + 1);
      if (line.startsWith("{")) this.#accept(line);
      breakIndex = this.#stdout.indexOf("\n");
    }
    if (this.#stdout.length > 8_000_000) this.#destroy("The Ubuntu helper sent an oversized response");
  }

  #accept(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed) || typeof parsed.id !== "number") return;
    const id = parsed.id;
    this.#settleWith(id, (request) => {
      try {
        request.resolve(unwrapEnvelope(parsed));
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #settleWith(id: number, settle: (request: PendingRequest) => void): void {
    const request = this.#pending.get(id);
    if (!request) return;
    this.#pending.delete(id);
    clearTimeout(request.timer);
    settle(request);
  }

  #retire(child: ChildProcessWithoutNullStreams, reason: string): void {
    if (this.#child === child) this.#child = null;
    this.#rejectAll(reason);
  }

  #destroy(reason: string): void {
    const child = this.#child;
    this.#child = null;
    if (child) {
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }
    this.#rejectAll(reason);
  }

  #rejectAll(reason: string): void {
    if (this.#pending.size === 0) return;
    const outstanding = [...this.#pending.values()];
    this.#pending.clear();
    for (const request of outstanding) {
      clearTimeout(request.timer);
      request.reject(new Error(`${this.#label}: ${reason}`));
    }
  }
}

const readChannel = new RemoteChannel("read channel");
const controlChannel = new RemoteChannel("control channel");

let installation: Promise<void> | null = null;

async function installHelper(): Promise<void> {
  if (config.mode === "local") return;
  await runOrThrow("ssh", [...sshOptions, sshHost, `mkdir -p ${helperDirectory}`], undefined, 30_000);
  await runOrThrow("scp", ["-q", helperSourcePath, `${sshHost}:${helperRemotePath}`], undefined, 45_000);
}

/**
 * Copies the helper once per process. A failure is not cached, so the next
 * request retries instead of leaving the controller permanently broken.
 */
export function ensureRemoteHelper(): Promise<void> {
  installation ??= installHelper().catch((error: unknown) => {
    installation = null;
    throw error instanceof Error ? error : new Error(String(error));
  });
  return installation;
}

async function remoteOneShot(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const command = helperCommand(false);
  const result = await runProcess(
    command.executable,
    command.args,
    JSON.stringify({ action, payload }),
    timeoutMs,
  );
  try {
    return unwrapEnvelope(lastJsonLine(result.stdout));
  } catch (error) {
    // A helper rejection is the real answer. Anything else means SSH itself
    // failed, and stderr explains it better than the unparsable stdout.
    if (error instanceof RemoteHelperError) throw error;
    throw new Error(result.stderr.trim() || result.stdout.trim() || `SSH exited with code ${result.code}`);
  }
}

async function callChannel(
  channel: RemoteChannel,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  await ensureRemoteHelper();
  try {
    return await channel.send(action, payload, timeoutMs);
  } catch (error) {
    // Helper rejections and timeouts are answers, not transport faults.
    if (error instanceof RemoteHelperError || error instanceof RemoteTimeoutError) throw error;
    // The channel died. Fall back to a single fresh SSH invocation so a dropped
    // tunnel degrades to the slower path instead of failing the request.
    return remoteOneShot(action, payload, timeoutMs);
  }
}

/** Dashboard reads. Fast, idempotent, kept off the slow mutation channel. */
export function remoteQuery(action: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
  return callChannel(readChannel, action, payload, timeoutMs);
}

/** State changes. Serialized against each other so two restarts cannot interleave. */
export function remoteMutate(action: string, payload: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
  return callChannel(controlChannel, action, payload, timeoutMs);
}

export function closeRemoteChannels(): void {
  readChannel.dispose();
  controlChannel.dispose();
}

const containerNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const logFlushIntervalMs = 60;
const logBatchLimitBytes = 96_000;
const socketBacklogLimitBytes = 4_000_000;

/**
 * Pipes `docker logs --follow` into a WebSocket. Chunks are coalesced on a short
 * timer so a chatty container produces a handful of frames per second instead of
 * hundreds, and frames are dropped when the browser stops keeping up.
 */
export function streamContainerLogs(socket: WebSocket, name: string, tail: number): () => void {
  if (!containerNamePattern.test(name)) {
    socket.close(1008, "Invalid container name");
    return () => undefined;
  }
  const safeTail = Number.isFinite(tail) ? Math.min(Math.max(Math.trunc(tail), 20), 2000) : 300;
  const child = spawn(
    config.mode === "local" ? "docker" : "ssh",
    config.mode === "local"
      ? ["logs", "--follow", "--tail", String(safeTail), "--timestamps", name]
      : [...sshOptions, sshHost, `docker logs --follow --tail ${safeTail} --timestamps ${name}`],
    { windowsHide: true },
  );

  let batch = "";
  let dropped = 0;
  let timer: NodeJS.Timeout | null = null;

  const flush = () => {
    timer = null;
    if (!batch || socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > socketBacklogLimitBytes) {
      dropped += batch.length;
      batch = "";
      return;
    }
    const data = dropped > 0 ? `[ubuntu-control] dropped ${dropped} bytes while catching up\n${batch}` : batch;
    dropped = 0;
    batch = "";
    socket.send(JSON.stringify({ type: "data", data }));
  };

  const push = (chunk: string) => {
    batch += chunk;
    if (batch.length >= logBatchLimitBytes) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }
    timer ??= setTimeout(flush, logFlushIntervalMs);
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.once("error", (error) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "error", message: error.message }));
  });
  child.once("close", (code) => {
    if (timer) clearTimeout(timer);
    flush();
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "exit", code }));
  });

  return () => {
    if (timer) clearTimeout(timer);
    child.stdout.removeAllListeners("data");
    child.stderr.removeAllListeners("data");
    child.kill();
  };
}
