"use client";

import { useEffect } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.replace(/=+$/, "");
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Registers the PWA service worker and subscribes for push notifications.
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Native iOS shell: register for APNs instead of web push (web push is
    // unavailable inside the Capacitor WKWebView). No-ops in the browser/PWA.
    void import("@/components/shell/nativePush")
      .then((m) => m.registerNativePush())
      .catch(() => {});

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onLoad = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");

        // Subscribe for push notifications
        if (!("PushManager" in window)) return;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          // Already subscribed — keep it, but make sure it's still valid
          return;
        }

        // Ask for permission
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;

        // Get VAPID public key from our server
        const res = await fetch("/api/push/vapid");
        const { publicKey } = await res.json();
        if (!publicKey) return;

        const options = {
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        } as unknown as PushSubscriptionOptionsInit;
        const sub = await reg.pushManager.subscribe(options);

        // Store the subscription on the server
        await fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch (e) {
        // Silently fail — notifications are a nice-to-have
        console.warn("push subscribe:", e);
      }
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}