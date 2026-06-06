"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RepoAvatar, AgentProfile, ActiveSession } from "@/lib/workspace-types";

/**
 * Active-context store for the whole shell. Drives the bottom ContextBar and
 * is fed by Chat / Repos / Fleet slices.
 *
 * Extended with:
 *   - Repo avatars (two-letter custom + custom image per repo)
 *   - Profiles (model + provider + skill bundles)
 *   - Active sessions (spawned when you open a branch)
 *   - Notifications (session start / finish)
 *   - Collapsable bar state
 */

export type ModelId = string; // loosened from union to allow any model

export interface ModelOption {
  id: ModelId;
  /** Short display label, e.g. "Opus 4.8". */
  label: string;
  /** Inference provider for the bound session. */
  provider: string;
}

/** Selectable models — loaded from the /api/models endpoint at boot. */
const PROVIDER = process.env.NEXT_PUBLIC_MODEL_PROVIDER ?? "anthropic";

export const DEFAULT_MODELS: ModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", provider: PROVIDER },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", provider: PROVIDER },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", provider: PROVIDER },
];

export const DEFAULT_MODEL_ID = "claude-opus-4-8";

const MODEL_STORAGE_KEY = "locals-only-model";
const PROFILE_STORAGE_KEY = "locals-only-profile";
const AVATAR_STORAGE_KEY = "locals-only-avatars";

export type AgentStatus = "online" | "connecting" | "offline";

export interface ContextUsage {
  /** Tokens used in the active session's context window. */
  used: number;
  /** Context-window size for the active model. */
  total: number;
}

export interface ActiveWorkspace {
  /** Repo slug, e.g. "polymarket-arbitrage-bot". */
  repo: string;
  /** Absolute repo path (cwd for the bound Hermes session). */
  path?: string;
  /** Active branch / workspace name. */
  branch: string;
}

/** Notification about a session lifecycle event. */
export interface SessionNotification {
  id: string;
  repo: string;
  branch: string;
  type: "started" | "completed" | "error";
  ts: number;
}

interface WorkspaceContextValue {
  active: ActiveWorkspace | null;
  setActiveWorkspace: (next: ActiveWorkspace | null) => void;

  models: ModelOption[];
  model: ModelOption;
  setModel: (id: string) => void;

  contextUsage: ContextUsage | null;
  setContextUsage: (next: ContextUsage | null) => void;

  status: AgentStatus;
  setStatus: (next: AgentStatus) => void;

  // Profiles
  profiles: AgentProfile[];
  activeProfile: AgentProfile | null;
  setActiveProfile: (id: string) => void;

  // Repo avatars
  repoAvatars: Record<string, RepoAvatar>;
  setRepoAvatar: (repo: string, avatar: RepoAvatar) => void;

  // Active sessions (spawned from branches)
  activeSessions: ActiveSession[];
  addSession: (s: ActiveSession) => void;
  updateSession: (repo: string, patch: Partial<ActiveSession>) => void;
  removeSession: (repo: string) => void;

  // Notifications
  notifications: SessionNotification[];
  dismissNotification: (id: string) => void;

  // Collapse
  barCollapsed: boolean;
  setBarCollapsed: (v: boolean) => void;

  // Compress action (dispatched to the active session)
  compress: () => void;
}

/** Default profiles the user can select. */
export const DEFAULT_PROFILES: AgentProfile[] = [
  { id: "default", label: "Default", model: "claude-opus-4-8", provider: "anthropic" },
  { id: "fast", label: "Fast", model: "claude-haiku-4-5", provider: "anthropic" },
];

function modelById(models: ModelOption[], id: string): ModelOption {
  return models.find((m) => m.id === id) ?? models[0];
}

function loadAvatars(): Record<string, RepoAvatar> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RepoAvatar>) : {};
  } catch {
    return {};
  }
}

function saveAvatars(avatars: Record<string, RepoAvatar>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(avatars));
  } catch { /* quota */ }
}

