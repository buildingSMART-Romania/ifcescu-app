// App settings singleton (persisted to localStorage). Mirrors the i18n pattern:
// non-React modules (e.g. viewer/measure) read getSettings() synchronously, while
// React code subscribes via ./react (useSettings). One JSON blob, deep-merged over
// DEFAULTS on load so blobs saved by older versions gain new keys without crashing.

export type LengthUnit = "m" | "cm" | "mm";
export type AreaUnit = "m2" | "ha";
export type Projection = "perspective" | "orthographic";
/** How the orbit pivot follows the selection: manual = only via C/frame (default),
 *  selection = pivot recenters on what you select without moving the camera,
 *  autoFrame = the camera flies to frame every new selection. */
export type PivotMode = "manual" | "selection" | "autoFrame";

export interface Settings {
  /** Experimental modules, off by default. Gates the Analytics module. */
  experimental: { analytics: boolean };
  units: { length: LengthUnit; area: AreaUnit; decimals: number };
  viewer: {
    /** Hex override for the 3D background; null = use the theme default. */
    background: string | null;
    navCube: boolean;
    viewBar: boolean;
    projection: Projection;
    snap: { vertex: boolean; midpoint: boolean; edge: boolean; face: boolean };
    /** Selection highlight colors: outline (silhouette) and an optional fill tint. */
    selection: { outline: string; fill: string | null };
    /** 3D navigation preferences. Speeds are multipliers on the default (1 = stock). */
    nav: {
      pivotMode: PivotMode;
      zoomSpeed: number;
      orbitSpeed: number;
      panSpeed: number;
      /** Double-click on an element selects and frames it. */
      dblClickFrame: boolean;
    };
  };
}

export const DEFAULTS: Settings = {
  experimental: { analytics: false },
  units: { length: "m", area: "m2", decimals: 3 },
  viewer: {
    background: null,
    navCube: true,
    viewBar: true,
    projection: "perspective",
    snap: { vertex: true, midpoint: true, edge: true, face: true },
    selection: { outline: "#bcf124", fill: null },
    nav: { pivotMode: "manual", zoomSpeed: 1, orbitSpeed: 1, panSpeed: 1, dblClickFrame: true },
  },
};

const KEY = "ifc-app-settings";

/** Deep-merge a stored (possibly partial / outdated) blob over the defaults. */
function merge(base: Settings, patch: any): Settings {
  if (!patch || typeof patch !== "object") return base;
  return {
    experimental: { ...base.experimental, ...patch.experimental },
    units: { ...base.units, ...patch.units },
    viewer: {
      ...base.viewer,
      ...patch.viewer,
      snap: { ...base.viewer.snap, ...(patch.viewer?.snap ?? {}) },
      selection: { ...base.viewer.selection, ...(patch.viewer?.selection ?? {}) },
      nav: { ...base.viewer.nav, ...(patch.viewer?.nav ?? {}) },
    },
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const merged = merge(DEFAULTS, JSON.parse(raw));
      // Experimental features are session-only: they always start disabled on app
      // load and must be re-enabled from Settings (so e.g. the Analytics panel never
      // appears just because it was on last time). Other settings persist.
      return { ...merged, experimental: { ...DEFAULTS.experimental } };
    }
  } catch {
    /* localStorage unavailable or corrupt JSON — fall back to defaults */
  }
  return DEFAULTS;
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

/** Apply a deep-partial patch, persist, and notify listeners. */
export function updateSettings(patch: any): void {
  current = merge(current, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((fn) => fn());
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
