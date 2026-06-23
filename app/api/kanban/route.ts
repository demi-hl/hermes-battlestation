import { NextResponse } from "next/server";
import { run, scrubPaths} from "@/lib/exec";
import { cached, bust } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import type { KanbanData, KanbanTask } from "@/lib/kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sq(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// Read the real shared board (SQLite-backed at ~/.hermes/kanban.db). An empty
// board is a valid result — the pane renders a designed empty state.
export async function GET() {
  const env: ApiEnvelope<KanbanData> = await cached(
    "kanban",
    15_000,
    async () => {
      const r = await run("hermes kanban ls --json", { timeoutMs: 12000 });
      if (!r.ok) {
        return {
          data: null,
          fetchedAt: new Date().toISOString(),
          error: scrubPaths(r.stderr).split("\n")[0] || "hermes kanban ls failed",
        };
      }
      let tasks: KanbanTask[] = [];
      try {
        tasks = JSON.parse(r.stdout) as KanbanTask[];
      } catch {
        return {
          data: null,
          fetchedAt: new Date().toISOString(),
          error: "could not parse hermes kanban output",
        };
      }
      return {
        data: { board: "default", tasks },
        fetchedAt: new Date().toISOString(),
      };
    },
  );
  return NextResponse.json(env);
}

// Create a task on the shared board via `hermes kanban create`. The CLI parks
// new tasks in todo/triage (it has no arbitrary --status); the requested
// `status` is accepted for API symmetry but the real lane is the CLI default.
// --triage routes through the specifier when the caller asks for it.
export async function POST(req: Request) {
  let body: { title?: string; body?: string; status?: string; triage?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const parts = ["hermes kanban create", sq(title)];
  if (body.body && body.body.trim()) parts.push("--body", sq(body.body.trim()));
  if (body.triage) parts.push("--triage");
  parts.push("--created-by", sq("battlestation"), "--json");

  const r = await run(parts.join(" "), { timeoutMs: 15000 });
  if (!r.ok) {
    return NextResponse.json(
      { error: scrubPaths(r.stderr).split("\n")[0] || "hermes kanban create failed" },
      { status: 500 },
    );
  }
  let task: KanbanTask | null = null;
  try {
    task = JSON.parse(r.stdout) as KanbanTask;
  } catch {
    // CLI succeeded but emitted non-JSON — still a success, just no echo.
  }
  bust("kanban");
  return NextResponse.json({ ok: true, task });
}
