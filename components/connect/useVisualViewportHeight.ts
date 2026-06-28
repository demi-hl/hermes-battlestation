"use client";

import { useEffect } from "react";

// Keyboard-safe viewport height used by the pre-auth connect/start screens.
// Capacitor WKWebView can keep 100dvh at full screen height while the keyboard
// is open, so inputs near the bottom get buried. Track visualViewport.height and
// let the page scroll inside the visible area instead.
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      document.documentElement.style.setProperty("--app-vh", `${vv.height}px`);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);

    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--app-vh");
    };
  }, []);
}
