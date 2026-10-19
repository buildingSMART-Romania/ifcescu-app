// Section-aware CPU raycasting. The GPU picker already ignores section-clipped
// geometry, but the renderer's CPU raycaster (measure snapping, double-click
// face pick) returns the nearest surface even when the cut has discarded it —
// so measurements on a sliced building snapped to invisible walls. This wraps
// a `raycast(ray, meshes)` so it only reports hits in the kept half-space,
// using the shader's own rule: discard where (dot(p, n) − d) · side > 0,
// side = flipped ? −1 : 1.
import type { Ray, Intersection } from "@ifc-lite/renderer";

export interface ClipPlane {
  normal: [number, number, number];
  distance: number;
  flipped?: boolean;
}

// Tolerance (world units) for a hit lying ON the plane — e.g. the face the cut
// was created from — so it still counts as visible.
const CLIP_EPS = 1e-4;

/** True when `p` lies in the half-space the section discards (on-plane counts as kept). */
export function isClipped(plane: ClipPlane | null, p: { x: number; y: number; z: number }): boolean {
  if (!plane) return false;
  const n = plane.normal;
  return (p.x * n[0] + p.y * n[1] + p.z * n[2] - plane.distance) * (plane.flipped ? -1 : 1) > CLIP_EPS;
}

export function clipAwareRaycast<M>(
  base: (ray: Ray, meshes: M) => Intersection | null,
  getPlane: () => ClipPlane | null,
): (ray: Ray, meshes: M) => Intersection | null {
  return (ray, meshes) => {
    const sp = getPlane();
    if (!sp) return base(ray, meshes);
    const n = sp.normal;
    const side = sp.flipped ? -1 : 1;
    const o = ray.origin, d = ray.direction;
    const s0 = (o.x * n[0] + o.y * n[1] + o.z * n[2] - sp.distance) * side; // > 0 → origin in the cut-away half
    const sd = (d.x * n[0] + d.y * n[1] + d.z * n[2]) * side;
    if (s0 > 0) {
      // Camera on the removed side: start the ray where it enters the kept half.
      if (sd >= 0) return null; // never re-enters → nothing visible along this ray
      const t0 = -s0 / sd;
      const hit = base({ origin: { x: o.x + d.x * t0, y: o.y + d.y * t0, z: o.z + d.z * t0 }, direction: d }, meshes);
      if (hit) hit.distance += t0;
      return hit;
    }
    // Camera on the kept side: anything past the plane is cut away.
    const hit = base(ray, meshes);
    return hit && !isClipped(sp, hit.point) ? hit : null;
  };
}
