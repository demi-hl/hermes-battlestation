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
  /** Human provider name for grouping, e.g. "Anthropic", "xAI". */
  providerLabel?: string;
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

  // Active turn — when a turn is running, the ms-epoch it started (else null).
  // Drives the live m:ss timer in the ContextBar so you can see it's thinking.
  turnStartedAt: number | null;
  setTurnStartedAt: (v: number | null) => void;

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
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);

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

  // Profiles — loaded live from /api/profiles (the real `hermes profile list`).
  // Falls back to DEFAULT_PROFILES only if the API is unreachable.
  const [profiles, setProfiles] = useState<AgentProfile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem(PROFILE_STORAGE_KEY) ?? "default";
  });

  useEffect(() => {
    let live = true;
    // `hermes profile list` is ~8s cold; a single shot that misses (server
    // mid-restart / transient) would strand the UI on the 2-profile fallback
    // until app reload. Retry until the real list lands so it self-heals.
    (async () => {
      for (let attempt = 0; attempt < 5 && live; attempt++) {
        try {
          const res = await fetch("/api/profiles", { cache: "no-store" });
          if (res.ok) {
            const data = (await res.json()) as {
              profiles?: Array<{ id: string; label: string; model: string; provider: string; effort?: string }>;
            };
            if (data.profiles?.length) {
              if (!live) return;
              setProfiles(
                data.profiles.map((p) => ({
                  id: p.id,
                  label: p.label,
                  model: p.model,
                  provider: p.provider,
                  effort: p.effort ?? "",
                })),
              );
              return;
            }
          }
        } catch {
          /* retry below */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const setActiveProfile = useCallback((id: string) => {
    setActiveProfileId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(PROFILE_STORAGE_KEY, id);
    }
  }, []);

  // Cross-pane bus: tapping a session (or its profile) in the Sessions pane
  // switches the active brain to that session's profile, so the next turn runs
  // under the same profile the session belongs to. Ignored if the profile id
  // isn't in the live list (stale / unknown).
  useEffect(() => {
    const onSetProfile = (e: Event) => {
      const id = (e as CustomEvent<{ profile?: string }>).detail?.profile;
      if (!id) return;
      setActiveProfileId((cur) => {
        if (id === cur) return cur;
        if (!profiles.some((p) => p.id === id)) return cur;
        if (typeof window !== "undefined") localStorage.setItem(PROFILE_STORAGE_KEY, id);
        return id;
      });
    };
    window.addEventListener("lo-set-profile", onSetProfile as EventListener);
    return () => window.removeEventListener("lo-set-profile", onSetProfile as EventListener);
  }, [profiles]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0],
    [profiles, activeProfileId],
  );

  // The model shown in the bar follows the active profile's configured model
  // (the profile is the real selector; the standalone model picker is an
  // optional per-turn override layered on top).
  useEffect(() => {
    if (activeProfile?.model) setModel(activeProfile.model);
  }, [activeProfile, setModel]);

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

  // Collapsable bar — default collapsed to reclaim the bottom band; the
  // second row (profile + sessions) is one tap away via the chevron.
  const [barCollapsed, setBarCollapsed] = useState(true);

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
      turnStartedAt, setTurnStartedAt,
      profiles, activeProfile, setActiveProfile,
      repoAvatars, setRepoAvatar,
      activeSessions, addSession, updateSession, removeSession,
      notifications, dismissNotification,
      barCollapsed, setBarCollapsed,
      compress,
    }),
    [active, models, model, setModel, contextUsage, status, turnStartedAt, profiles, activeProfile,
     setActiveProfile, repoAvatars, activeSessions, notifications, barCollapsed, compress,
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
  turnStartedAt: null,
  setTurnStartedAt: () => {},
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
