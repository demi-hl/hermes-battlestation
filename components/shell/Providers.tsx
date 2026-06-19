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
    const pinToViewport = (vh: number) => {
      // Expose the live visible height so the shell can size to it. `100dvh`
      // does NOT shrink when the iOS keyboard opens, which buries the composer
      // below the keyboard; the shell reads `--app-vh` instead.
      root.style.setProperty("--app-vh", `${vh}px`);
      root.style.position = "fixed";
      root.style.top = "0";
      root.style.left = "0";
      root.style.right = "0";
      root.style.bottom = "auto";
      root.style.height = `${vh}px`;
      root.style.overflow = "hidden";

      body.style.position = "fixed";
      body.style.top = "0";
      body.style.left = "0";
      body.style.right = "0";
      body.style.bottom = "auto";
      body.style.height = `${vh}px`;
      body.style.overflow = "hidden";
    };

    if (window.visualViewport) {
      const handler = () => pinToViewport(window.visualViewport!.height);
      window.visualViewport.addEventListener("resize", handler);
      // Fire on mount so the initial height matches even if keyboard is open.
      handler();
      return () =>
        window.visualViewport!.removeEventListener("resize", handler);
    } else {
      // No visualViewport API — fall back to 100dvh via CSS (same as before).
      pinToViewport(window.innerHeight);
    }
  }, []);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}