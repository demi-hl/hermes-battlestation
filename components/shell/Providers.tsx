"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { ThemeProvider } from "@/lib/themes";
import { WorkspaceProvider } from "./workspace-context";

/**
 * Client provider tree for the shell: the ported ThemeProvider (8-theme system
 * + CSS-var cascade), the WorkspaceProvider (active context + model), and a
 * MotionConfig that makes every Framer animation respect the OS
 * reduced-motion setting.
 *
 * Also handles iOS keyboard viewport: when the keyboard opens, Safari tries to
 * scroll the document to reveal the focused input, hiding content above. We
 * pin the root to `position: fixed` and track `visualViewport.height` so the
 * app always fills the visible area and never scrolls as a document.
 */
export function Providers({ children }: { children: ReactNode }) {
  // iOS keyboard viewport fix — one-time mount, no deps.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const body = document.body;

    // Pin to the visual viewport — this prevents Safari from scrolling the
    // document when the keyboard opens (the scroll would hide content above).
    // `top` follows visualViewport.offsetTop so the pinned shell tracks any
    // shift iOS Safari applies while bringing the focused input into view
    // (without it, the composer ends up buried under the keyboard).
    const pinToViewport = (vh: number, top = 0) => {
      // Expose the live visible height so the shell can size to it. `100dvh`
      // does NOT shrink when the iOS keyboard opens, which buries the composer
      // below the keyboard; the shell reads `--app-vh` instead.
      root.style.setProperty("--app-vh", `${vh}px`);
      root.style.position = "fixed";
      root.style.top = `${top}px`;
      root.style.left = "0";
      root.style.right = "0";
      root.style.bottom = "auto";
      root.style.height = `${vh}px`;
      root.style.overflow = "hidden";

      body.style.position = "fixed";
      body.style.top = `${top}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.bottom = "auto";
      body.style.height = `${vh}px`;
      body.style.overflow = "hidden";
    };

    // Full viewport height (no keyboard) — the baseline we shrink from.
    const fullHeight = () =>
      window.visualViewport?.height ?? window.innerHeight;

    // Expose the keyboard height as a CSS var so the composer can sit directly
    // above it. 0 when closed. `--kb-open` (0/1) is a boolean the layout uses to
    // slide the bottom nav/context chrome out of the way so the composer sits
    // flush on the keyboard (Telegram-style) instead of with chrome between.
    const setKeyboardInset = (px: number) => {
      const v = Math.max(0, px);
      root.style.setProperty("--keyboard-inset", `${v}px`);
      root.style.setProperty("--kb-open", v > 1 ? "1" : "0");
    };

    const cleanups: Array<() => void> = [];

    // True once the native Capacitor Keyboard plugin is wired. When native, the
    // plugin's keyboardWillShow/Hide events are the AUTHORITATIVE viewport
    // driver; the visualViewport scroll/resize path below must NOT also re-pin,
    // or the two fight and iOS's reveal-scroll drags the whole fixed shell (the
    // green context bar) up the screen. PWA/web (no plugin) keeps the vv path.
    let nativeKeyboard = false;

    // Native path: Capacitor Keyboard plugin fires real show/hide events with
    // the exact keyboard height. visualViewport "resize" does NOT fire in a
    // WKWebView on keyboard open, so this is the only reliable signal in the
    // iOS app. Dynamic import so the web/PWA build (no native plugin) is fine.
    let baseline = fullHeight();
    void (async () => {
      // Only the real native app has a working Keyboard plugin. On web/PWA the
      // plugin import still resolves (web stub), so guarding on the platform is
      // what keeps us off the native path — otherwise addListener logs
      // "Keyboard plugin is not implemented on web" AND nativeKeyboard flips
      // true, disabling the visualViewport path below (breaking PWA keyboard
      // tracking). Mirror the isNativePlatform() guard used in nativePush.ts.
      const core = await import("@capacitor/core");
      if (!core.Capacitor?.isNativePlatform?.()) return; // browser/PWA → vv path below
      const { Keyboard } = await import("@capacitor/keyboard");
      nativeKeyboard = true;
      const onShow = Keyboard.addListener("keyboardWillShow", (info) => {
        baseline = fullHeight();
        setKeyboardInset(info.keyboardHeight);
        // Shrink the pinned app to the space above the keyboard so the
        // composer (anchored to the bottom of the app) rides up with it.
        // top stays 0 — never offset, so the shell can't drift upward.
        pinToViewport(baseline - info.keyboardHeight, 0);
      });
      const onHide = Keyboard.addListener("keyboardWillHide", () => {
        setKeyboardInset(0);
        pinToViewport(fullHeight(), 0);
      });
      // addListener returns a Promise<PluginListenerHandle> in Capacitor 8.
      cleanups.push(() => void onShow.then((h) => h.remove()));
      cleanups.push(() => void onHide.then((h) => h.remove()));
    })().catch(() => {
      /* not in the native app — visualViewport path below covers PWA/web */
    });

    // Web/PWA path: visualViewport tracks the keyboard in mobile Safari. We
    // follow BOTH resize (height shrinks) and scroll (Safari shifts the visual
    // viewport down via offsetTop to reveal the focused input) so the pinned
    // shell rides exactly above the keyboard instead of being scrolled under it.
    // Skipped entirely once the native plugin is active (it owns the pin).
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const handler = () => {
        if (nativeKeyboard) return; // native plugin is authoritative
        const vh = vv.height;
        // Layout viewport (innerHeight) does NOT shrink with the keyboard, so
        // it's the right baseline for the keyboard height.
        const layoutH = window.innerHeight;
        setKeyboardInset(Math.max(0, layoutH - vh - vv.offsetTop));
        pinToViewport(vh, vv.offsetTop);
      };
      vv.addEventListener("resize", handler);
      vv.addEventListener("scroll", handler);
      handler();
      cleanups.push(() => vv.removeEventListener("resize", handler));
      cleanups.push(() => vv.removeEventListener("scroll", handler));
    } else {
      pinToViewport(window.innerHeight);
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}