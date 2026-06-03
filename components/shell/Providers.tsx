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
 * Also handles iOS keyboard viewport: when the keyboard opens, Safari's
 * `100dvh` doesn't always recalculate, so content scrolls off-screen. We
 * listen on `window.visualViewport.resize` and pin the root to the visible
 * height.
 */
export function Providers({ children }: { children: ReactNode }) {
  // iOS keyboard viewport fix — one-time mount, no deps.
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !window.visualViewport
    )
      return;

    const handler = () => {
      const vh = window.visualViewport!.height;
      document.documentElement.style.height = `${vh}px`;
      document.body.style.height = `${vh}px`;
    };

    window.visualViewport.addEventListener("resize", handler);
    // Fire once on mount so the initial height is correct (covers the case
    // where the page loads with the keyboard already open).
    handler();

    return () =>
      window.visualViewport!.removeEventListener("resize", handler);
  }, []);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}