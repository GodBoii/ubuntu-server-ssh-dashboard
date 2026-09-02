import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerminal } from "@xterm/xterm";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Act, Lamp } from "../components/kit";

type Link = { kind: "connecting" } | { kind: "open" } | { kind: "closed"; message: string };

/** Matches the console palette so the shell and the shell-inside-it agree. */
const theme = {
  background: "#100f0e",
  foreground: "#d6d4cf",
  cursor: "#4d9e90",
  cursorAccent: "#100f0e",
  selectionBackground: "rgba(77, 158, 144, 0.3)",
  black: "#22211e",
  red: "#c9584c",
  green: "#7fa46a",
  yellow: "#cfa33e",
  blue: "#6f96b0",
  magenta: "#a887ae",
  cyan: "#4d9e90",
  white: "#c8c6c1",
  brightBlack: "#78756f",
  brightRed: "#d9746a",
  brightGreen: "#96b884",
  brightYellow: "#dcb257",
  brightBlue: "#8bafc6",
  brightMagenta: "#bf9fc4",
  brightCyan: "#63b3a5",
  brightWhite: "#ecebe8",
};

const fontBounds = { min: 10, max: 20 };
const retryDelaysMs = [1_000, 2_500, 5_000, 10_000];

function readMessage(raw: unknown): { type: string; data?: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const type = Reflect.get(raw, "type");
  if (typeof type !== "string") return null;
  const data = Reflect.get(raw, "data");
  return { type, data: typeof data === "string" ? data : undefined };
}

export default function TerminalApp({
  token,
  notify,
}: {
  token: string;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [link, setLink] = useState<Link>({ kind: "connecting" });
  const [generation, setGeneration] = useState(0);
  const [fontSize, setFontSize] = useState(13);
  const [full, setFull] = useState(false);
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState("");

  const sendSize = useCallback(() => {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!terminal || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
  }, []);

  // Built once. Reconnects reuse the instance so scrollback survives.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new XTerminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Geist Mono Variable", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5_000,
      allowProposedApi: true,
      theme,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);

    // The GPU renderer is a real latency win but is not available everywhere.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // The DOM renderer stays in place.
    }

    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });

    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          fit.fit();
        } catch {
          return;
        }
        sendSize();
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [sendSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      return;
    }
    sendSize();
  }, [fontSize, sendSize]);

  useEffect(() => {
    if (!token) return;
    const terminal = terminalRef.current;
    if (!terminal) return;

    let socket: WebSocket | null = null;
    let retry = 0;
    let attempt = 0;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      setLink({ kind: "connecting" });
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${location.host}/ws/terminal?token=${encodeURIComponent(token)}&cols=${terminal.cols}&rows=${terminal.rows}`,
      );
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setLink({ kind: "open" });
        socket?.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      };

      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const message = readMessage(parsed);
        if (message?.type === "data" && message.data) terminal.write(message.data);
      };

      socket.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 10_000;
        attempt += 1;
        setLink({ kind: "closed", message: `closed · retrying in ${Math.round(delay / 1000)}s` });
        terminal.writeln("\r\n\x1b[38;5;108m-- session closed, reattaching --\x1b[0m");
        retry = window.setTimeout(open, delay);
      };
    };

    open();

    return () => {
      disposed = true;
      window.clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      socketRef.current = null;
    };
  }, [generation, token]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!finding) searchRef.current?.clearDecorations();
  }, [finding]);

  const find = (direction: 1 | -1) => {
    if (!needle) return;
    const options = { decorations: { activeMatchColorOverviewRuler: "#4d9e90", matchOverviewRuler: "#78756f" } };
    if (direction === 1) searchRef.current?.findNext(needle, options);
    else searchRef.current?.findPrevious(needle, options);
  };

  const copySelection = async () => {
    const selection = terminalRef.current?.getSelection();
    if (!selection) {
      notify("select some output first", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(selection);
      notify("selection copied");
    } catch {
      notify("the browser blocked clipboard access", "error");
    }
  };

  return (
    <div className="term" ref={shellRef}>
      <header className="term-head">
        <div className="term-id">
          <Lamp level={link.kind === "open" ? "ok" : link.kind === "connecting" ? "live" : "fail"} />
          <b>arun@arun-H110</b>
          <span className="note">{link.kind === "open" ? "pty attached" : link.kind === "connecting" ? "attaching" : link.message}</span>
        </div>

        <div className="acts">
          {finding ? (
            <div className="term-find">
              <Search size={12} aria-hidden="true" />
              <input
                autoFocus
                type="text"
                aria-label="Search terminal output"
                placeholder="find"
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") find(event.shiftKey ? -1 : 1);
                  if (event.key === "Escape") {
                    setFinding(false);
                    setNeedle("");
                  }
                }}
              />
              <Act label="Previous match" icon={<ChevronUp size={13} />} onClick={() => find(-1)} disabled={!needle} />
              <Act label="Next match" icon={<ChevronDown size={13} />} onClick={() => find(1)} disabled={!needle} />
              <Act label="Close find" icon={<X size={13} />} onClick={() => { setFinding(false); setNeedle(""); }} />
            </div>
          ) : (
            <Act label="Find in output" icon={<Search size={13} />} onClick={() => setFinding(true)} />
          )}
          <Act label="Smaller text" icon={<Minus size={13} />} disabled={fontSize <= fontBounds.min} onClick={() => setFontSize((size) => size - 1)} />
          <Act label="Larger text" icon={<Plus size={13} />} disabled={fontSize >= fontBounds.max} onClick={() => setFontSize((size) => size + 1)} />
          <Act label="Copy selection" icon={<Copy size={13} />} onClick={() => void copySelection()} />
          <Act label="Clear screen" icon={<Eraser size={13} />} onClick={() => terminalRef.current?.clear()} />
          <Act label="Reattach now" icon={<RotateCcw size={13} />} onClick={() => setGeneration((value) => value + 1)} />
          <Act
            label={full ? "Leave fullscreen" : "Fullscreen"}
            icon={full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            onClick={() => {
              if (document.fullscreenElement === shellRef.current) void document.exitFullscreen();
              else void shellRef.current?.requestFullscreen();
            }}
          />
        </div>
      </header>

      <div className="term-surface" ref={hostRef} />

      <footer className="log-foot">
        <span>runs as arun over the existing cloudflare tunnel</span>
        <span className="push">sudo still prompts</span>
      </footer>
    </div>
  );
}
