import { useCallback, useState } from "react";

/** Prefix for all persisted UI-layout keys (dock heights, panel widths). */
const PREFIX = "ifc-ui:";

type Updater<T> = T | ((prev: T) => T);

/**
 * Like useState<number> (or number|null), but the value survives reloads via
 * localStorage. Used for UI layout the user has adjusted — dock heights, the
 * tree/props panel widths — mirroring how settings/index.ts persists app
 * settings. Storage failures (private mode, quota) silently fall back to the
 * in-memory state.
 */
export function usePersistedNumber(key: string, initial: number): [number, (v: Updater<number>) => void];
export function usePersistedNumber(key: string, initial: number | null): [number | null, (v: Updater<number | null>) => void];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePersistedNumber(key: string, initial: any): any {
  const [value, setValue] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
    } catch {
      /* localStorage unavailable — use the default */
    }
    return initial;
  });
  const set = useCallback(
    (v: Updater<number | null>) =>
      setValue((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        try {
          if (next === null) localStorage.removeItem(PREFIX + key);
          else localStorage.setItem(PREFIX + key, String(next));
        } catch {
          /* ignore persistence failures */
        }
        return next;
      }),
    [key],
  );
  return [value, set];
}
