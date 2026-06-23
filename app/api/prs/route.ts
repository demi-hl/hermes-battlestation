import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run, scrubPaths} from "@/lib/exec";
import { cached, bust } from "@/lib/cache";
import type { ApiEnvelope } from "@/lib/types";
import {
  type PrsPayload,
  type PrItem,
  type RepoPRs,
  type IssueItem,
  ciFromRollup,
  normalizeReview,
  parseOwnerRepo,
  isValidFullName,
} from "@/lib/prs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local roots we scan for git repos (per the brief). Both may be absent on a
// given box; enumeration is graceful. We never SSH and never touch the repo
// tree, only `git remote get-url` (read) + `gh` (GitHub API over the authed
// CLI). Owner/repo is DERIVED from each origin, never hardcoded.
const HOME = process.env.HOME ?? process.cwd();
const ROOTS = [`${HOME}/projects`, `${HOME}/agent`];

const PR_FIELDS =
  "number,title,headRefName,baseRefName,additions,deletions,isDraft,statusCheckRollup,reviewDecision,updatedAt,url";

interface RawPr {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  isDraft: boolean;
  statusCheckRollup: unknown;
  reviewDecision: unknown;
  updatedAt: string;
  url: string;
}

function mapPr(p: RawPr): PrItem {
  return {
    number: p.number,
    title: p.title,
    headRef: p.headRefName,
    baseRef: p.baseRefName,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    isDraft: !!p.isDraft,
    ci: ciFromRollup(p.statusCheckRollup),
    review: normalizeReview(p.reviewDecision),
    updatedAt: p.updatedAt,
    url: p.url,
  };
}

async function ghLogin(): Promise<string | null> {
  return cached("gh-login", 300_000, async () => {
    const r = await run("gh api user --jq .login", { timeoutMs: 10_000 });
    return r.ok ? r.stdout.trim() || null : null;
  });
}

/** True when `dir` is a directory holding a `.git` (a normal clone or a
 *  worktree, where `.git` is a file). Follows symlinks via stat. */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    if (!(await stat(dir)).isDirectory()) return false;
    await stat(join(dir, ".git")); // throws if absent
    return true;
  } catch {
    return false;
  }
}

/** github owner/repo for one repo directory, or null if it has no github
 *  origin. cwd-based so the path is never interpolated into the shell. The
 *  try/catch contains a spawn-level throw (e.g. a stale/invalid cwd). */
async function originOf(
  dir: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    if (!(await isGitRepo(dir))) return null;
    const r = await run("git remote get-url origin", { cwd: dir, timeoutMs: 8_000 });
    if (!r.ok) return null;
    return parseOwnerRepo(r.stdout);
  } catch {
    return null;
  }
}

/** Open PRs for one owner/repo. owner/repo come from trusted local origins
 *  (not client input), but they already passed parseOwnerRepo's charset. */
async function prsFor(owner: string, repo: string): Promise<RepoPRs> {
  const full = `${owner}/${repo}`;
  // Belt-and-braces: parseOwnerRepo already gates the charset, but re-check at
  // the exact point of shell interpolation so the safety property is local to
  // where the command is built (survives any future refactor of the callers).
  if (!isValidFullName(full)) {
    return { repo, owner, fullName: full, prs: [], error: "invalid repo name" };
  }
  const r = await run(
    `gh pr list --repo ${full} --state open --limit 50 --json ${PR_FIELDS}`,
    { timeoutMs: 15_000 },
  );
  const base: RepoPRs = { repo, owner, fullName: full, prs: [] };
  if (!r.ok) return { ...base, error: scrubPaths(r.stderr) || "gh pr list failed" };
  try {
    const raw = JSON.parse(r.stdout) as RawPr[];
    return { ...base, prs: raw.map(mapPr) };
  } catch {
    return { ...base, error: "could not parse gh pr list output" };
  }
}

/** Assigned-to-me open issues across the owner in a single search call. */
async function assignedIssues(login: string): Promise<IssueItem[]> {
  const r = await run(
    `gh search issues --owner ${login} --assignee @me --state open --limit 30 --json number,title,repository,url,updatedAt`,
    { timeoutMs: 15_000 },
  );
  if (!r.ok) return [];
  try {
    const raw = JSON.parse(r.stdout) as {
      number: number;
      title: string;
      repository?: { nameWithOwner?: string; name?: string };
      url: string;
      updatedAt: string;
    }[];
    return raw.map((i) => ({
      number: i.number,
      title: i.title,
      repo: i.repository?.nameWithOwner ?? i.repository?.name ?? "",
      url: i.url,
      updatedAt: i.updatedAt,
    }));
  } catch {
    return [];
  }
}

