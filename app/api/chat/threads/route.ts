import { NextResponse } from "next/server";
import { listLocalRepos } from "@/lib/local-repos";
import {
  listLolSessions,
  querySessionByTitle,
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
 * The chat hub's thread list. Threads = the "general" thread + every existing
 * `lol-*` Hermes session (the per-repo contexts already spun up). The repo list
 * lets the composer start a NEW thread bound to a repo that has no session yet.
 * All session data is real (read from ~/.hermes/state.db); repos are real git
 * dirs under the scan roots.
 */
export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const [repos, sessions, generalRow] = await Promise.all([
      listLocalRepos(),
      listLolSessions(),
      querySessionByTitle(GENERAL_SESSION_TITLE),
    ]);

    const byName = new Map(repos.map((r) => [r.name, r]));

    const threads: ChatThread[] = [];

    // General thread first (home cwd).
    threads.push({
      id: GENERAL_THREAD_ID,
      title: "general",
      repo: null,
      cwd: GENERAL_CWD,
      sessionTitle: GENERAL_SESSION_TITLE,
      sessionId: generalRow?.id ?? null,
      messageCount: generalRow?.messageCount ?? 0,
      model: generalRow?.model ?? null,
      lastActive: generalRow?.lastActive ? Math.round(generalRow.lastActive * 1000) : null,
      usage: usageFromRow(generalRow),
    });

    // One thread per existing lol-* session (excluding general).
    for (const s of sessions) {
      const title = s.title ?? "";
      if (!title || title === GENERAL_SESSION_TITLE) continue;
      const slug = title.replace(/^lol-/, "");
      // Map slug back to a known repo name when possible (slug is lossy, so
      // match against the slugified repo names).
      const repo =
        repos.find((r) => repoSlug(r.name) === slug)?.name ?? slug;
      const known = byName.get(repo);
      threads.push({
        id: title,
        title: repo,
        repo,
        cwd: known?.path ?? GENERAL_CWD,
        sessionTitle: title,
        sessionId: s.id,
        messageCount: s.messageCount,
        model: s.model,
        lastActive: s.lastActive ? Math.round(s.lastActive * 1000) : null,
        usage: usageFromRow(s),
      });
    }

    const payload: ThreadsPayload = {
      threads,
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
