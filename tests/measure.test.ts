import { describe, it, expect } from "vitest";
import { modelToStereo70, distToSeg, pointInPoly, polygonArea, footOnPlane, planeAngleDeg, facesMeasurement, PARALLEL_DEG, MeasureTool } from "../src/viewer/measure";
import type { GeorefInfo } from "../src/ifc/editor";

describe("MeasureTool.undo", () => {
  // Just enough DOM + engine for the tool's state machine (no rendering here:
  // requestAnimationFrame never fires).
  const el = () => ({ setAttribute() {}, appendChild() {}, style: {} });
  (globalThis as any).document ??= { createElementNS: el, createElement: el };
  (globalThis as any).requestAnimationFrame ??= () => 0;
  (globalThis as any).cancelAnimationFrame ??= () => {};
  const engine = {
    snap: (x: number, y: number) => ({ point: { x, y, z: 0 }, type: "vertex" }),
    raycastFace: (x: number, y: number) => ({ point: { x, y, z: 0 }, normal: { x: 0, y: 0, z: 1 } }),
  };
  const tool = (mode: "length" | "area" | "faces") => {
    const m = new MeasureTool(engine as any, el() as any);
    m.setMode(mode);
    return m;
  };
  const click = (m: MeasureTool, x: number) => m.onClick({ clientX: x, clientY: x } as MouseEvent);
  const undoAll = (m: MeasureTool) => { let n = 0; while (m.undo()) n++; return n; };

  it("removes the point in progress first, then finished measurements, one per call", () => {
    const m = tool("length");
    click(m, 1); click(m, 2); // measurement 1
    click(m, 3); click(m, 4); // measurement 2
    click(m, 5); // 1st point of a 3rd, in progress
    expect(m.canUndo()).toBe(true);
    expect(undoAll(m)).toBe(3); // the pending point, then measurement 2, then 1
    expect(m.canUndo()).toBe(false);
    expect(m.undo()).toBe(false);
  });

  it("steps back through an area's points one by one", () => {
    const m = tool("area");
    click(m, 1); click(m, 2); click(m, 3);
    expect(undoAll(m)).toBe(3);
  });

  it("measurements round-trip through get/setMeasurements (session save/restore)", () => {
    const m = tool("length");
    click(m, 1); click(m, 2);
    const saved = m.getMeasurements();
    expect(saved).toHaveLength(1);
    const back = tool("length");
    back.setMeasurements(saved);
    expect(back.getMeasurements()).toEqual(saved);
    expect(back.undo()).toBe(true); // restored measurements can be undone too
    expect(back.canUndo()).toBe(false);
  });

  it("faces mode: undo drops the 1st picked face, so the next click starts over", () => {
    const m = tool("faces");
    click(m, 1); // 1st face
    expect(m.undo()).toBe(true); // dropped
    click(m, 2); click(m, 3); // a full measurement again (not finishing the old one)
    expect(undoAll(m)).toBe(1);
  });
});

const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unit = (x: number, y: number, z: number) => {
  const L = Math.hypot(x, y, z);
  return { x: x / L, y: y / L, z: z / L };
};

describe("measure.footOnPlane", () => {
  it("drops a point straight onto a horizontal plane", () => {
    const foot = footOnPlane({ x: 3, y: 7, z: -2 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(foot).toEqual({ x: 3, y: 2, z: -2 });
  });

  it("lands on a tilted plane, along its normal, at the shortest distance", () => {
    const n = unit(1, 1, 0); // plane x + y = 2 through (1,1,0)
    const p = { x: 4, y: 3, z: 5 };
    const foot = footOnPlane(p, { x: 1, y: 1, z: 0 }, n);
    expect(foot.x + foot.y).toBeCloseTo(2); // on the plane
    expect(foot.z).toBeCloseTo(5);
    expect(len(p, foot)).toBeCloseTo(5 / Math.SQRT2); // |4+3-2| / sqrt(2)
  });

  it("ignores the normal's direction and leaves points on the plane in place", () => {
    const q = { x: 0, y: 0, z: 1 };
    const a = footOnPlane({ x: 2, y: 2, z: 4 }, q, { x: 0, y: 0, z: 1 });
    const b = footOnPlane({ x: 2, y: 2, z: 4 }, q, { x: 0, y: 0, z: -1 });
    expect(a).toEqual(b);
    expect(footOnPlane({ x: 5, y: -1, z: 1 }, q, { x: 0, y: 0, z: 1 })).toEqual({ x: 5, y: -1, z: 1 });
  });
});

describe("measure.planeAngleDeg", () => {
  it("is 0° for parallel faces, including opposite faces of a wall", () => {
    expect(planeAngleDeg({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0);
    expect(planeAngleDeg({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBeCloseTo(0);
  });

  it("is 90° for a wall and a slab, and 45° for a 45° roof", () => {
    expect(planeAngleDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(planeAngleDeg({ x: 0, y: 1, z: 0 }, unit(1, 1, 0))).toBeCloseTo(45);
  });
});

describe("measure.facesMeasurement", () => {
  it("parallel faces: distance between the planes, wherever the 2nd face is clicked", () => {
    // Two faces of a 0.3 m wall: x = 0 and x = 0.3, clicked at different spots.
    const m = facesMeasurement(
      { point: { x: 0, y: 1, z: 2 }, normal: { x: -1, y: 0, z: 0 } },
      { point: { x: 0.3, y: 2.5, z: -4 }, normal: { x: 1, y: 0, z: 0 } },
    );
    expect(m.mode).toBe("faces");
    expect(len(m.pts[0], m.pts[1])).toBeCloseTo(0.3);
    expect(m.angle!).toBeLessThan(PARALLEL_DEG);
    expect(m.ext).toEqual({ x: 0, y: 1, z: 2 }); // dashed to the 1st face's pick
  });

  it("non-parallel faces: perpendicular from the 2nd point to the 1st plane, plus the angle", () => {
    const m = facesMeasurement(
      { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }, // floor y = 0
      { point: { x: 1, y: 2, z: 0 }, normal: unit(1, 1, 0) }, // sloped face
    );
    expect(len(m.pts[0], m.pts[1])).toBeCloseTo(2);
    expect(m.pts[1]).toEqual({ x: 1, y: 0, z: 0 });
    expect(m.angle!).toBeCloseTo(45);
  });
});

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
