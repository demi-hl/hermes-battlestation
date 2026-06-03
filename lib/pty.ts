import os from "node:os";
import * as pty from "node-pty";

/**
 * Server-side PTY session manager for the Terminal pane.
 *
 * One real PTY (node-pty) per session id; the Terminal keys the id to the active
 * repo slug, so a session survives the pane unmounting on tab-switch and resumes
 * with its scrollback when re-attached (persistent per-repo cwd). Output fans
 * out to any number of live SSE listeners; a bounded ring buffer is replayed to
 * each new attachment so the screen reconstructs. Idle sessions are reaped.
 */

const SHELL = process.env.SHELL || "/bin/bash";
const RING_LIMIT = 256 * 1024; // bytes of recent output replayed on attach
const IDLE_MS = 15 * 60 * 1000; // kill sessions untouched for 15 min
const MAX_SESSIONS = 12;

export interface PtyListener {
  onData: (chunk: string) => void;
  onExit: (code: number) => void;
}

interface Session {
  id: string;
  cwd: string;
  proc: pty.IPty;
  ring: string;
  listeners: Set<PtyListener>;
  exited: boolean;
  exitCode: number | null;
  lastUsed: number;
}

// Persist the map across Next route-module reloads in dev (module state can be
// re-evaluated on hot reload); in prod this is just a module singleton.
const g = globalThis as unknown as { __loPty?: Map<string, Session> };
const sessions: Map<string, Session> = g.__loPty ?? new Map();
g.__loPty = sessions;

let reaper: ReturnType<typeof setInterval> | null = null;
function ensureReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (s.exited && s.listeners.size === 0) {
        sessions.delete(s.id);
        continue;
      }
      if (now - s.lastUsed > IDLE_MS && s.listeners.size === 0) {
        try {
          s.proc.kill();
        } catch {
          /* already gone */
        }
        sessions.delete(s.id);
      }
    }
  }, 60_000);
  // Do not keep the event loop alive solely for the reaper.
  if (typeof reaper.unref === "function") reaper.unref();
}

function appendRing(s: Session, chunk: string) {
  s.ring += chunk;
  if (s.ring.length > RING_LIMIT) {
    s.ring = s.ring.slice(s.ring.length - RING_LIMIT);
  }
}

export function getOrCreateSession(id: string, cwd: string): Session {
  ensureReaper();
  const existing = sessions.get(id);
  if (existing && !existing.exited) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (existing) sessions.delete(id);

  // Evict the oldest idle session if we are at the cap.
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort(
      (a, b) => a.lastUsed - b.lastUsed,
    )[0];
    if (oldest) {
      try {
        oldest.proc.kill();
      } catch {
        /* ignore */
      }
      sessions.delete(oldest.id);
    }
  }

  const proc = pty.spawn(SHELL, ["-l"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
      // Mark the shell so a user's rc can branch if desired.
      LOCALS_ONLY: "1",
    } as Record<string, string>,
  });

  const session: Session = {
    id,
    cwd,
    proc,
    ring: "",
    listeners: new Set(),
    exited: false,
    exitCode: null,
    lastUsed: Date.now(),
  };

  proc.onData((chunk) => {
    appendRing(session, chunk);
    session.lastUsed = Date.now();
    for (const l of session.listeners) {
      try {
        l.onData(chunk);
      } catch {
        /* a dead listener should not break the fan-out */
      }
    }
  });

  proc.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    for (const l of session.listeners) {
      try {
        l.onExit(exitCode);
      } catch {
        /* ignore */
      }
    }
  });

  sessions.set(id, session);
  return session;
}

/** Attach a listener; returns the scrollback to replay plus a detach fn. */
export function attach(
  session: Session,
  listener: PtyListener,
): { replay: string; detach: () => void } {
  session.listeners.add(listener);
  session.lastUsed = Date.now();
  return {
    replay: session.ring,
    detach: () => {
      session.listeners.delete(listener);
      session.lastUsed = Date.now();
    },
  };
}

export function writeToSession(id: string, data: string): boolean {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  s.proc.write(data);
  s.lastUsed = Date.now();
  return true;
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  const c = Math.max(2, Math.min(500, Math.floor(cols)));
  const r = Math.max(1, Math.min(300, Math.floor(rows)));
  try {
    s.proc.resize(c, r);
    s.lastUsed = Date.now();
    return true;
  } catch {
    return false;
  }
}

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    s.proc.kill();
  } catch {
    /* ignore */
  }
  sessions.delete(id);
  return true;
}

export function defaultCwd(): string {
  return os.homedir();
}
