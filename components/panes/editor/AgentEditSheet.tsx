"use client";

import { useState } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";
import { SparkleIcon } from "@/components/panes/pane-icons";
import {
  requestAgentEdit,
  type AgentEditResult,
} from "@/lib/agent-edit";

interface AgentEditSheetProps {
  open: boolean;
  onClose: () => void;
  repo: string;
  path: string;
  content: string;
  selection?: { from: number; to: number; text: string };
  /** Accept writes the proposed content into the editor (which then saves). */
  onAccept: (proposed: string) => void;
}

type DiffRow = { type: "ctx" | "add" | "del"; text: string };

/** Compact LCS line diff for the review surface (capped for safety). */
function lineDiff(a: string, b: string): DiffRow[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const CAP = 1500;
  if (A.length > CAP || B.length > CAP) {
    return [
      { type: "del", text: `(${A.length} lines replaced)` },
      { type: "add", text: `(${B.length} lines proposed)` },
    ];
  }
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ type: "ctx", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: A[i] });
      i++;
    } else {
      rows.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: "del", text: A[i++] });
  while (j < m) rows.push({ type: "add", text: B[j++] });
  return rows;
}

export function AgentEditSheet({
  open,
  onClose,
  repo,
  path,
  content,
  selection,
  onAccept,
}: AgentEditSheetProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentEditResult | null>(null);

  const reset = () => {
    setInstruction("");
    setBusy(false);
    setResult(null);
  };

  const run = async () => {
    if (!instruction.trim()) return;
    haptic(10);
    setBusy(true);
    setResult(null);
    const r = await requestAgentEdit({
      repo,
      path,
      content,
      selection,
      instruction: instruction.trim(),
    });
    setResult(r);
    setBusy(false);
  };

  const diff =
    result?.proposed != null ? lineDiff(content, result.proposed) : null;
  const changeCount = diff
    ? diff.filter((r) => r.type !== "ctx").length
    : 0;

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Ask agent to edit"
    >
      <div className="px-2 pb-1">
        <div className="flex items-center gap-2 px-1 pb-2">
          <SparkleIcon width={15} height={15} className="text-midground" />
          <span className="font-mono-ui truncate text-[0.72rem] text-text-tertiary">
            {path}
            {selection ? ` · ${selection.text.length} chars selected` : ""}
          </span>
        </div>

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="e.g. add input validation, fix the type error, write a docstring"
          className="w-full resize-none rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] px-3 py-2 text-sm text-midground outline-none placeholder:text-text-tertiary focus:border-[color-mix(in_srgb,var(--midground)_40%,transparent)]"
        />

        <button
          type="button"
          onClick={run}
          disabled={busy || !instruction.trim()}
          className={cn(
            "mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-2.5 text-sm font-medium transition-colors",
            busy || !instruction.trim()
              ? "bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] text-text-tertiary"
              : "bg-midground text-background-base active:opacity-90",
          )}
        >
          {busy ? (
            <span className="march inline-block h-[1px] w-16" aria-hidden />
          ) : (
            <>
              <SparkleIcon width={15} height={15} />
              Generate edit
            </>
          )}
        </button>

        {result && (
          <div className="mt-3">
            {result.proposed == null ? (
              <div className="rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] px-3 py-2.5">
                <p className="text-[0.72rem] leading-relaxed text-text-secondary">
                  {result.note}
                </p>
                {!result.wired && (
                  <span className="mt-1.5 inline-block font-mono-ui text-[0.6rem] uppercase tracking-[0.16em] text-text-tertiary">
                    wiring pending · slice 2 owns the session
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-display font-mondwest text-[0.62rem] tracking-[0.16em] text-text-tertiary">
                    Proposed diff
                  </span>
                  <span className="font-mono-ui tabular text-[0.66rem] text-text-tertiary">
                    {changeCount} changed lines
                  </span>
                </div>
                <div className="max-h-[34dvh] overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border">
                  <pre className="font-mono-ui text-[0.7rem] leading-[1.5]">
                    {diff!.map((row, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "flex gap-2 px-2",
                          row.type === "add" &&
                            "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)]",
                          row.type === "del" &&
                            "bg-[color-mix(in_srgb,var(--color-destructive)_12%,transparent)]",
                        )}
                      >
                        <span
                          className={cn(
                            "w-3 shrink-0 select-none text-center",
                            row.type === "add" && "text-[color:var(--color-success)]",
                            row.type === "del" && "text-[color:var(--color-destructive)]",
                            row.type === "ctx" && "text-text-tertiary",
                          )}
                        >
                          {row.type === "add" ? "+" : row.type === "del" ? "-" : ""}
                        </span>
                        <span className="whitespace-pre-wrap break-all text-text-secondary">
                          {row.text || " "}
                        </span>
                      </div>
                    ))}
                  </pre>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      haptic(8);
                      setResult(null);
                    }}
                    className="flex-1 rounded-[var(--radius-md)] border border-border py-2 text-sm text-text-secondary active:bg-[color-mix(in_srgb,var(--midground)_6%,transparent)]"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      haptic(12);
                      onAccept(result.proposed!);
                      onClose();
                      reset();
                    }}
                    className="flex-1 rounded-[var(--radius-md)] bg-midground py-2 text-sm font-medium text-background-base active:opacity-90"
                  >
                    Accept
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
