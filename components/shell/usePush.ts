"use client";

/**
 * usePush — wires web push end to end for the PWA / Capacitor surfaces.
 *
 * Flow: feature detect, request Notification permission on demand, fetch the
 * VAPID public key from /api/push/vapid, subscribe through the active service
 * worker's PushManager, then POST the subscription to /api/push/register.
 *
 * SSR safe (everything that touches window / navigator is guarded). Never
 * throws out of enable(); failures resolve quietly and leave enabled false so
 * the caller can re-try. Push is unavailable in some WKWebView builds, hence
 * the broad feature detection.
 */

import { useCallback, useEffect, useState } from "react";

export interface UsePushResult {
  supported: boolean;
  permission: NotificationPermission;
  enabled: boolean;
  enable: () => Promise<void>;
}

// Push needs all three: service workers, the Push API, and the Notification
// API. Any missing piece means we hide the affordance entirely.
function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// VAPID keys arrive base64url; PushManager wants a BufferSource. Back the
// array with an explicit ArrayBuffer so the type stays ArrayBuffer (not the
// wider ArrayBufferLike, which TS strict rejects for applicationServerKey).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePush(): UsePushResult {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);

  // Resolve support + current state on mount (client only). Also reflect an
  // already live subscription so a returning user shows as enabled.
  useEffect(() => {
    if (!detectSupport()) return;
    setSupported(true);
    try {
      setPermission(Notification.permission);
    } catch {
      // Some embedded webviews throw on Notification access; ignore.
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setEnabled(!!sub);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!detectSupport()) return;
    try {
      // 1. Permission. Bail quietly if the user denies.
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      // 2. The app registers the worker elsewhere; just wait for it to be live.
      const reg = await navigator.serviceWorker.ready;

      // 3. Reuse an existing subscription, else create one with the VAPID key.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const res = await fetch("/api/push/vapid", { cache: "no-store" });
        const { publicKey } = (await res.json()) as { publicKey?: string };
        if (!publicKey) {
          // VAPID not configured server side; nothing to subscribe against.
          return;
        }
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      // 4. Hand the subscription to the server so it can target this device.
      const reg2 = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (reg2.ok) setEnabled(true);
    } catch {
      // Subscription can fail (denied mid flight, no VAPID, webview quirks).
      // Leave enabled false so the caller may prompt again later.
      setEnabled(false);
    }
  }, []);

  return { supported, permission, enabled, enable };
}
