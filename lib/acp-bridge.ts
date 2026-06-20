// Long-lived ACP (Agent Client Protocol) bridge to the real Hermes agent.
//
// This is the streaming spine that makes the iOS chat feel like the desktop:
// instead of the headless `--cli -q -Q` path (which buffers the whole turn and
// dumps the final answer), we drive `hermes acp` over JSON-RPC/stdio and relay
// its live `session/update` notifications — token-by-token text, reasoning, and
// tool-call activity — straight to the browser.
//
// One adapter process is spawned PER PROFILE and kept warm. The spawn is
// `hermes -p <profile> acp --accept-hooks`, so switching profile in the app
// actually changes which brain (model + system prompt + toolset + .env) runs
// the turn. Sessions are multiplexed over each adapter: each repo gets one ACP
// session (cwd = repo path), persisted to a per-profile map so they survive a
// server restart and never collide across profiles.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.HOME ?? homedir();

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

/** Which brain runs the turn. Profile is the lever; model/provider are
 *  optional per-invocation overrides (`-m` / `--provider`). */
export interface BridgeTarget {
  profile: string;
  model?: string;
  provider?: string;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

type ToolKind = { name: string; title: string };

/** Stable registry key for a (profile, model, provider) combo. */
function targetKey(t: BridgeTarget): string {
  return [t.profile || "default", t.model ?? "", t.provider ?? ""].join("|");
}

/** Filesystem-safe slug for the per-target session map file. */
function targetSlug(t: BridgeTarget): string {
  return targetKey(t).replace(/[^a-zA-Z0-9._-]/g, "_");
}

class AcpBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;

  private readonly target: BridgeTarget;
  private readonly mapPath: string;

  // repo -> ACP session id (persisted across restarts).
  private repoSession = new Map<string, string>();
  // sessions we've created/loaded in THIS process (no reload needed).
  private liveSessions = new Set<string>();

  // Per-session event sinks, keyed by ACP sessionId. Verified empirically: the
  // agent tags EVERY session/update with its sessionId and runs prompts for
  // different sessions CONCURRENTLY. So we route each update to the sink for its
  // session — N turns stream in parallel on one warm adapter, with no
  // cross-wiring. (The old single-sink design dumped a still-running turn's
  // tokens into whatever turn started last.) toolCallIds are globally unique, so
  // one shared kind map is safe across concurrent sessions.
  private sinks = new Map<string, (ev: AcpTurnEvent) => void>();
  private toolKinds = new Map<string, ToolKind>();

  constructor(target: BridgeTarget) {
    this.target = target;
    // Default profile with no override keeps the legacy map path so existing
    // general/repo sessions carry over. Everything else is namespaced.
    const isLegacy =
      (target.profile || "default") === "default" && !target.model && !target.provider;
    this.mapPath = isLegacy
      ? join(HOME, ".hermes", "lo-acp-sessions.json")
      : join(HOME, ".hermes", `lo-acp-sessions__${targetSlug(target)}.json`);
    this.loadMap();
  }

  private loadMap() {
    try {
      const raw = readFileSync(this.mapPath, "utf8");
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
      writeFileSync(this.mapPath, JSON.stringify(obj));
    } catch {
      /* best-effort */
    }
  }

  /** `hermes -p <profile> [-m <model>] [--provider <prov>] acp --accept-hooks` */
  private spawnArgs(): string[] {
    const args = ["-p", this.target.profile || "default"];
    if (this.target.model) args.push("-m", this.target.model);
    if (this.target.provider) args.push("--provider", this.target.provider);
    args.push("acp", "--accept-hooks");
    return args;
  }

  private ensureProc(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const bin = process.env.HERMES_BIN || "hermes";
      const child = spawn(bin, this.spawnArgs(), {
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
        for (const sink of this.sinks.values()) {
          sink({ kind: "error", error: "agent process exited" });
        }
        this.sinks.clear();
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
        const params = msg.params as Record<string, unknown> | undefined;
        this.onUpdate(
          params?.sessionId as string | undefined,
          params?.update as Record<string, unknown> | undefined,
        );
      }
      // server->client requests (fs/permission) are not expected: we declared
      // no fs capability and run --accept-hooks, so nothing to answer.
    }
  }

