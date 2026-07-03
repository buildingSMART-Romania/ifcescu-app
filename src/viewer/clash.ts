// Clash detection (geometric interference) between two sets of elements — pure,
// engine-free logic so it is unit-testable without WebGPU. The app feeds element
// AABBs (from the engine's retained per-element bounds) and, for the optional
// narrow phase, triangle soups (from the engine's retained per-element geometry).
//
// Pipeline: broad phase (uniform-grid AABB overlap) classifies each candidate
// pair as a "hard" clash (geometry overlaps on all axes beyond a tolerance) or a
// "clearance" clash (axis-aligned gap below a threshold). The optional narrow
// phase confirms hard candidates with a triangle-triangle intersection test,
// dropping the false positives an AABB-only test would keep.

export type V3 = [number, number, number];
export type ClashType = "hard" | "clearance";
export type ClashStatus = "new" | "active" | "resolved" | "approved" | "ignored";

/** One candidate element: its AABB (world coords) and, optionally, a flat
 *  triangle soup (9 floats per triangle: v0 xyz, v1 xyz, v2 xyz) for narrow phase. */
export interface ClashElement {
  id: number;
  model: string;
  min: V3;
  max: V3;
  tris?: Float32Array;
  guid?: string;
  label?: string;
}

export interface ClashOptions {
  /** Minimum overlap on every axis (world units) for a hard clash. */
  tolerance: number;
  /** Gap threshold (world units) for a clearance clash; null disables clearance. */
  clearance: number | null;
  /** Confirm hard candidates with a triangle-triangle test. */
  narrowPhase: boolean;
}

export interface ClashResult {
  /** Stable pair key (GUID-based when available, else id-based) for persistence. */
  key: string;
  /** Global id of the Set A element and the Set B element. */
  a: number;
  b: number;
  type: ClashType;
  /** Hard: smallest axis overlap. Clearance: the gap between the boxes. */
  penetration: number;
  /** Approximate clash location (world coords). */
  center: V3;
  status: ClashStatus;
  /** True when narrow phase was skipped (too many triangles) and the hard clash
   *  rests on the AABB test alone. */
  approximate?: boolean;
}

const EPS = 1e-7;

/** Order-independent pair key. */
export function pairKey(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function center3(min: V3, max: V3): V3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** Per-axis overlap of two AABBs (negative = separated on that axis). */
function axisOverlap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

/** Euclidean gap between two AABBs (0 when they touch or overlap). */
function aabbGap(a: ClashElement, b: ClashElement): number {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k], 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Median of the largest AABB dimension across all elements — a sensible grid cell. */
function medianCell(elems: ClashElement[]): number {
  const sizes: number[] = [];
  for (const e of elems) {
    sizes.push(Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2]));
  }
  if (!sizes.length) return 1;
  sizes.sort((p, q) => p - q);
  const m = sizes[Math.floor(sizes.length / 2)];
  return m > EPS ? m : 1;
}

/** Uniform spatial grid over Set B for broad-phase candidate lookup. */
class Grid {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly cell: number) {}

  private static key(ix: number, iy: number, iz: number): string {
    return `${ix},${iy},${iz}`;
  }

  insert(index: number, min: V3, max: V3): void {
    const c = this.cell;
    for (let ix = Math.floor(min[0] / c); ix <= Math.floor(max[0] / c); ix++)
      for (let iy = Math.floor(min[1] / c); iy <= Math.floor(max[1] / c); iy++)
        for (let iz = Math.floor(min[2] / c); iz <= Math.floor(max[2] / c); iz++) {
          const k = Grid.key(ix, iy, iz);
          const list = this.cells.get(k);
          if (list) list.push(index);
          else this.cells.set(k, [index]);
        }
  }

  /** Indices whose cells overlap the (optionally inflated) query box. */
  query(min: V3, max: V3, pad: number): Set<number> {
    const c = this.cell;
    const out = new Set<number>();
    for (let ix = Math.floor((min[0] - pad) / c); ix <= Math.floor((max[0] + pad) / c); ix++)
      for (let iy = Math.floor((min[1] - pad) / c); iy <= Math.floor((max[1] + pad) / c); iy++)
        for (let iz = Math.floor((min[2] - pad) / c); iz <= Math.floor((max[2] + pad) / c); iz++) {
          const list = this.cells.get(Grid.key(ix, iy, iz));
          if (list) for (const i of list) out.add(i);
        }
    return out;
  }
}

