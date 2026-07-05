import { describe, it, expect } from "vitest";
import { QuantityType } from "@ifc-lite/data";
import {
  FALLBACK_QTO,
  QTO_SCHEMA,
  computeForClass,
  computeGeoQuantities,
  deriveQsetName,
  elementMetrics,
  partArea,
  partFootprintArea,
  partVolume,
  plateMetrics,
  type GeoPart,
  type GeometrySource,
} from "../src/viewer/geoQuantities";
import { IfcEditor } from "../src/ifc/editor";

/** Axis-aligned box [0..w]×[0..h]×[0..d] (world Y-up: h is the height) with
 *  outward CCW winding — 8 vertices, 12 triangles. */
function box(w: number, h: number, d: number, flip = false): GeoPart {
  const pos = new Float32Array([
    0, 0, 0, w, 0, 0, w, h, 0, 0, h, 0, // back face corners (z=0)
    0, 0, d, w, 0, d, w, h, d, 0, h, d, // front face corners (z=d)
  ]);
  const tris = [
    0, 2, 1, 0, 3, 2, // z=0
    4, 5, 6, 4, 6, 7, // z=d
    0, 4, 7, 0, 7, 3, // x=0
    1, 2, 6, 1, 6, 5, // x=w
    0, 1, 5, 0, 5, 4, // y=0 (bottom)
    3, 7, 6, 3, 6, 2, // y=h (top)
  ];
  if (flip) for (let i = 0; i < tris.length; i += 3) [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
  return { pos, idx: new Uint32Array(tris) };
}

/** Closed curved+sloped ribbon (a road layer): circular arc of radius R over
 *  `theta` radians, width w, vertical thickness t, climbing `climb` metres end
 *  to end. World Y-up. N segments; top/bottom/walls/end caps — watertight. */
function ribbon(R: number, theta: number, w: number, t: number, climb: number, N = 256): GeoPart {
  const rings = N + 1;
  // 4 vertices per ring: bottom-inner, bottom-outer, top-inner, top-outer.
  const pos = new Float32Array(rings * 4 * 3);
  for (let i = 0; i < rings; i++) {
    const a = (theta * i) / N;
    const y = (climb * i) / N;
    const cos = Math.cos(a), sin = Math.sin(a);
    const set = (slot: number, r: number, yy: number) => {
      const o = (i * 4 + slot) * 3;
      pos[o] = r * cos;
      pos[o + 1] = yy;
      pos[o + 2] = r * sin;
    };
    set(0, R - w / 2, y);
    set(1, R + w / 2, y);
    set(2, R - w / 2, y + t);
    set(3, R + w / 2, y + t);
  }
  // Consistent OUTWARD winding — partVolume's per-part |signed sum| assumes the
  // tessellator's consistent orientation, so the fixture must honour it too.
  const idx: number[] = [];
  const v = (i: number, slot: number) => i * 4 + slot;
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let i = 0; i < N; i++) {
    quad(v(i, 2), v(i + 1, 2), v(i + 1, 3), v(i, 3)); // top (+Y)
    quad(v(i, 0), v(i, 1), v(i + 1, 1), v(i + 1, 0)); // bottom (−Y)
    quad(v(i, 0), v(i + 1, 0), v(i + 1, 2), v(i, 2)); // inner wall (−radial)
    quad(v(i, 1), v(i, 3), v(i + 1, 3), v(i + 1, 1)); // outer wall (+radial)
  }
  quad(v(0, 0), v(0, 2), v(0, 3), v(0, 1)); // start cap (−tangential)
  quad(v(N, 0), v(N, 1), v(N, 3), v(N, 2)); // end cap (+tangential)
  return { pos, idx: new Uint32Array(idx) };
}

/** Watertight plate W×D×t (world Y-up; plan = XZ) with a rectangular cutout
 *  [hx0,hx1]×[hz0,hz1]. Top/bottom are a 3×3 cell grid minus the centre cell;
 *  outer + hole walls close the solid. Consistent OUTWARD winding (hole walls
 *  face into the opening). */
