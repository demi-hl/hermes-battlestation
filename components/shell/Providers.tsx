"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/lib/themes";
import { WorkspaceProvider } from "./workspace-context";

/**
 * Client provider tree for the shell: the ported ThemeProvider (8-theme system
 * + CSS-var cascade), the WorkspaceProvider (active context + model), and a
 * MotionConfig that makes every Framer animation respect the OS
 * reduced-motion setting.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
