import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, Repo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env: ApiEnvelope<Repo[]> = await cached("repos", 60_000, async () => {
    const r = await run(
      "gh repo list demi-hl --limit 30 --json name,description,pushedAt,url",
      { timeoutMs: 12000 },
    );
    if (!r.ok) {
      return {
        data: null,
        fetchedAt: new Date().toISOString(),
        error: r.stderr.trim() || "gh repo list failed",
      };
    }
    let repos: Repo[] = [];
    try {
      repos = JSON.parse(r.stdout) as Repo[];
    } catch {
      return {
        data: null,
        fetchedAt: new Date().toISOString(),
        error: "could not parse gh output",
      };
    }
    repos.sort(
      (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
    );
    return { data: repos, fetchedAt: new Date().toISOString() };
  });
  return NextResponse.json(env);
}