  private onUpdate(sessionId: string | undefined, u: Record<string, unknown> | undefined) {
    if (!u) return;
    const sink = sessionId ? this.sinks.get(sessionId) : undefined;
    if (!sink) return;
    const kind = u.sessionUpdate as string;
    switch (kind) {
      case "agent_message_chunk": {
        const text = ((u.content as Record<string, unknown>)?.text as string) ?? "";
        if (text) sink({ kind: "delta", text });
        break;
      }
      case "agent_thought_chunk": {
        const text = ((u.content as Record<string, unknown>)?.text as string) ?? "";
        if (text) sink({ kind: "thought", text });
        break;
      }
      case "tool_call": {
        const id = (u.toolCallId as string) ?? "";
        const name = (u.kind as string) ?? (u.title as string) ?? "tool";
        const title = (u.title as string) ?? name;
        this.toolKinds.set(id, { name, title });
        sink({ kind: "tool-start", id, name, title });
        break;
      }
      case "tool_call_update": {
        const id = (u.toolCallId as string) ?? "";
        const status = (u.status as string) ?? "";
        if (status === "completed" || status === "failed") {
          const meta = this.toolKinds.get(id) ?? { name: "tool", title: "tool" };
          this.toolKinds.delete(id);
          sink({
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
        sink({
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
   *
   * Guards the poisoned-session class: a persisted session id can survive a
   * `session/load` (resolves OK) yet produce a dead turn — instant `end_turn`
   * with zero content. When a LOADED (not fresh) session does that, we drop it
   * from the map and retry once with a brand-new session.
   */
  async prompt(
    repo: string,
    cwd: string,
    text: string,
    onEvent: (ev: AcpTurnEvent) => void,
    images: { data: string; mime: string }[] = [],
  ): Promise<void> {
    await this.ensureProc();
    let { id, isNew } = await this.resolveSession(repo, cwd);

    // Build the ACP prompt content blocks: the text turn plus any image
    // attachments as image content blocks (the adapter forwards these to the
    // model as image_url parts so vision models can see pasted photos). `data`
    // is sent as raw base64 — strip the data-URL prefix if present.
    const promptBlocks: Record<string, unknown>[] = [{ type: "text", text }];
    for (const img of images) {
      const raw = img.data.startsWith("data:")
        ? img.data.slice(img.data.indexOf(",") + 1)
        : img.data;
      if (!raw) continue;
      promptBlocks.push({ type: "image", data: raw, mimeType: img.mime || "image/png" });
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      this.toolKinds.clear();
      let gotContent = false;
      const wrapped = (ev: AcpTurnEvent) => {
        if (ev.kind === "delta" || ev.kind === "thought" || ev.kind === "tool-start") {
          gotContent = true;
        }
        // Swallow the synthetic done/error on a dead loaded session so we can
        // retry transparently; otherwise pass everything through.
        onEvent(ev);
      };

      // Register this turn's sink under its sessionId so concurrent turns on
      // OTHER sessions keep streaming to their own sinks (no cross-wiring).
      this.sinks.set(id, wrapped);
      onEvent({ kind: "session", sessionId: id, isNew });

      let stopReason = "end_turn";
      let failed = false;
      try {
        const res = (await this.rpc("session/prompt", {
          sessionId: id,
          prompt: promptBlocks,
        })) as { stopReason?: string };
        stopReason = res?.stopReason ?? "end_turn";
      } catch (e) {
        failed = true;
        // A loaded session may reject on prompt if its backing row was pruned.
        if (attempt === 0 && !isNew) {
          this.sinks.delete(id);
          this.invalidate(repo, id);
          const fresh = await this.resolveSession(repo, cwd);
          id = fresh.id;
          isNew = fresh.isNew;
          continue;
        }
        onEvent({ kind: "error", error: e instanceof Error ? e.message : "prompt failed" });
      } finally {
        this.sinks.delete(id);
      }

      // Dead loaded session: resolved with no content. Retry once fresh.
      if (!failed && !gotContent && !isNew && attempt === 0) {
        this.invalidate(repo, id);
        const fresh = await this.resolveSession(repo, cwd);
        id = fresh.id;
        isNew = fresh.isNew;
        continue;
      }

      if (!failed) onEvent({ kind: "done", stopReason });
      return;
    }
  }

  /** Forget a session that proved dead (stale id / pruned row). */
  private invalidate(repo: string, id: string) {
    if (this.repoSession.get(repo) === id) {
      this.repoSession.delete(repo);
      this.saveMap();
    }
    this.liveSessions.delete(id);
  }

  /** Tear down the adapter process so the next turn respawns it fresh. Used
   *  when a global setting the adapter reads at boot changes (e.g. reasoning
   *  effort in config.yaml) — the warm process would otherwise keep the old
   *  value for the life of the server. Session ids are persisted to disk, so
   *  they survive the respawn (cold session/load on next turn). */
  kill(): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    this.liveSessions.clear();
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
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

  /**
   * Public cancel entry point for the stop-turn route. Fires the existing
   * session/cancel RPC for this repo's session (best-effort, swallows errors).
   * Returns true when a session id was known for the repo (i.e. a cancel was
   * attempted), false when there was nothing to cancel on this bridge.
   */
  async cancelByRepo(repo: string): Promise<boolean> {
    const id = this.repoSession.get(repo);
    if (!id) return false;
    await this.cancel(repo);
    return true;
  }
}

// Module singleton registry — one warm bridge per (profile, model, provider),
// surviving across requests within the Node server process.
declare global {
   
  var __loAcpBridges: Map<string, AcpBridge> | undefined;
}

export function acpBridge(target: BridgeTarget = { profile: "default" }): AcpBridge {
  if (!global.__loAcpBridges) global.__loAcpBridges = new Map<string, AcpBridge>();
  const key = targetKey(target);
  let bridge = global.__loAcpBridges.get(key);
  if (!bridge) {
    bridge = new AcpBridge(target);
    global.__loAcpBridges.set(key, bridge);
  }
  return bridge;
}

/**
 * Cancel a repo's in-flight turn across EVERY warm bridge. The mobile client
 * only knows the repo, not which (profile, model, provider) bridge actually ran
 * the turn, so we fan the cancel out to all live bridges in the registry and
 * let each one no-op when it has no session for that repo. Best-effort: errors
 * are swallowed per bridge so one bad bridge cannot block the others. Returns
 * the number of bridges that had a session for the repo and were asked to
 * cancel (0 when nothing was in flight anywhere).
 */
export async function cancelAllForRepo(repo: string): Promise<number> {
  const registry = global.__loAcpBridges;
  if (!registry) return 0;
  let cancelled = 0;
  const tasks: Promise<void>[] = [];
  for (const bridge of registry.values()) {
    tasks.push(
      (async () => {
        try {
          if (await bridge.cancelByRepo(repo)) cancelled += 1;
        } catch {
          /* best-effort: never let one bridge break the fan-out */
        }
      })(),
    );
  }
  await Promise.all(tasks);
  return cancelled;
}

/**
 * Kill every warm bridge so the next turn respawns each adapter fresh. Call
 * after changing a global setting the adapter reads only at boot (reasoning
 * effort, etc.). Returns how many bridges were town down. Session ids persist
 * to disk, so conversations carry over the respawn.
 */
export function resetAllBridges(): number {
  const registry = global.__loAcpBridges;
  if (!registry) return 0;
  let n = 0;
  for (const bridge of registry.values()) {
    try {
      bridge.kill();
      n += 1;
    } catch {
      /* best-effort */
    }
  }
  registry.clear();
  return n;
}
