// Geoid undulation lookup for the cotă (vertical) fix.
//
// IFC heights are Marea Neagră 1975 (normal/orthometric). Cesium positions by
// WGS84 ellipsoidal height. The separation is the geoid undulation N:
//   h_ellipsoidal = H_orthometric + N
// N comes from a small EGM2008 grid clipped to Romania (public/geoid/...).
// Black Sea 1975 vs EGM2008 geoid differ by only a few cm, so EGM2008 N is a
// decimeter-accurate stand-in for the Marea Neagră 1975 → ellipsoid offset.

export interface GeoidGrid {
  lonMin: number;
  latMin: number;
  dLon: number;
  dLat: number;
  cols: number;
  rows: number;
  values: number[]; // row-major, south→north (row 0 = latMin), west→east
}

/** Mid-country fallback if the grid asset can't be loaded. */
export const FALLBACK_UNDULATION = 36;

let gridPromise: Promise<GeoidGrid | null> | null = null;

/** Load the bundled Romania geoid grid once (relative to the app base URL). */
export function loadGeoidGrid(): Promise<GeoidGrid | null> {
  if (!gridPromise) {
    const url = import.meta.env.BASE_URL + "geoid/egm2008-ro.json";
    gridPromise = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<GeoidGrid>) : null))
      .catch(() => null);
  }
  return gridPromise;
}

/**
 * Bilinearly interpolate the geoid undulation N (metres) at lon/lat. Falls back
 * to FALLBACK_UNDULATION outside the grid or when the grid is missing.
 */
export function geoidUndulation(grid: GeoidGrid | null, lonDeg: number, latDeg: number): number {
  if (!grid) return FALLBACK_UNDULATION;
  const { lonMin, latMin, dLon, dLat, cols, rows, values } = grid;
  const fc = (lonDeg - lonMin) / dLon;
  const fr = (latDeg - latMin) / dLat;
  if (fc < 0 || fr < 0 || fc > cols - 1 || fr > rows - 1) return FALLBACK_UNDULATION;
  const c = Math.floor(fc);
  const r = Math.floor(fr);
  const tc = fc - c;
  const tr = fr - r;
  const c1 = Math.min(c + 1, cols - 1);
  const r1 = Math.min(r + 1, rows - 1);
  const v00 = values[r * cols + c];
  const v01 = values[r * cols + c1];
  const v10 = values[r1 * cols + c];
  const v11 = values[r1 * cols + c1];
  const top = v00 * (1 - tc) + v01 * tc;
  const bot = v10 * (1 - tc) + v11 * tc;
  return top * (1 - tr) + bot * tr;
}
