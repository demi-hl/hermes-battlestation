"use client";

import {
  useEffect,
  useState,
  type FocusEvent,
  type FormEvent,
} from "react";
import { cn } from "@/lib/utils";

const LS_URL = "bs_remote_url";

type ConnectFormProps = {
  autoFocusToken?: boolean;
  className?: string;
  redirectIfAuthenticated?: boolean;
  remoteUrlMode?: "details" | "inline";
  showStartLink?: boolean;
};

export function ConnectForm({
  autoFocusToken = true,
  className,
  redirectIfAuthenticated = true,
  remoteUrlMode = "details",
  showStartLink = true,
}: ConnectFormProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [pairLink, setPairLink] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState(false);

  useEffect(() => {
    // Pre-fill the last URL used on this device.
    try {
      const saved = localStorage.getItem(LS_URL);
      if (saved) setUrl(saved);
    } catch {
      /* ignore */
    }
    // Surface an OAuth round-trip failure bounced back to /connect.
    try {
      const err = new URLSearchParams(window.location.search).get("oauth_error");
      if (err) {
        setStatus("error");
        setMsg(`Nous sign-in failed: ${err}`);
      }
    } catch {
      /* ignore */
    }
    // Learn the box's auth mode: if no token is required, enter; otherwise note
    // whether Nous sign-in is available so we can show the button.
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { authRequired?: boolean; oauthAvailable?: boolean }) => {
        if (j && j.authRequired === false && redirectIfAuthenticated) {
          window.location.replace("/");
          return;
        }
        if (j && j.oauthAvailable) setOauthAvailable(true);
      })
      .catch(() => {});
  }, [redirectIfAuthenticated]);

  function normalizeUrl(raw: string): string {
    let u = raw.trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  // Parse a pairing deep-link (what `npm run pair` prints / its QR encodes:
  // `https://box/?token=…`) into its URL + token. Returns null if there's no
  // token to extract. Falls back to treating a bare non-URL string as a raw
  // token so pasting just the token still works.
  function parsePairingLink(raw: string): { url: string; token: string } | null {
    const s = raw.trim();
    if (!s) return null;
    try {
      const u = new URL(s);
      const tok = u.searchParams.get("token");
      if (!tok) return null;
      return { url: `${u.protocol}//${u.host}`, token: tok };
    } catch {
      // Not a URL — if it has no scheme/space, treat it as a bare token.
      if (!/\s/.test(s) && !/^https?:/i.test(s)) return { url: "", token: s };
      return null;
    }
  }

  function applyPairingLink(raw: string) {
    const parsed = parsePairingLink(raw);
    if (!parsed) {
      setStatus("error");
      setMsg("that doesn't look like a pairing link — paste the link from `npm run pair`");
      return;
    }
    if (parsed.url) setUrl(parsed.url);
    setToken(parsed.token);
    setStatus("idle");
    setMsg(null);
    void doConnect(parsed.url || url, parsed.token);
  }

  // Keep the focused field visible once the keyboard animation settles.
  function scrollIntoView(e: FocusEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  }

  function signInWithNous() {
    // Full-page navigation (NOT fetch) — the start route 302s to the Nous
    // Portal, which a fetch would follow opaquely. Same-origin only; the
    // "different box" handoff is token-only by design.
    window.location.href = "/api/auth/oauth/start";
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    await doConnect(url, token);
  }

  async function doConnect(rawUrl: string, rawToken: string) {
    const tok = rawToken.trim();
    if (!tok) {
      setStatus("error");
      setMsg("token is required");
      return;
    }
    setStatus("checking");
    setMsg(null);

    const target = normalizeUrl(rawUrl);
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
      window.location.href = `${target}/?token=${encodeURIComponent(tok)}`;
      return;
    }

    // Same origin → validate the token here and set the cookie.
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tok }),
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

  const remoteUrlField = (
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
        onFocus={scrollIntoView}
        placeholder="https://your-box:9443  (Tailscale, LAN, or tunnel)"
        className="rounded-lg border border-border bg-transparent px-3 py-2 font-mono-ui text-[0.8rem] text-text-primary outline-none focus:border-midground"
      />
      <span className="font-mono-ui text-[0.58rem] text-text-tertiary">
        Leave blank to use this box. Only set this to point the app at a different
        Hermes box you run.
      </span>
    </label>
  );

  return (
    <form
      onSubmit={connect}
      className={cn(
        "flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-[color-mix(in_srgb,var(--background-base)_72%,transparent)] p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="font-mondwest text-xl tracking-wide text-text-primary">
          Connect to your Hermes
        </h1>
        <p className="font-mono-ui text-[0.72rem] leading-relaxed text-text-tertiary">
          Sign in with your Nous account, or use the box&apos;s access token. Same
          profiles and sessions, mirrored across every device.
        </p>
      </div>

      {oauthAvailable && (
        <>
          <button
            type="button"
            onClick={signInWithNous}
            className="flex items-center justify-center gap-2 rounded-full bg-midground px-4 py-2.5 text-[0.82rem] font-medium text-background-base transition-opacity hover:opacity-90"
          >
            <img src="/nous-icon.svg" alt="" aria-hidden className="h-4 w-4" />
            Sign in with Nous
          </button>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono-ui text-[0.58rem] uppercase tracking-wider text-text-tertiary">
              or use a token
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5 rounded-xl border border-midground/40 bg-[color-mix(in_srgb,var(--midground)_6%,transparent)] p-3">
        <span className="font-mono-ui text-[0.6rem] uppercase tracking-wider text-midground">
          Fastest · paste your pairing link
        </span>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={pairLink}
          onChange={(e) => setPairLink(e.target.value)}
          onFocus={scrollIntoView}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text && /token=/.test(text)) {
              e.preventDefault();
              setPairLink(text);
              applyPairingLink(text);
            }
          }}
          placeholder="https://your-box.ts.net/?token=…"
          className="rounded-lg border border-border bg-transparent px-3 py-2 font-mono-ui text-[0.8rem] text-text-primary outline-none focus:border-midground"
        />
        <button
          type="button"
          onClick={() => applyPairingLink(pairLink)}
          disabled={status === "checking" || !pairLink.trim()}
          className="mt-0.5 rounded-full bg-midground px-4 py-2 text-[0.8rem] font-medium text-background-base transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {status === "checking" ? "Connecting…" : "Paste & connect"}
        </button>
        <span className="font-mono-ui text-[0.58rem] leading-snug text-text-tertiary">
          On your box run <code className="text-text-secondary">npm run pair</code> and paste
          the link it prints — carries the URL and token together, no typing.
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono-ui text-[0.58rem] uppercase tracking-wider text-text-tertiary">
          or enter manually
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {remoteUrlMode === "inline" && remoteUrlField}

      <label className="flex flex-col gap-1">
        <span className="font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
          Access token
        </span>
        <input
          type="password"
          autoFocus={!oauthAvailable && autoFocusToken}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onFocus={scrollIntoView}
          placeholder="your BATTLESTATION_TOKEN"
          className="rounded-lg border border-border bg-transparent px-3 py-2 font-mono-ui text-[0.8rem] text-text-primary outline-none focus:border-midground"
        />
      </label>

      {remoteUrlMode === "details" && (
        <details className="flex flex-col gap-1">
          <summary className="cursor-pointer select-none font-mono-ui text-[0.6rem] uppercase tracking-wider text-text-tertiary">
            Advanced · connect to a different box
          </summary>
          <div className="mt-2">{remoteUrlField}</div>
        </details>
      )}

      {msg && (
        <p className="font-mono-ui text-[0.68rem] text-[color:var(--color-destructive)]">
          {msg}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "checking" || !token.trim()}
        className="rounded-full border border-border bg-transparent px-4 py-2 text-[0.8rem] font-medium text-text-primary transition-opacity disabled:opacity-40"
      >
        {status === "checking" ? "Connecting…" : "Connect with token"}
      </button>

      <details className="font-mono-ui text-[0.64rem] text-text-tertiary">
        <summary className="cursor-pointer select-none">Where do I get these?</summary>
        <p className="mt-2 leading-relaxed">
          <strong className="text-text-secondary">Nous sign-in</strong> uses your
          existing Nous account — no token to copy. It appears when the box has an
          OAuth client configured. <strong className="text-text-secondary">Access token</strong>:
          on the box running Hermes, run{" "}
          <code className="text-text-secondary">npm run token</code> to print it
          (or set <code className="text-text-secondary">BATTLESTATION_TOKEN</code> in the
          box&apos;s environment). Already signed in somewhere? Open{" "}
          <strong className="text-text-secondary">Settings → Link a device</strong>{" "}
          and tap <em>Copy access token</em>. The Remote URL is that box&apos;s address
          over Tailscale, your LAN, or a tunnel (e.g.{" "}
          <code className="text-text-secondary">https://your-box:9443</code>). The
          token is set on the box only — it never lives in this app or the source.
        </p>
      </details>

      {showStartLink && (
        <a
          href="/start"
          className="text-center font-mono-ui text-[0.66rem] text-midground transition-opacity hover:opacity-80"
        >
          New to Hermes? Set up your own agent →
        </a>
      )}
    </form>
  );
}
