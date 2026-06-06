import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type {
  SkillEntry,
  SkillGroup,
  SkillBundle,
  SkillsPayload,
} from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? process.cwd();
const SKILL_ROOTS = [
  `${HOME}/.hermes/skills`,
  "/usr/local/lib/hermes-agent/skills",
];

// Walk a skills root collecting SKILL.md paths (depth-limited; the registry is
// <root>/<category>/<name>/SKILL.md, with a few flat builtin <root>/<name>/...).
async function findSkillFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const p = path.join(root, name);
    let st;
    try {
      st = await fs.stat(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...(await findSkillFiles(p, depth + 1)));
    } else if (name === "SKILL.md") {
      out.push(p);
    }
  }
  return out;
}

// Parse `name` + `description` from a SKILL.md YAML frontmatter block. Cheap
// line parse (no YAML dep): read the first fenced --- block only.
function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = m ? m[1] : text.slice(0, 1200);
  const out: { name?: string; description?: string } = {};
  for (const line of block.split("\n")) {
    const nm = line.match(/^name:\s*(.+)$/);
    if (nm && !out.name) out.name = unquote(nm[1]);
    const dm = line.match(/^description:\s*(.+)$/);
    if (dm && !out.description) out.description = unquote(dm[1]);
    if (out.name && out.description) break;
  }
  return out;
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").trim();
}

function categoryOf(file: string, root: string): string {
  const rel = path.relative(root, file); // e.g. creative/high-end-web/SKILL.md
  const parts = rel.split(path.sep);
  if (parts.length >= 3) return parts[0];
  return "builtin";
}

// Best-effort parse of `hermes skills list` (a Rich table). Output is piped, so
// names may be truncated with an ellipsis at ~80 cols; we use it only for the
// enabled/disabled status + a real row count, reconciling names against disk.
function parseSkillsTable(stdout: string): { rows: { name: string; status: string }[]; count: number } {
  const rows: { name: string; status: string }[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\[[0-9;]*m/g, "");
    if (!line.includes("│")) continue; // the box vertical
    const cells = line
      .split("│")
      .map((c) => c.trim())
      .filter((_, i, a) => i > 0 && i < a.length); // drop edge empties
    if (cells.length < 4) continue;
    const name = cells[0].replace(/…$/, "").trim();
    if (!name || name.toLowerCase() === "name") continue; // header
    const status = (cells[cells.length - 1] || "").toLowerCase();
    rows.push({ name, status });
  }
  return { rows, count: rows.length };
}

function parseBundles(stdout: string): SkillBundle[] {
  if (/no bundles/i.test(stdout)) return [];
  const bundles: SkillBundle[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\[[0-9;]*m/g, "");
    if (!line.includes("│")) continue;
    const cells = line
      .split("│")
      .map((c) => c.trim())
      .filter((_, i, a) => i > 0 && i < a.length);
    if (cells.length < 1) continue;
    const name = cells[0];
    if (!name || /^name$/i.test(name)) continue;
    const skills = cells[1] ? cells[1].split(/[,\s]+/).filter(Boolean) : [];
    bundles.push({ name, skills });
  }
  return bundles;
}

export async function GET() {
  const payload = await cached<SkillsPayload>("skills", 60_000, async () => {
    const fetchedAt = new Date().toISOString();

    // 1) Disk registry = the real, full-named source of truth (exact names for
    //    the `-s` preload flag, plus descriptions the CLI table lacks).
    const byName = new Map<string, SkillEntry>();
    for (const root of SKILL_ROOTS) {
      const files = await findSkillFiles(root);
      for (const file of files) {
        let text: string;
        try {
          text = await fs.readFile(file, "utf8");
        } catch {
          continue;
        }
        const fm = parseFrontmatter(text);
        const dirName = path.basename(path.dirname(file));
        const name = (fm.name || dirName).trim();
        if (!name) continue;
        if (byName.has(name)) continue; // first root wins (~/.hermes over builtin)
        byName.set(name, {
          name,
          description: fm.description || "",
          category: categoryOf(file, root),
          source: root.startsWith(HOME) ? "local" : "builtin",
          enabled: true,
        });
      }
    }

    // 2) Cross-check against the real CLI for enabled state + an honest count.
    let cliCount = 0;
    try {
      const r = await run("hermes skills list", { timeoutMs: 12000 });
      if (r.ok) {
        const { rows, count } = parseSkillsTable(r.stdout);
        cliCount = count;
        const disabled = new Set(
          rows.filter((x) => x.status && x.status !== "enabled").map((x) => x.name),
        );
        for (const entry of byName.values()) {
          // CLI name may be a truncated prefix of the full disk name.
          for (const d of disabled) {
            if (entry.name === d || entry.name.startsWith(d)) {
              entry.enabled = false;
              break;
            }
          }
        }
      }
    } catch {
      /* CLI cross-check is best-effort; the disk registry still stands */
    }

    // 3) Bundles.
    let bundles: SkillBundle[] = [];
    try {
      const rb = await run("hermes bundles list", { timeoutMs: 8000 });
      if (rb.ok) bundles = parseBundles(rb.stdout);
    } catch {
      /* none */
    }

    // Group by category, alphabetical within.
    const groupsMap = new Map<string, SkillEntry[]>();
    for (const s of byName.values()) {
      const arr = groupsMap.get(s.category) ?? [];
      arr.push(s);
      groupsMap.set(s.category, arr);
    }
    const groups: SkillGroup[] = [...groupsMap.entries()]
      .map(([category, skills]) => ({
        category,
        skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));

    return {
      groups,
      bundles,
      total: byName.size,
      cliCount,
      fetchedAt,
    };
  });

  return NextResponse.json(payload);
}
