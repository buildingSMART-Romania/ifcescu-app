import { describe, it, expect } from "vitest";
import { rtcToYup, cameraToBcf, cameraFromBcf, boundsToBcf } from "../src/viewer/bcfCoords";
import type { ViewerCameraState, ViewerBounds } from "../src/ifc/bcf";

// A georeferenced RTC origin (IFC Z-up: x=E, y=N, z=up) — e.g. a bridge in a
// national grid. Non-zero so the transforms are actually exercised.
const RTC = { x: 512340.5, y: 5401220.25, z: 87.6 };

const camera: ViewerCameraState = {
  position: { x: 10, y: 6, z: -4 },
  target: { x: 1, y: 2, z: -3 },
  up: { x: 0, y: 1, z: 0 },
  fov: Math.PI / 3,
};

// The engine's canonical render(Y-up, RTC-local) → absolute IFC(Z-up) transform,
// replicated from ViewerEngine.worldToIfc so the test is independent of it.
const worldToIfc = (w: { x: number; y: number; z: number }) => ({
  x: w.x + RTC.x,
  y: -w.z + RTC.y,
  z: w.y + RTC.z,
});

// The @ifc-lite/bcf helpers' Y-up → Z-up axis flip (no translation), which runs
// AFTER cameraToBcf/boundsToBcf on the write path.
const libYupToZup = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: -p.z, z: p.y });

describe("bcfCoords RTC handling", () => {
  it("rtcToYup maps IFC Z-up (E,N,up) to render Y-up (E,up,-N)", () => {
    expect(rtcToYup(RTC)).toEqual({ x: RTC.x, y: RTC.z, z: -RTC.y });
  });

  it("is a no-op when the model isn't georeferenced (rtc = 0)", () => {
    const zero = { x: 0, y: 0, z: 0 };
    expect(cameraToBcf(camera, zero)).toEqual(camera);
    expect(boundsToBcf({ min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 } }, zero))
      .toEqual({ min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 } });
  });

  it("cameraToBcf then cameraFromBcf round-trips to the original (read undoes write)", () => {
    const roundTripped = cameraFromBcf(cameraToBcf(camera, RTC), RTC);
    expect(roundTripped.position.x).toBeCloseTo(camera.position.x, 6);
    expect(roundTripped.position.y).toBeCloseTo(camera.position.y, 6);
    expect(roundTripped.position.z).toBeCloseTo(camera.position.z, 6);
    expect(roundTripped.target).toEqual(camera.target);
    expect(roundTripped.up).toEqual(camera.up); // orientation untouched
    expect(roundTripped.fov).toBe(camera.fov);
  });

  it("write path (cameraToBcf → lib Y-up→Z-up) equals worldToIfc (real IFC coords)", () => {
    const bcfYup = cameraToBcf(camera, RTC);
    const absPos = libYupToZup(bcfYup.position);
    const expected = worldToIfc(camera.position);
    expect(absPos.x).toBeCloseTo(expected.x, 3);
    expect(absPos.y).toBeCloseTo(expected.y, 3);
    expect(absPos.z).toBeCloseTo(expected.z, 3);
  });

  it("boundsToBcf → lib flip lands each corner at its real IFC coordinate", () => {
    const b: ViewerBounds = { min: { x: -2, y: 0, z: -5 }, max: { x: 3, y: 4, z: -1 } };
    const shifted = boundsToBcf(b, RTC);
    for (const corner of ["min", "max"] as const) {
      const abs = libYupToZup(shifted[corner]);
      const expected = worldToIfc(b[corner]);
      expect(abs.x).toBeCloseTo(expected.x, 3);
      expect(abs.y).toBeCloseTo(expected.y, 3);
      expect(abs.z).toBeCloseTo(expected.z, 3);
    }
  });
});
