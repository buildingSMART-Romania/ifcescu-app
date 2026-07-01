// Coordinate reference transforms for the Cesium globe view.
//
// Romanian national CRS is Stereo 70 (EPSG:3844, Pulkovo 1942(58) / Stereo70).
// proj4 outputs/accepts [easting, northing]; in Romanian terms easting = Est (X)
// and northing = Nord (Y) — matching GeorefInfo.eastings / GeorefInfo.northings.
import proj4 from "proj4";

// EPSG:3844 with a 7-parameter Helmert to WGS84 (sub-2 m, fine for visual
// context; a .gsb grid would give cm but is out of scope).
const STEREO70_DEF =
  "+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 " +
  "+ellps=krass +towgs84=2.329,-147.042,-92.08,-0.309,0.325,0.497,5.69 +units=m +no_defs";

proj4.defs("EPSG:3844", STEREO70_DEF);
const WGS84 = "EPSG:4326";
const toWgs84 = proj4("EPSG:3844", WGS84);

export interface LonLat {
  lonDeg: number;
  latDeg: number;
}

/** Stereo 70 (Est, Nord) → WGS84 longitude/latitude in degrees. */
export function stereo70ToWgs84(eastings: number, northings: number): LonLat {
  const [lonDeg, latDeg] = toWgs84.forward([eastings, northings]);
  return { lonDeg, latDeg };
}

/** WGS84 lon/lat (degrees) → Stereo 70 (Est, Nord). */
export function wgs84ToStereo70(lonDeg: number, latDeg: number): { eastings: number; northings: number } {
  const [eastings, northings] = toWgs84.inverse([lonDeg, latDeg]);
  return { eastings, northings };
}

/**
 * Meridian (grid) convergence γ at a Stereo 70 point, in degrees: the angle
 * between Stereo 70 grid-north and geodetic (true) north. Positive when grid
 * north points east of true north. Computed numerically from a small north-step
 * in grid coordinates — robust for any projection without analytic formulas.
 */
export function gridConvergenceDeg(eastings: number, northings: number): number {
  const d = 100; // metres
  const a = stereo70ToWgs84(eastings, northings);
  const b = stereo70ToWgs84(eastings, northings + d); // due grid-north
  // Geodetic azimuth of the grid-north step (local equirectangular is plenty
  // accurate over 100 m). dx East, dy North.
  const cosLat = Math.cos((a.latDeg * Math.PI) / 180);
  const dEast = (b.lonDeg - a.lonDeg) * cosLat;
  const dNorth = b.latDeg - a.latDeg;
  // Azimuth from true north, clockwise: atan2(East, North).
  return (Math.atan2(dEast, dNorth) * 180) / Math.PI;
}