/** AABB-level classification of a candidate pair (no triangle test). */
function classifyAabb(a: ClashElement, b: ClashElement, opts: ClashOptions): { type: ClashType; penetration: number; center: V3 } | null {
  const ox = axisOverlap(a.min[0], a.max[0], b.min[0], b.max[0]);
  const oy = axisOverlap(a.min[1], a.max[1], b.min[1], b.max[1]);
  const oz = axisOverlap(a.min[2], a.max[2], b.min[2], b.max[2]);
  if (ox > opts.tolerance && oy > opts.tolerance && oz > opts.tolerance) {
    const lo: V3 = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
    const hi: V3 = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
    return { type: "hard", penetration: Math.min(ox, oy, oz), center: center3(lo, hi) };
  }
  if (opts.clearance != null) {
    const gap = aabbGap(a, b);
    if (gap <= opts.clearance) {
      const ca = center3(a.min, a.max);
      const cb = center3(b.min, b.max);
      return { type: "clearance", penetration: gap, center: [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2] };
    }
  }
  return null;
}

interface Candidate {
  a: ClashElement;
  b: ClashElement;
  type: ClashType;
  penetration: number;
  center: V3;
}

/** Broad phase only: grid-accelerated AABB overlap/clearance candidate pairs. */
function broadPhase(setA: ClashElement[], setB: ClashElement[], opts: ClashOptions): Candidate[] {
  const cell = Math.max(medianCell(setA), medianCell(setB));
  const grid = new Grid(cell);
  setB.forEach((e, i) => grid.insert(i, e.min, e.max));
  const pad = opts.clearance ?? 0;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const a of setA) {
    for (const bi of grid.query(a.min, a.max, pad)) {
      const b = setB[bi];
      if (a.id === b.id) continue; // never clash an element with itself
      const k = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const cls = classifyAabb(a, b, opts);
      if (cls) out.push({ a, b, ...cls });
    }
  }
  return out;
}

function resultKey(a: ClashElement, b: ClashElement): string {
  return pairKey(a.guid ?? `#${a.id}`, b.guid ?? `#${b.id}`);
}

// --- narrow phase: triangle-triangle ------------------------------------------

const MAX_TRI_PAIRS = 4_000_000; // guard: assume a clash rather than hang

/** Triangles (as [v0,v1,v2] world points) whose AABB meets the overlap box. */
function trisInBox(tris: Float32Array | undefined, lo: V3, hi: V3): V3[][] {
  const out: V3[][] = [];
  if (!tris) return out;
  for (let i = 0; i + 9 <= tris.length; i += 9) {
    const x0 = tris[i], y0 = tris[i + 1], z0 = tris[i + 2];
    const x1 = tris[i + 3], y1 = tris[i + 4], z1 = tris[i + 5];
    const x2 = tris[i + 6], y2 = tris[i + 7], z2 = tris[i + 8];
    if (Math.min(x0, x1, x2) > hi[0] || Math.max(x0, x1, x2) < lo[0]) continue;
    if (Math.min(y0, y1, y2) > hi[1] || Math.max(y0, y1, y2) < lo[1]) continue;
    if (Math.min(z0, z1, z2) > hi[2] || Math.max(z0, z1, z2) < lo[2]) continue;
    out.push([[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]]);
  }
  return out;
}

/** Tight AABB of a set of triangles (the region those triangles actually occupy). */
function tightBox(tris: V3[][]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let k = 0; k < 3; k++) {
    if (v[k] < min[k]) min[k] = v[k];
    if (v[k] > max[k]) max[k] = v[k];
  }
  return { min, max };
}

/**
 * Narrow-phase refinement of a hard candidate. Confirms the two triangle soups
 * actually intersect inside the overlap box, then measures the TRUE penetration
 * from the regions each element occupies there (not the inflated full-element
 * AABB overlap). A beam merely resting on a slab (coplanar contact) yields a
 * penetration of ~0, so the caller can drop it as touching rather than clashing.
 * `penetration: null` means it could not be refined (no triangles) — keep the
 * AABB estimate.
 */
