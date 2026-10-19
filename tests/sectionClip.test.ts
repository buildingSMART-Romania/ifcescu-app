import { describe, it, expect } from "vitest";
import type { Ray, Intersection } from "@ifc-lite/renderer";
import { clipAwareRaycast, type ClipPlane } from "../src/viewer/sectionClip";

// Fake scene: walls perpendicular to X at the given x positions; the base
// raycaster returns the nearest one in front of the ray (like Raycaster.raycast).
function wallsAt(xs: number[]) {
  return (ray: Ray): Intersection | null => {
    let best: Intersection | null = null;
    for (const x of xs) {
      if (ray.direction.x === 0) continue;
      const t = (x - ray.origin.x) / ray.direction.x;
      if (t <= 1e-9 || (best && t >= best.distance)) continue;
      best = {
        point: { x, y: ray.origin.y, z: ray.origin.z },
        normal: { x: -Math.sign(ray.direction.x), y: 0, z: 0 },
        distance: t,
        meshIndex: 0,
        triangleIndex: 0,
        expressId: x,
        barycentricCoord: { u: 0, v: 0, w: 1 },
      };
    }
    return best;
  };
}

const ray = (x: number, dx: number): Ray => ({ origin: { x, y: 0, z: 0 }, direction: { x: dx, y: 0, z: 0 } });
// Keep x ≤ 5 (unflipped: the shader discards dot(p,n) − d > 0).
const CUT: ClipPlane = { normal: [1, 0, 0], distance: 5 };

describe("clipAwareRaycast", () => {
  it("passes through untouched when no section is active", () => {
    const rc = clipAwareRaycast(wallsAt([3, 7]), () => null);
    expect(rc(ray(10, -1), undefined)?.expressId).toBe(7);
  });

  it("camera on the kept side: keeps hits before the plane, drops hits past it", () => {
    expect(clipAwareRaycast(wallsAt([3, 7]), () => CUT)(ray(0, 1), undefined)?.expressId).toBe(3);
    expect(clipAwareRaycast(wallsAt([7]), () => CUT)(ray(0, 1), undefined)).toBeNull();
  });

  it("camera on the removed side: skips cut-away walls and reports the true distance", () => {
    const hit = clipAwareRaycast(wallsAt([8, 3]), () => CUT)(ray(10, -1), undefined);
    expect(hit?.expressId).toBe(3);
    expect(hit?.distance).toBeCloseTo(7);
  });

  it("camera on the removed side looking away from the plane sees nothing", () => {
    expect(clipAwareRaycast(wallsAt([12]), () => CUT)(ray(10, 1), undefined)).toBeNull();
  });

  it("flipped keeps the other half", () => {
    const hit = clipAwareRaycast(wallsAt([3, 7]), () => ({ ...CUT, flipped: true }))(ray(0, 1), undefined);
    expect(hit?.expressId).toBe(7);
    expect(hit?.distance).toBeCloseTo(7);
  });

  it("a face lying on the plane stays hittable", () => {
    expect(clipAwareRaycast(wallsAt([5]), () => CUT)(ray(0, 1), undefined)?.expressId).toBe(5);
  });
});
