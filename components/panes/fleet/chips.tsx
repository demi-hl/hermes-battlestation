"use client";

import {
  NODE_META,
  type AgentNode,
} from "@/lib/fleet/types";

/** Compact "Xs / Xm / Xh / Xd ago" from an epoch-ms instant. */
export function agoShort(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Node chip — colored dot + label. Fixed data accent so node attribution
 *  reads the same across all 8 themes. */
export function NodeChip({ node }: { node: AgentNode }) {
  const meta = NODE_META[node];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${meta.color} 36%, transparent)`,
      }}
      title={`${meta.label} · ${meta.sub}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: meta.color, boxShadow: `0 0 5px ${meta.color}` }}
      />
      {meta.label}
    </span>
  );
}