function plateWithHole(W: number, D: number, t: number, hx0: number, hx1: number, hz0: number, hz1: number): GeoPart {
  const pos: number[] = [];
  const idx: number[] = [];
  const P = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const i0 = P(a[0], a[1], a[2]), i1 = P(b[0], b[1], b[2]), i2 = P(c[0], c[1], c[2]), i3 = P(d[0], d[1], d[2]);
    idx.push(i0, i1, i2, i0, i2, i3);
  };
  const xs = [0, hx0, hx1, W];
  const zs = [0, hz0, hz1, D];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue; // the opening
      const xa = xs[i], xb = xs[i + 1], za = zs[j], zb = zs[j + 1];
      quad([xa, t, za], [xa, t, zb], [xb, t, zb], [xb, t, za]); // top (+Y)
      quad([xa, 0, za], [xb, 0, za], [xb, 0, zb], [xa, 0, zb]); // bottom (−Y)
    }
  }
  // Outer walls (outward normals −X / +X / −Z / +Z).
  quad([0, 0, 0], [0, 0, D], [0, t, D], [0, t, 0]);
  quad([W, 0, 0], [W, t, 0], [W, t, D], [W, 0, D]);
  quad([0, 0, 0], [0, t, 0], [W, t, 0], [W, 0, 0]);
  quad([0, 0, D], [W, 0, D], [W, t, D], [0, t, D]);
  // Hole walls (outward = into the opening: +X / −X / +Z / −Z).
  quad([hx0, 0, hz0], [hx0, t, hz0], [hx0, t, hz1], [hx0, 0, hz1]);
  quad([hx1, 0, hz0], [hx1, 0, hz1], [hx1, t, hz1], [hx1, t, hz0]);
  quad([hx0, 0, hz0], [hx1, 0, hz0], [hx1, t, hz0], [hx0, t, hz0]);
  quad([hx0, 0, hz1], [hx0, t, hz1], [hx1, t, hz1], [hx1, 0, hz1]);
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

/** Tapered ("feathered") plate: L×D in plan, top height h·sin(πx/L) — the
 *  thickness feathers to ZERO at both ends, so the top face meets the bottom
 *  face at the rim and shares its vertices (the real motorway-layer case that
 *  erases the outline from the parity boundary). Consistent outward winding. */
function taperedPlate(L: number, D: number, h: number, N = 64): GeoPart {
  const pos: number[] = [];
  const idx: number[] = [];
  const P = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const emit = (a: number[], b: number[], c: number[], d: number[]) => {
    const i0 = P(a[0], a[1], a[2]), i1 = P(b[0], b[1], b[2]), i2 = P(c[0], c[1], c[2]), i3 = P(d[0], d[1], d[2]);
    idx.push(i0, i1, i2, i0, i2, i3);
  };
  const y = (x: number) => h * Math.sin((Math.PI * x) / L);
  for (let i = 0; i < N; i++) {
    const xa = (L * i) / N, xb = (L * (i + 1)) / N;
    const ya = y(xa), yb = y(xb);
    emit([xa, ya, 0], [xa, ya, D], [xb, yb, D], [xb, yb, 0]); // top (+Y)
    emit([xa, 0, 0], [xb, 0, 0], [xb, 0, D], [xa, 0, D]); // bottom (−Y)
    emit([xa, 0, 0], [xa, ya, 0], [xb, yb, 0], [xb, 0, 0]); // wall z=0 (−Z)
    emit([xa, 0, D], [xb, 0, D], [xb, yb, D], [xa, ya, D]); // wall z=D (+Z)
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

const boundsOf = (parts: GeoPart[]) => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of parts) {
    for (let i = 0; i < pos.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], pos[i + a]);
        max[a] = Math.max(max[a], pos[i + a]);
      }
    }
  }
  return { min, max };
};

/** In-memory GeometrySource over id → parts (optionally with local-X axis hints). */
function srcOf(map: Record<number, GeoPart[]>, hints?: Record<number, [number, number]>): GeometrySource {
  return {
    elementGeometryParts: (id) => map[id] ?? null,
    elementBounds: (id) => (map[id] ? boundsOf(map[id]) : null),
    elementAxisHint: (id) => hints?.[id] ?? null,
  };
}

