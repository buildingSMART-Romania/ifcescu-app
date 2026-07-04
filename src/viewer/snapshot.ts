// Per-element snapshot capture for BCF viewpoints. There is no offscreen render
// path, so a snapshot means: frame the LIVE camera on the element, let one frame
// render, then read the canvas. This module drives that loop for the IDS→BCF and
// clash→BCF exports (each topic gets a thumbnail of its element). DOM/canvas code
// — kept out of the pure data layer and verified manually, not in node tests.
import type { ViewerEngine } from "./engine";

/** Downscale a PNG data URL so a few hundred snapshots don't bloat the .bcfzip.
 *  Returns the original on any failure (never throws). */
export function downscalePng(dataUrl: string, maxDim = 1024): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) return resolve(dataUrl); // already small enough
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const cx = canvas.getContext("2d");
        if (!cx) return resolve(dataUrl);
        cx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export interface SnapshotTask {
  /** Map key the caller uses to attach the snapshot (e.g. "modelId:expressId"). */
  key: string;
  /** Render-space (Y-up) AABB to frame for this task's element/region. */
  min: [number, number, number];
  max: [number, number, number];
}

export interface SnapshotOptions {
  /** Max snapshots to capture; beyond this the topics stay camera-only. */
  cap?: number;
  maxDim?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Capture one downscaled PNG per task. Each element is framed INSTANTLY (no
 * animation) and drawn with a SYNCHRONOUS render before the screenshot, so the
 * capture is deterministic — no rAF race, no stale/blank frames. Only the camera
 * is moved (colors/selection untouched, so an IDS red overlay survives) and it is
 * restored at the end. The 3D churn is meant to be hidden behind a cover overlay
 * by the caller (see Viewer.runSnapshotCapture).
 */
export async function captureSnapshots(
  engine: ViewerEngine,
  tasks: SnapshotTask[],
  opts: SnapshotOptions = {},
): Promise<Map<string, string>> {
  const { cap = 400, maxDim = 1024, onProgress } = opts;
  const out = new Map<string, string>();
  if (!tasks.length) return out;

  const saved = engine.getCameraState();
  const n = Math.min(tasks.length, cap);
  try {
    for (let i = 0; i < n; i++) {
      const task = tasks[i];
      engine.frameBoundsInstant(task.min, task.max);
      engine.renderNow(); // draw the framed view synchronously, then capture it
      const png = await engine.screenshot();
      if (png) out.set(task.key, await downscalePng(png, maxDim));
      onProgress?.(i + 1, n);
      // Yield to the event loop so the cover-overlay progress bar repaints.
      if ((i & 7) === 7) await new Promise<void>((r) => setTimeout(r));
    }
  } finally {
    engine.applyCameraState(saved);
    engine.renderNow(); // restore the view immediately (no flash of a stale frame)
  }
  return out;
}
