"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Pet feature — an optional sprite that replaces the app-session status dot.
// Lives next to the profile chip; the session timer stays. Choose/disable in
// Settings. Persisted to localStorage so it survives reloads and syncs across
// the app's surfaces (desktop / PWA / dashboard) on the same device.
// ---------------------------------------------------------------------------

export interface Pet {
  id: string;
  label: string;
  /** public/ path to a transparent sprite PNG, or null = the classic dot. */
  src: string | null;
}

export const PETS: Pet[] = [
  { id: "none", label: "Status dot", src: null },
  { id: "psycat", label: "Psycat", src: "/pets/psycat.png" },
];

export const DEFAULT_PET_ID = "none";

const STORAGE_KEY = "hermes-pet";

export function getPet(id: string): Pet {
  return PETS.find((p) => p.id === id) ?? PETS[0];
}

/** Read the persisted pet id once (safe pre-mount; returns default on SSR). */
function readStoredPetId(): string {
  if (typeof window === "undefined") return DEFAULT_PET_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_PET_ID;
  } catch {
    return DEFAULT_PET_ID;
  }
}

/**
 * usePet — the active pet + a setter. Persists to localStorage and listens for
 * `storage` (other tabs) and a same-tab `pet-changed` event so the ContextBar
 * and the Settings picker stay in sync without a shared store.
 */
export function usePet(): { pet: Pet; petId: string; setPetId: (id: string) => void } {
  const [petId, setPetIdState] = useState<string>(DEFAULT_PET_ID);

  useEffect(() => {
    setPetIdState(readStoredPetId());
    const sync = () => setPetIdState(readStoredPetId());
    window.addEventListener("storage", sync);
    window.addEventListener("pet-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("pet-changed", sync);
    };
  }, []);

  const setPetId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore quota / disabled storage */
    }
    setPetIdState(id);
    window.dispatchEvent(new Event("pet-changed"));
  }, []);

  return { pet: getPet(petId), petId, setPetId };
}
