import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, DecisionLog } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAULT =
  process.env.OBSIDIAN_VAULT_PATH ??
  "/mnt/c/Users/demig/iCloudDrive/Documents/Obsidian Vault";

// Pull the bullets under a "## Heading" until the next "## " heading.
function section(md: string, heading: string): string[] {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const m = md.match(re);
  if (!m || m.index === undefined) return [];
  const rest = md.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  const block = end === -1 ? rest : rest.slice(0, end);
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^-\s+/, "").trim())
    .filter(Boolean);
}

export async function GET() {
  const env: ApiEnvelope<DecisionLog> = await cached(
    "decisions",
    30_000,
    async () => {
      const at = new Date().toISOString();
      const dir = join(VAULT, "Daily Decisions");
      try {
        const names = (await readdir(dir)).filter((n) => n.endsWith(".md"));
        if (names.length === 0) {
          return {
            data: { available: false, date: null, shipped: [], decided: [], note: "no decision logs yet" },
            fetchedAt: at,
          };
        }
        // Latest by filename (YYYY-MM-DD.md) with mtime tiebreak.
        const withTime = await Promise.all(
          names.map(async (n) => ({
            n,
            mtime: (await stat(join(dir, n))).mtimeMs,
          })),
        );
        withTime.sort((a, b) =>
          b.n.localeCompare(a.n) || b.mtime - a.mtime,
        );
        const latest = withTime[0].n;
        const md = await readFile(join(dir, latest), "utf8");
        const date = latest.replace(/\.md$/, "");
        return {
          data: {
            available: true,
            date,
            shipped: section(md, "Shipped"),
            decided: section(md, "Decided.*"),
          },
          fetchedAt: at,
        };
      } catch (e) {
        return {
          data: { available: false, date: null, shipped: [], decided: [], note: "vault path unreachable" },
          fetchedAt: at,
          error: e instanceof Error ? e.message : "read failed",
        };
      }
    },
  );
  return NextResponse.json(env);
}
