// Locals Only PWA service worker.
// Network-first for navigations with an app-shell precache so the install/icon
// works offline. NEVER caches /api/* (live ops data) or any auth traffic, and
// never touches non-GET requests. Self-hosted fonts + brand assets are
// runtime-cached on first load by the same-origin GET branch below.
const CACHE = "locals-only-v2";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/filler-bg0.webp",
  "/nous-icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache live data, auth, or non-GET. Let them hit the network directly.
  if (
    e.request.method !== "GET" ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/auth")
  ) {
    return;
  }
  // Only handle same-origin GETs.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});

/** ── Push notifications ── */
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data;
  try {
    data = e.data.json();
  } catch {
    data = { title: "Hermes", body: e.data.text() };
  }
  const { title = "Hermes", body = "", tag = "default", icon = "/icon-192.png", data: extra = {} } = data;
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      badge: "/icon-192.png",
      renotify: true,
      vibrate: [100, 50, 100],
      data: extra,
      requireInteraction: true,
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    }),
  );
});