// Honest empty / unsourceable state. Omit-if-unsourceable rule: never fabricate
// numbers when a source 404s or a box is down.
export function EmptyState({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-line-2 bg-bg/40 px-3 py-3">
      <span className="text-[13px] text-muted">{title}</span>
      {sub && <span className="font-mono text-[11px] text-faint">{sub}</span>}
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-1/2 animate-pulse rounded bg-line-2" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-line" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-line" />
    </div>
  );
}
