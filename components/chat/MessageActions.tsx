"use client";

import { useState } from "react";
import { haptic } from "@/components/shell/haptics";
import { cn } from "@/lib/utils";

type ActionState = "idle" | "copied" | "shared" | "saved" | "opened" | "failed";
type MediaKind = "image" | "video" | "audio";
type ActionAlign = "left" | "right";

type ShareNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

const STATUS: Record<Exclude<ActionState, "idle">, string> = {
  copied: "copied",
  shared: "shared",
  saved: "saved",
  opened: "opened",
  failed: "failed",
};

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/webm": "weba",
};

const KIND_MIME: Record<MediaKind, string> = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mp4",
};

export function MediaActions({
  src,
  kind,
  alt = "",
  align = "left",
  className,
}: {
  src: string;
  kind: MediaKind;
  alt?: string;
  align?: ActionAlign;
  className?: string;
}) {
  const [state, setState] = useState<ActionState>("idle");
  const [open, setOpen] = useState(false);
  const fileName = mediaFileName(src, kind, alt);
  const mark = (next: ActionState) => flashState(next, setState);

  const run = (fn: () => Promise<void>) => {
    setOpen(false);
    void fn();
  };

  return (
    <div className={cn(actionRowClass(align), "relative", className)}>
      <button
        type="button"
        aria-label={`${kind} actions`}
        aria-expanded={open}
        onClick={() => {
          void haptic(4);
          setOpen((v) => !v);
        }}
        className="grid h-8 w-8 place-items-center rounded-full border border-border/70 bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] text-text-tertiary transition-colors hover:text-midground active:scale-95 active:bg-[color-mix(in_srgb,var(--midground)_10%,transparent)]"
      >
        <span aria-hidden className="-mt-1 font-mono-ui text-[1.05rem] leading-none tracking-[-0.08em]">•••</span>
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute bottom-9 z-30 min-w-28 overflow-hidden rounded-xl border border-border bg-[color-mix(in_srgb,var(--background-base)_92%,transparent)] p-1 shadow-xl backdrop-blur",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <MenuButton onClick={() => run(() => shareMedia(src, kind, fileName, mark))}>share</MenuButton>
          <MenuButton onClick={() => run(() => saveMedia(src, kind, fileName, mark))}>
            {isAppleMobile() ? "open" : "save"}
          </MenuButton>
        </div>
      )}
      <ActionStatus state={state} />
    </div>
  );
}

function MenuButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left font-mono-ui text-[0.62rem] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] hover:text-midground"
    >
      {children}
    </button>
  );
}

function ActionStatus({ state }: { state: ActionState }) {
  if (state === "idle") return null;
  return (
    <span aria-live="polite" className="self-center font-mono-ui text-[0.6rem] uppercase tracking-[0.12em] text-text-tertiary">
      {STATUS[state]}
    </span>
  );
}

function actionRowClass(align: ActionAlign): string {
  return cn("flex items-center gap-1.5", align === "right" ? "justify-end" : "justify-start");
}

function flashState(next: ActionState, setState: (next: ActionState) => void) {
  if (next === "idle") return;
  setState(next);
  window.setTimeout(() => setState("idle"), 1600);
}

async function saveMedia(
  src: string,
  kind: MediaKind,
  fileName: string,
  mark: (next: ActionState) => void,
) {
  void haptic(8);
  try {
    const file = await fileFromSrc(src, kind, fileName).catch(() => null);
    const fileShare = file ? await shareFiles([file]) : "unavailable";
    if (fileShare === "shared") {
      mark("shared");
      return;
    }
    if (fileShare === "cancelled") return;
    mark(downloadOrOpen(src, fileName));
  } catch {
    mark("failed");
  }
}

async function shareMedia(
  src: string,
  kind: MediaKind,
  fileName: string,
  mark: (next: ActionState) => void,
) {
  void haptic(8);
  try {
    const file = await fileFromSrc(src, kind, fileName).catch(() => null);
    const fileShare = file ? await shareFiles([file]) : "unavailable";
    if (fileShare === "shared") {
      mark("shared");
      return;
    }
    if (fileShare === "cancelled") return;

    const nav = shareNavigator();
    if (nav?.share && !src.startsWith("data:")) {
      try {
        await nav.share({ title: fileName, url: absoluteSrc(src) });
        mark("shared");
        return;
      } catch (e) {
        if (isAbort(e)) return;
      }
    }

    mark(downloadOrOpen(src, fileName));
  } catch {
    mark("failed");
  }
}

async function shareFiles(files: File[]): Promise<"shared" | "cancelled" | "unavailable"> {
  const nav = shareNavigator();
  if (!nav?.share || !nav.canShare?.({ files })) return "unavailable";
  try {
    await nav.share({ files, title: files[0]?.name });
    return "shared";
  } catch (e) {
    if (isAbort(e)) return "cancelled";
    return "unavailable";
  }
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea path for older/iOS WebViews.
    }
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy failed");
}

async function fileFromSrc(src: string, kind: MediaKind, fileName: string): Promise<File> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || mimeFromName(fileName) || KIND_MIME[kind];
  return new File([blob], fileName, { type });
}

function downloadOrOpen(src: string, fileName: string): ActionState {
  const href = absoluteSrc(src);
  if (isAppleMobile()) {
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (!opened && !href.startsWith("data:")) window.location.href = href;
    return "opened";
  }

  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return "saved";
}

function mediaFileName(src: string, kind: MediaKind, alt: string): string {
  const fromSrc = fileNameFromSrc(src);
  const base = fromSrc || alt.trim() || `hermes-${kind}`;
  const clean = base
    .replace(/[?#].*$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `hermes-${kind}`;
  return ensureExtension(clean, kind, dataMime(src));
}

function fileNameFromSrc(src: string): string {
  if (src.startsWith("data:")) return "";
  try {
    const url = new URL(src, window.location.href);
    const apiPath = url.pathname === "/api/media" ? url.searchParams.get("path") : null;
    const raw = apiPath || url.pathname;
    return decodeURIComponent(raw).split(/[\\/]/).filter(Boolean).pop() ?? "";
  } catch {
    return src.split(/[\\/]/).filter(Boolean).pop() ?? "";
  }
}

function ensureExtension(name: string, kind: MediaKind, mime?: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const type = mime || KIND_MIME[kind];
  const ext = MIME_EXT[type] || MIME_EXT[KIND_MIME[kind]];
  return `${name}.${ext}`;
}

function mimeFromName(name: string): string | null {
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext) return null;
  return Object.entries(MIME_EXT).find(([, candidate]) => candidate === ext)?.[0] ?? null;
}

function dataMime(src: string): string | undefined {
  return src.match(/^data:([^;,]+)/)?.[1];
}

function absoluteSrc(src: string): string {
  if (/^(data|blob):/i.test(src)) return src;
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}

function isAppleMobile(): boolean {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function shareNavigator(): ShareNavigator | null {
  if (typeof navigator === "undefined") return null;
  return navigator as ShareNavigator;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
