// WebGPU viewer engine wrapping @ifc-lite/renderer — replaces web-ifc-viewer +
// three.js. Owns the Renderer, the camera-control wiring (orbit/pan/zoom on the
// canvas), the render loop, picking, per-element bounds (zoom-to-selection) and
// the renderer-Y-up → IFC coordinate conversion the measurement readout needs.
import { Renderer, planeBasis, nearestCardinalAxis, FederationRegistry } from "@ifc-lite/renderer";
import type { SectionPlane } from "@ifc-lite/renderer";
import { GeometryProcessor, type MeshData } from "@ifc-lite/geometry";
import type { IfcDataStore } from "@ifc-lite/parser";
import type { ViewerCameraState, ViewerBounds } from "@ifc-lite/bcf";
import { parseStore } from "../ifc/store";
import { t } from "../i18n";

export interface RenderState {
  hiddenIds: Set<number>;
  isolatedIds: Set<number> | null;
  selectedIds: Set<number>;
  sectionPlane: SectionPlane | null;
  clearColor: [number, number, number, number];
}

export type SnapType = "vertex" | "midpoint" | "edge" | "face";
export interface SnapOptions {
  vertex: boolean;
  midpoint: boolean;
  edge: boolean;
  face: boolean;
}

type Bounds = { min: [number, number, number]; max: [number, number, number] };
// The Camera applies its OWN internal scaling (ORBIT_SENSITIVITY 0.01 rad/px,
// PAN_SPEED_MULTIPLIER 0.001·distance, ZOOM_SENSITIVITY 0.001 clamped to 0.1),
// so we must feed it RAW pixel/wheel deltas. (Pre-scaling here double-applied the
// factor and made everything crawl.) These knobs stay at 1 for the native feel.
const ORBIT_SENS = 0.7;
const PAN_SENS = 0.7;
const ZOOM_SENS = 0.7;
const OUTLINE_COLOR = "#bcf124"; // lime selection outline (matches the old viewer)
const SNAP_PX = 14; // screen-space snap radius for measurement
// Only emit a shared edge when its two faces meet at a sharp angle (feature edge);
// 50° keeps building corners and the silhouette but drops the dense triangulation
// of tessellated/terrain surfaces. Boundary edges (1 face) are always emitted.
const SHARP_COS = Math.cos((50 * Math.PI) / 180);
// Selection-outline work caps: welding sharp edges for thousands of elements
// (e.g. a whole storey) froze the UI for seconds, so beyond these limits the
// outline stays PARTIAL — selection state / highlight fill are unaffected.
const OUTLINE_MAX_IDS = 400;
const OUTLINE_MAX_FLOATS = 200_000 * 6; // ~200k edge segments (6 floats each)
const SVG_NS = "http://www.w3.org/2000/svg";

/** One federated model: its parsed store and the id offset applied to its
 *  expressIds to make them globally unique across all loaded models. */
interface LoadedModelRec {
  store: IfcDataStore;
  offset: number; // 0 for the first (primary) model
  localIDs: number[];
  globalIDs: number[];
  rtcOffset: { x: number; y: number; z: number };
  fileName: string;
  // Final (id-offset + render-shifted) meshes, retained so removal can rebuild
  // the scene (per-entity removal is unreliable on color-merged batches).
  meshes: MeshData[];
}

