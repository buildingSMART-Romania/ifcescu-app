import { describe, it, expect } from "vitest";
import {
  detectClashes,
  detectClashesAsync,
  triTriIntersect,
  mergeStatuses,
  pairKey,
  type ClashElement,
  type V3,
} from "../src/viewer/clash";

function box(id: number, model: string, min: V3, max: V3, tris?: Float32Array): ClashElement {
  return { id, model, min, max, guid: `g${id}`, tris };
}

function tri(p0: V3, p1: V3, p2: V3): Float32Array {
  return new Float32Array([...p0, ...p1, ...p2]);
}

/** Triangle soup (12 triangles) for a solid axis-aligned box. */
function boxTris([x0, y0, z0]: V3, [x1, y1, z1]: V3): Float32Array {
  const p: V3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], // bottom
    [4, 6, 5], [4, 7, 6], // top
    [0, 5, 1], [0, 4, 5], // front
    [3, 2, 6], [3, 6, 7], // back
    [0, 7, 4], [0, 3, 7], // left
    [1, 5, 6], [1, 6, 2], // right
  ];
  const out: number[] = [];
  for (const [a, b, c] of faces) out.push(...p[a], ...p[b], ...p[c]);
  return new Float32Array(out);
}

const HARD = { tolerance: 0.001, clearance: null, narrowPhase: false };

describe("clash.detectClashes (broad phase)", () => {
  it("reports a hard clash with the smallest axis overlap as penetration", () => {
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2])];
    const b = [box(20, "B", [1, 1, 1.5], [3, 3, 3])]; // overlap: x=1, y=1, z=0.5
    const res = detectClashes(a, b, HARD);
    expect(res).toHaveLength(1);
    expect(res[0].type).toBe("hard");
    expect(res[0].penetration).toBeCloseTo(0.5, 6);
    expect(res[0].a).toBe(10);
    expect(res[0].b).toBe(20);
  });

  it("finds a clearance clash only when clearance is enabled", () => {
    const a = [box(10, "A", [0, 0, 0], [1, 1, 1])];
    const b = [box(20, "B", [1.05, 0, 0], [2, 1, 1])]; // 0.05 gap on x
    expect(detectClashes(a, b, HARD)).toHaveLength(0);
    const withClear = detectClashes(a, b, { tolerance: 0.001, clearance: 0.1, narrowPhase: false });
    expect(withClear).toHaveLength(1);
    expect(withClear[0].type).toBe("clearance");
    expect(withClear[0].penetration).toBeCloseTo(0.05, 6);
  });

  it("ignores elements that are far apart", () => {
    const a = [box(10, "A", [0, 0, 0], [1, 1, 1])];
    const b = [box(20, "B", [10, 10, 10], [11, 11, 11])];
    expect(detectClashes(a, b, { tolerance: 0.001, clearance: 0.5, narrowPhase: false })).toHaveLength(0);
  });

  it("never clashes an element with itself and dedups overlapping sets", () => {
    const shared = box(10, "A", [0, 0, 0], [2, 2, 2]);
    const other = box(20, "B", [1, 1, 1], [3, 3, 3]);
    const res = detectClashes([shared, other], [shared, other], HARD);
    // Only the (10,20) pair, once — no (10,10)/(20,20), no duplicate.
    expect(res).toHaveLength(1);
    expect(res[0].key).toBe(pairKey("g10", "g20"));
  });
});

describe("clash.triTriIntersect", () => {
  it("detects two crossing triangles", () => {
    const horizontal = [[0, 0, 0], [4, 0, 0], [0, 4, 0]] as V3[];
    const vertical = [[1, 1, -1], [1, 1, 1], [3, 1, 0]] as V3[]; // pierces z=0
    expect(triTriIntersect(horizontal, vertical)).toBe(true);
  });

  it("rejects two separated triangles", () => {
    const t1 = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as V3[];
    const t2 = [[0, 0, 5], [1, 0, 5], [0, 1, 5]] as V3[];
    expect(triTriIntersect(t1, t2)).toBe(false);
  });

  it("detects overlapping coplanar triangles", () => {
    const t1 = [[0, 0, 0], [4, 0, 0], [0, 4, 0]] as V3[];
    const t2 = [[1, 1, 0], [5, 1, 0], [1, 5, 0]] as V3[];
    expect(triTriIntersect(t1, t2)).toBe(true);
  });
});

