"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Repo avatar: two-letter abbreviation by default, custom image when set.
 */
export function RepoAvatarBadge({
  letters,
  imageUrl,
  size = 20,
  className,
}: {
  letters: string;
  imageUrl?: string;
  size?: number;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={letters}
        draggable={false}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--midground)_10%,transparent)] bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] font-mondwest text-[0.5rem] font-medium uppercase tracking-wide text-text-secondary",
        className,
      )}
      style={{ width: size, height: size, lineHeight: 1 }}
    >
      {letters}
    </span>
  );
}

/**
 * A picker that lets the user set a custom avatar (two-letter or image URL)
 * for a repo. Rendered as a small popover.
 */
export function RepoAvatarEditor({
  repo,
  current,
  onSave,
  onClose,
}: {
  repo: string;
  current: { letters: string; imageUrl?: string };
  onSave: (avatar: { letters: string; imageUrl?: string }) => void;
  onClose: () => void;
}) {
  const [letters, setLetters] = useState(current.letters);
  const [imageUrl, setImageUrl] = useState(current.imageUrl ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--background-base)_94%,transparent)] p-2.5 backdrop-blur-sm">
      <span className="font-mono-ui text-[0.62rem] text-text-tertiary">
        {repo}
      </span>
      <div className="flex items-center gap-2">
        <RepoAvatarBadge letters={letters} imageUrl={imageUrl || undefined} size={28} />
        <input
          ref={inputRef}
          type="text"
          value={letters}
          onChange={(e) => setLetters(e.target.value.slice(0, 2).toUpperCase())}
          placeholder="Letters"
          maxLength={2}
          className="w-10 rounded border border-border bg-transparent px-1.5 py-1 text-center font-mono-ui text-[0.68rem] text-text-primary outline-none focus:border-midground"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Or paste image URL..."
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 font-mono-ui text-[0.62rem] text-text-primary outline-none placeholder:text-text-disabled focus:border-midground"
        />
        {imageUrl && (
          <button
            type="button"
            onClick={() => setImageUrl("")}
            className="shrink-0 px-1 text-[0.62rem] text-text-tertiary hover:text-midground"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-[0.62rem] text-text-tertiary hover:text-midground"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onSave({ letters, imageUrl: imageUrl || undefined });
            onClose();
          }}
          className="rounded bg-midground px-2 py-1 text-[0.62rem] text-white hover:brightness-110"
        >
          save
        </button>
      </div>
    </div>
  );
}
