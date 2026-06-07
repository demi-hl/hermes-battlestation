"use client";

import dynamic from "next/dynamic";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWorkspace } from "@/components/shell/workspace-context";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/shell/Sheet";
import { EditorIcon, CloseIcon } from "@/components/shell/icons";
import {
  SaveIcon,
  SearchIcon,
  ReplaceIcon,
  SymbolIcon,
  SparkleIcon,
  FileIcon,
} from "@/components/panes/pane-icons";
import { FileTree } from "./editor/FileTree";
import { AgentEditSheet } from "./editor/AgentEditSheet";
import { langFor, extractSymbols } from "./editor/lang";
import { Button } from "@/components/ui";
import type { CodeEditorHandle } from "./editor/CodeEditor";

const CodeEditor = dynamic(
  () => import("./editor/CodeEditor").then((m) => m.CodeEditor),
  {
    ssr: false,
    loading: () => <EditorSkeleton />,
  },
);

interface OpenTab {
  path: string;
  name: string;
  content: string;
  base: string;
  binary: boolean;
  tooLarge: boolean;
  loading: boolean;
  error: string | null;
}

export function EditorPane() {
  const { active } = useWorkspace();
  const repo = active?.repo ?? null;

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleRef = useRef<CodeEditorHandle | null>(null);

  // Tabs belong to a repo; switching workspaces resets the editor.
  useEffect(() => {
    setTabs([]);
    setActivePath(null);
    setTreeOpen(false);
  }, [repo]);

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const dirtyCount = tabs.filter((t) => t.content !== t.base).length;

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 1800);
  }, []);

  const openFile = useCallback(
    async (path: string, name: string) => {
      if (!repo) return;
      setTreeOpen(false);
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActivePath(path);
        return;
      }
      const tab: OpenTab = {
        path,
        name,
        content: "",
        base: "",
        binary: false,
        tooLarge: false,
        loading: true,
        error: null,
      };
      setTabs((prev) => [...prev, tab]);
      setActivePath(path);
      try {
        const res = await fetch(
          `/api/files/read?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "read failed");
        setTabs((prev) =>
          prev.map((t) =>
            t.path === path
              ? {
                  ...t,
                  loading: false,
                  binary: !!body.binary,
                  tooLarge: !!body.tooLarge,
                  content: body.content ?? "",
                  base: body.content ?? "",
                }
              : t,
          ),
        );
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.path === path
              ? { ...t, loading: false, error: (e as Error).message }
              : t,
          ),
        );
      }
    },
    [repo, tabs],
  );

  const updateContent = useCallback((path: string, value: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, content: value } : t)),
    );
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      haptic(6);
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        const next = prev.filter((t) => t.path !== path);
        if (activePath === path) {
          const fallback = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
          setActivePath(fallback?.path ?? null);
        }
        return next;
      });
    },
    [activePath],
  );

  const save = useCallback(async () => {
    if (!repo || !activeTab || activeTab.content === activeTab.base) return;
    haptic(12);
    setSaving(true);
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          path: activeTab.path,
          content: activeTab.content,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "write failed");
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path ? { ...t, base: t.content } : t,
        ),
      );
      flashToast(`Saved ${activeTab.name}`);
    } catch (e) {
      flashToast(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [repo, activeTab, flashToast]);

  // Cmd/Ctrl-S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Swipe across open tabs (editor is a secondary tab, so the shell's
  // primary-tab swipe never fires here — no conflict).
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || tabs.length < 2) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const i = tabs.findIndex((t) => t.path === activePath);
    if (i === -1) return;
    const next = tabs[i + (dx < 0 ? 1 : -1)];
    if (next) {
      haptic(8);
      setActivePath(next.path);
    }
  };

  if (!repo) {
    return <NoWorkspace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3">
      <Toolbar
        repo={repo}
        activeTab={activeTab}
        dirtyCount={dirtyCount}
        saving={saving}
        onToggleTree={() => {
          haptic(6);
          setTreeOpen((v) => !v);
        }}
        onFind={() => handleRef.current?.openSearch()}
        onReplace={() => handleRef.current?.openReplace()}
        onSymbols={() => setSymbolsOpen(true)}
        onAgent={() => setAgentOpen(true)}
        onSave={save}
      />

      {tabs.length > 0 && (
        <TabStrip
          tabs={tabs}
          activePath={activePath}
          onSelect={(p) => {
            haptic(5);
            setActivePath(p);
          }}
          onClose={closeTab}
          onLongPress={(p) => setTabMenu(p)}
        />
      )}

      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-border"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          background: "color-mix(in srgb, var(--background-base) 40%, transparent)",
        }}
      >
        {activeTab && <span className="arc-border" aria-hidden />}
        {!activeTab ? (
          <EmptyEditor onBrowse={() => setTreeOpen(true)} />
        ) : activeTab.loading ? (
          <EditorSkeleton />
        ) : activeTab.error ? (
          <CenterNote text={`Could not open file: ${activeTab.error}`} />
        ) : activeTab.binary ? (
          <CenterNote text="Binary file — not shown in the editor." />
        ) : activeTab.tooLarge ? (
          <CenterNote text="File is larger than 2 MB — open it in the terminal instead." />
        ) : (
          <CodeEditor
            key={activeTab.path}
            docKey={activeTab.path}
            filename={activeTab.name}
            initialValue={activeTab.content}
            onChange={(v) => updateContent(activeTab.path, v)}
            onReady={(h) => {
              handleRef.current = h;
            }}
          />
        )}
      </div>

      {/* File tree drawer */}
      <AnimatePresence>
        {treeOpen && (
          <motion.div
            className="absolute inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
              onClick={() => setTreeOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 left-0 w-[76%] max-w-[320px] border-r border-border"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              style={{
                background:
                  "color-mix(in srgb, var(--background-base) 92%, transparent)",
                backdropFilter: "blur(20px) saturate(150%)",
                paddingTop: "calc(env(safe-area-inset-top) + 8px)",
              }}
            >
              <FileTree
                repo={repo}
                activePath={activePath}
                onOpenFile={openFile}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="pointer-events-none absolute inset-x-0 bottom-3 z-50 mx-auto w-fit rounded-full border border-border px-4 py-1.5 text-[0.74rem] text-midground"
            style={{
              background:
                "color-mix(in srgb, var(--background-base) 86%, transparent)",
              backdropFilter: "blur(14px)",
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Go-to-symbol */}
      <SymbolSheet
        open={symbolsOpen}
        onClose={() => setSymbolsOpen(false)}
        filename={activeTab?.name ?? ""}
        content={activeTab?.content ?? ""}
        onJump={(line) => {
          setSymbolsOpen(false);
          handleRef.current?.gotoLine(line);
        }}
      />

      {/* Agent inline edit */}
      {activeTab && !activeTab.binary && !activeTab.tooLarge && (
        <AgentEditSheet
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          repo={repo}
          path={activeTab.path}
          content={activeTab.content}
          selection={handleRef.current?.getSelection()}
          onAccept={(proposed) => {
            updateContent(activeTab.path, proposed);
            flashToast("Applied agent edit — review and save");
          }}
        />
      )}

      {/* Tab context menu */}
      <Sheet
        open={tabMenu !== null}
        onClose={() => setTabMenu(null)}
        title="Tab"
      >
        <div className="flex flex-col gap-0.5 pb-1">
          <MenuRow
            label="Close"
            onClick={() => {
              if (tabMenu) closeTab(tabMenu);
              setTabMenu(null);
            }}
          />
          <MenuRow
            label="Close others"
            onClick={() => {
              setTabs((prev) => prev.filter((t) => t.path === tabMenu));
              setActivePath(tabMenu);
              setTabMenu(null);
            }}
          />
          <MenuRow
            label="Close all"
            onClick={() => {
              setTabs([]);
              setActivePath(null);
              setTabMenu(null);
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Toolbar({
  repo,
  activeTab,
  dirtyCount,
  saving,
  onToggleTree,
  onFind,
  onReplace,
  onSymbols,
  onAgent,
  onSave,
}: {
  repo: string;
  activeTab: OpenTab | null;
  dirtyCount: number;
  saving: boolean;
  onToggleTree: () => void;
  onFind: () => void;
  onReplace: () => void;
  onSymbols: () => void;
  onAgent: () => void;
  onSave: () => void;
}) {
  const dirty = !!activeTab && activeTab.content !== activeTab.base;
  const lang = activeTab ? langFor(activeTab.name).label : null;
  const editable = !!activeTab && !activeTab.binary && !activeTab.tooLarge;
  return (
    <div className="flex items-center gap-1.5 py-2">
      <button
        type="button"
        onClick={onToggleTree}
        aria-label="Toggle file tree"
        className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-2.5 py-1.5 text-[0.74rem] text-midground active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
      >
        <FileIcon width={14} height={14} className="text-text-tertiary" />
        Files
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {activeTab ? (
          <>
            <span className="truncate font-mono-ui text-[0.74rem] text-midground">
              {activeTab.name}
            </span>
            {dirty && (
              <span
                aria-label="unsaved"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-warning)]"
              />
            )}
            {lang && (
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono-ui text-[0.56rem] uppercase tracking-[0.12em] text-text-tertiary">
                {lang}
              </span>
            )}
          </>
        ) : (
          <span className="truncate font-mono-ui text-[0.72rem] text-text-tertiary">
            {repo}
          </span>
        )}
      </div>

      <ToolBtn label="Find" onClick={onFind} disabled={!editable}>
        <SearchIcon width={15} height={15} />
      </ToolBtn>
      <ToolBtn label="Replace" onClick={onReplace} disabled={!editable}>
        <ReplaceIcon width={15} height={15} />
      </ToolBtn>
      <ToolBtn label="Go to symbol" onClick={onSymbols} disabled={!editable}>
        <SymbolIcon width={15} height={15} />
      </ToolBtn>
      <ToolBtn label="Ask agent to edit" onClick={onAgent} disabled={!editable}>
        <SparkleIcon width={15} height={15} />
      </ToolBtn>
      <ToolBtn
        label="Save"
        onClick={onSave}
        disabled={!dirty || saving}
        accent={dirty}
      >
        <SaveIcon width={15} height={15} className={saving ? "animate-spin-slow" : ""} />
        {dirtyCount > 1 && (
          <span className="absolute -right-1 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[color:var(--color-warning)] px-0.5 text-[0.5rem] font-bold text-background-base">
            {dirtyCount}
          </span>
        )}
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  disabled,
  accent,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        if (disabled) return;
        haptic(8);
        onClick();
      }}
      disabled={disabled}
      className={cn(
        "relative grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] transition-colors",
        disabled
          ? "text-text-disabled"
          : accent
            ? "bg-[color-mix(in_srgb,var(--color-warning)_16%,transparent)] text-midground active:scale-90"
            : "text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] active:scale-90",
      )}
    >
      {children}
    </button>
  );
}

function TabStrip({
  tabs,
  activePath,
  onSelect,
  onClose,
  onLongPress,
}: {
  tabs: OpenTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onLongPress: (path: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
      {tabs.map((t) => {
        const active = t.path === activePath;
        const dirty = t.content !== t.base;
        return (
          <div
            key={t.path}
            onPointerDown={() => {
              timer.current = setTimeout(() => onLongPress(t.path), 480);
            }}
            onPointerUp={() => timer.current && clearTimeout(timer.current)}
            onPointerLeave={() => timer.current && clearTimeout(timer.current)}
            className={cn(
              "group relative flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border py-1 pl-2.5 pr-1.5 transition-colors",
              active
                ? "border-[color-mix(in_srgb,var(--midground)_35%,transparent)] bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
                : "border-border",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(t.path)}
              className={cn(
                "max-w-[120px] truncate font-mono-ui text-[0.7rem]",
                active ? "text-midground" : "text-text-secondary",
              )}
            >
              {t.name}
            </button>
            {dirty && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-warning)]" />
            )}
            <button
              type="button"
              aria-label={`Close ${t.name}`}
              onClick={() => onClose(t.path)}
              className="grid h-4 w-4 place-items-center rounded-full text-text-tertiary transition-colors active:scale-90 hover:text-midground"
            >
              <CloseIcon width={10} height={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SymbolSheet({
  open,
  onClose,
  filename,
  content,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  filename: string;
  content: string;
  onJump: (line: number) => void;
}) {
  const symbols = open ? extractSymbols(filename, content) : [];
  return (
    <Sheet open={open} onClose={onClose} title="Go to symbol">
      {symbols.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-text-tertiary">
          No symbols found in this file.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 pb-1">
          {symbols.map((s, i) => (
            <li key={`${s.name}-${s.line}-${i}`}>
              <button
                type="button"
                onClick={() => {
                  haptic(8);
                  onJump(s.line);
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
              >
                <span className="truncate font-mono-ui text-[0.8rem] text-midground">
                  {s.name}
                </span>
                <span className="ml-2 shrink-0 font-mono-ui tabular text-[0.66rem] text-text-tertiary">
                  L{s.line}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function MenuRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic(8);
        onClick();
      }}
      className="rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm text-midground active:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)]"
    >
      {label}
    </button>
  );
}

function EmptyEditor({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <FileIcon width={28} height={28} className="text-text-tertiary" />
      <p className="max-w-[28ch] text-sm text-text-tertiary">
        Open the file tree to start editing the active workspace.
      </p>
      <Button outlined size="sm" type="button" onClick={onBrowse}>
        Browse files
      </Button>
    </div>
  );
}

function CenterNote({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <p className="max-w-[30ch] text-sm text-text-tertiary">{text}</p>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[0.7, 0.45, 0.85, 0.6, 0.5, 0.75, 0.4, 0.65, 0.55].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-[color-mix(in_srgb,var(--midground)_7%,transparent)]"
          style={{ width: `${w * 100}%` }}
        />
      ))}
    </div>
  );
}

function NoWorkspace() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <div
        className="relative grid h-20 w-20 place-items-center rounded-[calc(var(--theme-radius)+8px)] text-midground"
        style={{ background: "color-mix(in srgb, var(--midground) 6%, transparent)" }}
      >
        <span className="arc-border" aria-hidden />
        <EditorIcon width={32} height={32} />
      </div>
      <div>
        <h2 className="font-mondwest text-display text-lg tracking-wide text-midground">
          Editor
        </h2>
        <p className="mx-auto mt-2 max-w-[30ch] text-sm leading-relaxed text-text-tertiary">
          Select a workspace in the Repos tab to open its file tree here. Full
          CodeMirror editing, multi-file tabs, find / replace, and agent edits.
        </p>
      </div>
    </div>
  );
}
