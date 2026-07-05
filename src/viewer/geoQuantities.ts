// Geometry-derived quantities (IfcOpenShell-style: ifcopenshell.util.shape +
// the QtoCalculator naming). For models authored without IfcElementQuantity,
// compute per-element quantities from the retained triangle meshes and expose
// them under the STANDARD schema names of each class's Qto_ set (NetVolume,
// GrossFootprintArea, CrossSectionArea, …). Everything stays in SI (m/m²/m³)
// — the engine's world space and the app's uniform display convention; the
// write path converts into the file's declared units at the editor boundary
// (see ifc/unitScales.ts).
import { yieldToEventLoop } from "./clash";

/** One retained mesh part: indexed triangles, world-space (Y-up), metres. */
export interface GeoPart {
  pos: Float32Array;
  idx: Uint32Array;
}

/** The slice of ViewerEngine the calculator needs (structural, test-friendly). */
export interface GeometrySource {
  elementGeometryParts(id: number): GeoPart[] | null;
  elementBounds(id: number): { min: [number, number, number]; max: [number, number, number] } | null;
  /** Plan direction (unit [x,z]) of the element's LOCAL X axis from its
   *  placement chain — its own orientation. Optional. */
  elementAxisHint?(id: number): [number, number] | null;
}

// --- pure mesh math (equivalents of ifcopenshell.util.shape) ---------------

/** Volume of one mesh part via the divergence theorem: |Σ v0·(v1×v2)/6| over
 *  its triangles. The absolute value is taken PER PART because the tessellator
 *  does not guarantee a globally consistent winding — a part with uniformly
 *  flipped winding still yields the right magnitude. (A part with mixed winding
 *  would not; acceptable for the tessellated solids @ifc-lite emits.) */
export function partVolume(part: GeoPart): number {
  const { pos, idx } = part;
  let six = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    // a · (b × c)
    six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return Math.abs(six) / 6;
}

/** Total triangle area of one mesh part: Σ |cross(v1−v0, v2−v0)| / 2. */
export function partArea(part: GeoPart): number {
  const { pos, idx } = part;
  let sum = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    sum += Math.hypot(cx, cy, cz);
  }
  return sum / 2;
}

/** Horizontal-plane footprint: Σ of the plan-projected areas of upward-facing
 *  triangles (world is Y-up, so "plan" is the XZ plane and the projected area of
 *  a triangle is |cross.y|/2). Same approximation IfcOpenShell uses for
 *  get_footprint_area — overhanging faces stacked vertically double-count. */
export function partFootprintArea(part: GeoPart): number {
  const { pos, idx } = part;
  let sum = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cy = uz * vx - ux * vz; // y component of the cross product
    // Only up-facing triangles; winding is unreliable so classify by the true
    // normal magnitude: |cy| dominant over the full cross length ⇒ near-horizontal.
    const cx = uy * vz - uz * vy, cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len > 0 && Math.abs(cy) / len > 0.7) sum += Math.abs(cy) / 2;
  }
  // Both the top and the bottom cap of a closed solid are near-horizontal, so
  // the sum counts the footprint twice.
  return sum / 2;
}

/** Plan-oriented horizontal extents: the element's own axes, not the world's.
 *  A world-aligned bbox wildly overstates Length/Width for anything rotated in
 *  plan (a 20×3.6 m road at 45° reads as ~17×17 m), so find the dominant plan
 *  direction via area-weighted 2D PCA of the triangle centroids (the
 *  ifcopenshell.util.shape approach) and measure extents along it. */
