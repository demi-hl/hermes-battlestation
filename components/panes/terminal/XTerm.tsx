"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Status = "connecting" | "live" | "exited" | "error";

interface XTermProps {
  /** Repo slug → server resolves the PTY session id + cwd. */
  repo: string;
  onStatus?: (status: Status) => void;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

const b64decode = (s: string): string => {
  try {
    // atob → binary string → utf8
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
};

/**
 * xterm.js wired to the server PTY over SSE (output) + POST (input). The session
 * id is the repo slug, so unmounting on tab-switch leaves the shell running and
 * remounting replays its scrollback. Cursor blinks; the theme is resolved from
 * the live app CSS vars so it tracks the active Hermes theme.
 */
export function XTerm({ repo, onStatus }: XTermProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const bg = cssVar("--background-base", "#041c1c");
    const fg = cssVar("--midground-base", "#ffe6cb");
    const success = cssVar("--color-success", "#4ade80");
    const warning = cssVar("--color-warning", "#ffbd38");
    const destructive = cssVar("--color-destructive", "#fb2c36");
    const dim = `color-mix(in srgb, ${fg} 55%, transparent)`;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'var(--theme-font-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      letterSpacing: 0,
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: {
        background: "rgba(0,0,0,0)",
        foreground: fg,
        cursor: fg,
        cursorAccent: bg,
        selectionBackground: `color-mix(in srgb, ${fg} 28%, transparent)`,
        black: bg,
        brightBlack: dim,
        red: destructive,
        brightRed: destructive,
        green: success,
        brightGreen: success,
        yellow: warning,
        brightYellow: warning,
        blue: `color-mix(in srgb, ${fg} 70%, #4aa)`,
        brightBlue: `color-mix(in srgb, ${fg} 80%, #4aa)`,
        magenta: cssVar("--series-input-token", fg),
        brightMagenta: fg,
        cyan: `color-mix(in srgb, ${success} 60%, ${fg})`,
        brightCyan: success,
        white: fg,
        brightWhite: fg,
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* host not laid out yet */
      }
    };
    safeFit();

    let lastCols = term.cols;
    let lastRows = term.rows;
    const postResize = (cols: number, rows: number) => {
      void fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, resize: { cols, rows } }),
        keepalive: true,
      }).catch(() => {});
    };
    postResize(term.cols, term.rows);

    // Keystrokes → server.
    const dataSub = term.onData((data) => {
      void fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, data }),
      }).catch(() => {});
    });

    // Keep the PTY size in sync with the rendered terminal.
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (cols !== lastCols || rows !== lastRows) {
        lastCols = cols;
        lastRows = rows;
        postResize(cols, rows);
      }
    });
    const ro = new ResizeObserver(() => safeFit());
    ro.observe(host);

    // Output stream (SSE over fetch so we control abort + reconnect).
    let aborted = false;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      onStatus?.("connecting");
      controller = new AbortController();
      try {
        const res = await fetch(
          `/api/terminal?repo=${encodeURIComponent(repo)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok || !res.body) {
          onStatus?.("error");
          scheduleReconnect();
          return;
        }
        onStatus?.("live");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // Push the freshly-fitted size now that we are attached.
        postResize(term.cols, term.rows);
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (event === "out") term.write(b64decode(data));
            else if (event === "exit") {
              onStatus?.("exited");
              term.write(
                `\r\n\x1b[38;5;245m[process exited — reconnect to start a new shell]\x1b[0m\r\n`,
              );
            }
          }
        }
        if (!aborted) {
          onStatus?.("error");
          scheduleReconnect();
        }
      } catch {
        if (!aborted) {
          onStatus?.("error");
          scheduleReconnect();
        }
      }
    };

    const scheduleReconnect = () => {
      if (aborted) return;
      reconnectTimer = setTimeout(() => {
        term.clear();
        connect();
      }, 1200);
    };

    connect();

    // Tap to focus (raise the mobile keyboard).
    const focus = () => term.focus();
    host.addEventListener("click", focus);

    return () => {
      aborted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller?.abort();
      ro.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      host.removeEventListener("click", focus);
      term.dispose();
    };
    // Rebuild the whole terminal when the bound repo changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  return <div ref={hostRef} className="h-full w-full" />;
}
