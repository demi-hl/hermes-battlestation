import { NextResponse } from "next/server";
import { run } from "@/lib/exec";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, MaxUsage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTE = "exact weekly-cap % is interactive-only (run /usage in claude)";

export async function GET() {
  const env: ApiEnvelope<MaxUsage> = await cached("max-usage", 30_000, async () => {
    const r = await run('python3 "$HOME/.hermes/scripts/max_usage_check.py"', {
      timeoutMs: 20000,
    });
    const at = new Date().toISOString();
    const text = `${r.stdout}\n${r.stderr}`;
    if (!r.ok && !text.includes("Max sub")) {
      const data: MaxUsage = {
        ok: false,
        date: null,
        calls: null,
        tokens: null,
        high: false,
        throttleSignals: 0,
        note: NOTE,
        error: r.stderr.trim() || "max_usage_check.py failed",
      };
      return { data, fetchedAt: at };
    }
    const dateM = text.match(/Max-usage check\s*[-–]?\s*(\d{4}-\d{2}-\d{2})/);
    const usageM = text.match(
      /Anthropic \(Max sub\):\s*([\d,]+)\s*calls,\s*([\d,]+)\s*tokens/,
    );
    const high = /\[!\]\s*HIGH/i.test(text);
    const throttleM = text.match(/(\d+)\s*throttle\/rate-limit signal/i);
    const data: MaxUsage = {
      ok: !!usageM,
      date: dateM ? dateM[1] : null,
      calls: usageM ? Number(usageM[1].replace(/,/g, "")) : null,
      tokens: usageM ? Number(usageM[2].replace(/,/g, "")) : null,
      high,
      throttleSignals: throttleM ? Number(throttleM[1]) : 0,
      note: NOTE,
    };
    return { data, fetchedAt: at };
  });
  return NextResponse.json(env);
}