export class ViewerEngine {
  readonly renderer: Renderer;
  store: IfcDataStore | null = null; // primary model's store (offset 0)
  allIDs: number[] = []; // union of all models' GLOBAL ids
  rtcOffset = { x: 0, y: 0, z: 0 }; // shared origin (primary model)
  // Federation: each model gets an id offset so the whole engine (pick,
  // selection, visibility, bounds, snap) works transparently on GLOBAL ids;
  // only store/property lookups route back per-model via `resolveGlobal`.
  private readonly fed = new FederationRegistry();
  private readonly models = new Map<string, LoadedModelRec>();
  private primaryRtc: { x: number; y: number; z: number } | null = null;
  private readonly bounds = new Map<number, Bounds>();
  // Retained per-element world-space geometry (Y-up) for the selection outline.
  private readonly geom = new Map<number, { pos: Float32Array; idx: Uint32Array }[]>();
  private readonly snapCache = new Map<number, { verts: Float32Array; edges: Uint32Array } | null>();
  // Welded sharp-edge segments per element, built lazily by setSelectionOutline
  // (welding is expensive; re-selecting must not redo it). Invalidated alongside
  // snapCache whenever an element's retained geometry changes (model add/remove).
  private readonly edgeCache = new Map<number, Float32Array>();
  private selEdges: Float32Array | null = null;
  private outlineSvg: SVGSVGElement | null = null;
  private outlinePath: SVGPathElement | null = null;
  private sectionPath: SVGPathElement | null = null; // small colored section-plane indicator
  private sectionHandle: HTMLDivElement | null = null;
  private secCenterWorld: [number, number, number] | null = null;
  private secQuad: [number, number, number][] | null = null; // 4 corners of the indicator
  private secSizePct = 0.18; // indicator half-size as a fraction of the model half-diagonal
  private handleDrag: { lastX: number; lastY: number } | null = null;
  /** Notified when the in-viewer handle drags the section, so the UI slider stays in sync. */
  onSectionMove: ((pos: number) => void) | null = null;
  /** Active snap methods for measurement (all on by default). */
  snapOptions: SnapOptions = { vertex: true, midpoint: true, edge: true, face: true };
  private state: RenderState = {
    hiddenIds: new Set(),
    isolatedIds: null,
    selectedIds: new Set(),
    sectionPlane: null,
    clearColor: [0.93, 0.94, 0.96, 1],
  };
  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private detach: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.attachControls();
    this.createOutlineOverlay();
    this.lastT = performance.now();
    this.loop();
  }

  private createOutlineOverlay(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "4" });
    // Section-plane indicator (filled square, buildingSMART magenta) — added
    // first so the selection outline draws on top of it.
    const sec = document.createElementNS(SVG_NS, "path");
    sec.setAttribute("fill", "rgba(230, 0, 126, 0.16)");
    sec.setAttribute("stroke", "rgb(230, 0, 126)");
    sec.setAttribute("stroke-width", "2");
    sec.setAttribute("stroke-linejoin", "round");
    svg.appendChild(sec);
    this.sectionPath = sec;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", OUTLINE_COLOR);
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    parent.appendChild(svg);
    this.outlineSvg = svg;
    this.outlinePath = path;

    // Draggable scissor handle (Trimble-style) to move the section along its normal.
    const handle = document.createElement("div");
    handle.className = "section-handle";
    Object.assign(handle.style, {
      position: "absolute", width: "30px", height: "30px", marginLeft: "-15px", marginTop: "-15px",
      borderRadius: "50%", background: "#fff", border: "1px solid #bbb",
      boxShadow: "0 1px 6px rgba(0,0,0,0.4)", cursor: "grab", pointerEvents: "auto", zIndex: "7",
      display: "none", alignItems: "center", justifyContent: "center", fontSize: "15px", userSelect: "none",
    });
    handle.textContent = "✂️";
    handle.title = t("measure.dragSection");
    parent.appendChild(handle);
    this.sectionHandle = handle;
    const onMove = (e: PointerEvent) => {
      if (!this.handleDrag || !this.sec || !this.secCenterWorld) return;
      const cam = this.renderer.getCamera();
      const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
      const c = this.secCenterWorld;
      const { normal: n, dMin, dMax } = this.sec;
      const range = dMax - dMin || 1;
      // Probe the screen-space direction of the normal with a SMALL world step
      // tied to the camera distance — so the probe point stays in front of the
      // camera (never behind / off-screen) at any zoom or angle. (Using the full
      // range here put the probe behind the camera when zoomed in → drag froze.)
      const cp = cam.getPosition();
      const eps = (Math.hypot(cp.x - c[0], cp.y - c[1], cp.z - c[2]) || 1) * 0.05;
      const A = cam.projectToScreen({ x: c[0], y: c[1], z: c[2] }, w, h);
      const B = cam.projectToScreen({ x: c[0] + n[0] * eps, y: c[1] + n[1] * eps, z: c[2] + n[2] * eps }, w, h);
      if (A && B) {
        const vx = B.x - A.x, vy = B.y - A.y;
        const len = Math.hypot(vx, vy);
        if (len > 0.5) { // skip when looking almost along the normal (degenerate)
          const ux = vx / len, uy = vy / len;
          const pxAlong = (e.clientX - this.handleDrag.lastX) * ux + (e.clientY - this.handleDrag.lastY) * uy;
          const worldDelta = (pxAlong / len) * eps; // screen px → world units along the normal
          const dPos = (worldDelta / range) * 100;
          this.sec.pos = Math.max(0, Math.min(100, this.sec.pos + dPos));
          this.applySection();
          this.onSectionMove?.(Math.round(this.sec.pos));
        }
      }
      this.handleDrag.lastX = e.clientX;
      this.handleDrag.lastY = e.clientY;
    };
    handle.addEventListener("pointerdown", (e) => {
      if (!this.sec) return;
      e.stopPropagation();
      e.preventDefault();
      this.handleDrag = { lastX: e.clientX, lastY: e.clientY };
      handle.setPointerCapture(e.pointerId);
      handle.style.cursor = "grabbing";
    });
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", (e) => {
      this.handleDrag = null;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      handle.style.cursor = "grab";
    });
  }

  /** Whether a model id is already federated (guards re-adds from effect re-runs). */
  hasModel(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /** World-space (Y-up) AABB of one element, or null if it has no geometry.
   *  Used by clash detection's broad phase. */
  elementBounds(id: number): Bounds | null {
    const b = this.bounds.get(id);
    return b ? { min: [...b.min] as [number, number, number], max: [...b.max] as [number, number, number] } : null;
  }

  /** Flat world-space (Y-up) triangle soup for one element: 9 floats per triangle
   *  (v0 xyz, v1 xyz, v2 xyz). Null if the element has no retained geometry. Used
   *  by clash detection's narrow phase. */
  elementTriangleSoup(id: number): Float32Array | null {
    const list = this.geom.get(id);
    if (!list || !list.length) return null;
    let triCount = 0;
    for (const g of list) triCount += g.idx.length / 3;
    const out = new Float32Array(triCount * 9);
    let o = 0;
    for (const g of list) {
      const { pos, idx } = g;
      for (let i = 0; i < idx.length; i++) {
        const v = idx[i] * 3;
        out[o++] = pos[v];
        out[o++] = pos[v + 1];
        out[o++] = pos[v + 2];
      }
    }
    return out;
  }

  /** Map a global id back to its owning model + local expressId + store. */
  resolveGlobal(globalId: number): { modelId: string; store: IfcDataStore; localId: number } | null {
    const r = this.fed.fromGlobalId(globalId);
    if (!r) return null;
    const rec = this.models.get(r.modelId);
    if (!rec) return null;
    return { modelId: r.modelId, store: rec.store, localId: r.expressId };
  }

  /**
   * Parse + stream a model into the shared scene. Each model's expressIds are
   * offset into a global id space (first model → offset 0, so single-model
   * behaviour is identical and primary global ids == local ids). Non-primary
   * models stream against the primary's RTC offset so they align spatially.
   */
  async addModel(
    modelId: string,
    bytes: Uint8Array,
    fileName: string,
    opts?: { fitView?: boolean },
  ): Promise<{ store: IfcDataStore; offset: number; localIDs: number[]; globalIDs: number[]; isFirst: boolean }> {
    const existing = this.models.get(modelId);
    if (existing) {
      return { store: existing.store, offset: existing.offset, localIDs: existing.localIDs, globalIDs: existing.globalIDs, isFirst: existing.offset === 0 };
    }
    const store = await parseStore(bytes);
    const isFirst = this.models.size === 0;
    let maxId = 0;
    for (const k of store.entityIndex.byId.keys()) if (k > maxId) maxId = k;
    const offset = this.fed.registerModel(modelId, maxId);

    const localIDs = new Set<number>();
    const globalIDs = new Set<number>();
    const collected: MeshData[] = [];
    let rtc = { x: 0, y: 0, z: 0 };
    // Render-space (Y-up) shift placing this model relative to the primary's
    // origin. Primary → no shift; others → (their RTC − primary RTC). null until
    // the RTC is known (then any buffered batches are flushed).
    let delta: [number, number, number] | null = isFirst ? [0, 0, 0] : null;
    const pending: MeshData[] = [];

    const computeDelta = (): [number, number, number] => {
      const p = this.primaryRtc ?? { x: 0, y: 0, z: 0 };
      // rtc is IFC Z-up (x=E, y=N, z=up); render is Y-up (x=E, y=up, z=−N).
      return [rtc.x - p.x, rtc.z - p.z, p.y - rtc.y];
    };
    const place = (meshes: MeshData[]) => {
      const d = delta!;
      const shift = d[0] !== 0 || d[1] !== 0 || d[2] !== 0;
      for (const m of meshes) {
        if (shift) {
          const o = m.origin ?? [0, 0, 0];
          m.origin = [o[0] + d[0], o[1] + d[1], o[2] + d[2]];
        }
        this.accumBounds(m);
        this.retainGeometry(m);
        collected.push(m);
      }
      this.renderer.addMeshes(meshes, true);
      this.renderer.requestRender();
    };

    const proc = new GeometryProcessor();
    await proc.init();
    for await (const ev of proc.processStreaming(bytes)) {
      if (this.disposed) break;
      if (ev.type === "rtcOffset") {
        rtc = ev.rtcOffset;
        if (isFirst) { this.primaryRtc = ev.rtcOffset; this.rtcOffset = ev.rtcOffset; }
        else if (delta === null) { delta = computeDelta(); if (pending.length) { place(pending); pending.length = 0; } }
      } else if (ev.type === "batch") {
        for (const m of ev.meshes) {
          if (m.expressId > maxId) continue; // defensive: id outside registered range
          m.expressId += offset; // shift into the global id space
          localIDs.add(m.expressId - offset);
          globalIDs.add(m.expressId);
        }
        if (delta !== null) place(ev.meshes);
        else pending.push(...ev.meshes); // RTC not yet known (rare) → buffer
      } else if (ev.type === "complete" && (ev as any).coordinateInfo?.wasmRtcOffset) {
        if (isFirst) this.rtcOffset = (ev as any).coordinateInfo.wasmRtcOffset;
        else if (delta === null) { rtc = (ev as any).coordinateInfo.wasmRtcOffset; }
      }
    }
    proc.dispose?.();
    if (delta === null) delta = computeDelta(); // RTC arrived only at "complete"
    if (pending.length) place(pending);

    const rec: LoadedModelRec = { store, offset, localIDs: [...localIDs], globalIDs: [...globalIDs], rtcOffset: rtc, fileName, meshes: collected };
    // Drop any outline edges cached from PARTIAL geometry (an id offset range can
    // be reused after a remove, and geom lists grow while a model streams in).
    for (const g of rec.globalIDs) this.edgeCache.delete(g);
    this.models.set(modelId, rec);
    if (isFirst) this.store = store;
    this.recomputeAllIDs();
    this.renderer.ensureMeshResources();
    if (opts?.fitView ?? isFirst) this.renderer.fitToView();
    this.renderer.requestRender();
    return { store, offset, localIDs: rec.localIDs, globalIDs: rec.globalIDs, isFirst };
  }

  /** Remove a federated model. Per-entity removal is unreliable on color-merged
   *  batches, so clear the scene and re-add the remaining models' meshes. */
  removeModel(modelId: string): void {
    const rec = this.models.get(modelId);
    if (!rec) return;
    for (const g of rec.globalIDs) {
      this.bounds.delete(g);
      this.geom.delete(g);
      this.snapCache.delete(g);
      this.edgeCache.delete(g);
    }
    this.fed.unregisterModel(modelId);
    this.models.delete(modelId);
    const scene = this.renderer.getScene();
    scene.clear();
    for (const r of this.models.values()) this.renderer.addMeshes(r.meshes, false);
    this.recomputeAllIDs();
    this.renderer.ensureMeshResources();
    this.renderer.requestRender();
  }

  private recomputeAllIDs(): void {
    const all: number[] = [];
    for (const rec of this.models.values()) all.push(...rec.globalIDs);
    this.allIDs = all;
  }

  /** Keep a CPU copy of world-space (Y-up) geometry so we can outline a selection. */
  private retainGeometry(m: MeshData): void {
    const [ox, oy, oz] = m.origin ?? [0, 0, 0];
    const src = m.positions;
    const pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      pos[i] = src[i] + ox;
      pos[i + 1] = src[i + 1] + oy;
      pos[i + 2] = src[i + 2] + oz;
    }
    const list = this.geom.get(m.expressId) ?? [];
    list.push({ pos, idx: new Uint32Array(m.indices) });
    this.geom.set(m.expressId, list);
  }

  /** Set the selection silhouette outline color (CSS color string). */
  setOutlineColor(color: string): void {
    this.outlinePath?.setAttribute("stroke", color);
  }

  /** Build the lime silhouette edges (world Y-up) for the selected element(s).
   *  Cached per element (see edgeCache) and capped (see OUTLINE_MAX_*) so huge
   *  selections stay responsive — beyond the caps the outline is partial. */
  setSelectionOutline(ids: Iterable<number>): void {
    const segs: number[] = [];
    let count = 0;
    for (const id of ids) {
      if (count >= OUTLINE_MAX_IDS || segs.length >= OUTLINE_MAX_FLOATS) break;
      count++;
      let edges = this.edgeCache.get(id);
      if (edges === undefined) {
        const list = this.geom.get(id);
        const tmp: number[] = [];
        if (list) for (const g of list) collectSharpEdges(g.pos, g.idx, tmp);
        edges = new Float32Array(tmp);
        this.edgeCache.set(id, edges);
      }
      for (let i = 0; i < edges.length; i++) segs.push(edges[i]);
    }
    this.selEdges = segs.length ? new Float32Array(segs) : null;
    this.renderer.requestRender();
  }

  private drawOutline(): void {
    const path = this.outlinePath;
    if (!path) return;
    if (!this.selEdges) {
      path.setAttribute("d", "");
      return;
    }
    const cam = this.renderer.getCamera();
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const e = this.selEdges;
    let d = "";
    for (let i = 0; i < e.length; i += 6) {
      const a = cam.projectToScreen({ x: e[i], y: e[i + 1], z: e[i + 2] }, w, h);
      const b = cam.projectToScreen({ x: e[i + 3], y: e[i + 4], z: e[i + 5] }, w, h);
      if (a && b) d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    path.setAttribute("d", d);
  }

  /**
   * Upload the section plane as a FIXED bounding-box-sized rectangle outline,
   * drawn in 3D by the renderer (GPU) so it never morphs on zoom and never
   * changes size as it slides (Trimble-style). No fill — edges only.
   */
  private uploadSectionPlane(): void {
    const mb = this.modelBounds();
    if (!this.sec || !this.sec.enabled || !mb) {
      this.secCenterWorld = null;
      this.secQuad = null;
      return;
    }
    const { normal: n, dMin, dMax, pos, anchor } = this.sec;
    const distance = dMin + (pos / 100) * (dMax - dMin);
    // Anchor the widget at the double-click point (projected onto the current
    // plane), so it sits where the user clicked and slides perpendicular as the
    // plane moves — instead of snapping to the bounding-box centre.
    const ndotc = n[0] * anchor[0] + n[1] * anchor[1] + n[2] * anchor[2];
    const c: [number, number, number] = [anchor[0] + n[0] * (distance - ndotc), anchor[1] + n[1] * (distance - ndotc), anchor[2] + n[2] * (distance - ndotc)];
    this.secCenterWorld = c;
    const { tangent: tg, bitangent: bt } = planeBasis(n);
    // Small indicator: half-size = secSizePct of the model's half-diagonal (slider).
    const s = this.secSizePct * 0.5 * Math.hypot(mb.max[0] - mb.min[0], mb.max[1] - mb.min[1], mb.max[2] - mb.min[2]);
    const corner = (su: number, sv: number): [number, number, number] =>
      [c[0] + tg[0] * su + bt[0] * sv, c[1] + tg[1] * su + bt[1] * sv, c[2] + tg[2] * su + bt[2] * sv];
    this.secQuad = [corner(s, s), corner(s, -s), corner(-s, -s), corner(-s, s)];
  }

  /** Set the section indicator size (fraction 0..1 of the model half-diagonal). */
  setSectionSize(pct: number): void {
    this.secSizePct = Math.max(0.02, Math.min(1, pct));
    this.uploadSectionPlane();
    this.renderer.requestRender();
  }

  /** Draw the section indicator as a filled magenta quad (projected each frame). */
  private drawSectionQuad(): void {
    const path = this.sectionPath;
    if (!path) return;
    const q = this.secQuad;
    if (!q) { path.setAttribute("d", ""); return; }
    const cam = this.renderer.getCamera();
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    let d = "";
    for (let i = 0; i < q.length; i++) {
      const p = cam.projectToScreen({ x: q[i][0], y: q[i][1], z: q[i][2] }, w, h);
      if (!p) { path.setAttribute("d", ""); return; } // a corner behind camera → hide
      d += `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
    path.setAttribute("d", d + "Z");
  }

  /** Position the scissor handle at the projected plane centre (per-frame). */
  private drawSectionHandle(): void {
    const handle = this.sectionHandle;
    if (!handle) return;
    if (!this.sec || !this.sec.enabled || !this.secCenterWorld) {
      handle.style.display = "none";
      return;
    }
    const cam = this.renderer.getCamera();
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const c = this.secCenterWorld;
    const hc = cam.projectToScreen({ x: c[0], y: c[1], z: c[2] }, w, h);
    if (hc) {
      handle.style.display = "flex";
      handle.style.left = `${hc.x}px`;
      handle.style.top = `${hc.y}px`;
    } else {
      handle.style.display = "none";
    }
  }

  private accumBounds(m: MeshData): void {
    const [ox, oy, oz] = m.origin ?? [0, 0, 0];
    let b = this.bounds.get(m.expressId);
    if (!b) {
      b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      this.bounds.set(m.expressId, b);
    }
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] + ox, y = p[i + 1] + oy, z = p[i + 2] + oz;
      if (x < b.min[0]) b.min[0] = x; if (x > b.max[0]) b.max[0] = x;
      if (y < b.min[1]) b.min[1] = y; if (y > b.max[1]) b.max[1] = y;
      if (z < b.min[2]) b.min[2] = z; if (z > b.max[2]) b.max[2] = z;
    }
  }

  setState(patch: Partial<RenderState>): void {
    this.state = { ...this.state, ...patch };
    this.renderer.requestRender();
  }

  private loop = (): void => {
    if (this.disposed) return;
    const t = performance.now();
    const dt = (t - this.lastT) / 1000;
    this.lastT = t;
    const animating = this.renderer.getCamera().update(dt);
    if (animating || this.renderer.consumeRenderRequest()) {
      this.renderer.render({
        clearColor: this.state.clearColor,
        hiddenIds: this.state.hiddenIds,
        isolatedIds: this.state.isolatedIds,
        selectedIds: this.state.selectedIds,
        sectionPlane: this.state.sectionPlane ?? undefined,
      });
      this.drawOutline();
      this.drawSectionQuad();
      this.drawSectionHandle();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // --- pointer controls ---------------------------------------------------
  private attachControls(): void {
    const cv = this.canvas;
    const cam = this.renderer.getCamera();
    let btn = -1;
    let lx = 0, ly = 0;

    const onDown = (e: PointerEvent) => {
      btn = e.button;
      lx = e.clientX; ly = e.clientY;
      cv.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (btn < 0) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (btn === 0) cam.orbit(dx * ORBIT_SENS, dy * ORBIT_SENS, false);
      else if (btn === 2 || btn === 1) cam.pan(dx * PAN_SENS, dy * PAN_SENS, false);
      this.renderer.requestRender();
    };
    const onUp = (e: PointerEvent) => {
      btn = -1;
      try { cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      cam.zoom(e.deltaY * ZOOM_SENS, false, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      this.renderer.requestRender();
    };
    const onCtx = (e: Event) => e.preventDefault();
    // Suppress the middle-button autoscroll (Chrome/Edge on Windows) so it can pan.
    const onMouseDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", onCtx);
    cv.addEventListener("mousedown", onMouseDown);
    this.detach = () => {
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("contextmenu", onCtx);
      cv.removeEventListener("mousedown", onMouseDown);
    };
  }

  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  async pick(clientX: number, clientY: number) {
    const { x, y } = this.toCanvas(clientX, clientY);
    return this.renderer.pick(x, y, { hiddenIds: this.state.hiddenIds, isolatedIds: this.state.isolatedIds });
  }

  raycast(clientX: number, clientY: number) {
    const { x, y } = this.toCanvas(clientX, clientY);
    return this.renderer.raycastScene(x, y, {
      hiddenIds: this.state.hiddenIds,
      isolatedIds: this.state.isolatedIds,
    });
  }

  /**
   * Custom snapping (the renderer's built-in snap is unreliable on batched
   * geometry): raycast for the hit element, then find the nearest welded vertex
   * or edge point within SNAP_PX screen pixels, from our retained geometry.
   */
  snap(clientX: number, clientY: number): { point: { x: number; y: number; z: number }; type: SnapType } | null {
    const rc = this.raycast(clientX, clientY);
    if (!rc) return null;
    const P = rc.intersection.point;
    const o = this.snapOptions;
    const faceFallback = () => (o.face ? { point: P, type: "face" as SnapType } : null);
    const data = this.snapData(rc.intersection.expressId);
    if (!data) return faceFallback();

    const cam = this.renderer.getCamera();
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const { x: cx, y: cy } = this.toCanvas(clientX, clientY);
    const cp = cam.getPosition();
    const dist = Math.hypot(cp.x - P.x, cp.y - P.y, cp.z - P.z) || 1;
    const worldR = (SNAP_PX / (h / 2)) * Math.tan(cam.getFOV() / 2) * dist * 2; // generous prefilter
    const wr2 = worldR * worldR;
    const V = data.verts;

    let best: { point: { x: number; y: number; z: number }; type: SnapType } | null = null;
    let bestPx = SNAP_PX;
    let bestPri = 9;
    const consider = (px: number, py: number, pz: number, pri: number, type: SnapType) => {
      const dx = px - P.x, dy = py - P.y, dz = pz - P.z;
      if (dx * dx + dy * dy + dz * dz > wr2) return;
      const s = cam.projectToScreen({ x: px, y: py, z: pz }, w, h);
      if (!s) return;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d > SNAP_PX) return;
      if (pri < bestPri || (pri === bestPri && d < bestPx)) {
        best = { point: { x: px, y: py, z: pz }, type };
        bestPx = d;
        bestPri = pri;
      }
    };
    if (o.vertex) for (let i = 0; i < V.length; i += 3) consider(V[i], V[i + 1], V[i + 2], 0, "vertex"); // endpoints
    if (o.midpoint || o.edge) {
      const E = data.edges;
      for (let i = 0; i < E.length; i += 2) {
        const a = E[i] * 3, b = E[i + 1] * 3;
        if (o.midpoint) consider((V[a] + V[b]) / 2, (V[a + 1] + V[b + 1]) / 2, (V[a + 2] + V[b + 2]) / 2, 1, "midpoint");
        if (o.edge) {
          const ex = V[b] - V[a], ey = V[b + 1] - V[a + 1], ez = V[b + 2] - V[a + 2];
          const len2 = ex * ex + ey * ey + ez * ez || 1;
          let t = ((P.x - V[a]) * ex + (P.y - V[a + 1]) * ey + (P.z - V[a + 2]) * ez) / len2;
          t = Math.max(0, Math.min(1, t));
          consider(V[a] + ex * t, V[a + 1] + ey * t, V[a + 2] + ez * t, 2, "edge");
        }
      }
    }
    return best ?? faceFallback();
  }

  private snapData(id: number): { verts: Float32Array; edges: Uint32Array } | null {
    const cached = this.snapCache.get(id);
    if (cached !== undefined) return cached;
    const list = this.geom.get(id);
    const data = list ? buildSnapData(list) : null;
    this.snapCache.set(id, data);
    return data;
  }

  /** Overall model bounds (renderer Y-up world), folded from per-element bounds. */
  modelBounds(): Bounds | null {
    return this.selectionBounds(this.bounds.keys());
  }

  // --- section (arbitrary plane aligned to a picked face) -----------------
  // `anchor` = the world point where the section was created (double-click hit),
  // so the widget sits there and slides perpendicular, not at the bbox centre.
  private sec: { normal: [number, number, number]; dMin: number; dMax: number; pos: number; flipped: boolean; enabled: boolean; anchor: [number, number, number] } | null = null;

  /** Re-apply the section state to the renderer (clip via normal + distance). */
  private applySection(): void {
    if (!this.sec || !this.sec.enabled) {
      this.setState({ sectionPlane: null });
      this.uploadSectionPlane();
      return;
    }
    const { normal, dMin, dMax, pos, flipped } = this.sec;
    const distance = dMin + (pos / 100) * (dMax - dMin);
    const axis = nearestCardinalAxis(normal).axis; // for the type (clip uses normal+distance)
    // No fill cap — just the plane edges drawn in 3D (uploadSectionPlane).
    this.setState({
      sectionPlane: { axis, position: pos, enabled: true, flipped, normal, distance, showCap: false, showOutlines: false } as SectionPlane,
    });
    this.uploadSectionPlane();
  }

  /** Orient the section to a picked face (plane normal = face normal, through the hit point). Returns position %. */
  orientSection(normal: [number, number, number], point: [number, number, number]): number {
    const L = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    const n: [number, number, number] = [normal[0] / L, normal[1] / L, normal[2] / L];
    const mb = this.modelBounds();
    if (!mb) return 50;
    let dMin = Infinity, dMax = -Infinity;
    for (const X of [mb.min[0], mb.max[0]]) for (const Y of [mb.min[1], mb.max[1]]) for (const Z of [mb.min[2], mb.max[2]]) {
      const d = n[0] * X + n[1] * Y + n[2] * Z;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
    const dHit = n[0] * point[0] + n[1] * point[1] + n[2] * point[2];
    const pos = dMax > dMin ? Math.max(0, Math.min(100, ((dHit - dMin) / (dMax - dMin)) * 100)) : 50;
    this.sec = { normal: n, dMin, dMax, pos, flipped: false, enabled: true, anchor: point };
    this.applySection();
    return Math.round(pos);
  }

  /** Remove the section plane entirely (no cut, no indicator). */
  clearSection(): void {
    this.sec = null;
    this.setState({ sectionPlane: null });
    this.uploadSectionPlane();
  }

  sectionSetPos(pos: number): void {
    if (this.sec) { this.sec.pos = pos; this.applySection(); }
  }
  sectionSetFlipped(f: boolean): void {
    if (this.sec) { this.sec.flipped = f; this.applySection(); }
  }

  // --- framing ------------------------------------------------------------
  private selectionBounds(ids: Iterable<number>): Bounds | null {
    const b: Bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let any = false;
    for (const id of ids) {
      const e = this.bounds.get(id);
      if (!e) continue;
      any = true;
      for (let i = 0; i < 3; i++) {
        if (e.min[i] < b.min[i]) b.min[i] = e.min[i];
        if (e.max[i] > b.max[i]) b.max[i] = e.max[i];
      }
    }
    return any ? b : null;
  }

  zoomToSelection(ids: Iterable<number>): void {
    const b = this.selectionBounds(ids);
    if (!b) return;
    this.renderer.getCamera().frameBounds(
      { x: b.min[0], y: b.min[1], z: b.min[2] },
      { x: b.max[0], y: b.max[1], z: b.max[2] },
    );
    this.renderer.requestRender();
  }

  /** Frame a cube of half-size `half` centered on a world point (Y-up). Used by
   *  clash detection to zoom onto the interference region, not the whole elements. */
  zoomToBox(center: [number, number, number], half: number): void {
    const h = Math.max(half, 1e-3);
    this.renderer.getCamera().frameBounds(
      { x: center[0] - h, y: center[1] - h, z: center[2] - h },
      { x: center[0] + h, y: center[1] + h, z: center[2] + h },
    );
    this.renderer.requestRender();
  }

  /** Frame ALL loaded (federated) models — a single deterministic view that
   *  always frames everything currently loaded. */
  fit(): void {
    this.frameDir(this.modelBounds(), [1, 1, 1]);
  }

  /** Orbit the camera by raw pixel deltas (used by the nav-cube drag). */
  orbit(dx: number, dy: number): void {
    this.renderer.getCamera().orbit(dx * ORBIT_SENS, dy * ORBIT_SENS, false);
    this.renderer.requestRender();
  }

  /** Zoom toward the viewport centre by a wheel-like delta (nav-bar +/- buttons).
   *  Negative = zoom in, positive = zoom out (matches wheel deltaY). */
  zoomBy(delta: number): void {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.getCamera().zoom(delta, false, w / 2, h / 2, w, h);
    this.renderer.requestRender();
  }

  setPresetView(view: "top" | "bottom" | "front" | "back" | "left" | "right"): void {
    const mb = this.renderer.getModelBounds();
    this.renderer.getCamera().setPresetView(view, mb ?? undefined);
    this.renderer.requestRender();
  }

  /** Frame a bounds box from a render-space direction (shared by view presets). */
  private frameDir(b: Bounds | null, dir: [number, number, number]): void {
    if (!b) return;
    const c: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const radius = 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
    const dist = radius * 2.5;
    const cam = this.renderer.getCamera();
    cam.setPosition(c[0] + d[0] * dist, c[1] + d[1] * dist, c[2] + d[2] * dist);
    cam.setTarget(c[0], c[1], c[2]);
    // Up is world-up unless looking near-vertically (then pick a horizontal up).
    if (Math.abs(d[1]) > 0.99) cam.setUp(0, 0, -1);
    else cam.setUp(0, 1, 0);
    this.renderer.requestRender();
  }

  /** Look at ALL models' centre from an arbitrary render-space direction (used by
   *  the nav-cube edges/corners and the Izometric preset). */
  setViewDirection(dir: [number, number, number]): void {
    this.frameDir(this.modelBounds(), dir);
  }

  /** CSS matrix3d (rotation only) mirroring the camera orientation, for the
   *  nav-cube. world→view rotation with CSS Y-down flip on the up/forward rows. */
  cubeMatrix(): string {
    const cam = this.renderer.getCamera();
    const p = cam.getPosition(), t = cam.getTarget(), u = cam.getUp();
    const nrm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const f = nrm([t.x - p.x, t.y - p.y, t.z - p.z]);
    const r = nrm(cross(f, [u.x, u.y, u.z]));
    const tu = cross(r, f); // true up (orthonormal)
    // world→view rotation R has rows [r, tu, -f]. CSS is Y-down, so the cube
    // transform is the PROPER rotation F·R·F (F = diag(1,-1,1)) — i.e. negate the
    // middle column. Using F·R alone is a reflection and mirrors the labels.
    const m = [
      r[0], -tu[0], -f[0], 0,
      -r[1], tu[1], f[1], 0,
      r[2], -tu[2], -f[2], 0,
      0, 0, 0, 1,
    ];
    return `matrix3d(${m.map((n) => (Math.abs(n) < 1e-6 ? 0 : Number(n.toFixed(6)))).join(",")})`;
  }

  resize(): void {
    this.renderer.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
    this.renderer.requestRender();
  }

  /** Renderer Y-up world (RTC-subtracted) → absolute IFC model coords (Z-up). */
  worldToIfc(w: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: w.x + this.rtcOffset.x, y: -w.z + this.rtcOffset.y, z: w.y + this.rtcOffset.z };
  }

  async screenshot(): Promise<string | null> {
    return this.renderer.captureScreenshot();
  }

  // --- BCF viewpoint capture / apply --------------------------------------
  // Camera coords stay in the renderer's raw Y-up world space; the @ifc-lite/bcf
  // helpers (createViewpoint/extractViewpointState) do the Y-up↔Z-up conversion
  // themselves, so we must NOT pre-convert with worldToIfc here.
  getCameraState(): ViewerCameraState {
    const cam = this.renderer.getCamera();
    const p = cam.getPosition(), t = cam.getTarget(), u = cam.getUp();
    const ortho = cam.getProjectionMode() === "orthographic";
    return {
      position: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z },
      up: { x: u.x, y: u.y, z: u.z },
      fov: cam.getFOV(),
      isOrthographic: ortho,
      orthoScale: ortho ? cam.getOrthoSize() : undefined,
    };
  }

  /** Overall model bounds as a {min,max} box (renderer Y-up world) for viewpoints. */
  getModelBoundsState(): ViewerBounds | null {
    const b = this.modelBounds();
    if (!b) return null;
    return {
      min: { x: b.min[0], y: b.min[1], z: b.min[2] },
      max: { x: b.max[0], y: b.max[1], z: b.max[2] },
    };
  }

  // --- per-element color overrides (e.g. IDS non-conforming = red) --------
  /** Paint elements with per-element RGBA colors (0..1) — e.g. one color per
   *  data-table group. Replaces any prior override set. */
  setColorOverrideMap(map: Map<number, [number, number, number, number]>): void {
    const device = this.renderer.getGPUDevice();
    const pipeline = this.renderer.getPipeline();
    if (!device || !pipeline) return;
    const scene = this.renderer.getScene();
    if (map.size) scene.setColorOverrides(new Map(map), device, pipeline);
    else scene.clearColorOverrides();
    this.renderer.requestRender();
  }

  /** Remove all color overrides (restore original element colors). */
  clearColorOverrides(): void {
    this.renderer.getScene().clearColorOverrides();
    this.renderer.requestRender();
  }

  /** Switch the camera between perspective and orthographic, preserving the view. */
  setProjection(mode: "perspective" | "orthographic"): void {
    const cam = this.renderer.getCamera();
    if (cam.getProjectionMode() === mode) return;
    cam.setProjectionMode(mode);
    this.renderer.requestRender();
  }

  /** Restore a camera pose captured in a BCF viewpoint (Y-up world coords). */
  applyCameraState(s: ViewerCameraState): void {
    const cam = this.renderer.getCamera();
    cam.setProjectionMode(s.isOrthographic ? "orthographic" : "perspective");
    cam.setPosition(s.position.x, s.position.y, s.position.z);
    cam.setTarget(s.target.x, s.target.y, s.target.z);
    cam.setUp(s.up.x, s.up.y, s.up.z);
    cam.setFOV(s.fov);
    if (s.isOrthographic && s.orthoScale != null) cam.setOrthoSize(s.orthoScale);
    this.renderer.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detach?.();
    this.outlineSvg?.remove();
    this.sectionHandle?.remove();
    try { this.renderer.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Extract feature edges (dihedral > 50° or boundary) as world segments.
 *
 * @ifc-lite tessellation emits UNWELDED vertices (each triangle owns its 3
 * corners), so edge sharing must be detected by POSITION, not by index — else
 * every edge looks like a boundary and the whole triangulation is drawn. We weld
 * positions to a 1 mm grid, remap the triangles, then test the dihedral angle.
 */
function buildSnapData(list: { pos: Float32Array; idx: Uint32Array }[]): { verts: Float32Array; edges: Uint32Array } {
  const weld = new Map<string, number>();
  const verts: number[] = [];
  const edgeSet = new Set<string>();
  const edges: number[] = [];
  const Q = 1000;
  for (const g of list) {
    const local = new Int32Array(g.pos.length / 3);
    for (let v = 0; v < local.length; v++) {
      const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
      const key = Math.round(x * Q) + "_" + Math.round(y * Q) + "_" + Math.round(z * Q);
      let id = weld.get(key);
      if (id === undefined) {
        id = verts.length / 3;
        weld.set(key, id);
        verts.push(x, y, z);
      }
      local[v] = id;
    }
    for (let t = 0; t < g.idx.length; t += 3) {
      const c = [local[g.idx[t]], local[g.idx[t + 1]], local[g.idx[t + 2]]];
      for (let k = 0; k < 3; k++) {
        const a = c[k], b = c[(k + 1) % 3];
        if (a === b) continue;
        const ek = a < b ? a + "," + b : b + "," + a;
        if (edgeSet.has(ek)) continue;
        edgeSet.add(ek);
        edges.push(a, b);
      }
    }
  }
  return { verts: new Float32Array(verts), edges: new Uint32Array(edges) };
}

function collectSharpEdges(pos: Float32Array, idx: Uint32Array, out: number[]): void {
  const vCount = pos.length / 3;
  const canon = new Int32Array(vCount); // original vertex → welded id
  const weldKey = new Map<string, number>();
  const wpos: number[] = []; // welded positions (x,y,z…)
  const Q = 1000; // 1 mm grid
  for (let v = 0; v < vCount; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const key = Math.round(x * Q) + "_" + Math.round(y * Q) + "_" + Math.round(z * Q);
    let id = weldKey.get(key);
    if (id === undefined) {
      id = wpos.length / 3;
      weldKey.set(key, id);
      wpos.push(x, y, z);
    }
    canon[v] = id;
  }

  const edges = new Map<string, { n: [number, number, number][]; a: number; b: number }>();
  const triN = (i0: number, i1: number, i2: number): [number, number, number] => {
    const ax = pos[i1 * 3] - pos[i0 * 3], ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
    const bx = pos[i2 * 3] - pos[i0 * 3], by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const addEdge = (c0: number, c1: number, n: [number, number, number]) => {
    if (c0 === c1) return;
    const a = Math.min(c0, c1), b = Math.max(c0, c1);
    const key = a + "," + b;
    const e = edges.get(key);
    if (e) e.n.push(n);
    else edges.set(key, { n: [n], a, b });
  };
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const n = triN(i0, i1, i2);
    addEdge(canon[i0], canon[i1], n);
    addEdge(canon[i1], canon[i2], n);
    addEdge(canon[i2], canon[i0], n);
  }
  for (const e of edges.values()) {
    // Boundary (1 face) OR a crease where any two adjacent faces meet sharply.
    // |dot| handles inconsistent winding (flipped normals on shared facets).
    const sharp =
      e.n.length === 1 ||
      e.n.some((n0, i) => e.n.slice(i + 1).some((n1) => Math.abs(n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < SHARP_COS));
    if (!sharp) continue;
    out.push(wpos[e.a * 3], wpos[e.a * 3 + 1], wpos[e.a * 3 + 2], wpos[e.b * 3], wpos[e.b * 3 + 1], wpos[e.b * 3 + 2]);
  }
}
