import type { ComponentType, SVGProps } from "react";
import {
  ChatIcon,
  ReposIcon,
  EditorIcon,
  TerminalIcon,
  DiffIcon,
  FleetIcon,
  KanbanIcon,
  PullRequestIcon,
  AutomationIcon,
  SettingsIcon,
} from "./icons";
import { ChatPane } from "@/components/panes/ChatPane";
import { ReposPane } from "@/components/panes/ReposPane";
import { EditorPane } from "@/components/panes/EditorPane";
import { TerminalPane } from "@/components/panes/TerminalPane";
import { DiffPane } from "@/components/panes/DiffPane";
import { FleetPane } from "@/components/panes/FleetPane";
import { KanbanPane } from "@/components/panes/KanbanPane";
import { TasksPRsPane } from "@/components/panes/TasksPRsPane";
import { AutomationsPane } from "@/components/panes/AutomationsPane";
import { SettingsPane } from "@/components/panes/SettingsPane";

/**
 * Tab registry — the contract between the shell (slice 1) and the feature
 * slices. A slice "owns" a pane by swapping the `Pane` component for a tab id;
 * it never has to touch the shell, the nav, or the routing. To reorder the
 * bottom bar, edit `PRIMARY_TAB_IDS` — everything else (the "More" sheet,
 * swipe order) derives from these two exports.
 */

export type TabId =
  | "chat"
  | "repos"
  | "editor"
  | "terminal"
  | "diff"
  | "fleet"
  | "kanban"
  | "prs"
  | "automations"
  | "settings";

export interface TabDef {
  id: TabId;
  /** Full label (More sheet, a11y). */
  label: string;
  /** Tighter label for the bottom bar. */
  shortLabel: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Pane body. Slices replace the placeholder with the real surface. */
  Pane: ComponentType;
}

export const TABS: TabDef[] = [
  { id: "chat", label: "Chat", shortLabel: "Chat", Icon: ChatIcon, Pane: ChatPane },
  { id: "repos", label: "Repos", shortLabel: "Repos", Icon: ReposIcon, Pane: ReposPane },
  { id: "editor", label: "Editor", shortLabel: "Editor", Icon: EditorIcon, Pane: EditorPane },
  { id: "terminal", label: "Terminal", shortLabel: "Term", Icon: TerminalIcon, Pane: TerminalPane },
  { id: "diff", label: "Diff", shortLabel: "Diff", Icon: DiffIcon, Pane: DiffPane },
  { id: "fleet", label: "Fleet", shortLabel: "Fleet", Icon: FleetIcon, Pane: FleetPane },
  { id: "kanban", label: "Kanban", shortLabel: "Board", Icon: KanbanIcon, Pane: KanbanPane },
  { id: "prs", label: "Tasks & PRs", shortLabel: "PRs", Icon: PullRequestIcon, Pane: TasksPRsPane },
  { id: "automations", label: "Automations", shortLabel: "Auto", Icon: AutomationIcon, Pane: AutomationsPane },
  { id: "settings", label: "Settings", shortLabel: "Settings", Icon: SettingsIcon, Pane: SettingsPane },
];

/** Tabs shown directly in the bottom bar (the rest live behind "More").
 *  Chat + Repos are the load-bearing surfaces; Fleet is the command center;
 *  Tasks & PRs is the primary review surface. Reorder freely. */
export const PRIMARY_TAB_IDS: TabId[] = ["chat", "repos", "fleet", "prs"];

export const TAB_MAP: Record<TabId, TabDef> = Object.fromEntries(
  TABS.map((t) => [t.id, t]),
) as Record<TabId, TabDef>;

export function getTab(id: TabId): TabDef {
  return TAB_MAP[id];
}

export const PRIMARY_TABS: TabDef[] = PRIMARY_TAB_IDS.map(getTab);

/** Tabs that are not pinned to the bar — surfaced via the "More" sheet. */
export const SECONDARY_TABS: TabDef[] = TABS.filter(
  (t) => !PRIMARY_TAB_IDS.includes(t.id),
);

export const DEFAULT_TAB_ID: TabId = "chat";
