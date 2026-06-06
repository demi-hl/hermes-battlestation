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

/**
 * Active-context store for the whole shell. The bottom ContextBar renders from
 * this; later slices DRIVE it:
 *   - the Repos slice calls `setActiveWorkspace(repo, branch)` on selection,
 *   - the Chat slice calls `setContextUsage(...)` / `setStatus(...)` as a
 *     session streams,
 *   - the model picker (slice 1, in the ContextBar) calls `setModel(...)`.
 *
 * Exported via `useWorkspace()` so any slice can read or feed it.
 */

export type ModelId = "claude-opus-4-8" | "claude-sonnet-4-6" | "claude-haiku-4-5";

export interface ModelOption {
  id: ModelId;
  /** Short display label, e.g. "Opus 4.8". */
  label: string;
  /** Inference provider for the bound session. */
  provider: string;
}

/**
 * Selectable models. Provider is configurable per deployment; the boot default
 * matches the host agent's configured default. Any session the app spawns runs
 * on the selected model + provider.
 */
const PROVIDER = process.env.NEXT_PUBLIC_MODEL_PROVIDER ?? "anthropic";

export const MODELS: ModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", provider: PROVIDER },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", provider: PROVIDER },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", provider: PROVIDER },
];

/** Canonical default — the app boots with the first model selected. */
export const DEFAULT_MODEL_ID: ModelId = "claude-opus-4-8";

const MODEL_STORAGE_KEY = "locals-only-model";

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

interface WorkspaceContextValue {
  active: ActiveWorkspace | null;
  setActiveWorkspace: (next: ActiveWorkspace | null) => void;

  models: ModelOption[];
  model: ModelOption;
  setModel: (id: ModelId) => void;

  contextUsage: ContextUsage | null;
  setContextUsage: (next: ContextUsage | null) => void;

  status: AgentStatus;
  setStatus: (next: AgentStatus) => void;
}

function modelById(id: ModelId): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [active, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  // Optimistic default: the app is being served from the always-on PC, so the
  // agent host is reachable. The Fleet / Chat slices replace this with a real
  // probe + live session state.
  const [status, setStatus] = useState<AgentStatus>("online");

  const [modelId, setModelId] = useState<ModelId>(() => {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && MODELS.some((m) => m.id === stored)) return stored as ModelId;
    return DEFAULT_MODEL_ID;
  });

  const setModel = useCallback((id: ModelId) => {
    setModelId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODEL_STORAGE_KEY, id);
    }
  }, []);

  // Surface the active model + provider on <html> so other surfaces (and the
  // session spawner in later slices) can read it without prop-drilling.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.model = modelId;
    document.documentElement.dataset.provider = "anthropic";
  }, [modelId]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      active,
      setActiveWorkspace,
      models: MODELS,
      model: modelById(modelId),
      setModel,
      contextUsage,
      setContextUsage,
      status,
      setStatus,
    }),
    [active, modelId, setModel, contextUsage, status],
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
  models: MODELS,
  model: modelById(DEFAULT_MODEL_ID),
  setModel: () => {},
  contextUsage: null,
  setContextUsage: () => {},
  status: "online",
  setStatus: () => {},
});