describe("mesh math (ifcopenshell.util.shape equivalents)", () => {
  const cube = box(2, 3, 4); // 2 wide (x) × 3 high (y) × 4 deep (z)

  it("volume, surface area and footprint of a 2×3×4 box", () => {
    expect(partVolume(cube)).toBeCloseTo(24, 6);
    expect(partArea(cube)).toBeCloseTo(52, 6); // 2·(2·3 + 3·4 + 2·4)
    expect(partFootprintArea(cube)).toBeCloseTo(8, 6); // plan projection 2×4
  });

  it("volume is winding-robust (a fully flipped mesh keeps its magnitude)", () => {
    expect(partVolume(box(2, 3, 4, true))).toBeCloseTo(24, 6);
  });

  it("multi-part elements sum per part", () => {
    const m = elementMetrics(srcOf({ 1: [box(1, 1, 1), box(1, 1, 1)] }), 1)!;
    expect(m.volume).toBeCloseTo(2, 6);
    expect(m.surfaceArea).toBeCloseTo(12, 6);
  });

  it("dims: horizontal major/minor + vertical height", () => {
    const m = elementMetrics(srcOf({ 1: [cube] }), 1)!;
    expect(m.lengthH).toBeCloseTo(4, 6); // max(x=2, z=4)
    expect(m.widthH).toBeCloseTo(2, 6);
    expect(m.height).toBeCloseTo(3, 6);
    expect(m.lengthMax).toBeCloseTo(4, 6);
  });

  it("plan-rotated elements keep their own Length/Width (oriented, not world bbox)", () => {
    // The same 2×3×4 box rotated 30° around the vertical axis: a world-aligned
    // bbox would report ~4.46×3.73 in plan; the oriented extents must stay 4×2.
    const rot = box(2, 3, 4);
    const cos = Math.cos(Math.PI / 6), sin = Math.sin(Math.PI / 6);
    for (let i = 0; i < rot.pos.length; i += 3) {
      const x = rot.pos[i], z = rot.pos[i + 2];
      rot.pos[i] = x * cos - z * sin;
      rot.pos[i + 2] = x * sin + z * cos;
    }
    const m = elementMetrics(srcOf({ 1: [rot] }), 1)!;
    expect(m.lengthH).toBeCloseTo(4, 4);
    expect(m.widthH).toBeCloseTo(2, 4);
    expect(m.height).toBeCloseTo(3, 6);
    expect(m.volume).toBeCloseTo(24, 5); // rotation-invariant
  });
});

