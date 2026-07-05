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

/** In-memory GeometrySource over id → parts. */
function srcOf(map: Record<number, GeoPart[]>): GeometrySource {
  return {
    elementGeometryParts: (id) => map[id] ?? null,
    elementBounds: (id) => (map[id] ? boundsOf(map[id]) : null),
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
    const m = plateMetrics([p], partVolume(p), partArea(p))!;
    expect(m.length).toBeCloseTo(20, 4);
    expect(m.width).toBeCloseTo(3.6, 4);
    expect(m.thickness).toBeCloseTo(0.04, 6);
    expect(m.perimeter).toBeCloseTo(47.2, 4);
    expect(m.area).toBeCloseTo(72, 4);
  });

  it("a chunky solid is NOT a plate (keeps the straight-axis dims)", () => {
    const c = box(2, 3, 4);
    expect(plateMetrics([c], partVolume(c), partArea(c))).toBeNull();
  });

  it("the fallback mapping uses plate dims for plate-like proxies", () => {
    const road = ribbon(100, 2.7, 27, 0.04, 1);
    const m = elementMetrics(srcOf({ 1: [road] }), 1)!;
    const q = computeForClass("IfcBuildingElementProxy", m);
    expect(q.values.Length).toBeCloseTo(270, 0);
    expect(q.values.Height).toBeCloseTo(0.04, 3);
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
