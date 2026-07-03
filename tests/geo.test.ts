import { describe, it, expect } from "vitest";
import { stereo70ToWgs84, wgs84ToStereo70, gridConvergenceDeg } from "../src/geo/crs";
import { geoidUndulation, type GeoidGrid } from "../src/geo/geoid";
import { computePlacement } from "../src/geo/placement";
import type { GeorefInfo } from "../src/ifc/editor";

describe("crs (Stereo 70 ↔ WGS84)", () => {
  it("reprojects a Romanian point into plausible lon/lat", () => {
    // Anchor of 4D_ST09 (Sibiu–Pitești area), Est≈472k / Nord≈402k.
    const { lonDeg, latDeg } = stereo70ToWgs84(472352, 402110);
    expect(lonDeg).toBeGreaterThan(20);
    expect(lonDeg).toBeLessThan(30);
    expect(latDeg).toBeGreaterThan(43);
    expect(latDeg).toBeLessThan(48);
  });

  it("round-trips Stereo 70 → WGS84 → Stereo 70 within 1 m", () => {
    const e = 500000, n = 450000;
    const { lonDeg, latDeg } = stereo70ToWgs84(e, n);
    const back = wgs84ToStereo70(lonDeg, latDeg);
    expect(Math.abs(back.eastings - e)).toBeLessThan(1);
    expect(Math.abs(back.northings - n)).toBeLessThan(1);
  });

  it("grid convergence near the central meridian is small, grows away", () => {
    const near = Math.abs(gridConvergenceDeg(500000, 500000)); // ~lon 25°, lat 46°
    expect(near).toBeLessThan(0.2);
    const west = Math.abs(gridConvergenceDeg(300000, 450000));
    expect(west).toBeGreaterThan(near);
    expect(west).toBeLessThan(5);
  });
});

describe("geoid undulation", () => {
  // Tiny synthetic grid (south→north, west→east) around Romania.
  const grid: GeoidGrid = {
    lonMin: 24, latMin: 45, dLon: 1, dLat: 1, cols: 2, rows: 2,
    values: [36, 38, 40, 42], // (45,24)=36 (45,25)=38 (46,24)=40 (46,25)=42
  };

  it("bilinearly interpolates inside the grid", () => {
    expect(geoidUndulation(grid, 24, 45)).toBeCloseTo(36, 6);
    expect(geoidUndulation(grid, 25, 46)).toBeCloseTo(42, 6);
    expect(geoidUndulation(grid, 24.5, 45.5)).toBeCloseTo(39, 6); // mean of corners
  });

  it("falls back outside the grid or when missing", () => {
    expect(geoidUndulation(grid, 10, 10)).toBe(36);
    expect(geoidUndulation(null, 25, 46)).toBe(36);
  });
});

describe("placement mode detection", () => {
  // Constant ζ=37 grid spanning all of Romania (lon 20–30, lat 43–49).
  const grid: GeoidGrid = {
    lonMin: 20, latMin: 43, dLon: 10, dLat: 6, cols: 2, rows: 2, values: [37, 37, 37, 37],
  };
  // Local bbox centred at origin (small coords).
  const localBbox = { minX: -50, minY: -50, minZ: 0, maxX: 50, maxY: 50, maxZ: 20 };
  // Real-coordinate bbox around Est 472k / Nord 402k.
  const realBbox = { minX: 472300, minY: 402060, minZ: 440, maxX: 472400, maxY: 402160, maxZ: 460 };

  it("uses georef when an IfcMapConversion is present", () => {
    const georef: GeorefInfo = { crsName: "EPSG:3844", eastings: 472350, northings: 402110, height: 450, rotationDeg: 0, scale: 1 };
    const p = computePlacement(georef, localBbox, grid);
    expect(p.mode).toBe("georef");
    expect(p.anchorStereo70.e).toBeCloseTo(472350, 0);
    expect(p.anchorStereo70.n).toBeCloseTo(402110, 0);
    expect(p.ellipsoidalH).toBeCloseTo(p.anchorStereo70.h + p.geoidUndulation, 3);
  });

  it("detects real Stereo 70 coordinates without georef", () => {
    const p = computePlacement(null, realBbox, grid);
    expect(p.mode).toBe("real");
    expect(p.anchorStereo70.e).toBeCloseTo(472350, 0);
    expect(p.lonDeg).toBeGreaterThan(20);
    expect(p.geoidUndulation).toBeCloseTo(37, 0);
  });

  it("returns 'none' for small local coords without georef", () => {
    const p = computePlacement(null, localBbox, grid);
    expect(p.mode).toBe("none");
  });

  it("ignores a contradictory IfcMapConversion when geometry is already real (Motorway case)", () => {
    // Real Stereo 70 geometry (~472k/402k = Curtea de Argeș) but a bogus map
    // conversion offsetting to Sfântu Gheorghe with scale 0. The real geometry
    // must win: anchor stays at the geometry, offset dropped.
    const bogus: GeorefInfo = { crsName: "EPSG:3844", eastings: 564194, northings: 482767, height: 0, rotationDeg: 0, scale: 1 };
    const p = computePlacement(bogus, realBbox, grid);
    expect(p.mode).toBe("real");
    expect(p.appliedGeoref).toBeNull();
    expect(p.anchorStereo70.e).toBeCloseTo(472350, 0);
    expect(p.anchorStereo70.n).toBeCloseTo(402110, 0);
  });

  it("georef and real coords agree on the same anchor", () => {
    const georef: GeorefInfo = { crsName: "EPSG:3844", eastings: 472350, northings: 402110, height: 450, rotationDeg: 0, scale: 1 };
    const a = computePlacement(georef, localBbox, grid);
    const b = computePlacement(null, realBbox, grid);
    expect(Math.abs(a.lonDeg - b.lonDeg)).toBeLessThan(1e-3);
    expect(Math.abs(a.latDeg - b.latDeg)).toBeLessThan(1e-3);
  });
});
