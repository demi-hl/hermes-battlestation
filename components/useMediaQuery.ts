import { useSyncExternalStore } from "react";

/** SSR-safe boolean media-query hook. Uses useSyncExternalStore so there's no
 *  setState-in-effect and no hydration mismatch (server snapshot = false). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
