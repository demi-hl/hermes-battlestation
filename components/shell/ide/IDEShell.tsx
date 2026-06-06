"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import { IDELeftRail, type CenterView } from "./IDELeftRail";
import { ChangesPanel } from "./ChangesPanel";
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

// Views that get the right-hand source-control panel (repo-bound work).
const WITH_SOURCE_PANEL = new Set<CenterView>(["agent", "editor", "diff"]);

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
    }
}

/**
 * The god-mode IDE shell (desktop). Three panes:
 *   left   — Hermes-tab nav + workspace/worktree switcher (IDELeftRail)
 *   center — the agent conversation spine, or a swapped-in Hermes tab
 *   right  — source-control panel (Files / live Changes) bound to the workspace
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

  return (
    <div className="relative z-[1] flex h-[100dvh] w-full overflow-hidden bg-[length:400px_346px]"
      style={{ backgroundImage: 'url("/hermes-bg.svg")' }}
    >
      <IDELeftRail view={view} onView={setView} />

      <main className="relative flex min-w-0 flex-1">
        <section className="min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto scrollbar-none">
            <CenterPane view={view} />
          </div>
        </section>

        {showSource && (
          <aside className="hidden w-[300px] shrink-0 xl:block">
            <ChangesPanel
              repo={repo}
              activePath={activePath}
              onOpenFile={(p) => {
                setActivePath(p);
                if (view !== "editor") setView("editor");
              }}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