describe("plate metrics (curvature- and slope-proof top-face dims)", () => {
  it("a curved, climbing road layer reads its ARC length and TRUE thickness", () => {
    // 270 m arc (R=100, θ=2.7), 27 m wide, 4 cm thick, climbing 1 m end-to-end.
    // Straight-axis extents would read the ~250 m chord and a ~1 m "height".
    const road = ribbon(100, 2.7, 27, 0.04, 1);
    const m = elementMetrics(srcOf({ 1: [road] }), 1)!;
    expect(m.plate).toBeDefined();
    expect(m.plate!.length).toBeCloseTo(270, 0); // R·θ, follows the curve
    expect(m.plate!.width).toBeCloseTo(27, 1);
    expect(m.plate!.thickness).toBeCloseTo(0.04, 3); // NOT the 1 m climb
    expect(m.plate!.area).toBeCloseTo(270 * 27, -2); // ±50 m² on 7290
    // The bbox height really is ~1 m — proving the plate path is what fixes it.
    expect(m.height).toBeGreaterThan(0.9);
  });

  it("a flat rectangular plate solves exactly", () => {
    const p = box(3.6, 0.04, 20); // 3.6 × 20 m, 4 cm thick
    const m = plateMetrics([p], partVolume(p), partArea(p), partFootprintArea(p))!;
    expect(m.length).toBeCloseTo(20, 4);
    expect(m.width).toBeCloseTo(3.6, 4);
    expect(m.thickness).toBeCloseTo(0.04, 6);
    expect(m.perimeter).toBeCloseTo(47.2, 4);
    expect(m.area).toBeCloseTo(72, 4);
  });

  it("a plate with a cutout uses the OUTER outline + gross area for L/w", () => {
    // 3.6 × 2.611 m, 4 cm thick, with a 1 × 0.7 m opening (the Infra bridge
    // course case): the opening must NOT inflate the perimeter or shrink the
    // solve — L/w stay the outline dims, NetArea stays net.
    const p = plateWithHole(3.6, 2.611, 0.04, 1.3, 2.3, 0.955, 1.655);
    const m = plateMetrics([p], partVolume(p), partArea(p), partFootprintArea(p))!;
    expect(m.perimeter).toBeCloseTo(2 * (3.6 + 2.611), 3); // outer only
    expect(m.length).toBeCloseTo(3.6, 1);
    expect(m.width).toBeCloseTo(2.611, 1);
    expect(m.area).toBeCloseTo(3.6 * 2.611 - 0.7, 3); // net (opening subtracted)
    expect(m.thickness).toBeCloseTo(0.04, 6);
  });

  it("the placement axis relabels Length/Width on ambiguous plates (local X = transverse)", () => {
    // A road segment WIDER (3.6 m, along plan X) than long (2.611 m): shape
    // alone labels the 3.6 as Length. The placement hint says local X runs
    // along the 3.6 direction — which is transverse — so Length must be 2.611.
    const p = plateWithHole(3.6, 2.611, 0.04, 1.3, 2.3, 0.955, 1.655);
    const m = elementMetrics(srcOf({ 1: [p] }, { 1: [1, 0] }), 1)!;
    expect(m.plate!.length).toBeCloseTo(2.611, 1);
    expect(m.plate!.width).toBeCloseTo(3.6, 1);
    // Hint along the travel direction → no swap.
    const m2 = elementMetrics(srcOf({ 1: [p] }, { 1: [0, 1] }), 1)!;
    expect(m2.plate!.length).toBeCloseTo(3.6, 1);
    // No hint → magnitude labeling (the existing behaviour).
    const m3 = elementMetrics(srcOf({ 1: [p] }), 1)!;
    expect(m3.plate!.length).toBeCloseTo(3.6, 1);
  });

  it("strongly elongated ribbons ignore an atypical placement hint (aspect ≥ 3)", () => {
    const road = ribbon(100, 2.7, 27, 0.04, 1);
    const m = elementMetrics(srcOf({ 1: [road] }, { 1: [1, 0] }), 1)!;
    expect(m.plate!.length).toBeCloseTo(270, 0); // the arc stays the Length
  });

  it("an unwelded (fragmented) top face keeps area/thickness but drops the L/w split", () => {
    // A 20 × 3.6 m layer tessellated as 4 abutting segments with 1 mm gaps at
    // the joints (over the 0.1 mm weld quantization — the real-world motorway
    // export case): each fragment closes its own boundary loop, so the outer
    // outline is unknowable. Area/thickness stay exact; L/w must be dropped
    // (the caller then falls back to the plan-oriented extents).
    const seg = () => box(5, 0.04, 3.6);
    const parts: GeoPart[] = [0, 1, 2, 3].map((i) => {
      const p = seg();
      for (let j = 0; j < p.pos.length; j += 3) p.pos[j] += i * 5.001;
      return p;
    });
    const vol = parts.reduce((s, p) => s + partVolume(p), 0);
    const surf = parts.reduce((s, p) => s + partArea(p), 0);
    const m = plateMetrics(parts, vol, surf, parts.reduce((s, p) => s + partFootprintArea(p), 0))!;
    expect(m.area).toBeCloseTo(72, 3); // 4 × 5 × 3.6
    expect(m.thickness).toBeCloseTo(0.04, 6);
    expect(m.length).toBeUndefined();
    expect(m.width).toBeUndefined();
    expect(m.perimeter).toBeUndefined();
    // End-to-end: the class mapping falls back to the plan-oriented extents.
    const q = computeForClass("IfcCourse", elementMetrics(srcOf({ 1: parts }), 1)!);
    expect(q.values.Length).toBeCloseTo(20, 0); // PCA major (chord)
    expect(q.values.Depth).toBeCloseTo(0.04, 6); // still the exact V/A thickness
    expect(q.values.NetArea).toBeCloseTo(72, 3);
  });

  it("unequal fragmentation (70/30) is detected too — a huge 'opening' means unwelded", () => {
    const a = box(14, 0.04, 3.6);
    const b = box(6, 0.04, 3.6);
    for (let j = 0; j < b.pos.length; j += 3) b.pos[j] += 14.001; // 1 mm joint gap
    const vol = partVolume(a) + partVolume(b);
    const surf = partArea(a) + partArea(b);
    const m = plateMetrics([a, b], vol, surf, partFootprintArea(a) + partFootprintArea(b))!;
    expect(m.area).toBeCloseTo(72, 3);
    expect(m.thickness).toBeCloseTo(0.04, 6);
    expect(m.length).toBeUndefined(); // not solvable — falls back to PCA dims
  });

  it("a feathered (tapered-rim) layer resolves its outline via the normal-sign split", () => {
    // Thickness goes to zero at both ends: top and bottom share the rim
    // vertices, so the parity boundary erases the outline (its only loops are
    // zero-area slivers along the sides). The sign split must recover it.
    const p = taperedPlate(20, 3.6, 0.4);
    const m = plateMetrics([p], partVolume(p), partArea(p), partFootprintArea(p))!;
    expect(m.length).toBeCloseTo(20, 0);
    expect(m.width).toBeCloseTo(3.6, 1);
    expect(m.perimeter).toBeCloseTo(2 * (20 + 3.6), 0);
    // thickness = V/A = mean height of the sine profile: h·2/π
    expect(m.thickness).toBeCloseTo(0.4 * (2 / Math.PI), 2);
  });

  it("a chunky solid is NOT a plate (keeps the straight-axis dims)", () => {
    const c = box(2, 3, 4);
    expect(plateMetrics([c], partVolume(c), partArea(c), partFootprintArea(c))).toBeNull();
  });

  it("the fallback mapping uses plate dims for plate-like proxies", () => {
    const road = ribbon(100, 2.7, 27, 0.04, 1);
    const m = elementMetrics(srcOf({ 1: [road] }), 1)!;
    const q = computeForClass("IfcBuildingElementProxy", m);
    expect(q.values.Length).toBeCloseTo(270, 0);
    expect(q.values.Height).toBeCloseTo(0.04, 3);
    expect(q.values.NetArea).toBeCloseTo(270 * 27, -2); // single face, not the shell
    // Chunky solids get no NetArea (only the shell's OuterSurfaceArea applies).
    const cubeQ = computeForClass("IfcThing", elementMetrics(srcOf({ 1: [box(2, 3, 4)] }), 1)!);
    expect(cubeQ.values.NetArea).toBeUndefined();
    expect(cubeQ.values.OuterSurfaceArea).toBeCloseTo(52, 5);
  });

  it("IfcCourse maps to Qto_CourseBaseQuantities with arc dims", () => {
    const road = ribbon(100, 2.7, 27, 0.04, 1);
    const m = elementMetrics(srcOf({ 1: [road] }), 1)!;
    const q = computeForClass("IfcCourse", m);
    expect(q.qset).toBe("Qto_CourseBaseQuantities");
    expect(q.values.Length).toBeCloseTo(270, 0);
    expect(q.values.Depth).toBeCloseTo(0.04, 3);
    expect(q.values.NetArea).toBeCloseTo(270 * 27, -2);
  });
});

