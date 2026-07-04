// BCF coordinate correctness for georeferenced models.
//
// The renderer works in an RTC-shifted, Y-up world (geometry is translated by
// −rtcOffset to keep float32 precision on large survey coordinates). The
// @ifc-lite/bcf helpers convert Y-up↔Z-up but do NOT undo the RTC shift, so a
// BCF viewpoint written straight from getCameraState()/elementBounds() lands at
// (real − rtcOffset) — wrong in every other BCF tool (BIMcollab, Solibri, …).
// These pure helpers restore the shift: add it on the way OUT (so the lib's
// Y-up→Z-up yields absolute IFC coords), subtract it on the way IN. For a
// non-georeferenced model rtcOffset is {0,0,0} and every helper is a no-op.
import type { ViewerCameraState, ViewerBounds } from "../ifc/bcf";

type Vec3 = { x: number; y: number; z: number };

/** The RTC origin (stored in IFC Z-up: x=E, y=N, z=up) expressed in the
 *  renderer's Y-up axes (x=E, y=up, z=−N) — the same mapping the loader uses. */
export function rtcToYup(rtc: Vec3): Vec3 {
  return { x: rtc.x, y: rtc.z, z: -rtc.y };
}

const add = (p: Vec3, d: Vec3): Vec3 => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
const sub = (p: Vec3, d: Vec3): Vec3 => ({ x: p.x - d.x, y: p.y - d.y, z: p.z - d.z });

/** Render-local camera → BCF-absolute (still Y-up; the lib flips to Z-up). */
export function cameraToBcf(cam: ViewerCameraState, rtc: Vec3): ViewerCameraState {
  const d = rtcToYup(rtc);
  return { ...cam, position: add(cam.position, d), target: add(cam.target, d) };
}

/** BCF-absolute camera (post extractViewpointState, Y-up) → render-local. */
export function cameraFromBcf(cam: ViewerCameraState, rtc: Vec3): ViewerCameraState {
  const d = rtcToYup(rtc);
  return { ...cam, position: sub(cam.position, d), target: sub(cam.target, d) };
}

/** Render-local bounds → BCF-absolute (still Y-up). */
export function boundsToBcf(b: ViewerBounds, rtc: Vec3): ViewerBounds {
  const d = rtcToYup(rtc);
  return { min: add(b.min, d), max: add(b.max, d) };
}
