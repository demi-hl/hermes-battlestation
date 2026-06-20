/**
 * Native APNs push registration — the iOS-app counterpart to the web-push
 * path in usePush.ts. Only does anything inside the Capacitor shell; in the
 * browser / PWA it no-ops (web push handles that surface).
 *
 * Flow: detect native -> request permission -> register with APNs -> on the
 * `registration` event, POST the device token to /api/push/register-native so
 * the server can target this device over APNs. Tapping a delivered push fires
 * `pushNotificationActionPerformed`, which we relay to the in-app deep-link bus
 * (`lo-push-open`) the shell already listens for.
 */

let started = false;

export async function registerNativePush(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const core = await import("@capacitor/core");
    if (!core.Capacitor?.isNativePlatform?.()) return; // browser / PWA → web push
  } catch {
    return; // not in a Capacitor env
  }

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    // APNs token arrived — hand it to the server keyed to this device.
    await PushNotifications.addListener("registration", (token) => {
      void fetch("/api/push/register-native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.value, platform: "ios" }),
      }).catch(() => {
        /* best-effort; the next launch re-registers */
      });
    });

    await PushNotifications.addListener("registrationError", () => {
      /* APNs registration failed (no entitlement / no network) — silent */
    });

    // Notification tapped from the lock screen / banner. Deep-link in place via
    // the same window event the service worker uses for web push.
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data = action?.notification?.data ?? {};
      const threadId = data.threadId ?? data.thread ?? null;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("lo-push-open", { detail: { threadId } }),
        );
      }
    });

    // Permission, then register with APNs.
    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === "granted";
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      const req = await PushNotifications.requestPermissions();
      granted = req.receive === "granted";
    }
    if (granted) {
      await PushNotifications.register();
    }
  } catch {
    /* plugin missing / older shell — no native push, web push still covers PWA */
  }
}
