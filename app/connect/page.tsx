"use client";

import { useEffect, useState } from "react";

// ── Login / Connect screen ───────────────────────────────────────────────────
// Two fields: the Remote URL of the box running your Hermes, and the access
// Token. The whole app loads from that box (the iOS-app model), so:
//   - If the URL is empty or matches where we already are → same-origin login:
//     POST the token to /api/auth, set the cookie, enter the app.
//   - If the URL points at a DIFFERENT box → redirect the whole app there with
//     the token as a one-time deep link (?token=…); that box's middleware
//     validates it, swaps it for a cookie, and the app loads from there.
// The token is never stored in the bundle or the repo — only as a cookie on the
// box it authenticates to. The URL is remembered locally for convenience.

export const dynamic = "force-dynamic";

const LS_URL = "bs_remote_url";

export default function ConnectPage() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // Pre-fill the last URL used on this device.
    try {
      const saved = localStorage.getItem(LS_URL);
      if (saved) setUrl(saved);
    } catch {
      /* ignore */
    }
    // If THIS box needs no token, there's nothing to log into — enter.
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { authRequired?: boolean }) => {
        if (j && j.authRequired === false) window.location.replace("/");
      })
      .catch(() => {});
  }, []);

  function normalizeUrl(raw: string): string {
    let u = raw.trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setStatus("error");
      setMsg("token is required");
      return;
    }
    setStatus("checking");
    setMsg(null);

    const target = normalizeUrl(url);
    const here = window.location.origin;

    // Different box → hand off the whole app to that URL with the token.
    if (target && target !== here) {
      try {
        localStorage.setItem(LS_URL, target);
      } catch {
        /* ignore */
      }
      // Probe it first so we fail loudly here instead of a blank redirect.
      try {
        const probe = await fetch(`${target}/api/health`, { cache: "no-store" });
        if (!probe.ok) throw new Error(String(probe.status));
      } catch {
        setStatus("error");
        setMsg(`couldn't reach ${target} — check the URL and that the box is reachable`);
        return;
      }
      window.location.href = `${target}/?token=${encodeURIComponent(token.trim())}`;
      return;
    }

    // Same origin → validate the token here and set the cookie.
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) {
        if (target) {
          try {
            localStorage.setItem(LS_URL, target);
          } catch {
            /* ignore */
          }
        }
        window.location.replace("/");
        return;
      }
      setStatus("error");
      setMsg(j.error ?? "could not connect");
    } catch {
      setStatus("error");
      setMsg("network error — is the box reachable?");
    }
  }

  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center px-5">
      <div className="mb-6 flex items-center gap-2.5">
        <img src="/nous-logo.svg" alt="Nous" className="h-7 w-7" />
        <span className="font-mondwest text-lg tracking-[0.2em] text-text-primary">
          BATTLESTATION
        </span>
      </div>
      <form
        onSubmit={connect}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-[color-mix(in_srgb,var(--background-base)_72%,transparent)] p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm"
      >
        <div className="flex flex-col gap-1">
          <h1 className="font-mondwest text-xl tracking-wide text-text-primary">
            Connect to your Hermes
          </h1>
          <p className="font-mono-ui text-[0.72rem] leading-relaxed text-text-tertiary">
            Point this at the box running your Hermes and enter your access
            token. Same profiles and sessions, mirrored across every device.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
            Remote URL
          </span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-box:9443  (Tailscale, LAN, or tunnel)"
            className="rounded-lg border border-border bg-transparent px-3 py-2 font-mono-ui text-[0.8rem] text-text-primary outline-none focus:border-midground"
          />
          <span className="font-mono-ui text-[0.58rem] text-text-tertiary">
            Leave blank if you opened this app directly from your box.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
            Access token
          </span>
          <input
            type="password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="your BATTLESTATION_TOKEN"
            className="rounded-lg border border-border bg-transparent px-3 py-2 font-mono-ui text-[0.8rem] text-text-primary outline-none focus:border-midground"
          />
        </label>

        {msg && (
          <p className="font-mono-ui text-[0.68rem] text-[color:var(--color-destructive)]">
            {msg}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "checking" || !token.trim()}
          className="rounded-full bg-midground px-4 py-2 text-[0.8rem] font-medium text-background-base transition-opacity disabled:opacity-40"
        >
          {status === "checking" ? "Connecting…" : "Connect"}
        </button>

        <details className="font-mono-ui text-[0.64rem] text-text-tertiary">
          <summary className="cursor-pointer select-none">
            Where do I get these?
          </summary>
          <p className="mt-2 leading-relaxed">
            On the box running Hermes, set an access token:{" "}
            <code className="text-text-secondary">BATTLESTATION_TOKEN</code> in
            the app&apos;s environment. The Remote URL is that box&apos;s address
            over Tailscale, your LAN, or a tunnel (e.g.{" "}
            <code className="text-text-secondary">https://your-box:9443</code>).
            The token is set on the box only — it never lives in this app or the
            source.
          </p>
        </details>
      </form>
    </main>
  );
}
