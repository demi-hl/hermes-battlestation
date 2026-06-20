import { NextResponse } from "next/server";
import { listLocalRepos } from "@/lib/local-repos";
import {
  querySessionById,
  readBridgeSessions,
  resolveBridgeId,
  usageFromRow,
  GENERAL_THREAD_ID,
  GENERAL_SESSION_TITLE,
  GENERAL_CWD,
  repoSlug,
} from "@/lib/sessions";
import type { ChatThread, ThreadsPayload } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The chat hub's thread list. Threads = the "general" thread + every repo/branch
 * the ACP bridge has an active session for. The bridge persists a key->sessionId
 * map (`~/.hermes/lo-acp-sessions*.json`); that map — NOT a `lol-*` DB title — is
 * the real registry, because the ACP path auto-titles the underlying session row
 * ("Open Source Repo Setup for App") and never renames it to `lol-<slug>`. We
 * resolve each mapped id to its live DB row for the message count + usage meter.
 * The repo list lets the composer start a NEW thread for a repo with no session.
 */
export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const repos = await listLocalRepos();
    const bridge = readBridgeSessions();

    // Resolve the general thread's backing session via the bridge map first
    // (its real id), falling back to nothing if no session exists yet.
    const generalId =
      bridge.get(GENERAL_SESSION_TITLE) ?? bridge.get(GENERAL_THREAD_ID) ?? null;
    const generalRow = generalId ? await querySessionById(generalId) : null;

    const threads: ChatThread[] = [];

    threads.push({
      id: GENERAL_THREAD_ID,
      title: "general",
      repo: null,
      cwd: GENERAL_CWD,
      sessionTitle: GENERAL_SESSION_TITLE,
      sessionId: generalRow?.id ?? generalId,
      messageCount: generalRow?.messageCount ?? 0,
      model: generalRow?.model ?? null,
      lastActive: generalRow?.lastActive ? Math.round(generalRow.lastActive * 1000) : null,
      usage: usageFromRow(generalRow),
    });

    // Build one thread per bridge-mapped repo/branch key (excluding the general
    // aliases, handled above). Keys are `lol-<slug>[__<branch>]`, a bare slug,
    // or a legacy repo name — resolveBridgeId understands all shapes, but here
    // we iterate the map so we surface exactly the sessions that exist.
    const byName = new Map(repos.map((r) => [r.name, r]));
    const seen = new Set<string>([generalRow?.id ?? "", generalId ?? ""]);

    for (const [key, sessionId] of bridge) {
      if (key === GENERAL_SESSION_TITLE || key === GENERAL_THREAD_ID) continue;
      if (!sessionId || seen.has(sessionId)) continue;
      seen.add(sessionId);

      // Parse `lol-<slug>[__<branch>]` / bare-slug / repo-name into repo+branch.
      const raw = key.replace(/^lol-/, "");
      const [slug, branchSuffix] = raw.split("__");
      const branch = branchSuffix ? branchSuffix : null;
      const repo =
        repos.find((r) => repoSlug(r.name) === slug || r.name === slug)?.name ?? slug;
      const known = byName.get(repo);
      const row = await querySessionById(sessionId);

      threads.push({
        id: key, // stable thread id = bridge map key
        title: branch ? `${repo} · ${branch}` : repo,
        repo,
        branch,
        cwd: known?.path ?? GENERAL_CWD,
        sessionTitle: key,
        sessionId,
        messageCount: row?.messageCount ?? 0,
        model: row?.model ?? null,
        lastActive: row?.lastActive ? Math.round(row.lastActive * 1000) : null,
        usage: usageFromRow(row),
      });
    }

    // Newest activity first (general stays pinned at the top).
    const [general, ...rest] = threads;
    rest.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));

    const payload: ThreadsPayload = {
      threads: [general, ...rest],
      repos,
      home: GENERAL_CWD,
      fetchedAt,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const payload: ThreadsPayload = {
      threads: [],
      repos: [],
      home: GENERAL_CWD,
      fetchedAt,
      error: e instanceof Error ? e.message : "failed to load threads",
    };
    return NextResponse.json(payload, { status: 200 });
  }
}
