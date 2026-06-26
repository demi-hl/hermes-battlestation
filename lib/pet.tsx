"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type PetState = "idle" | "wave" | "run" | "failed" | "review" | "jump" | "waiting";

export interface Pet {
  id: string;
  label: string;
  enabled: boolean;
  frames: string[];
  framesByState?: Partial<Record<PetState, string[]>>;
  loopMs?: number;
  frameW?: number;
  frameH?: number;
}

export interface PetGalleryItem {
  slug: string;
  displayName: string;
  installed: boolean;
  active: boolean;
  curated: boolean;
  spritesheetUrl: string;
}

const DEFAULT_PET: Pet = {
  id: "none",
  label: "Status dot",
  enabled: false,
  frames: [],
};

const PET_CHANGED = "pet-changed";

async function fetchPet(): Promise<Pet> {
  const res = await fetch("/api/pets?mode=info", { cache: "no-store" });
  if (!res.ok) return DEFAULT_PET;
  const data = (await res.json()) as { ok?: boolean; pet?: Partial<Pet> };
  if (!data.ok || !data.pet?.enabled || !Array.isArray(data.pet.frames)) return DEFAULT_PET;
  return {
    id: data.pet.id || "pet",
    label: data.pet.label || data.pet.id || "Pet",
    enabled: true,
    frames: data.pet.frames,
    framesByState: data.pet.framesByState,
    loopMs: data.pet.loopMs,
    frameW: data.pet.frameW,
    frameH: data.pet.frameH,
  };
}

export function usePet(): {
  pet: Pet;
  resolved: boolean;
  reloadPet: () => Promise<void>;
  setPetId: (id: string) => Promise<void>;
} {
  const [pet, setPet] = useState<Pet>(DEFAULT_PET);
  // False until the first fetch settles. The green-dot default and the pet
  // sprite are BOTH gated on this so we never flash the dot before the pet
  // loads in (the "bright green dot then it becomes the pet" artifact).
  const [resolved, setResolved] = useState(false);

  const reloadPet = useCallback(async () => {
    setPet(await fetchPet());
    setResolved(true);
  }, []);

  useEffect(() => {
    reloadPet();
    const sync = () => void reloadPet();
    window.addEventListener(PET_CHANGED, sync);
    const timer = window.setInterval(sync, 30_000);
    return () => {
      window.removeEventListener(PET_CHANGED, sync);
      window.clearInterval(timer);
    };
  }, [reloadPet]);

  const setPetId = useCallback(
    async (id: string) => {
      const off = id === "none";
      const res = await fetch("/api/pets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(off ? { action: "off" } : { action: "select", slug: id }),
      });
      if (!res.ok) throw new Error("pet update failed");
      const data = (await res.json()) as { ok?: boolean; error?: string; pet?: Pet };
      if (!data.ok) throw new Error(data.error || "pet update failed");
      setPet(data.pet?.enabled ? data.pet : DEFAULT_PET);
      window.dispatchEvent(new Event(PET_CHANGED));
    },
    [],
  );

  return { pet, resolved, reloadPet, setPetId };
}

export function PetSprite({
  pet,
  className,
  style,
  alt,
  active = false,
  state,
}: {
  pet: Pet;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  /** Agent is mid-turn — animate faster + brighter so you SEE it working. */
  active?: boolean;
  /** Activity row from the petdex sheet. Falls back to run while active. */
  state?: PetState;
}) {
  const effectiveState: PetState = state ?? (active ? "run" : "idle");
  const frames = pet.enabled ? (pet.framesByState?.[effectiveState] ?? pet.frames) : [];
  const [frame, setFrame] = useState(0);

  const delay = useMemo(() => {
    const loop = pet.loopMs && pet.loopMs > 0 ? pet.loopMs : 1100;
    const base = Math.max(90, Math.round(loop / Math.max(1, frames.length || 1)));
    // While the agent is responding, run ~2.4x faster (floored so it stays
    // smooth, not a strobe) — reads as an excited/working gait vs the calm idle.
    return active ? Math.max(45, Math.round(base / 2.4)) : base;
  }, [frames.length, pet.loopMs, active]);

  useEffect(() => {
    setFrame(0);
    if (frames.length <= 1) return;
    const t = window.setInterval(() => {
      setFrame((n) => (n + 1) % frames.length);
    }, delay);
    return () => window.clearInterval(t);
  }, [delay, frames.length, pet.id, effectiveState]);

  if (!frames.length) {
    return (
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", className)}
        style={{
          background: "var(--color-success)",
          boxShadow: "0 0 5px var(--color-success)",
          ...style,
        }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={frames[frame]}
      alt={alt ?? pet.label}
      aria-hidden={alt ? undefined : true}
      decoding="async"
      draggable={false}
      className={cn(
        "hermes-pet-sprite hermes-pet-sprite--petdex object-contain",
        active && "hermes-pet-sprite--active",
        className,
      )}
      style={style}
    />
  );
}