describe("QTO_SCHEMA class mapping", () => {
  const metrics = elementMetrics(srcOf({ 1: [box(2, 3, 4)] }), 1)!;

  it("IfcWall maps to Qto_WallBaseQuantities with the standard names", () => {
    const q = computeForClass("IfcWall", metrics);
    expect(q.qset).toBe("Qto_WallBaseQuantities");
    expect(q.values.NetVolume).toBeCloseTo(24, 6);
    expect(q.values.Length).toBeCloseTo(4, 6);
    expect(q.values.Width).toBeCloseTo(2, 6);
    expect(q.values.Height).toBeCloseTo(3, 6);
    expect(q.values.GrossFootprintArea).toBeCloseTo(8, 6);
    expect(q.values.NetSideArea).toBeCloseTo(12, 6); // 4 × 3
    expect(q.kinds.NetVolume).toBe("volume");
    expect(q.kinds.NetSideArea).toBe("area");
    expect(q.kinds.Length).toBe("length");
  });

  it("IfcWallStandardCase shares the wall mapping; IfcColumn derives CrossSectionArea", () => {
    expect(QTO_SCHEMA.IFCWALLSTANDARDCASE).toBe(QTO_SCHEMA.IFCWALL);
    const q = computeForClass("IFCCOLUMN", metrics);
    expect(q.qset).toBe("Qto_ColumnBaseQuantities");
    expect(q.values.Length).toBeCloseTo(3, 6); // vertical
    expect(q.values.CrossSectionArea).toBeCloseTo(24 / 3, 6);
  });

  it("unmapped classes get generic quantities and a pattern-derived Qto set", () => {
    const q = computeForClass("IfcFlowSegment", metrics);
    expect(q.qset).toBe("Qto_FlowSegmentBaseQuantities");
    expect(q.values.NetVolume).toBeCloseTo(24, 6);
    expect(q.values.OuterSurfaceArea).toBeCloseTo(52, 6);
    expect(FALLBACK_QTO.map((d) => d.name)).toContain("Height");
  });

  it("deriveQsetName follows the official naming pattern; garbage yields null", () => {
    expect(deriveQsetName("IfcCourse")).toBe("Qto_CourseBaseQuantities");
    expect(deriveQsetName("IfcEarthworksFill")).toBe("Qto_EarthworksFillBaseQuantities");
    expect(deriveQsetName("")).toBeNull();
    expect(deriveQsetName("Ifc")).toBeNull();
    expect(deriveQsetName("Ifc Weird Name")).toBeNull();
  });
});

