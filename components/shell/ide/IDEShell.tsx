"use client";

import { useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useWorkspace } from "@/components/shell/workspace-context";
import { IDELeftRail, type CenterView } from "./IDELeftRail";
import { ChangesPanel } from "./ChangesPanel";
import { StatusBar } from "../StatusBar";
import { ChatHub } from "@/components/chat/ChatHub";
import { KanbanPane } from "@/components/panes/KanbanPane";
import { FleetPane } from "@/components/panes/FleetPane";
import { TasksPRsPane } from "@/components/panes/TasksPRsPane";
import { AutomationsPane } from "@/components/panes/AutomationsPane";
import { ObsidianPane } from "@/components/panes/ObsidianPane";
import { EditorPane } from "@/components/panes/EditorPane";
import { TerminalPane } from "@/components/panes/TerminalPane";
import { DiffPane } from "@/components/panes/DiffPane";
import { SettingsPane } from "@/components/panes/SettingsPane";
import { SessionsPane } from "@/components/panes/SessionsPane";
import { CronPane } from "@/components/panes/CronPane";
import { SkillsPane } from "@/components/panes/SkillsPane";
import { RuntimeConfigPane } from "@/components/panes/RuntimeConfigPane";
import { ApiKeysPane } from "@/components/panes/ApiKeysPane";
import { AnalyticsPane } from "@/components/panes/AnalyticsPane";
import { OnboardingPane } from "@/components/panes/OnboardingPane";
import { McpPane } from "@/components/panes/McpPane";
import { OpenRouterPane } from "@/components/panes/OpenRouterPane";

function CenterPane({ view }: { view: CenterView }) {
  switch (view) {
    case "agent":
      return <ChatHub />;
    case "kanban":
      return <KanbanPane />;
    case "fleet":
      return <FleetPane />;
    case "prs":
      return <TasksPRsPane />;
    case "automations":
      return <AutomationsPane />;
    case "obsidian":
      return <ObsidianPane />;
    case "editor":
      return <EditorPane />;
    case "terminal":
      return <TerminalPane />;
    case "diff":
      return <DiffPane />;
    case "settings":
      return <SettingsPane />;
    case "sessions":
      return <SessionsPane />;
    case "cron":
      return <CronPane />;
    case "skills":
      return <SkillsPane />;
    case "config":
      return <RuntimeConfigPane />;
    case "keys":
      return <ApiKeysPane />;
    case "analytics":
      return <AnalyticsPane />;
    case "onboarding":
      return <OnboardingPane />;
    case "mcp":
      return <McpPane />;
    case "openrouter":
      return <OpenRouterPane />;
  }
}

// Views that get the right-hand source-control panel (repo-bound work).
const WITH_SOURCE_PANEL = new Set<CenterView>(["agent", "editor", "diff"]);

/**
 * The god-mode IDE shell (desktop). One main view at a time:
 *   left   — Hermes-tab nav + workspace/worktree switcher (IDELeftRail)
 *   center — the selected Hermes surface (agent spine by default)
 *   right  — resizable source-control panel (Files / live Changes), shown for
 *            repo-bound views. The center|source divider is drag-resizable and
 *            the width is persisted.
 *
 * Everything routes through the Hermes agent: the center spine IS a per-repo
 * `lol-*` session; the agent mutates the repo and the right panel reflects it.
 */
export function IDEShell() {
  const [view, setView] = useState<CenterView>("agent");
  const { active } = useWorkspace();
  const [activePath, setActivePath] = useState<string | null>(null);
  const repo = active?.repo ?? null;
  const showSource = WITH_SOURCE_PANEL.has(view);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "battlestation-ide",
    panelIds: ["__center", ...(showSource ? ["__source"] : [])],
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  });

  return (
    <div className="relative z-[1] flex h-[100dvh] w-full flex-col overflow-hidden">
      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        <IDELeftRail view={view} onView={setView} />

        <main className="relative flex min-w-0 flex-1">
          <Group
            orientation="horizontal"
            className="h-full w-full"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <Panel id="__center" minSize="30%" className="min-w-0">
              <div className="h-full overflow-y-auto scrollbar-none">
                <CenterPane view={view} />
              </div>
            </Panel>

            {showSource && (
              <>
                <Separator className="group relative w-px shrink-0 bg-border data-[separator]:cursor-col-resize">
                  <span className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-[color-mix(in_srgb,var(--midground)_18%,transparent)]" />
                </Separator>
                <Panel id="__source" defaultSize="22%" minSize="14%" maxSize="40%" className="min-w-0">
                  <ChangesPanel
                    repo={repo}
                    activePath={activePath}
                    onOpenFile={(p) => {
                      setActivePath(p);
                      if (view !== "editor") setView("editor");
                    }}
                  />
                </Panel>
              </>
            )}
          </Group>
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
