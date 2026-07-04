// Dashboard persistence: one GLOBAL saved dashboard (cards + tile geometry) in
// localStorage. Filters/selections are deliberately session-only — restoring
// them would silently re-isolate the 3D scene on open. Field keys (class,
// material, qty:*) are stable across models; a card whose field is missing in
// the current model renders a "field missing" state instead of crashing.
import { useEffect, useRef } from "react";
import { parseDashboardState, type ChartCard, type Geo } from "../../viewer/analytics";

const KEY = "ifc-analytics:dashboard";

/** Load the saved dashboard, or null (absent / corrupt / other version). */
export function loadDashboard(): { cards: ChartCard[]; geo: Record<string, Geo> } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseDashboardState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function save(cards: ChartCard[], geo: Record<string, Geo>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cards, geo }));
  } catch {
    /* quota/private mode — the in-memory dashboard still works */
  }
}

/** Debounced auto-save; flushes the pending write on unmount so a quick
 *  dock-close never loses the last edit. */
export function useDashboardSave(cards: ChartCard[], geo: Record<string, Geo>): void {
  const latest = useRef({ cards, geo });
  latest.current = { cards, geo };
  useEffect(() => {
    const id = setTimeout(() => save(latest.current.cards, latest.current.geo), 400);
    return () => clearTimeout(id);
  }, [cards, geo]);
  useEffect(() => () => save(latest.current.cards, latest.current.geo), []);
}