export function planOrientedExtents(parts: GeoPart[]): { major: number; minor: number; majorDir: [number, number] } | null {
  // Pass 1: area-weighted mean + covariance of the SURFACE in plan (XZ), using
  // the exact per-triangle moment integrals — ∫f dA = (A/12)(Σfₖ + Σ·Σ) for a
  // bilinear f — so an asymmetric diagonal split of a face can't skew the axis
  // (centroid sampling does exactly that on a 2-triangle rectangle).
  let W = 0, mx = 0, mz = 0, sxx = 0, sxz = 0, szz = 0;
  for (const { pos, idx } of parts) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const w = Math.hypot(cx, cy, cz) / 2; // triangle area
      if (w <= 0) continue;
      const x1 = pos[a], x2 = pos[b], x3 = pos[c];
      const z1 = pos[a + 2], z2 = pos[b + 2], z3 = pos[c + 2];
      const sx = x1 + x2 + x3, sz = z1 + z2 + z3;
      W += w;
      mx += (w / 3) * sx;
      mz += (w / 3) * sz;
      sxx += (w / 12) * (x1 * x1 + x2 * x2 + x3 * x3 + sx * sx);
      szz += (w / 12) * (z1 * z1 + z2 * z2 + z3 * z3 + sz * sz);
      sxz += (w / 12) * (x1 * z1 + x2 * z2 + x3 * z3 + sx * sz);
    }
  }
  if (W <= 0) return null;
  mx /= W;
  mz /= W;
  sxx = sxx / W - mx * mx;
  sxz = sxz / W - mx * mz;
  szz = szz / W - mz * mz;
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ax = Math.cos(theta), az = Math.sin(theta);
  // Pass 2: extents of every vertex along the principal axis and its normal.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const { pos } of parts) {
    for (let i = 0; i < pos.length; i += 3) {
      const u = pos[i] * ax + pos[i + 2] * az;
      const v = -pos[i] * az + pos[i + 2] * ax;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  const e1 = maxU - minU, e2 = maxV - minV;
  // Report which plan direction the MAJOR extent runs along (u = principal
  // axis, v = its perpendicular) — the orientation-aware labeling needs it.
  const majorDir: [number, number] = e1 >= e2 ? [ax, az] : [-az, ax];
  return { major: Math.max(e1, e2), minor: Math.min(e1, e2), majorDir };
}

/** Intrinsic metrics of a thin, mostly-horizontal element (road course, slab,
 *  covering, ramp): derived from the TOP FACE of the mesh, so they follow
 *  curvature and slope — where straight-axis extents misread a curved road's
 *  chord as its length and its climb as its thickness. */
export interface PlateMetrics {
  /** True 3D area of the top face (net — openings subtracted), m². */
  area: number;
  /** Plate thickness: V / A (V = A·t for a thin plate) — NOT the bbox height,
   *  which a sloped element inflates by its climb. */
  thickness: number;
  /** OUTER boundary length of the top face (openings excluded), m. Absent when
   *  the outline can't be resolved into clean loops. */
  perimeter?: number;
  /** Ribbon arc length from the outer outline and the GROSS area (openings
   *  filled): P ≈ 2L+2w, A = L·w ⇒ L = (P+√(P²−16A))/4. Absent with perimeter. */
  length?: number;
  /** Ribbon width: A_gross / L. Absent with perimeter. */
  width?: number;
}

/** One closed boundary loop of the cap set: total edge length + its enclosed
 *  plan area (shoelace over XZ — world is Y-up). */
interface BoundaryLoop {
  len: number;
  planArea: number;
}

/** A validated outer outline: its length + the gross plan area it encloses. */
interface Outline {
  perimeter: number;
  grossPlanArea: number;
}

/** Detect a thin plate-like element and measure its top face. Returns null when
 *  the caps don't dominate the surface (a chunky solid) or the element isn't
 *  thin — callers then keep the straight-axis metrics. */
