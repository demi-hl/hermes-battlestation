"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
  reload: () => void;
};

// Fetch an ApiEnvelope route and re-poll on an interval. Honest about errors:
// surfaces the route's own `error` field even when partial `data` is present.
export function usePolling<T>(url: string, intervalMs = 30_000): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(url, { cache: "no-store", signal });
        const json = (await res.json()) as Record<string, unknown>;
        if (!mounted.current) return;
        // Tolerate both shapes: the ApiEnvelope `{data, fetchedAt}` wrapper
        // (e.g. /api/cron) and routes that return the payload bare at the top
        // level (e.g. /api/skills, /api/analytics, /api/env-keys, /api/mcp).
        const enveloped =
          json && typeof json === "object" && "data" in json && "fetchedAt" in json;
        const payload = enveloped ? (json.data as T) : (json as unknown as T);
        setData(payload ?? null);
        setError((json?.error as string | undefined) ?? null);
        setUpdatedAt((json?.fetchedAt as string | undefined) ?? null);
      } catch (e) {
        if (!mounted.current || (e instanceof Error && e.name === "AbortError"))
          return;
        setError("request failed");
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = setInterval(() => load(), intervalMs);
    return () => {
      mounted.current = false;
      ctrl.abort();
      clearInterval(id);
    };
  }, [load, intervalMs]);

  return { data, error, loading, updatedAt, reload: () => load() };
}
