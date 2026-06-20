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
  VaultIcon,
  KeyIcon,
  RouterIcon,
  ClockIcon,
  SkillsIcon,
  ChartIcon,
  PlugIcon,
  DownloadIcon,
  HomeIcon,
} from "./icons";
import { TasksHomePane } from "@/components/panes/TasksHomePane";
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
import { ObsidianPane } from "@/components/panes/ObsidianPane";
import { ApiKeysPane } from "@/components/panes/ApiKeysPane";
import { OpenRouterPane } from "@/components/panes/OpenRouterPane";
import { SessionsPane } from "@/components/panes/SessionsPane";
import { CronPane } from "@/components/panes/CronPane";
import { SkillsPane } from "@/components/panes/SkillsPane";
import { AnalyticsPane } from "@/components/panes/AnalyticsPane";
import { RuntimeConfigPane } from "@/components/panes/RuntimeConfigPane";
import { McpPane } from "@/components/panes/McpPane";
import { OnboardingPane } from "@/components/panes/OnboardingPane";
import { UsagePane } from "@/components/panes/UsagePane";

/**
 * Tab registry — the contract between the shell (slice 1) and the feature
 * slices. A slice "owns" a pane by swapping the `Pane` component for a tab id;
 * it never has to touch the shell, the nav, or the routing. To reorder the
 * bottom bar, edit `PRIMARY_TAB_IDS` — everything else (the "More" sheet,
 * swipe order) derives from these two exports.
 */

export type TabId =
  | "tasks"
  | "chat"
  | "repos"
  | "editor"
  | "terminal"
  | "diff"
  | "fleet"
  | "kanban"
  | "prs"
  | "obsidian"
  | "sessions"
  | "cron"
  | "skills"
  | "analytics"
  | "config"
  | "keys"
  | "openrouter"
  | "mcp"
  | "onboarding"
  | "usage"
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
  { id: "tasks", label: "Tasks", shortLabel: "Tasks", Icon: HomeIcon, Pane: TasksHomePane },
  { id: "chat", label: "Chat", shortLabel: "Chat", Icon: ChatIcon, Pane: ChatPane },
  { id: "repos", label: "Repos", shortLabel: "Repos", Icon: ReposIcon, Pane: ReposPane },
  { id: "editor", label: "Editor", shortLabel: "Editor", Icon: EditorIcon, Pane: EditorPane },
  { id: "terminal", label: "Terminal", shortLabel: "Term", Icon: TerminalIcon, Pane: TerminalPane },
  { id: "diff", label: "Diff", shortLabel: "Diff", Icon: DiffIcon, Pane: DiffPane },
  { id: "fleet", label: "Fleet", shortLabel: "Fleet", Icon: FleetIcon, Pane: FleetPane },
  { id: "kanban", label: "Kanban", shortLabel: "Board", Icon: KanbanIcon, Pane: KanbanPane },
  { id: "prs", label: "Tasks & PRs", shortLabel: "PRs", Icon: PullRequestIcon, Pane: TasksPRsPane },
  { id: "obsidian", label: "Obsidian", shortLabel: "Vault", Icon: VaultIcon, Pane: ObsidianPane },
  { id: "sessions", label: "Sessions", shortLabel: "Sessions", Icon: ClockIcon, Pane: SessionsPane },
  { id: "cron", label: "Cron", shortLabel: "Cron", Icon: AutomationIcon, Pane: CronPane },
  { id: "skills", label: "Skills", shortLabel: "Skills", Icon: SkillsIcon, Pane: SkillsPane },
  { id: "analytics", label: "Analytics", shortLabel: "Stats", Icon: ChartIcon, Pane: AnalyticsPane },
  { id: "config", label: "Config", shortLabel: "Config", Icon: SettingsIcon, Pane: RuntimeConfigPane },
  { id: "keys", label: "API Keys", shortLabel: "Keys", Icon: KeyIcon, Pane: ApiKeysPane },
  { id: "openrouter", label: "OpenRouter", shortLabel: "Router", Icon: RouterIcon, Pane: OpenRouterPane },
  { id: "mcp", label: "MCP", shortLabel: "MCP", Icon: PlugIcon, Pane: McpPane },
  { id: "onboarding", label: "Get Hermes", shortLabel: "Hermes", Icon: DownloadIcon, Pane: OnboardingPane },
  { id: "usage", label: "Usage & Limits", shortLabel: "Usage", Icon: ChartIcon, Pane: UsagePane },
  { id: "automations", label: "Automations", shortLabel: "Auto", Icon: AutomationIcon, Pane: AutomationsPane },
  { id: "settings", label: "Settings", shortLabel: "Settings", Icon: SettingsIcon, Pane: SettingsPane },
];

/** Tabs shown directly in the bottom bar (the rest live behind "More").
 *  Tasks is the home; Chat is the agent spine (slot 2 = prime thumb reach);
 *  Sessions/Repos/Kanban are the daily surfaces. Cron, Config, Fleet, etc. live
 *  in "More". Fixed set — no user pinning. To reorder the bar, edit this list. */
export const PRIMARY_TAB_IDS: TabId[] = ["tasks", "chat", "sessions", "repos", "kanban"];

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

/** Tabs that stay registered + routable (via in-app links such as the Repos
 *  NavRow or the Settings pane) but are intentionally NOT surfaced in the
 *  bottom-bar "More" sheet, to keep it uncluttered. Diff + Tasks&PRs are reached
 *  from Repos; Editor + Terminal are desktop-IDE surfaces; API Keys + MCP live
 *  under Settings → Integrations. */
export const HIDDEN_FROM_MORE: TabId[] = [
  "editor",
  "diff",
  "terminal",
  "prs",
  "keys",
  "mcp",
  "automations",
];

/**
 * Every tab (primary first, then secondary) so the bottom bar can resolve any
 * pinned id regardless of the default split. This is the lookup the
 * user-customizable bar reads against; PRIMARY_TABS/SECONDARY_TABS stay the
 * default split for first load.
 */
export const ALL_TABS: TabDef[] = [...PRIMARY_TABS, ...SECONDARY_TABS];

export const DEFAULT_TAB_ID: TabId = "tasks";
