import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, CaptureInbox } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAULT =
  process.env.OBSIDIAN_VAULT_PATH ??
  "/mnt/c/Users/demig/iCloudDrive/Documents/Obsidian Vault";

function isToday(ms: number): boolean {
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export async function GET() {
  const env: ApiEnvelope<CaptureInbox> = await cached("inbox", 30_000, async () => {
    const at = new Date().toISOString();
    const dir = join(VAULT, "Inbox");
    try {
      const names = (await readdir(dir)).filter((n) => n.endsWith(".md"));
      const today: string[] = [];
      for (const n of names) {
        const s = await stat(join(dir, n));
        if (isToday(s.mtimeMs)) today.push(n);
      }
      return {
        data: { available: true, countToday: today.length, files: today.sort() },
        fetchedAt: at,
      };
    } catch (e) {
      return {
        data: { available: false, countToday: 0, files: [], note: "Inbox path unreachable" },
        fetchedAt: at,
        error: e instanceof Error ? e.message : "read failed",
      };
    }
  });
  return NextResponse.json(env);
}
