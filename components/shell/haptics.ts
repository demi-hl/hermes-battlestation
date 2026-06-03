/**
 * Best-effort haptic feedback via the Vibration API. iOS Safari ignores it on
 * most surfaces today, but Android PWAs honor it and it is a no-op (never
 * throws) everywhere else — so key actions (send, switch repo, tab tap) can
 * call it unconditionally.
 */
export function haptic(pattern: number | number[] = 8): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some embedded webviews throw on vibrate; ignore */
  }
}