describe("computeGeoQuantities runner", () => {
  it("computes per element, resolves the class, skips geometry-less ids", async () => {
    const src = srcOf({ 1: [box(2, 3, 4)], 2: [box(1, 1, 1)] });
    const cls: Record<number, string> = { 1: "IfcWall", 2: "IfcThing" };
    const out = await computeGeoQuantities(src, [1, 2, 99], (id) => cls[id] ?? "");
    expect(out.size).toBe(2);
    expect(out.get(1)!.qset).toBe("Qto_WallBaseQuantities");
    expect(out.get(1)!.values.NetVolume).toBeCloseTo(24, 6);
    expect(out.get(2)!.qset).toBe("Qto_ThingBaseQuantities");
    expect(out.has(99)).toBe(false);
  });

  it("honours an abort signal", async () => {
    const src = srcOf({ 1: [box(1, 1, 1)] });
    const out = await computeGeoQuantities(src, [1], () => "IFCWALL", { signal: { aborted: true } });
    expect(out.size).toBe(0);
  });

  it("results stay in SI (metres) — the write path converts, not the runner", async () => {
    const src = srcOf({ 1: [box(2, 3, 4)] });
    const out = await computeGeoQuantities(src, [1], () => "IFCWALL");
    const q = out.get(1)!;
    expect(q.values.Length).toBeCloseTo(4, 6);
    expect(q.values.NetSideArea).toBeCloseTo(12, 6);
    expect(q.values.NetVolume).toBeCloseTo(24, 6);
  });
});

// Same tiny inline IFC4 model as createSite.test.ts — the write-back path:
// setQuantity(Qto_…) → export → reopen must surface the quantity set.
const TINY_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('tiny.ifc','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Test',$,$,$,$,(#2),#3);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
#3=IFCUNITASSIGNMENT((#5));
#4=IFCAXIS2PLACEMENT3D(#6,$,$);
#5=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#6=IFCCARTESIANPOINT((0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

describe("Qto write-back round-trip (editor)", () => {
  it("a written quantity set survives export + reopen", async () => {
    const ed = await IfcEditor.open(new TextEncoder().encode(TINY_IFC));
    const ID = 1;
    ed.setQuantity(ID, "Qto_WallBaseQuantities", "NetVolume", 24.5, QuantityType.Volume);
    ed.setQuantity(ID, "Qto_WallBaseQuantities", "Height", 3, QuantityType.Length);
    expect(ed.hasChanges()).toBe(true);
    const out = ed.export();
    ed.close();

    const ed2 = await IfcEditor.open(out);
    const qto = ed2.getSelection(ID).groups.find((g) => g.kind === "quantity" && g.name === "Qto_WallBaseQuantities");
    expect(qto).toBeDefined();
    const val = (name: string) => qto!.rows.find((r) => r.name === name)?.value;
    expect(Number(val("NetVolume"))).toBeCloseTo(24.5, 6);
    expect(Number(val("Height"))).toBeCloseTo(3, 6);
    ed2.close();
  });
});