/** All owned github repos under the scan roots (owner === login). */
async function ownedRepos(
  login: string,
): Promise<{ dir: string; owner: string; repo: string }[]> {
  const out: { dir: string; owner: string; repo: string }[] = [];
  const seen = new Set<string>();
  for (const root of ROOTS) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue; // root absent on this box
    }
    const dirs = entries.map((e) => join(root, e));
    const origins = await Promise.all(dirs.map(originOf));
    origins.forEach((o, i) => {
      if (!o || o.owner !== login) return;
      const key = `${o.owner}/${o.repo}`;
      if (seen.has(key)) return; // same repo checked out twice → once
      seen.add(key);
      out.push({ dir: dirs[i], owner: o.owner, repo: o.repo });
    });
  }
  return out;
}

function envelope(payload: PrsPayload): ApiEnvelope<PrsPayload> {
  return { data: payload, fetchedAt: new Date().toISOString() };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  // A manual refresh (refresh=1) drops the relevant cache entries so the next
  // read recomputes from gh; interval polls keep the 30s cache.
  const refresh = url.searchParams.get("refresh");
  if (refresh) bust("gh-login");

  // Scoped: one repo by its local path (the active workspace). The path becomes
  // a shell cwd, so it is canonicalized FIRST (resolve collapses any `..`) and
  // only then checked against the home tree, defeating traversal like
  // `$HOME/../../etc` that a prefix check alone would wave through.
  if (path) {
    const safePath = resolve(path);
    if (safePath !== HOME && !safePath.startsWith(`${HOME}/`)) {
      return NextResponse.json<ApiEnvelope<PrsPayload>>({
        data: null,
        fetchedAt: new Date().toISOString(),
        error: "path out of scope",
      });
    }
    if (refresh) bust(`prs:scoped:${safePath}`);
    const env = await cached(`prs:scoped:${safePath}`, 30_000, async () => {
      const login = await ghLogin();
      const origin = await originOf(safePath);
      if (!origin) {
        return envelope({
          login,
          repos: [],
          issues: [],
          totalPrs: 0,
          scannedCount: 0,
          scoped: true,
        });
      }
      const [group, issues] = await Promise.all([
        prsFor(origin.owner, origin.repo),
        login ? assignedIssues(login) : Promise.resolve<IssueItem[]>([]),
      ]);
      const scopedIssues = issues.filter(
        (i) => i.repo === group.fullName,
      );
      return envelope({
        login,
        repos: [group], // always include, even with 0 PRs → empty state
        issues: scopedIssues,
        totalPrs: group.prs.length,
        scannedCount: 1,
        scoped: true,
      });
    });
    return NextResponse.json(env);
  }

  // Roll-up across every owned github repo under the scan roots.
  if (refresh) bust("prs:all");
  const env = await cached("prs:all", 30_000, async () => {
    const login = await ghLogin();
    if (!login) {
      return {
        data: null,
        fetchedAt: new Date().toISOString(),
        error: "gh not authenticated (gh api user failed)",
      } satisfies ApiEnvelope<PrsPayload>;
    }
    const repos = await ownedRepos(login);
    const [groups, issues] = await Promise.all([
      Promise.all(repos.map((r) => prsFor(r.owner, r.repo))),
      assignedIssues(login),
    ]);
    // Only surface repos that actually have open PRs; sort by freshest PR.
    const withPrs = groups
      .filter((g) => g.prs.length > 0)
      .sort((a, b) => freshest(b) - freshest(a));
    return envelope({
      login,
      repos: withPrs,
      issues,
      totalPrs: withPrs.reduce((n, g) => n + g.prs.length, 0),
      scannedCount: repos.length,
      scoped: false,
    });
  });
  return NextResponse.json(env);
}

function freshest(g: RepoPRs): number {
  return g.prs.reduce(
    (max, p) => Math.max(max, new Date(p.updatedAt).getTime() || 0),
    0,
  );
}
