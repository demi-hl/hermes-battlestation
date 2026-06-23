// Pure shapes + helpers for the Tasks & PRs and Automations slices. NO node
// imports here so this module is safe to pull into client components (the panes
// import the types) as well as the server routes. The git/gh/hermes shelling
// lives in the route handlers; everything below is pure data transform and is
// unit-testable in isolation.

/* ===========================================================================
   Tasks & PRs (GitHub, via the gh CLI)
   =========================================================================== */

/** Aggregated CI verdict for a PR's status-check rollup. */
export type CiState = "pass" | "fail" | "pending" | "none";

/** GitHub review decision, normalized to the few we render. */
export type ReviewState =
  | "approved"
  | "changes_requested"
  | "review_required"
  | "none";

export interface PrItem {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  isDraft: boolean;
  ci: CiState;
  review: ReviewState;
  updatedAt: string;
  url: string;
}

export interface RepoPRs {
  /** Bare repo name, e.g. "my-repo". */
  repo: string;
  /** Owner login, e.g. "your-org". */
  owner: string;
  /** "owner/repo" for the gh --repo flag + detail links. */
  fullName: string;
  prs: PrItem[];
  /** Set when gh failed for just this repo (others may still be fine). */
  error?: string;
}

export interface IssueItem {
  number: number;
  title: string;
  /** "owner/repo" the issue belongs to. */
  repo: string;
  url: string;
  updatedAt: string;
}

export interface PrsPayload {
  /** Real gh login (gh api user), drives the identity header. */
  login: string | null;
  /** One group per owned repo that has an origin on github.com. */
  repos: RepoPRs[];
  /** Assigned-to-me open issues across the owner, roll-up. */
  issues: IssueItem[];
  totalPrs: number;
  /** Owned github repos scanned for the roll-up (honest coverage count). */
  scannedCount: number;
  /** True when a `?path=` scoped the result to a single repo. */
  scoped: boolean;
}

export interface PrCheck {
  name: string;
  /** Normalized check verdict. */
  state: CiState;
}

export interface PrDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  ci: CiState;
  checks: PrCheck[];
  review: ReviewState;
  author: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/* ---- gh JSON → normalized shapes ---------------------------------------- */

/** One entry in a `statusCheckRollup` array. gh emits CheckRun nodes
 *  (status + conclusion) and StatusContext nodes (state); we accept both. */
interface RollupNode {
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

const FAIL = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Per-node verdict from a rollup entry. */
function nodeState(n: RollupNode): CiState {
  // Check runs not yet COMPLETED are pending regardless of (null) conclusion.
  if (n.status && n.status !== "COMPLETED") return "pending";
  const raw = (n.conclusion ?? n.state ?? "").toUpperCase();
  if (!raw) return "pending";
  if (FAIL.has(raw)) return "fail";
  if (PASS.has(raw)) return "pass";
  if (raw === "PENDING" || raw === "EXPECTED" || raw === "QUEUED")
    return "pending";
  return "pending";
}

/** Aggregate a whole rollup: any fail wins, else any pending, else pass; an
 *  empty rollup means no CI is configured ("none"). */
export function ciFromRollup(rollup: unknown): CiState {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  const states = (rollup as RollupNode[]).map(nodeState);
  if (states.includes("fail")) return "fail";
  if (states.includes("pending")) return "pending";
  return "pass";
}

/** Named per-check verdicts for the detail view. */
export function checksFromRollup(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return [];
  return (rollup as (RollupNode & { name?: string; context?: string })[]).map(
    (n) => ({
      name: n.name ?? n.context ?? "check",
      state: nodeState(n),
    }),
  );
}

export function normalizeReview(decision: unknown): ReviewState {
  switch (String(decision ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

/** Parse a git origin URL into owner/repo, github.com only. Handles both
 *  `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git`. */
export function parseOwnerRepo(
  origin: string,
): { owner: string; repo: string } | null {
  const url = origin.trim();
  // scp-style: git@github.com:owner/repo(.git)
  let m = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  // https/ssh URL form: https://github.com/owner/repo(.git)
  if (!m) m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, "");
  if (!owner || !repo) return null;
  // Reject anything outside the github name charset. owner/repo flow into a
  // shell command (gh pr list --repo owner/repo), so a hostile local origin
  // URL must never be able to smuggle metacharacters past this point. Same
  // gate as isValidFullName, applied at the single source of every owner/repo.
  if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(repo)) return null;
  return { owner, repo };
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** Strict gates for values that get interpolated into a gh command. The detail
 *  route takes repo + number from the client, so these MUST hold before any
 *  shell interpolation. */
export function isValidFullName(s: string): boolean {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(s);
}
export function isValidNumber(s: string): boolean {
  return /^[0-9]{1,9}$/.test(s);
}

/* ===========================================================================
   Automations (Hermes cron, via `hermes cron list`)
   =========================================================================== */

export interface Automation {
  id: string;
  name: string;
  schedule: string;
  repeat: string | null;
  nextRun: string | null;
  lastRun: string | null;
  lastStatus: string | null;
  deliver: string | null;
  script: string | null;
  mode: string | null;
  active: boolean;
}

export interface AutomationsPayload {
  available: boolean;
  jobs: Automation[];
  /** Honest note when the source is unavailable / empty. */
  note?: string;
}

/** A job header line: `  b2bbc6ee8c88 [active]`. */
const JOB_HEADER = /^\s*([0-9a-f]{6,})\s+\[(active|paused|disabled)\]\s*$/i;
/** An indented field line: `    Name:      polymarket-bot-health`. */
const FIELD = /^\s+([A-Za-z ]+?):\s+(.*\S)\s*$/;

/** Parse the human `hermes cron list` table into structured jobs. The CLI has
 *  no --json mode, so we scan its blocks. Resilient to extra fields and to the
 *  last-run trailing status token (`... -07:00  ok`). */
export function parseCronList(stdout: string): Automation[] {
  const lines = stdout.split("\n");
  const jobs: Automation[] = [];
  let cur: Automation | null = null;

  const push = () => {
    if (cur) jobs.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const head = line.match(JOB_HEADER);
    if (head) {
      push();
      cur = {
        id: head[1],
        name: "",
        schedule: "",
        repeat: null,
        nextRun: null,
        lastRun: null,
        lastStatus: null,
        deliver: null,
        script: null,
        mode: null,
        active: head[2].toLowerCase() === "active",
      };
      continue;
    }
    if (!cur) continue;
    const f = line.match(FIELD);
    if (!f) continue;
    const key = f[1].trim().toLowerCase();
    const val = f[2].trim();
    switch (key) {
      case "name":
        cur.name = val;
        break;
      case "schedule":
        cur.schedule = val;
        break;
      case "repeat":
        cur.repeat = val;
        break;
      case "next run":
        cur.nextRun = val;
        break;
      case "last run": {
        // `2026-05-27T23:39:55.126988-07:00  ok` → timestamp + trailing status.
        const lr = val.match(/^(\S+)(?:\s+(.+))?$/);
        cur.lastRun = lr ? lr[1] : val;
        cur.lastStatus = lr && lr[2] ? lr[2].trim() : null;
        break;
      }
      case "deliver":
        cur.deliver = val;
        break;
      case "script":
        cur.script = val;
        break;
      case "mode":
        cur.mode = val;
        break;
      default:
        break;
    }
  }
  push();
  // Only keep blocks that actually parsed a name (guards against header noise).
  return jobs.filter((j) => j.name);
}
