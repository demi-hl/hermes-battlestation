// Tiny in-memory TTL cache so the cockpit's 30s polling never hammers ssh /
// python / the dashboard. Keyed by route. Server-side only (module state lives
// in the Next server process).
type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;
  const value = await produce();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Drop a cached entry so the next read recomputes (after a mutation). */
export function bust(key: string): void {
  store.delete(key);
}
