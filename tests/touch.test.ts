import { describe, it, expect } from "vitest";
import { pinchOf, pinchStep, zoomDeltas, panelZoom } from "../src/viewer/touch";

describe("touch.pinchOf", () => {
  it("gives the finger spread and their midpoint", () => {
    expect(pinchOf({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ dist: 50, cx: 15, cy: 20 });
  });
});

describe("touch.pinchStep (3D view)", () => {
  it("the model follows the fingers: twice the spread = half the camera distance", () => {
    const start = pinchOf({ x: 100, y: 100 }, { x: 200, y: 100 });
    expect(pinchStep(start, pinchOf({ x: 50, y: 100 }, { x: 250, y: 100 })).distFactor).toBeCloseTo(0.5);
    expect(pinchStep(start, pinchOf({ x: 125, y: 100 }, { x: 175, y: 100 })).distFactor).toBeCloseTo(2);
  });

  it("moving both fingers together pans by the midpoint's travel, without zooming", () => {
    const s = pinchStep(pinchOf({ x: 0, y: 0 }, { x: 100, y: 0 }), pinchOf({ x: 20, y: 10 }, { x: 120, y: 10 }));
    expect(s.distFactor).toBeCloseTo(1);
    expect([s.panDx, s.panDy]).toEqual([20, 10]);
  });

  it("never produces NaN/Infinity when the fingers touch", () => {
    expect(pinchStep({ dist: 0, cx: 0, cy: 0 }, { dist: 80, cx: 0, cy: 0 }).distFactor).toBe(1);
  });
});

describe("touch.zoomDeltas (camera.zoom calls for a distance factor)", () => {
  // Model of @ifc-lite's camera.zoom: distance *= 1 + delta * 0.0005, |delta| <= 100.
  const apply = (ds: number[]) => ds.reduce((f, d) => f * (1 + Math.max(-100, Math.min(100, d)) * 0.0005), 1);

  it("reaches large factors in several capped steps (the camera moves at most 5% per call)", () => {
    const ds = zoomDeltas(0.5);
    expect(ds.length).toBeGreaterThan(1);
    expect(ds.every((d) => Math.abs(d) <= 100)).toBe(true);
    expect(apply(ds)).toBeCloseTo(0.5, 3);
    expect(apply(zoomDeltas(1.8))).toBeCloseTo(1.8, 3);
  });

  it("small factors are one fine step; 1 is no call at all", () => {
    expect(zoomDeltas(0.99)).toHaveLength(1);
    expect(apply(zoomDeltas(0.99))).toBeCloseTo(0.99, 5);
    expect(zoomDeltas(1)).toEqual([]);
  });
});

describe("touch.panelZoom (panel content)", () => {
  it("follows the spread from where the pinch started, clamped to 60%-300%", () => {
    expect(panelZoom(1, 100, 150)).toBeCloseTo(1.5);
    expect(panelZoom(1.5, 100, 50)).toBeCloseTo(0.75);
    expect(panelZoom(1, 100, 1000)).toBe(3);
    expect(panelZoom(1, 100, 10)).toBe(0.6);
    expect(panelZoom(1.2, 0, 50)).toBe(1.2);
  });
});