/** Compute two-letter abbreviation from a repo name. */
export function repoLetters(name: string): string {
  // "976-tuna" → "97", "ageless-preview" → "AP"
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return name.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

const N_ID = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [active, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [status, setStatus] = useState<AgentStatus>("online");

  // Models loaded from /api/models at boot
  const [models, setModels] = useState<ModelOption[]>(DEFAULT_MODELS);

  // Load live models from the server
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/models", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { models?: ModelOption[]; defaultModel?: string };
          if (data.models?.length) setModels(data.models);
        }
      } catch { /* keep defaults */ }
    })();
  }, []);

  // Model selection
  const [modelId, setModelId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL_ID;
  });

  const setModel = useCallback((id: string) => {
    setModelId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.model = modelId;
    document.documentElement.dataset.provider = models.find((m) => m.id === modelId)?.provider ?? "anthropic";
  }, [modelId, models]);

  // Profiles
  const [profiles] = useState<AgentProfile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem(PROFILE_STORAGE_KEY) ?? "default";
  });

  const setActiveProfile = useCallback((id: string) => {
    setActiveProfileId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(PROFILE_STORAGE_KEY, id);
    }
    // Switch model to match the profile
    const prof = DEFAULT_PROFILES.find((p) => p.id === id);
    if (prof) setModel(prof.model);
  }, [setModel]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0],
    [profiles, activeProfileId],
  );

  // Repo avatars
  const [repoAvatars, setRepoAvatarsState] = useState<Record<string, RepoAvatar>>(loadAvatars);
  const setRepoAvatar = useCallback((repo: string, avatar: RepoAvatar) => {
    setRepoAvatarsState((prev) => {
      const next = { ...prev, [repo]: avatar };
      saveAvatars(next);
      return next;
    });
  }, []);

  // Active sessions
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const addSession = useCallback((s: ActiveSession) => {
    setActiveSessions((prev) => {
      if (prev.some((x) => x.repo === s.repo)) return prev;
      return [...prev, s];
    });
  }, []);
  const updateSession = useCallback((repo: string, patch: Partial<ActiveSession>) => {
    setActiveSessions((prev) => prev.map((s) => (s.repo === repo ? { ...s, ...patch } : s)));
  }, []);
  const removeSession = useCallback((repo: string) => {
    setActiveSessions((prev) => prev.filter((s) => s.repo !== repo));
  }, []);

  // Notifications
  const [notifications, setNotifications] = useState<SessionNotification[]>([]);
  const addNotification = useCallback((n: SessionNotification) => {
    setNotifications((prev) => [n, ...prev].slice(0, 10));
  }, []);
  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Collapsable bar
  const [barCollapsed, setBarCollapsed] = useState(false);

  // Compress action — sends a /compress message to the active session
  const compress = useCallback(() => {
    // Dispatched via a custom event so useChat can pick it up
    window.dispatchEvent(new CustomEvent("lo-compress"));
  }, []);

  // Spawn active session when workspace is set to a repo branch
  useEffect(() => {
    if (!active) return;
    const exists = activeSessions.some((s) => s.repo === active.repo);
    if (!exists) {
      const s: ActiveSession = {
        repo: active.repo,
        branch: active.branch,
        sessionId: null,
        startedAt: Date.now(),
        messageCount: 0,
        usage: null,
      };
      addSession(s);
      addNotification({ id: N_ID(), repo: active.repo, branch: active.branch, type: "started", ts: Date.now() });
    }
  }, [active, activeSessions, addSession, addNotification]);

  const model = useMemo(() => modelById(models, modelId), [models, modelId]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      active, setActiveWorkspace,
      models, model, setModel,
      contextUsage, setContextUsage,
      status, setStatus,
      profiles, activeProfile, setActiveProfile,
      repoAvatars, setRepoAvatar,
      activeSessions, addSession, updateSession, removeSession,
      notifications, dismissNotification,
      barCollapsed, setBarCollapsed,
      compress,
    }),
    [active, models, modelId, setModel, contextUsage, status, profiles, activeProfile,
     activeProfileId, repoAvatars, activeSessions, notifications, barCollapsed, compress,
     setRepoAvatar, addSession, updateSession, removeSession, dismissNotification],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  active: null,
  setActiveWorkspace: () => {},
  models: DEFAULT_MODELS,
  model: DEFAULT_MODELS[0],
  setModel: () => {},
  contextUsage: null,
  setContextUsage: () => {},
  status: "online",
  setStatus: () => {},
  profiles: DEFAULT_PROFILES,
  activeProfile: DEFAULT_PROFILES[0],
  setActiveProfile: () => {},
  repoAvatars: {},
  setRepoAvatar: () => {},
  activeSessions: [],
  addSession: () => {},
  updateSession: () => {},
  removeSession: () => {},
  notifications: [],
  dismissNotification: () => {},
  barCollapsed: false,
  setBarCollapsed: () => {},
  compress: () => {},
});
