// Measurement tool on the @ifc-lite WebGPU renderer (replaces the three.js one).
// Hit-testing + snapping come from renderer.raycastScene; visuals are a DOM/SVG
// overlay projected with camera.projectToScreen each frame (no GPU line buffers).
// Coordinates are reported in IFC model frame and, when georeferenced, Stereo 70.
import type { ViewerEngine, SnapType } from "./engine";
import type { GeorefInfo } from "../ifc/editor";
import { t } from "../i18n";
import { formatLength, formatArea, coordDecimals } from "../settings/format";
import { ovc } from "./overlayColors";

export type MeasureMode = "none" | "length" | "point" | "area";

interface V3 {
  x: number;
  y: number;
  z: number;
}

const NS = "http://www.w3.org/2000/svg";

/** IFC model point → Stereo 70 (Est, Nord, H). Identity when no georef. */
export function modelToStereo70(g: GeorefInfo | null, p: V3): V3 {
  if (!g) return { x: p.x, y: p.y, z: p.z };
  const t = (g.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return {
    x: g.eastings + g.scale * (p.x * c - p.y * s),
    y: g.northings + g.scale * (p.x * s + p.y * c),
    z: g.height + p.z,
  };
}

export class MeasureTool {
  mode: MeasureMode = "none";
  private georef: GeorefInfo | null = null;
  private pending: V3[] = []; // committed points of the in-progress measurement (renderer world)
  private hover: V3 | null = null;
  private hoverType: SnapType = "face";
  private done: { mode: MeasureMode; pts: V3[] }[] = [];
  private selected: number | null = null; // index into `done` of the picked measurement
  private svg: SVGSVGElement;
  private labels: HTMLDivElement;
  private raf = 0;
  private alive = true;

  constructor(private engine: ViewerEngine, private host: HTMLElement) {
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "measure-overlay");
    // width/height:100% is REQUIRED — an <svg> is a replaced element with a
    // default 300×150 intrinsic size, so `inset:0` alone leaves it tiny and
    // everything drawn beyond 300×150 px is clipped (invisible lines/glyphs).
    Object.assign(this.svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "5" });
    this.labels = document.createElement("div");
    Object.assign(this.labels.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "6" });
    host.appendChild(this.svg);
    host.appendChild(this.labels);
    const tick = () => {
      if (!this.alive) return;
      this.redraw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  setGeoref(g: GeorefInfo | null): void {
    this.georef = g;
  }
  // Kept for API parity with the old tool; RTC is handled inside the engine.
  setModelOffset(_o: unknown): void {}

  setMode(m: MeasureMode): void {
    this.mode = m;
    this.pending = [];
    this.hover = null;
    this.selected = null;
  }

  /** Hit-test a screen point against finished measurements; selects the topmost
   *  one hit (or clears the selection). Returns true if one was selected. */
  selectAt(clientX: number, clientY: number): boolean {
    const r = this.host.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const TH = 8; // px tolerance
    for (let i = this.done.length - 1; i >= 0; i--) {
      const m = this.done[i];
      // Keep scr index-aligned with m.pts (null = unprojectable, e.g. behind
      // the camera) so segments never connect non-adjacent vertices.
      const scr = m.pts.map((p) => this.project(p));
      if (!scr.some(Boolean)) continue;
      let hit = false;
      if (m.mode === "point") {
        hit = !!scr[0] && Math.hypot(scr[0].x - x, scr[0].y - y) <= TH;
      } else {
        const n = scr.length;
        const segs = m.mode === "area" ? n : n - 1; // area is closed
        for (let k = 0; k < segs; k++) {
          const a = scr[k], b = scr[(k + 1) % n];
          if (!a || !b) continue; // skip segments with an off-screen endpoint
          if (distToSeg(x, y, a, b) <= TH) { hit = true; break; }
        }
        // The polygon ring is only meaningful when every vertex projects.
        if (!hit && m.mode === "area" && scr.every(Boolean) &&
          pointInPoly(x, y, scr as { x: number; y: number }[])) hit = true;
      }
      if (hit) { this.selected = i; return true; }
    }
    this.selected = null;
    return false;
  }

  hasSelection(): boolean {
    return this.selected != null;
  }
  clearSelection(): void {
    this.selected = null;
  }
  /** Delete only the currently selected measurement. */
  deleteSelected(): void {
    if (this.selected == null) return;
    this.done.splice(this.selected, 1);
    this.selected = null;
  }

  private hit(ev: MouseEvent): V3 | null {
    const s = this.engine.snap(ev.clientX, ev.clientY);
    if (!s) return null;
    this.hoverType = s.type;
    return { x: s.point.x, y: s.point.y, z: s.point.z };
  }

  onClick(ev: MouseEvent): void {
    if (this.mode === "none") return;
    const p = this.hit(ev);
    if (!p) return;
    if (this.mode === "point") {
      this.done.push({ mode: "point", pts: [p] });
      return;
    }
    this.pending.push(p);
    if (this.mode === "length" && this.pending.length === 2) {
      this.done.push({ mode: "length", pts: this.pending });
      this.pending = [];
    }
  }

  onMove(ev: MouseEvent): void {
    if (this.mode === "none") return;
    this.hover = this.hit(ev);
  }

  onDblClick(): void {
    if (this.mode === "area" && this.pending.length >= 3) {
      this.done.push({ mode: "area", pts: this.pending });
      this.pending = [];
    }
  }

  clearAll(): void {
    this.done = [];
    this.pending = [];
    this.hover = null;
    this.selected = null;
  }

  dispose(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.svg.remove();
    this.labels.remove();
  }

  // --- rendering ----------------------------------------------------------
  private project(p: V3): { x: number; y: number } | null {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    return this.engine.renderer.getCamera().projectToScreen(p, w, h);
  }

  private redraw(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.labels.replaceChildren();

    const drawn: { mode: MeasureMode; pts: V3[]; preview?: boolean; selected?: boolean }[] =
      this.done.map((m, i) => ({ ...m, selected: i === this.selected }));
    if (this.pending.length) {
      const pts = this.hover ? [...this.pending, this.hover] : [...this.pending];
      drawn.push({ mode: this.mode, pts, preview: true });
    } else if (this.hover && this.mode !== "none") {
      drawn.push({ mode: this.mode, pts: [this.hover], preview: true });
    }

    for (const m of drawn) {
      const scr = m.pts.map((p) => this.project(p));
      // Selected measurement: teal + thicker, to stand out from the accent ones.
      const col = m.selected ? ovc.teal() : ovc.accent();
      const sw = m.selected ? "3.5" : "2";
      const dotR = m.selected ? "5" : "3.5";
      if (m.pts.length >= 2) {
        const pl = document.createElementNS(NS, "polyline");
        const closed = m.mode === "area" && !m.preview;
        const coords = scr.filter(Boolean) as { x: number; y: number }[];
        if (closed && coords.length >= 3) coords.push(coords[0]);
        pl.setAttribute("points", coords.map((c) => `${c.x},${c.y}`).join(" "));
        pl.setAttribute("fill", m.mode === "area" && closed ? (m.selected ? "rgba(0,160,175,0.14)" : ovc.accentFill(0.10)) : "none");
        pl.setAttribute("stroke", col);
        pl.setAttribute("stroke-width", sw);
        this.svg.appendChild(pl);
      }
      for (const c of scr) {
        if (!c) continue;
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", String(c.x));
        dot.setAttribute("cy", String(c.y));
        dot.setAttribute("r", dotR);
        dot.setAttribute("fill", "#fff");
        dot.setAttribute("stroke", col);
        dot.setAttribute("stroke-width", "2");
        this.svg.appendChild(dot);
      }
      this.addLabels(m, scr);
    }

    // AutoCAD-style snap marker at the cursor: square = endpoint (vertex),
    // diamond = edge/midpoint, circle = on face. Drawn with a dark halo so it
    // reads on any background.
    if (this.hover && this.mode !== "none") {
      const c = this.project(this.hover);
      if (c) {
        const col = this.hoverType === "vertex" ? "#bcf124"
          : this.hoverType === "midpoint" ? "#ff9d00"
            : this.hoverType === "edge" ? "#00d0ff" : "#ffd400";
        const r = 9;
        const mk = (stroke: string, sw: number) => {
          let el: SVGElement;
          if (this.hoverType === "face") {
            el = document.createElementNS(NS, "circle");
            el.setAttribute("cx", String(c.x)); el.setAttribute("cy", String(c.y)); el.setAttribute("r", String(r - 2));
          } else if (this.hoverType === "midpoint") {
            el = document.createElementNS(NS, "polygon"); // triangle
            el.setAttribute("points", `${c.x},${c.y - r} ${c.x + r},${c.y + r} ${c.x - r},${c.y + r}`);
          } else {
            el = document.createElementNS(NS, "rect"); // square (vertex) / diamond (edge)
            el.setAttribute("x", String(c.x - r)); el.setAttribute("y", String(c.y - r));
            el.setAttribute("width", String(r * 2)); el.setAttribute("height", String(r * 2));
            if (this.hoverType === "edge") el.setAttribute("transform", `rotate(45 ${c.x} ${c.y})`);
          }
          el.setAttribute("fill", "none");
          el.setAttribute("stroke", stroke);
          el.setAttribute("stroke-width", String(sw));
          this.svg.appendChild(el);
        };
        mk("rgba(0,0,0,0.75)", 5); // halo
        mk(col, 2.5); // marker
      }
    }
  }

  private label(text: string, x: number, y: number): void {
    const d = document.createElement("div");
    d.className = "measure-label";
    d.textContent = text;
    Object.assign(d.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      transform: "translate(-50%,-130%)",
      background: "rgba(20,20,24,0.85)",
      color: "#fff",
      font: "12px system-ui, sans-serif",
      padding: "2px 6px",
      borderRadius: "4px",
      whiteSpace: "pre",
    });
    this.labels.appendChild(d);
  }

  private addLabels(m: { mode: MeasureMode; pts: V3[] }, scr: ({ x: number; y: number } | null)[]): void {
    const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (m.mode === "point" && m.pts[0] && scr[0]) {
      const ifc = this.engine.worldToIfc(m.pts[0]);
      const s = modelToStereo70(this.georef, ifc);
      const dp = coordDecimals();
      const txt = this.georef
        ? `X ${s.x.toFixed(dp)}  Y ${s.y.toFixed(dp)}\nZ ${s.z.toFixed(dp)} m`
        : `X ${ifc.x.toFixed(dp)}\nY ${ifc.y.toFixed(dp)}\nZ ${ifc.z.toFixed(dp)}`;
      this.label(txt, scr[0].x, scr[0].y);
    }
    if (m.mode === "length" && m.pts.length >= 2 && scr[0] && scr[1]) {
      const d = dist(m.pts[0], m.pts[1]);
      this.label(formatLength(d), (scr[0].x + scr[1].x) / 2, (scr[0].y + scr[1].y) / 2);
    }
    if (m.mode === "area" && m.pts.length >= 3) {
      let per = 0;
      for (let i = 1; i < m.pts.length; i++) per += dist(m.pts[i - 1], m.pts[i]);
      per += dist(m.pts[m.pts.length - 1], m.pts[0]);
      const area = polygonArea(m.pts);
      // Centroid over the vertices that actually project; if none do, there is
      // nowhere sensible to put the label, so skip it (never draw at 0,0).
      const vis = scr.filter((c): c is { x: number; y: number } => !!c);
      if (!vis.length) return;
      const cx = vis.reduce((a, c) => a + c.x, 0) / vis.length;
      const cy = vis.reduce((a, c) => a + c.y, 0) / vis.length;
      this.label(t("measure.areaPerimeter", { area: formatArea(area), per: formatLength(per) }), cx, cy);
    }
  }
}

/** Distance from screen point (px,py) to segment a–b. */
export function distToSeg(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

/** Even-odd point-in-polygon test on screen coords. */
export function pointInPoly(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 3D polygon area via the Newell cross-product sum (handles tilted plots). */
export function polygonArea(pts: V3[]): number {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += a.y * b.z - a.z * b.y;
    ny += a.z * b.x - a.x * b.z;
    nz += a.x * b.y - a.y * b.x;
  }
  return Math.hypot(nx, ny, nz) / 2;
}