function refineHard(a: ClashElement, b: ClashElement): { hit: boolean; approximate: boolean; penetration: number | null; center: V3 | null } {
  if (!a.tris || !b.tris) return { hit: true, approximate: true, penetration: null, center: null };
  const lo: V3 = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const hi: V3 = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
  const ta = trisInBox(a.tris, lo, hi);
  const tb = trisInBox(b.tris, lo, hi);
  if (!ta.length || !tb.length) return { hit: false, approximate: false, penetration: null, center: null };

  let approximate = false;
  let intersects = false;
  if (ta.length * tb.length > MAX_TRI_PAIRS) {
    intersects = true; approximate = true; // too heavy to confirm precisely → assume contact
  } else {
    for (const t1 of ta) { for (const t2 of tb) if (triTriIntersect(t1, t2)) { intersects = true; break; } if (intersects) break; }
  }
  if (!intersects) return { hit: false, approximate: false, penetration: null, center: null };

  // True penetration: overlap of the regions each element occupies in the contact
  // zone. Surface contact (touching) -> ~0; real interpenetration -> the embedment.
  const tA = tightBox(ta);
  const tB = tightBox(tb);
  const ox = axisOverlap(tA.min[0], tA.max[0], tB.min[0], tB.max[0]);
  const oy = axisOverlap(tA.min[1], tA.max[1], tB.min[1], tB.max[1]);
  const oz = axisOverlap(tA.min[2], tA.max[2], tB.min[2], tB.max[2]);
  const penetration = Math.max(0, Math.min(ox, oy, oz));
  const center: V3 = [
    (Math.max(tA.min[0], tB.min[0]) + Math.min(tA.max[0], tB.max[0])) / 2,
    (Math.max(tA.min[1], tB.min[1]) + Math.min(tA.max[1], tB.max[1])) / 2,
    (Math.max(tA.min[2], tB.min[2]) + Math.min(tA.max[2], tB.max[2])) / 2,
  ];
  return { hit: true, approximate, penetration, center };
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Moller triangle-triangle overlap test (1997). Rejects via each triangle's
 * supporting plane, then compares the intersection intervals the triangles cut
 * on the line where their planes meet. Coplanar pairs fall back to a 2D test.
 */
export function triTriIntersect(t1: V3[], t2: V3[]): boolean {
  const [v0, v1, v2] = t1;
  const [u0, u1, u2] = t2;

  const n1 = cross(sub(v1, v0), sub(v2, v0));
  const d1 = -dot(n1, v0);
  let du0 = dot(n1, u0) + d1;
  let du1 = dot(n1, u1) + d1;
  let du2 = dot(n1, u2) + d1;
  if (Math.abs(du0) < EPS) du0 = 0;
  if (Math.abs(du1) < EPS) du1 = 0;
  if (Math.abs(du2) < EPS) du2 = 0;
  const du0du1 = du0 * du1;
  const du0du2 = du0 * du2;
  if (du0du1 > 0 && du0du2 > 0) return false; // t2 entirely on one side of t1's plane

  const n2 = cross(sub(u1, u0), sub(u2, u0));
  const d2 = -dot(n2, u0);
  let dv0 = dot(n2, v0) + d2;
  let dv1 = dot(n2, v1) + d2;
  let dv2 = dot(n2, v2) + d2;
  if (Math.abs(dv0) < EPS) dv0 = 0;
  if (Math.abs(dv1) < EPS) dv1 = 0;
  if (Math.abs(dv2) < EPS) dv2 = 0;
  const dv0dv1 = dv0 * dv1;
  const dv0dv2 = dv0 * dv2;
  if (dv0dv1 > 0 && dv0dv2 > 0) return false; // t1 entirely on one side of t2's plane

  // Direction of the line of intersection of the two planes.
  const D = cross(n1, n2);
  let max = Math.abs(D[0]);
  let index = 0;
  if (Math.abs(D[1]) > max) { max = Math.abs(D[1]); index = 1; }
  if (Math.abs(D[2]) > max) index = 2;

  if (max < EPS) return coplanarTriTri(n1, t1, t2); // planes parallel → coplanar case

  const vp0 = v0[index], vp1 = v1[index], vp2 = v2[index];
  const up0 = u0[index], up1 = u1[index], up2 = u2[index];

  const i1 = computeInterval(vp0, vp1, vp2, dv0, dv1, dv2, dv0dv1, dv0dv2);
  if (!i1) return coplanarTriTri(n1, t1, t2);
  const i2 = computeInterval(up0, up1, up2, du0, du1, du2, du0du1, du0du2);
  if (!i2) return coplanarTriTri(n1, t1, t2);

  const [a1, b1] = i1[0] <= i1[1] ? i1 : [i1[1], i1[0]];
  const [a2, b2] = i2[0] <= i2[1] ? i2 : [i2[1], i2[0]];
  return !(b1 < a2 || b2 < a1);
}

/** Parametric interval the triangle cuts on the intersection line (projected to one axis). */
function computeInterval(
  vp0: number, vp1: number, vp2: number,
  d0: number, d1: number, d2: number,
  d0d1: number, d0d2: number,
): [number, number] | null {
  if (d0d1 > 0) return [isect(vp2, vp0, d2, d0), isect(vp2, vp1, d2, d1)]; // v2 alone on one side
  if (d0d2 > 0) return [isect(vp1, vp0, d1, d0), isect(vp1, vp2, d1, d2)]; // v1 alone
  if (d1 * d2 > 0 || d0 !== 0) return [isect(vp0, vp1, d0, d1), isect(vp0, vp2, d0, d2)]; // v0 alone
  if (d1 !== 0) return [isect(vp1, vp0, d1, d0), isect(vp1, vp2, d1, d2)];
  if (d2 !== 0) return [isect(vp2, vp0, d2, d0), isect(vp2, vp1, d2, d1)];
  return null; // triangle lies in the other plane → coplanar
}

function isect(vp0: number, vp1: number, d0: number, d1: number): number {
  return vp0 + (vp1 - vp0) * (d0 / (d0 - d1));
}

/** Coplanar triangle overlap: edge-edge crossing or one vertex inside the other. */
function coplanarTriTri(n: V3, t1: V3[], t2: V3[]): boolean {
  // Project onto the plane's dominant axis pair.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let i0 = 0, i1 = 1;
  if (ax > ay) {
    if (ax > az) { i0 = 1; i1 = 2; }
  } else if (ay > az) { i0 = 0; i1 = 2; }
  const p = (v: V3): [number, number] => [v[i0], v[i1]];
  const A = t1.map(p);
  const B = t2.map(p);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (segSeg(A[i], A[(i + 1) % 3], B[j], B[(j + 1) % 3])) return true;
  return pointInTri(A[0], B) || pointInTri(B[0], A);
}

function segSeg(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const d = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointInTri(pt: [number, number], tri: [number, number][]): boolean {
  const sign = (a: [number, number], b: [number, number], c: [number, number]) =>
    (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const d1 = sign(pt, tri[0], tri[1]);
  const d2 = sign(pt, tri[1], tri[2]);
  const d3 = sign(pt, tri[2], tri[0]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// --- public entry points ------------------------------------------------------

/** Turn a broad-phase candidate into a result, applying narrow-phase refinement
 *  (true penetration + touching filter) for hard clashes. Returns null to drop. */
function finalize(c: Candidate, opts: ClashOptions): ClashResult | null {
  let penetration = c.penetration;
  let center = c.center;
  let approximate = false;
  if (opts.narrowPhase && c.type === "hard") {
    const r = refineHard(c.a, c.b);
    if (!r.hit) return null;
    approximate = r.approximate;
    if (r.penetration !== null) {
      if (r.penetration <= opts.tolerance) return null; // surface contact, not a real clash
      penetration = r.penetration;
      center = r.center!;
    }
  }
  return {
    key: resultKey(c.a, c.b),
    a: c.a.id,
    b: c.b.id,
    type: c.type,
    penetration,
    center,
    status: "new",
    ...(approximate ? { approximate: true } : {}),
  };
}

/** Detect clashes between two element sets (synchronous; used by tests). */
export function detectClashes(setA: ClashElement[], setB: ClashElement[], opts: ClashOptions): ClashResult[] {
  const candidates = broadPhase(setA, setB, opts);
  const out: ClashResult[] = [];
  for (const c of candidates) {
    const r = finalize(c, opts);
    if (r) out.push(r);
  }
  return out;
}

/** How long the detection loop may run before yielding a macrotask (ms). */
const YIELD_EVERY_MS = 12;

/** Real macrotask yield. An awaited microtask (`Promise.resolve()`) never lets
 *  the browser paint, deliver input, or flip an abort flag mid-run — a timeout
 *  does. Shared with the UI layer so heavy pre-passes can yield the same way. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/** Async clash detection that yields to the event loop and reports progress so a
 *  large narrow-phase pass keeps the UI responsive and stays cancelable. */
export async function detectClashesAsync(
  setA: ClashElement[],
  setB: ClashElement[],
  opts: ClashOptions,
  hooks?: { onProgress?: (done: number, total: number) => void; signal?: { aborted: boolean } },
): Promise<ClashResult[]> {
  const candidates = broadPhase(setA, setB, opts);
  const out: ClashResult[] = [];
  const total = candidates.length;
  let deadline = performance.now() + YIELD_EVERY_MS;
  for (let i = 0; i < total; i++) {
    if (hooks?.signal?.aborted) break;
    const r = finalize(candidates[i], opts);
    if (r) out.push(r);
    if (performance.now() >= deadline) {
      hooks?.onProgress?.(i + 1, total);
      await yieldToEventLoop();
      deadline = performance.now() + YIELD_EVERY_MS;
    }
  }
  hooks?.onProgress?.(total, total);
  return out;
}

/** Re-apply previously chosen statuses (by stable pair key) to a fresh run. */
export function mergeStatuses(results: ClashResult[], prev: Map<string, ClashStatus>): ClashResult[] {
  return results.map((r) => {
    const s = prev.get(r.key);
    return s ? { ...r, status: s } : r;
  });
}
