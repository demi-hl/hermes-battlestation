import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import type { KanbanData, KanbanTask } from "@/lib/kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
          error: r.stderr.trim().split("\n")[0] || "hermes kanban ls failed",
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