export function plateMetrics(parts: GeoPart[], volume: number, surfaceArea: number, footprintArea: number): PlateMetrics | null {
  if (!(surfaceArea > 0) || !(volume > 0)) return null;
  // Caps = triangles whose unit normal is mostly vertical (|ny| > 0.5 ⇒ slopes
  // up to ~60°). Two edge tallies are kept:
  //  - ALL caps (parity method): robust when top/bottom winding disagree, but
  //    blind on TAPERED rims — a layer whose thickness feathers to zero shares
  //    its outline vertices between the faces, so every rim edge counts twice
  //    and the outline vanishes (real motorway exports do this);
  //  - the POSITIVE side only (sign method): with the solid's consistent
  //    winding, cy>0 selects one face, whose parity boundary IS the rim even
  //    when tapered.
  const Q = 1e4; // 0.1 mm position quantization for welding the unshared soup
  const k = (x: number, y: number, z: number) => `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
  const edgesAll = new Map<string, BoundaryEdge>();
  const edgesPos = new Map<string, BoundaryEdge>();
  const vertexPos = new Map<string, [number, number]>(); // key → plan (x,z)
  let capArea = 0;
  let capPlanArea = 0; // plan projection of the caps — measures the mean slope
  for (const { pos, idx } of parts) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const clen = Math.hypot(cx, cy, cz);
      if (clen <= 0 || Math.abs(cy) / clen <= 0.5) continue;
      capArea += clen / 2;
      capPlanArea += Math.abs(cy) / 2;
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const kp = k(pos[p], pos[p + 1], pos[p + 2]);
        const kq = k(pos[q], pos[q + 1], pos[q + 2]);
        if (!vertexPos.has(kp)) vertexPos.set(kp, [pos[p], pos[p + 2]]);
        if (!vertexPos.has(kq)) vertexPos.set(kq, [pos[q], pos[q + 2]]);
        const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
        const len = Math.hypot(pos[p] - pos[q], pos[p + 1] - pos[q + 1], pos[p + 2] - pos[q + 2]);
        for (const m of cy > 0 ? [edgesAll, edgesPos] : [edgesAll]) {
          const e = m.get(key);
          if (e) e.n++;
          else m.set(key, { n: 1, len, ka: kp, kb: kq });
        }
      }
    }
  }
  // The caps (top+bottom) must dominate the surface, else it's a chunky solid
  // (a cube's caps are 1/3 of it) and the plate model doesn't apply.
  if (capArea < 0.5 * surfaceArea) return null;
  const area = capArea / 2;
  if (!(area > 0)) return null;
  const thickness = volume / area;
  if (thickness > 0.25 * Math.sqrt(area)) return null; // not thin

  // Try the parity outline first (mirrored top+bottom pairs), then the
  // sign-split outline (tapered rims). Both validate against the projected
  // face area, so a degenerate/fragmented outline degrades to {area, thickness}
  // and the callers keep the straight-axis extents for L/w.
  const outline =
    resolveOutline(edgesAll, vertexPos, footprintArea, "paired") ??
    resolveOutline(edgesPos, vertexPos, footprintArea, "single");
  if (!outline) return { area, thickness };
  const { perimeter, grossPlanArea } = outline;
  // The perimeter is a 3D length but the shoelace gross is plan-projected —
  // on a sloped plate (a ramp) the area deficit (~cos of the slope) would skew
  // the solve. De-project with the face's mean slope so both sides of the
  // ribbon equations live in the face's own plane. ~1 for flat plates.
  const gross = grossPlanArea * (capPlanArea > 0 ? capArea / capPlanArea : 1);
  const disc = perimeter * perimeter - 16 * gross;
  const length = disc >= 0 ? (perimeter + Math.sqrt(disc)) / 4 : Math.sqrt(gross);
  return { area, thickness, perimeter, length, width: gross / length };
}

interface BoundaryEdge {
  n: number;
  len: number;
  ka: string;
  kb: string;
}

/** Resolve one edge tally into a validated outer outline, or null. "paired"
 *  expects mirrored top+bottom loops (parity over both caps); "single" expects
 *  one face's loops (sign split). Validation rejects fragmented outlines
 *  (unwelded segment joints), oversized "openings" (a fragment in disguise)
 *  and outlines inconsistent with the projected face area. */
function resolveOutline(
  edges: Map<string, BoundaryEdge>,
  vertexPos: Map<string, [number, number]>,
  footprintArea: number,
  mode: "paired" | "single",
): Outline | null {
  const loops = traceLoops([...edges.values()].filter((e) => e.n % 2 === 1), vertexPos);
  if (!loops || !loops.length || loops.length > 18) return null;
  loops.sort((a, b) => b.planArea - a.planArea);
  let perimeter: number, gross: number, holes: BoundaryLoop[];
  if (mode === "paired") {
    if (loops.length < 2 || loops.length % 2 !== 0) return null;
    perimeter = (loops[0].len + loops[1].len) / 2;
    gross = (loops[0].planArea + loops[1].planArea) / 2;
    holes = loops.slice(2);
    // Outer dominance over the full loop set (each face contributes a copy).
    if (gross < 0.7 * (loops.reduce((s, l) => s + l.planArea, 0) / 2)) return null;
  } else {
    perimeter = loops[0].len;
    gross = loops[0].planArea;
    holes = loops.slice(1);
    if (gross < 0.7 * loops.reduce((s, l) => s + l.planArea, 0)) return null;
  }
  // Real openings are small relative to the outline; a big one is a fragment.
  for (const h of holes) if (h.planArea > 0.3 * gross) return null;
  // The outline must actually enclose the face (a tapered rim erased by parity
  // leaves sliver loops with ~zero plan area) …
  if (!(perimeter > 0) || gross < 0.6 * footprintArea) return null;
  // … and no planar region has a boundary shorter than its equivalent circle.
  if (perimeter * perimeter < 4 * Math.PI * gross * 0.999) return null;
  return { perimeter, grossPlanArea: gross };
}

/** Chain boundary edges into closed loops via their shared (quantized) vertices.
 *  Returns null when the outline is not a clean 2-regular graph (a vertex with
 *  ≠2 boundary edges, an open chain, …). */
function traceLoops(boundary: { len: number; ka: string; kb: string }[], vertexPos: Map<string, [number, number]>): BoundaryLoop[] | null {
  if (!boundary.length) return null;
  const adj = new Map<string, number[]>();
  for (let i = 0; i < boundary.length; i++) {
    for (const key of [boundary[i].ka, boundary[i].kb]) {
      const list = adj.get(key);
      if (list) list.push(i);
      else adj.set(key, [i]);
    }
  }
  for (const list of adj.values()) if (list.length !== 2) return null;
  const used = new Array(boundary.length).fill(false);
  const loops: BoundaryLoop[] = [];
  for (let start = 0; start < boundary.length; start++) {
    if (used[start]) continue;
    let len = 0, shoelace = 0;
    let edgeIdx = start;
    let vertex = boundary[start].ka;
    const startVertex = vertex;
    let steps = 0;
    do {
      if (used[edgeIdx] || ++steps > boundary.length) return null; // open/self-crossing chain
      used[edgeIdx] = true;
      const e = boundary[edgeIdx];
      const next = e.ka === vertex ? e.kb : e.ka;
      const [x1, z1] = vertexPos.get(vertex)!;
      const [x2, z2] = vertexPos.get(next)!;
      len += e.len;
      shoelace += x1 * z2 - x2 * z1;
      vertex = next;
      const [e1, e2] = adj.get(vertex)!;
      edgeIdx = used[e1] ? e2 : e1;
    } while (vertex !== startVertex);
    if (len > 1e-9) loops.push({ len, planArea: Math.abs(shoelace) / 2 });
  }
  return loops;
}

/** Base metrics of one element, all in metres. */
export interface GeoMetrics {
  volume: number;
  surfaceArea: number;
  footprintArea: number;
  /** Plan-oriented horizontal extents (element axes, rotation-proof) + the
   *  vertical extent. */
  lengthH: number; // major horizontal extent
  widthH: number; // minor horizontal extent
  height: number; // vertical extent
  /** Largest extent overall (beam-style "length"). */
  lengthMax: number;
  /** Present when the element is a thin, mostly-horizontal plate — curvature-
   *  and slope-proof dims for courses/slabs/coverings. */
  plate?: PlateMetrics;
}

export function elementMetrics(src: GeometrySource, id: number): GeoMetrics | null {
  const parts = src.elementGeometryParts(id);
  const bounds = src.elementBounds(id);
  if (!parts || !parts.length || !bounds) return null;
  let volume = 0, surfaceArea = 0, footprintArea = 0;
  for (const p of parts) {
    volume += partVolume(p);
    surfaceArea += partArea(p);
    footprintArea += partFootprintArea(p);
  }
  const ey = bounds.max[1] - bounds.min[1]; // vertical (world Y-up)
  const plan = planOrientedExtents(parts);
  // Degenerate meshes fall back to the world-aligned bbox extents.
  const lengthH = plan?.major ?? Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  const widthH = plan?.minor ?? Math.min(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  const plate = plateMetrics(parts, volume, surfaceArea, footprintArea) ?? undefined;

  // Orientation-aware Length/Width for plates of ambiguous aspect: shape alone
  // can't tell the travel direction of a road segment wider than it is long.
  // The placement chain can — in the observed infra authoring the element's
  // LOCAL X is transverse (across the road), so Length runs perpendicular to
  // it. Applied only to the plate path (courses/slabs) when the shape is
  // ambiguous (aspect < 3); strongly elongated ribbons keep the unambiguous
  // magnitude labeling (an atypical placement must not relabel a 270 m arc).
  if (plate?.length != null && plate.width != null && plan) {
    const hint = src.elementAxisHint?.(id);
    if (hint && plate.length / Math.max(plate.width, 1e-9) < 3) {
      const [mx, mz] = plan.majorDir;
      const alongHint = Math.abs(hint[0] * mx + hint[1] * mz);
      const acrossHint = Math.abs(-hint[0] * mz + hint[1] * mx);
      // The ribbon's L runs along the plan major axis; if that axis follows the
      // TRANSVERSE local X, the labels are flipped — swap them.
      if (alongHint > acrossHint) {
        const l = plate.length;
        plate.length = plate.width;
        plate.width = l;
      }
    }
  }

  return {
    volume,
    surfaceArea,
    footprintArea,
    lengthH,
    widthH,
    height: ey,
    lengthMax: Math.max(lengthH, ey),
    plate,
  };
}

// --- schema map: IFC class → standard Qto_ set + named quantities -----------

/** Quantity value kind — mirrors @ifc-lite/data's QuantityType categories.
 *  Drives both the write-back QuantityType and the m→project-unit exponent. */
export type GeoQtyKind = "length" | "area" | "volume";

export interface QtoDef {
  name: string;
  kind: GeoQtyKind;
  compute: (m: GeoMetrics) => number | null;
}

export interface ClassQto {
  /** Standard IfcElementQuantity set name (write-back target). */
  qset: string;
  quantities: QtoDef[];
}

const vol: QtoDef = { name: "NetVolume", kind: "volume", compute: (m) => m.volume };
const outerSurface: QtoDef = { name: "OuterSurfaceArea", kind: "area", compute: (m) => m.surfaceArea };
/** Cross-section = volume / length (the IfcOpenShell QtoCalculator shortcut). */
const crossSection = (len: (m: GeoMetrics) => number): QtoDef => ({
  name: "CrossSectionArea",
  kind: "area",
  compute: (m) => (len(m) > 1e-9 ? m.volume / len(m) : null),
});

/** Per-class quantity definitions, keyed by UPPERCASE IFC class. Classes not
 *  listed fall back to FALLBACK_QTO (display-only, no write-back qset). */
export const QTO_SCHEMA: Record<string, ClassQto> = {
  IFCWALL: {
    qset: "Qto_WallBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.lengthH },
      { name: "Width", kind: "length", compute: (m) => m.widthH },
      { name: "Height", kind: "length", compute: (m) => m.height },
      { name: "GrossFootprintArea", kind: "area", compute: (m) => m.footprintArea },
      { name: "NetSideArea", kind: "area", compute: (m) => m.lengthH * m.height },
      vol,
    ],
  },
  IFCSLAB: {
    qset: "Qto_SlabBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.plate?.length ?? m.lengthH },
      { name: "Width", kind: "length", compute: (m) => m.plate?.width ?? m.widthH },
      // Depth = slab thickness (official name); V/A is slope-proof where the
      // bbox height would add the ramp's climb.
      { name: "Depth", kind: "length", compute: (m) => m.plate?.thickness ?? m.height },
      { name: "Perimeter", kind: "length", compute: (m) => m.plate?.perimeter ?? null },
      { name: "NetArea", kind: "area", compute: (m) => m.plate?.area ?? m.footprintArea },
      vol,
    ],
  },
  IFCCOURSE: {
    qset: "Qto_CourseBaseQuantities",
    quantities: [
      // Road layers curve and climb: length/width/thickness derive from the top
      // face (arc-following), not from straight axes.
      { name: "Length", kind: "length", compute: (m) => m.plate?.length ?? m.lengthH },
      { name: "Width", kind: "length", compute: (m) => m.plate?.width ?? m.widthH },
      { name: "Depth", kind: "length", compute: (m) => m.plate?.thickness ?? m.height },
      { name: "NetArea", kind: "area", compute: (m) => m.plate?.area ?? m.footprintArea },
      vol,
    ],
  },
  IFCBEAM: {
    qset: "Qto_BeamBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.lengthMax },
      crossSection((m) => m.lengthMax),
      outerSurface,
      vol,
    ],
  },
  IFCMEMBER: {
    qset: "Qto_MemberBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.lengthMax },
      crossSection((m) => m.lengthMax),
      outerSurface,
      vol,
    ],
  },
  IFCCOLUMN: {
    qset: "Qto_ColumnBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.height },
      crossSection((m) => m.height),
      outerSurface,
      vol,
    ],
  },
  IFCPILE: {
    qset: "Qto_PileBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.height },
      crossSection((m) => m.height),
      outerSurface,
      vol,
    ],
  },
  IFCDOOR: {
    qset: "Qto_DoorBaseQuantities",
    quantities: [
      { name: "Width", kind: "length", compute: (m) => m.lengthH },
      { name: "Height", kind: "length", compute: (m) => m.height },
      { name: "Area", kind: "area", compute: (m) => m.lengthH * m.height },
    ],
  },
  IFCWINDOW: {
    qset: "Qto_WindowBaseQuantities",
    quantities: [
      { name: "Width", kind: "length", compute: (m) => m.lengthH },
      { name: "Height", kind: "length", compute: (m) => m.height },
      { name: "Area", kind: "area", compute: (m) => m.lengthH * m.height },
    ],
  },
  IFCCOVERING: {
    qset: "Qto_CoveringBaseQuantities",
    quantities: [
      // Covering thickness; a thin shell's two big faces ≈ the whole surface / 2.
      { name: "Width", kind: "length", compute: (m) => m.plate?.thickness ?? Math.min(m.widthH, m.height) },
      { name: "NetArea", kind: "area", compute: (m) => m.plate?.area ?? m.surfaceArea / 2 },
      vol,
    ],
  },
  IFCPLATE: {
    qset: "Qto_PlateBaseQuantities",
    quantities: [
      { name: "Width", kind: "length", compute: (m) => m.plate?.thickness ?? Math.min(m.widthH, m.height) },
      { name: "NetArea", kind: "area", compute: (m) => m.plate?.area ?? m.surfaceArea / 2 },
      vol,
    ],
  },
  IFCFOOTING: {
    qset: "Qto_FootingBaseQuantities",
    quantities: [
      { name: "Length", kind: "length", compute: (m) => m.lengthH },
      { name: "Width", kind: "length", compute: (m) => m.widthH },
      { name: "Height", kind: "length", compute: (m) => m.height },
      outerSurface,
      vol,
    ],
  },
  IFCROOF: {
    qset: "Qto_RoofBaseQuantities",
    quantities: [
      { name: "ProjectedArea", kind: "area", compute: (m) => m.footprintArea },
      // True (sloped) roof surface, when the shape reads as a thin plate.
      { name: "NetArea", kind: "area", compute: (m) => m.plate?.area ?? null },
      vol,
    ],
  },
};
// IfcWallStandardCase shares the wall definitions.
QTO_SCHEMA.IFCWALLSTANDARDCASE = QTO_SCHEMA.IFCWALL;

/** Generic fallback for classes without a hand-written mapping. Plate-like
 *  shapes (e.g. road layers modelled as IfcBuildingElementProxy) use the
 *  curvature/slope-proof top-face dims; chunky solids keep the axis extents. */
export const FALLBACK_QTO: QtoDef[] = [
  vol,
  outerSurface,
  // For plate-like shapes also report the single-face area — OuterSurfaceArea
  // is the whole shell (top+bottom+sides ≈ 2× the useful figure) and reads as
  // "aberrant" on thin layers.
  { name: "NetArea", kind: "area", compute: (m) => m.plate?.area ?? null },
  { name: "Length", kind: "length", compute: (m) => m.plate?.length ?? m.lengthH },
  { name: "Width", kind: "length", compute: (m) => m.plate?.width ?? m.widthH },
  { name: "Height", kind: "length", compute: (m) => m.plate?.thickness ?? m.height },
];

/** One element's computed quantities + its write-back target Qto set (null
 *  only when the class name is unusable). Values in SI (m/m²/m³). */
export interface ElementGeoQty {
  qset: string | null;
  values: Record<string, number>;
  kinds: Record<string, GeoQtyKind>;
}

/** Write-back set name for classes outside QTO_SCHEMA, following the official
 *  naming pattern (Qto_<Class>BaseQuantities). Expects a friendly PascalCase
 *  class name ("IfcCourse" → "Qto_CourseBaseQuantities"). */
export function deriveQsetName(cls: string): string | null {
  const rest = cls.replace(/^Ifc/i, "").trim();
  return /^[A-Za-z][A-Za-z0-9]*$/.test(rest) ? `Qto_${rest}BaseQuantities` : null;
}

export function computeForClass(cls: string, m: GeoMetrics): ElementGeoQty {
  const mapped = QTO_SCHEMA[cls.toUpperCase()];
  const defs = mapped?.quantities ?? FALLBACK_QTO;
  const values: Record<string, number> = {};
  const kinds: Record<string, GeoQtyKind> = {};
  for (const d of defs) {
    const v = d.compute(m);
    if (v != null && Number.isFinite(v) && v > 0) {
      values[d.name] = v;
      kinds[d.name] = d.kind;
    }
  }
  return { qset: mapped?.qset ?? deriveQsetName(cls), values, kinds };
}

// --- async runner (cooperative, cancellable) --------------------------------

/** How long the compute loop may run before yielding a macrotask (ms). */
const YIELD_EVERY_MS = 12;

/** Compute quantities for a set of elements. `ids` are the engine's GLOBAL ids;
 *  `classOf` resolves an id to its IFC class. Results stay in SI (m/m²/m³) —
 *  the app's display convention; the write path converts to the file's units
 *  (IfcEditor.setQuantity). Yields to the event loop so large models keep the
 *  UI responsive; honours `signal.aborted`. */
export async function computeGeoQuantities(
  src: GeometrySource,
  ids: number[],
  classOf: (id: number) => string,
  hooks?: { onProgress?: (done: number, total: number) => void; signal?: { aborted: boolean } },
): Promise<Map<number, ElementGeoQty>> {
  const out = new Map<number, ElementGeoQty>();
  const total = ids.length;
  let deadline = performance.now() + YIELD_EVERY_MS;
  for (let i = 0; i < total; i++) {
    if (hooks?.signal?.aborted) break;
    const id = ids[i];
    const metrics = elementMetrics(src, id);
    if (metrics) {
      const q = computeForClass(classOf(id), metrics);
      // Round to 3 decimals (mm precision in SI) — beyond both the accuracy of
      // a render mesh and what a bill of quantities needs.
      for (const name of Object.keys(q.values)) q.values[name] = Math.round(q.values[name] * 1000) / 1000;
      if (Object.keys(q.values).length) out.set(id, q);
    }
    if (performance.now() >= deadline) {
      hooks?.onProgress?.(i + 1, total);
      await yieldToEventLoop();
      deadline = performance.now() + YIELD_EVERY_MS;
    }
  }
  hooks?.onProgress?.(total, total);
  return out;
}
