// Two-finger gestures, as pure math (unit-testable; the engine and the Viewer
// feed it pointer/touch positions).

export interface Pt {
  x: number;
  y: number;
}

/** Distance and midpoint of a two-finger contact. */
export interface Pinch {
  dist: number;
  cx: number;
  cy: number;
}

export function pinchOf(a: Pt, b: Pt): Pinch {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

/**
 * One step of a two-finger gesture on the 3D view: the factor to scale the
 * camera's distance by (fingers spread twice as far → half the distance, i.e.
 * the model follows the fingers) and the pan of the midpoint, in px.
 */
export function pinchStep(prev: Pinch, cur: Pinch): { distFactor: number; panDx: number; panDy: number } {
  const distFactor = prev.dist > 0 && cur.dist > 0 ? prev.dist / cur.dist : 1;
  return { distFactor, panDx: cur.cx - prev.cx, panDy: cur.cy - prev.cy };
}

/** @ifc-lite's camera.zoom(delta) scales the distance by (1 + delta * 0.0005),
 *  with |delta| capped at 100 (±5% per call) — measured. */
const ZOOM_PER_UNIT = 0.0005;
const ZOOM_MAX_DELTA = 100;

/** The camera.zoom deltas that scale the distance by `factor` (several calls
 *  when one step exceeds the camera's ±5% cap). */
export function zoomDeltas(factor: number): number[] {
  const out: number[] = [];
  let f = factor;
  for (let i = 0; i < 40 && Number.isFinite(f) && Math.abs(f - 1) > 1e-4; i++) {
    const d = Math.max(-ZOOM_MAX_DELTA, Math.min(ZOOM_MAX_DELTA, (f - 1) / ZOOM_PER_UNIT));
    out.push(d);
    f /= 1 + d * ZOOM_PER_UNIT;
  }
  return out;
}

/** Content zoom of a panel after pinching from `startDist` to `dist`, starting
 *  at `startZoom`; clamped to a readable range — 150% makes small text easy to
 *  read without blowing it up, 80% keeps it legible when shrinking. */
export function panelZoom(startZoom: number, startDist: number, dist: number, min = 0.8, max = 1.5): number {
  if (!(startDist > 0) || !(dist > 0)) return startZoom;
  return Math.min(max, Math.max(min, startZoom * (dist / startDist)));
}
