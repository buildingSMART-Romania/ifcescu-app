import { describe, it, expect } from "vitest";
import { modelToStereo70, distToSeg, pointInPoly, polygonArea } from "../src/viewer/measure";
import type { GeorefInfo } from "../src/ifc/editor";

describe("measure.modelToStereo70", () => {
  it("is the identity when there is no georef", () => {
    expect(modelToStereo70(null, { x: 1.5, y: -2, z: 3 })).toEqual({ x: 1.5, y: -2, z: 3 });
  });

  it("applies rotation, scale and false easting/northing/height", () => {
    const g = { eastings: 100, northings: 200, height: 10, rotationDeg: 90, scale: 2 } as GeorefInfo;
    // 90°: (x,y) → (-y, x); scaled by 2, then shifted.
    const p = modelToStereo70(g, { x: 3, y: 4, z: 5 });
    expect(p.x).toBeCloseTo(100 + 2 * -4, 10);
    expect(p.y).toBeCloseTo(200 + 2 * 3, 10);
    expect(p.z).toBeCloseTo(15, 10);
  });

  it("keeps a zero-rotation unit-scale georef as a pure translation", () => {
    const g = { eastings: 500000, northings: 300000, height: 90, rotationDeg: 0, scale: 1 } as GeorefInfo;
    expect(modelToStereo70(g, { x: 10, y: 20, z: 1 })).toEqual({ x: 500010, y: 300020, z: 91 });
  });
});

describe("measure.distToSeg", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it("is zero on the segment and the perpendicular distance beside it", () => {
    expect(distToSeg(5, 0, a, b)).toBe(0);
    expect(distToSeg(5, 3, a, b)).toBeCloseTo(3, 10);
  });

  it("clamps to the endpoints beyond the segment ends", () => {
    expect(distToSeg(-3, 4, a, b)).toBeCloseTo(5, 10); // 3-4-5 to endpoint a
    expect(distToSeg(13, 4, a, b)).toBeCloseTo(5, 10); // 3-4-5 to endpoint b
  });

  it("degenerates to point distance when a === b", () => {
    expect(distToSeg(3, 4, a, a)).toBeCloseTo(5, 10);
  });
});

describe("measure.pointInPoly", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("detects inside vs outside for a square", () => {
    expect(pointInPoly(5, 5, square)).toBe(true);
    expect(pointInPoly(15, 5, square)).toBe(false);
    expect(pointInPoly(-1, -1, square)).toBe(false);
  });

  it("handles a concave (L-shaped) polygon", () => {
    const L = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 },
      { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPoly(2, 8, L)).toBe(true); // in the vertical arm
    expect(pointInPoly(8, 8, L)).toBe(false); // in the notch
  });
});

describe("measure.polygonArea", () => {
  it("measures a unit square and scales quadratically", () => {
    const sq = (s: number) => [
      { x: 0, y: 0, z: 0 }, { x: s, y: 0, z: 0 }, { x: s, y: s, z: 0 }, { x: 0, y: s, z: 0 },
    ];
    expect(polygonArea(sq(1))).toBeCloseTo(1, 10);
    expect(polygonArea(sq(3))).toBeCloseTo(9, 10);
  });

  it("is orientation-independent (Newell): a tilted rectangle keeps its true area", () => {
    // 2×3 rectangle in the plane z = y (45° tilt around X): width 2, height 3·√2.
    const r = 3 * Math.SQRT2;
    const rect = [
      { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 3 }, { x: 0, y: 3, z: 3 },
    ];
    expect(polygonArea(rect)).toBeCloseTo(2 * r, 10);
  });

  it("returns zero for degenerate polygons", () => {
    expect(polygonArea([{ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }])).toBe(0);
  });
});
