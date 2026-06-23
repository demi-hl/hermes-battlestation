import { NextResponse } from "next/server";
import { run, scrubPaths} from "@/lib/exec";
import { bust } from "@/lib/cache";
import { isValidFullName, isValidNumber } from "@/lib/prs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS: Record<string, string> = {
  squash: "--squash",
  merge: "--merge",
  rebase: "--rebase",
};

/**
 * Merge a pull request via `gh pr merge`. repo + number are strictly validated
 * before any shell interpolation. Default strategy is squash; `--delete-branch`
 * cleans up the head branch. Returns the gh result so the sheet can confirm.
 */
export async function POST(req: Request) {
  let body: { repo?: string; number?: number | string; method?: string; deleteBranch?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const repo = String(body.repo ?? "");
  const number = String(body.number ?? "");
  const method = METHODS[(body.method ?? "squash").trim()] ?? "--squash";
  const deleteBranch = body.deleteBranch !== false; // default true

  if (!isValidFullName(repo) || !isValidNumber(number)) {
    return NextResponse.json({ error: "invalid repo or pr number" }, { status: 400 });
  }

  const parts = ["gh pr merge", number, "--repo", repo, method];
  if (deleteBranch) parts.push("--delete-branch");

  const r = await run(parts.join(" "), { timeoutMs: 30_000 });
  if (!r.ok) {
    const msg = scrubPaths(r.stderr || r.stdout || "gh pr merge failed").split("\n")[0];
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Drop cached PR lists + this PR's detail so the UI reflects the merge.
  bust("prs");
  bust(`pr:detail:${repo}#${number}`);
  return NextResponse.json({ ok: true, repo, number, merged: true });
}
