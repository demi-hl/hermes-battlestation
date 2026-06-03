import { NextResponse } from "next/server";
import { dashboardGet } from "@/lib/hermes";
import { cached } from "@/lib/cache";
import type { ApiEnvelope, CronList, CronJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawCron = {
  id?: string;
  name?: string;
  schedule_display?: string;
  schedule?: { display?: string };
  last_status?: string | null;
  enabled?: boolean;
  next_run_at?: string | null;
};

export async function GET() {
  const env: ApiEnvelope<CronList> = await cached("cron", 30_000, async () => {
    const at = new Date().toISOString();
    const res = await dashboardGet("/api/cron/jobs");
    if (!res.ok || !Array.isArray(res.data)) {
      return {
        data: {
          available: false,
          jobs: [],
          note:
            res.status === 0
              ? "dashboard not running on 127.0.0.1:9119"
              : `dashboard returned ${res.status}`,
        },
        fetchedAt: at,
      };
    }
    const jobs: CronJob[] = (res.data as RawCron[]).map((j) => ({
      id: j.id ?? "",
      name: j.name ?? "unnamed",
      schedule: j.schedule_display ?? j.schedule?.display ?? "",
      lastStatus: j.last_status ?? null,
      enabled: j.enabled ?? false,
      nextRunAt: j.next_run_at ?? null,
    }));
    return { data: { available: true, jobs }, fetchedAt: at };
  });
  return NextResponse.json(env);
}
