/**
 * Haptic feedback — dual path:
 * 1. Capacitor Haptics (native) when running inside the iOS app
 * 2. Vibration API fallback for PWA on Android / desktop
 *
 * Uses light/medium/heavy impact for distinct tactile feel.
 * Falls back to a silent no-op everywhere else (never throws).
 */

let capHaptics: any = null;
let capLoaded = false;

async function ensureCap(): Promise<boolean> {
  if (capLoaded) return !!capHaptics;
  capLoaded = true;
  try {
    const mod = await import("@capacitor/haptics");
    if (mod.Haptics && typeof mod.Haptics.impact === "function") {
      capHaptics = mod.Haptics;
    }
  } catch {
    // Not in Capacitor env
  }
  return !!capHaptics;
}

type ImpactStyle = "light" | "medium" | "heavy";

function intensity(n: number): ImpactStyle {
  if (n <= 4) return "light";
  if (n <= 10) return "medium";
  return "heavy";
}

/**
 * Best-effort haptic. Uses Capacitor native haptics inside the iOS app,
 * falls back to the Vibration API elsewhere. Never throws.
 */
export async function haptic(pattern: number | number[] = 8): Promise<void> {
  try {
    const hasCap = await ensureCap();
    if (hasCap && capHaptics) {
      const style = intensity(typeof pattern === "number" ? pattern : (pattern[0] ?? 8));
      await capHaptics.impact({ style });
      return;
    }
  } catch {
    // fallthrough
  }

  // Client-side only
  if (typeof window === "undefined") return;
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some embedded webviews throw on vibrate; ignore */
  }
}