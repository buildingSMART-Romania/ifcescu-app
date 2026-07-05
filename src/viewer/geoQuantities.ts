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
export function planOrientedExtents(parts: GeoPart[]): { major: number; minor: number } | null {
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
  return { major: Math.max(e1, e2), minor: Math.min(e1, e2) };
}

/** Intrinsic metrics of a thin, mostly-horizontal element (road course, slab,
 *  covering, ramp): derived from the TOP FACE of the mesh, so they follow
 *  curvature and slope — where straight-axis extents misread a curved road's
 *  chord as its length and its climb as its thickness. */
export interface PlateMetrics {
  /** True 3D area of the top face (not the plan projection), m². */
  area: number;
  /** Boundary length of the top face, m. */
  perimeter: number;
  /** Ribbon arc length: P ≈ 2L+2w and A = L·w ⇒ L = (P+√(P²−16A))/4. */
  length: number;
  /** Ribbon width: A / L. */
  width: number;
  /** Plate thickness: V / A (V = A·t for a thin plate) — NOT the bbox height,
   *  which a sloped element inflates by its climb. */
  thickness: number;
}

/** Detect a thin plate-like element and measure its top face. Returns null when
 *  the caps don't dominate the surface (a chunky solid) or the element isn't
 *  thin — callers then keep the straight-axis metrics. */
export function plateMetrics(parts: GeoPart[], volume: number, surfaceArea: number): PlateMetrics | null {
  if (!(surfaceArea > 0) || !(volume > 0)) return null;
  // Caps = triangles whose unit normal is mostly vertical (|ny| > 0.5 ⇒ slopes
  // up to ~60°). Winding is unreliable, so top and bottom can't be told apart —
  // both are collected and every total halves (they mirror each other; their
  // boundaries sit at different heights, so edge keys never collide).
  const Q = 1e4; // 0.1 mm position quantization for welding the unshared soup
  const k = (x: number, y: number, z: number) => `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
  const edges = new Map<string, { n: number; len: number }>();
  let capArea = 0;
  for (const { pos, idx } of parts) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const clen = Math.hypot(cx, cy, cz);
      if (clen <= 0 || Math.abs(cy) / clen <= 0.5) continue;
      capArea += clen / 2;
      // Count this triangle's edges; interior edges appear twice, boundary once.
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const kp = k(pos[p], pos[p + 1], pos[p + 2]);
        const kq = k(pos[q], pos[q + 1], pos[q + 2]);
        const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
        const e = edges.get(key);
        if (e) e.n++;
        else {
          edges.set(key, {
            n: 1,
            len: Math.hypot(pos[p] - pos[q], pos[p + 1] - pos[q + 1], pos[p + 2] - pos[q + 2]),
          });
        }
      }
    }
  }
  // The caps (top+bottom) must dominate the surface, else it's a chunky solid
  // (a cube's caps are 1/3 of it) and the plate model doesn't apply.
  if (capArea < 0.5 * surfaceArea) return null;
  let capPerimeter = 0;
  for (const e of edges.values()) if (e.n % 2 === 1) capPerimeter += e.len;
  const area = capArea / 2;
  const perimeter = capPerimeter / 2;
  if (!(area > 0) || !(perimeter > 0)) return null;
  const thickness = volume / area;
  if (thickness > 0.25 * Math.sqrt(area)) return null; // not thin
  const disc = perimeter * perimeter - 16 * area;
  const length = disc >= 0 ? (perimeter + Math.sqrt(disc)) / 4 : Math.sqrt(area);
  return { area, perimeter, length, width: area / length, thickness };
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
  return {
    volume,
    surfaceArea,
    footprintArea,
    lengthH,
    widthH,
    height: ey,
    lengthMax: Math.max(lengthH, ey),
    plate: plateMetrics(parts, volume, surfaceArea) ?? undefined,
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