describe("clash narrow phase", () => {
  const opts = { tolerance: 0.001, clearance: null, narrowPhase: true };

  it("drops an AABB overlap whose geometry does not actually intersect", () => {
    // Boxes' AABBs overlap on [1,1,1]..[2,2,2], but each triangle sits in its far corner.
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2], tri([0, 0, 0], [0.5, 0, 0], [0, 0.5, 0]))];
    const b = [box(20, "B", [1, 1, 1], [3, 3, 3], tri([2.6, 2.6, 2.6], [3, 2.6, 2.6], [2.6, 3, 2.6]))];
    expect(detectClashes(a, b, opts)).toHaveLength(0);
  });

  it("keeps a hard clash whose solids truly interpenetrate, with real penetration", () => {
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2], boxTris([0, 0, 0], [2, 2, 2]))];
    const b = [box(20, "B", [1, 1, 1], [3, 3, 3], boxTris([1, 1, 1], [3, 3, 3]))]; // overlap 1 on each axis
    const res = detectClashes(a, b, opts);
    expect(res).toHaveLength(1);
    expect(res[0].type).toBe("hard");
    expect(res[0].penetration).toBeGreaterThan(0.5);
  });

  it("drops mere surface contact even when the AABBs overlap a lot", () => {
    // A is a 2x2x2 box. B's *AABB* overlaps A on z by 1 (so it is a hard candidate),
    // but B's geometry is a box resting ON A's top face (z=2) — contact, not penetration.
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2], boxTris([0, 0, 0], [2, 2, 2]))];
    const b = [box(20, "B", [0.5, 0.5, 1.0], [1.5, 1.5, 3.0], boxTris([0.5, 0.5, 2.0], [1.5, 1.5, 3.0]))];
    // Without narrow phase the inflated AABB reports a hard clash...
    expect(detectClashes(a, b, { tolerance: 0.001, clearance: null, narrowPhase: false })).toHaveLength(1);
    // ...but the geometry only touches, so the precise check drops it.
    expect(detectClashes(a, b, opts)).toHaveLength(0);
  });
});

describe("clash status persistence", () => {
  it("re-applies previous statuses by stable pair key", () => {
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2])];
    const b = [box(20, "B", [1, 1, 1], [3, 3, 3])];
    const first = detectClashes(a, b, HARD);
    expect(first[0].status).toBe("new");
    const prev = new Map([[first[0].key, "resolved" as const]]);
    const merged = mergeStatuses(detectClashes(a, b, HARD), prev);
    expect(merged[0].status).toBe("resolved");
  });
});

describe("clash.detectClashesAsync", () => {
  it("matches the sync result and reports progress to completion", async () => {
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2])];
    const b = [box(20, "B", [1, 1, 1], [3, 3, 3])];
    let lastDone = -1;
    let lastTotal = -1;
    const res = await detectClashesAsync(a, b, HARD, {
      onProgress: (done, total) => { lastDone = done; lastTotal = total; },
    });
    expect(res).toHaveLength(1);
    expect(lastDone).toBe(lastTotal);
  });

  it("stops early when the signal is aborted", async () => {
    const a = [box(10, "A", [0, 0, 0], [2, 2, 2])];
    const b = [box(20, "B", [1, 1, 1], [3, 3, 3])];
    const res = await detectClashesAsync(a, b, HARD, { signal: { aborted: true } });
    expect(res).toHaveLength(0);
  });
});
