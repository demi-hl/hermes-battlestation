// Long-lived ACP (Agent Client Protocol) bridge to the real Hermes agent.
//
// This is the streaming spine that makes the iOS chat feel like the desktop:
// instead of the headless `--cli -q -Q` path (which buffers the whole turn and
// dumps the final answer), we drive `hermes acp` over JSON-RPC/stdio and relay
// its live `session/update` notifications — token-by-token text, reasoning, and
// tool-call activity — straight to the browser.
//
// One adapter process is spawned per Node server and kept warm. Sessions are
// multiplexed over it: each repo gets one ACP session (cwd = repo path), and
// the adapter persists sessions to ~/.hermes/state.db so they survive a server
// restart (we re-`session/load` lazily on the first turn after a cold start).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.HOME ?? homedir();
const MAP_PATH = join(HOME, ".hermes", "lo-acp-sessions.json");

/** A streamed turn event, normalized from ACP `session/update`. */
export type AcpTurnEvent =
  | { kind: "session"; sessionId: string; isNew: boolean }
  | { kind: "delta"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "tool-start"; id: string; name: string; title: string }
  | { kind: "tool-end"; id: string; name: string; title: string; ok: boolean }
  | { kind: "usage"; used: number; total: number }
  | { kind: "done"; stopReason: string }
  | { kind: "error"; error: string };

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

type ToolKind = { name: string; title: string };

class AcpBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;

  // repo -> ACP session id (persisted across restarts).
  private repoSession = new Map<string, string>();
  // sessions we've created/loaded in THIS process (no reload needed).
  private liveSessions = new Set<string>();

  // The single in-flight turn's event sink. ACP gives no per-request session
  // tagging on notifications, and we serialize turns globally (single user),
  // so one active sink at a time is correct.
  private sink: ((ev: AcpTurnEvent) => void) | null = null;
  private sinkSession: string | null = null;
  private toolKinds = new Map<string, ToolKind>();

  constructor() {
    this.loadMap();
  }

  private loadMap() {
    try {
      const raw = readFileSync(MAP_PATH, "utf8");
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) this.repoSession.set(k, v);
    } catch {
      /* first run — no map yet */
    }
  }

  private saveMap() {
    try {
      mkdirSync(join(HOME, ".hermes"), { recursive: true });
      const obj: Record<string, string> = {};
      for (const [k, v] of this.repoSession) obj[k] = v;
      writeFileSync(MAP_PATH, JSON.stringify(obj));
    } catch {
      /* best-effort */
    }
  }

  private ensureProc(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn("hermes", ["acp", "--accept-hooks"], {
        cwd: HOME,
        env: {
          ...process.env,
          HERMES_ACCEPT_HOOKS: "1",
          HERMES_YOLO_MODE: "1",
          HERMES_SESSION_SOURCE: "locals-only",
        },
      });
      this.child = child;

      child.stdout.on("data", (d: Buffer) => this.onData(d.toString()));
      child.stderr.on("data", () => {
        /* human logs — ignored, stdout is the JSON-RPC channel */
      });
      child.on("exit", () => {
        this.child = null;
        this.ready = null;
        this.liveSessions.clear();
        // Reject any in-flight waiters.
        for (const [, p] of this.pending) p.reject(new Error("acp adapter exited"));
        this.pending.clear();
        if (this.sink) {
          this.sink({ kind: "error", error: "agent process exited" });
          this.sink = null;
        }
      });
      child.on("error", (e) => reject(e));

      // Handshake.
      this.rpc("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: "locals-only-ios", version: "1" },
      })
        .then(() => resolve())
        .catch(reject);
    });
    return this.ready;
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number" && (("result" in msg) || ("error" in msg))) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if ("error" in msg && msg.error) {
            p.reject(new Error(JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
          }
        }
      } else if (msg.method === "session/update") {
        this.onUpdate((msg.params as Record<string, unknown>)?.update as Record<string, unknown>);
      }
      // server->client requests (fs/permission) are not expected: we declared
      // no fs capability and run --accept-hooks, so nothing to answer.
    }
  }

  private onUpdate(u: Record<string, unknown> | undefined) {
    if (!u || !this.sink) return;
    const kind = u.sessionUpdate as string;
    switch (kind) {
      case "agent_message_chunk": {
        const text = ((u.content as Record<string, unknown>)?.text as string) ?? "";
        if (text) this.sink({ kind: "delta", text });
        break;
      }
      case "agent_thought_chunk": {
        const text = ((u.content as Record<string, unknown>)?.text as string) ?? "";
        if (text) this.sink({ kind: "thought", text });
        break;
      }
      case "tool_call": {
        const id = (u.toolCallId as string) ?? "";
        const name = (u.kind as string) ?? (u.title as string) ?? "tool";
        const title = (u.title as string) ?? name;
        this.toolKinds.set(id, { name, title });
        this.sink({ kind: "tool-start", id, name, title });
        break;
      }
      case "tool_call_update": {
        const id = (u.toolCallId as string) ?? "";
        const status = (u.status as string) ?? "";
        if (status === "completed" || status === "failed") {
          const meta = this.toolKinds.get(id) ?? { name: "tool", title: "tool" };
          this.toolKinds.delete(id);
          this.sink({
            kind: "tool-end",
            id,
            name: meta.name,
            title: meta.title,
            ok: status === "completed",
          });
        }
        break;
      }
      case "usage_update": {
        this.sink({
          kind: "usage",
          used: (u.used as number) ?? 0,
          total: (u.size as number) ?? 0,
        });
        break;
      }
      default:
        break; // plan / available_commands / mode — not surfaced yet
    }
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("acp not started"));
    const id = ++this.nextId;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(payload);
    });
  }

  /** Resolve (creating or loading) the ACP session bound to a repo+cwd. */
  private async resolveSession(repo: string, cwd: string): Promise<{ id: string; isNew: boolean }> {
    const known = this.repoSession.get(repo);
    if (known) {
      if (this.liveSessions.has(known)) return { id: known, isNew: false };
      // Cold start: the adapter persisted this session — load it.
      try {
        await this.rpc("session/load", { sessionId: known, cwd, mcpServers: [] });
        this.liveSessions.add(known);
        return { id: known, isNew: false };
      } catch {
        // Stale id (db pruned). Fall through to create a fresh one.
        this.repoSession.delete(repo);
      }
    }
    const res = (await this.rpc("session/new", { cwd, mcpServers: [] })) as {
      sessionId: string;
    };
    const id = res.sessionId;
    this.repoSession.set(repo, id);
    this.liveSessions.add(id);
    this.saveMap();
    return { id, isNew: true };
  }

  /**
   * Run one turn. Streams normalized events to `onEvent` and resolves when the
   * turn ends. Caller serializes turns (one active sink at a time).
   */
  async prompt(
    repo: string,
    cwd: string,
    text: string,
    onEvent: (ev: AcpTurnEvent) => void,
  ): Promise<void> {
    await this.ensureProc();
    const { id, isNew } = await this.resolveSession(repo, cwd);

    this.sink = onEvent;
    this.sinkSession = id;
    this.toolKinds.clear();
    onEvent({ kind: "session", sessionId: id, isNew });

    try {
      const res = (await this.rpc("session/prompt", {
        sessionId: id,
        prompt: [{ type: "text", text }],
      })) as { stopReason?: string };
      onEvent({ kind: "done", stopReason: res?.stopReason ?? "end_turn" });
    } catch (e) {
      onEvent({ kind: "error", error: e instanceof Error ? e.message : "prompt failed" });
    } finally {
      if (this.sinkSession === id) {
        this.sink = null;
        this.sinkSession = null;
      }
    }
  }

  /** Cancel the in-flight turn for a repo's session. */
  async cancel(repo: string): Promise<void> {
    const id = this.repoSession.get(repo);
    if (!id || !this.child) return;
    try {
      await this.rpc("session/cancel", { sessionId: id });
    } catch {
      /* best-effort */
    }
  }
}

// Module singleton — survives across requests within the Node server process.
declare global {
  // eslint-disable-next-line no-var
  var __loAcpBridge: AcpBridge | undefined;
}

export function acpBridge(): AcpBridge {
  if (!global.__loAcpBridge) global.__loAcpBridge = new AcpBridge();
  return global.__loAcpBridge;
}
