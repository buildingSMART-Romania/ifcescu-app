// Decide where an IFC model sits on the globe and produce localised ENU vertices
// for Cesium. Handles two input kinds, unified into "every point in Stereo 70":
//   - georef: IfcMapConversion present  → apply the map conversion
//   - real:   no map conversion, but the geometry is already in Romanian
//             Stereo 70 coordinates      → identity
// Vertical datum is always Marea Neagră 1975; ellipsoidal height = H + N (geoid).
import type { GeorefInfo } from "../ifc/editor";
import { STEREO70_BOUNDS } from "../ifc/constants";
import { stereo70ToWgs84, gridConvergenceDeg } from "./crs";
import { geoidUndulation, type GeoidGrid } from "./geoid";

export type PlacementMode = "georef" | "real" | "none";

export interface Placement {
  mode: PlacementMode;
  /** The georef actually applied to vertices. null when the geometry is already
   *  in real Stereo 70 coords (a contradictory IfcMapConversion is dropped). */
  appliedGeoref: GeorefInfo | null;
  anchorStereo70: { e: number; n: number; h: number };
  lonDeg: number;
  latDeg: number;
  geoidUndulation: number; // ζ at the anchor
  ellipsoidalH: number; // anchor H + ζ (WGS84 ellipsoidal)
  convergenceDeg: number;
}

/** Map an IFC model point (x,y,z) to Stereo 70 (Est, Nord, H). */
export function modelToStereo70(
  georef: GeorefInfo | null,
  x: number,
  y: number,
  z: number,
): { e: number; n: number; h: number } {
  if (!georef) return { e: x, n: y, h: z }; // "real" coordinates: identity
  const t = (georef.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return {
    e: georef.eastings + georef.scale * (x * c - y * s),
    n: georef.northings + georef.scale * (x * s + y * c),
    h: georef.height + z,
  };
}

/** True when a Stereo 70 point falls inside the Romanian CRS bounds (a proxy for
 *  "this model has a real-world location we can search around"). */
export function inRomania(e: number, n: number): boolean {
  const b = STEREO70_BOUNDS;
  return e >= b.eMin && e <= b.eMax && n >= b.nMin && n <= b.nMax;
}

export interface Bbox {
  minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number;
}

/**
 * Decide the placement of a model from its georef (or lack of it) and geometry
 * bounding box. Returns mode "none" when the model is neither georeferenced nor
 * already in Romanian Stereo 70 coordinates.
 */
export function computePlacement(georef: GeorefInfo | null, bbox: Bbox, grid: GeoidGrid | null): Placement {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const cz = (bbox.minZ + bbox.maxZ) / 2;

  // If the RAW geometry already sits inside Romania, it is authored in real
  // Stereo 70 coordinates — a present IfcMapConversion is then contradictory
  // (e.g. an offset with scale 0 that would fling it elsewhere). Drop it and
  // treat the geometry as real; otherwise apply the georef as given.
  const applied = georef && inRomania(cx, cy) ? null : georef;

  const anchor = modelToStereo70(applied, cx, cy, cz);

  // Placeable only when the resulting anchor is a real Romanian location. A model
  // with a degenerate/zero IfcMapConversion (or coords outside Romania) lands at
  // null island — treat it as "none" so the globe is disabled, not misplaced.
  let mode: PlacementMode;
  if (!inRomania(anchor.e, anchor.n)) mode = "none";
  else mode = applied ? "georef" : "real";

  if (mode === "none") {
    return {
      mode,
      appliedGeoref: applied,
      anchorStereo70: anchor,
      lonDeg: NaN, latDeg: NaN, geoidUndulation: NaN, ellipsoidalH: NaN, convergenceDeg: NaN,
    };
  }

  const { lonDeg, latDeg } = stereo70ToWgs84(anchor.e, anchor.n);
  const N = geoidUndulation(grid, lonDeg, latDeg);
  const convergenceDeg = gridConvergenceDeg(anchor.e, anchor.n);
  return {
    mode,
    appliedGeoref: applied,
    anchorStereo70: anchor,
    lonDeg,
    latDeg,
    geoidUndulation: N,
    ellipsoidalH: anchor.h + N,
    convergenceDeg,
  };
}

/**
 * Localise model vertices into the East-North-Up frame anchored at the
 * placement origin. Output is small Float32 offsets (metres) suitable for a
 * Cesium primitive whose modelMatrix is eastNorthUpToFixedFrame(anchor).
 * Grid offsets are rotated by the meridian convergence so the model aligns with
 * geodetic north.
 */
export function toEnuVertices(
  positions: Float64Array,
  placement: Placement,
): Float32Array {
  const { anchorStereo70: a, convergenceDeg, appliedGeoref } = placement;
  const g = (convergenceDeg * Math.PI) / 180;
  const cg = Math.cos(g), sg = Math.sin(g);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const p = modelToStereo70(appliedGeoref, positions[i], positions[i + 1], positions[i + 2]);
    const dE = p.e - a.e;
    const dN = p.n - a.n;
    out[i] = dE * cg + dN * sg; // East
    out[i + 1] = -dE * sg + dN * cg; // North
    out[i + 2] = p.h - a.h; // Up
  }
  return out;
}
