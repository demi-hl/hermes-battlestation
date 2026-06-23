import { NextResponse } from "next/server";
import { run, scrubPaths} from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import {
  type PrDetail,
  ciFromRollup,
  checksFromRollup,
  normalizeReview,
  isValidFullName,
  isValidNumber,
} from "@/lib/prs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS =
  "number,title,body,state,isDraft,headRefName,baseRefName,additions,deletions,changedFiles,commits,statusCheckRollup,reviewDecision,author,url,createdAt,updatedAt";

interface RawDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: unknown[];
  statusCheckRollup: unknown;
  reviewDecision: unknown;
  author: { login?: string } | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") ?? "";
  const number = url.searchParams.get("number") ?? "";

  // repo + number come from the client → strict validation BEFORE any shell
  // interpolation. Reject anything outside the github name charset.
  if (!isValidFullName(repo) || !isValidNumber(number)) {
    return NextResponse.json<ApiEnvelope<PrDetail>>(
      {
        data: null,
        fetchedAt: new Date().toISOString(),
        error: "invalid repo or pr number",
      },
      { status: 400 },
    );
  }

  const env = await cached(`pr:detail:${repo}#${number}`, 30_000, async () => {
    const at = new Date().toISOString();
    const r = await run(
      `gh pr view ${number} --repo ${repo} --json ${FIELDS}`,
      { timeoutMs: 15_000 },
    );
    if (!r.ok) {
      return {
        data: null,
        fetchedAt: at,
        error: scrubPaths(r.stderr) || "gh pr view failed",
      } satisfies ApiEnvelope<PrDetail>;
    }
    let raw: RawDetail;
    try {
      raw = JSON.parse(r.stdout) as RawDetail;
    } catch {
      return {
        data: null,
        fetchedAt: at,
        error: "could not parse gh pr view output",
      } satisfies ApiEnvelope<PrDetail>;
    }
    const detail: PrDetail = {
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state,
      isDraft: !!raw.isDraft,
      headRef: raw.headRefName,
      baseRef: raw.baseRefName,
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changedFiles ?? 0,
      commits: Array.isArray(raw.commits) ? raw.commits.length : 0,
      ci: ciFromRollup(raw.statusCheckRollup),
      checks: checksFromRollup(raw.statusCheckRollup),
      review: normalizeReview(raw.reviewDecision),
      author: raw.author?.login ?? null,
      url: raw.url,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
    return { data: detail, fetchedAt: at } satisfies ApiEnvelope<PrDetail>;
  });
  return NextResponse.json(env);
}
