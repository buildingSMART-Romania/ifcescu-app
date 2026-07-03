import { type ReactNode, type CSSProperties, type PointerEvent as ReactPointerEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { IfcDataStore } from "@ifc-lite/parser";
import type { ViewerCameraState } from "@ifc-lite/bcf";
import type { Theme } from "../hooks/useTheme";
import { usePersistedNumber } from "../hooks/usePersistedNumber";
import type { GeorefInfo } from "../ifc/editor";
import { detectSchema, type IfcSchema } from "../ifc/store";
import { IfcEditor, type SelectionDetail } from "../ifc/editor";
import { EditPanel } from "./EditPanel";
import { ViewerEngine } from "../viewer/engine";
import { buildTree, buildClassTree, buildMaterialTree, getSelectionProps, gatherFileInfo, offsetTree, modelRootNode } from "../viewer/model";
import { MeasureTool, type MeasureMode } from "../viewer/measure";
import { computePlacement, type PlacementMode } from "../geo/placement";
import { IfcTree, defaultNodeOpen, nodeLabel, type TreeNode } from "./IfcTree";
import { ToolIcon, VisIcon, ViewIcon, UiIcon } from "./icons";
import { PropAccordion, FileInfoPanel, type PropGroup, type FileInfo } from "./PropsPanel";
import { useI18n } from "../i18n/react";
import { useSettings } from "../settings/react";
import { t, type I18nKey } from "../i18n";
import { BcfPanel } from "./BcfPanel";
import { IdsPanel } from "./IdsPanel";
import { DataTablePanel } from "./DataTablePanel";
import { ModelsPanel } from "./ModelsPanel";
import { NavCube } from "./NavCube";
import { ViewBar } from "./ViewBar";
import { groupColor, type PivotConfig, type PivotModel, type Rgba } from "../viewer/pivot";
import { runIdsValidation } from "../ifc/ids";
import type { IDSValidationReport, IDSDocument } from "../ifc/ids";
import { IdsEditorModal } from "./IdsEditorModal";
import { FilterPanel, DEFAULT_FILTER_RULES, type FilterRule } from "./FilterPanel";
// Lazy so Recharts only loads when the analytics panel is opened.
const AnalyticsPanel = lazy(() => import("./AnalyticsPanel"));
// Lazy so the clash detection panel (and its compute) load only when opened.
const ClashPanel = lazy(() => import("./ClashPanel"));
import { createBCFFromIDSReport, addTopicToProject, extractViewpointState, globalIdsToExpressIds, type BCFProject, type BCFViewpoint } from "../ifc/bcf";

// Non-conforming IDS elements are painted this red in the 3D view.
const IDS_FAIL_COLOR: [number, number, number, number] = [0.85, 0.13, 0.13, 1];

// The mutually-exclusive bottom panels (one open at a time).
type BottomDock = "none" | "filter" | "clash" | "analytics" | "table";

/** A locally-saved viewpoint: camera pose + user visibility (B4). */
interface Viewpoint {
  id: string;
  name: string;
  cam: ViewerCameraState;
  hidden: number[];
  isolated: number[] | null;
}

interface Props {
  /** The primary model's editor (owned by App so edits survive tab switches). */
  editor: IfcEditor;
  /** Report the primary IFC's change count up to App (drives the download button). */
  onChangeCount: (n: number) => void;
  bytes: Uint8Array;
  fileName: string;
  theme: Theme;
  georef: GeorefInfo | null;
  favorites: Set<string>;
  onToggleFavorite: (key: string) => void;
  /** Shared BCF project (lifted to App so it survives tab switches / new imports). */
  bcfProject?: BCFProject | null;
  onBcfProject?: (p: BCFProject) => void;
  /** IDS validation report (docked IDS panel lives inside the 3D viewer). */
  idsReport?: IDSValidationReport | null;
  onIdsReport?: (r: IDSValidationReport | null) => void;
  /** Federated models (primary first). The 3D viewer aggregates all of them;
   *  Editare/Glob/IDS/BCF stay on the primary (`bytes`/`fileName`/`georef`). */
  models: ViewerModelInput[];
  onAddModel: (file: File) => void;
  onRemoveModel: (id: string) => void;
  /** Report whether the primary model can be placed on the globe (drives the Glob 3D button). */
  onPlacementMode?: (mode: PlacementMode) => void;
}

export interface ViewerModelInput {
  id: string;
  bytes: Uint8Array;
  fileName: string;
  georef: GeorefInfo | null;
  primary: boolean;
}

const VIEWER_BG: Record<Theme, [number, number, number, number]> = {
  light: [0.933, 0.941, 0.957, 1],
  dark: [0.039, 0.055, 0.102, 1], // deep navy, matches the dark UI (#0a0e1a)
};
const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as any).gpu;

/** "#rrggbb" → renderer clearColor [r,g,b,a] in 0..1. */
function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.93, 0.94, 0.96, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

const sectionCtlStyle: CSSProperties = {
  position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 9,
  display: "flex", alignItems: "center", gap: 14, padding: "8px 14px",
  background: "rgba(20,20,24,0.86)", color: "#fff", borderRadius: 8,
  boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
};

/** Grouped toolbar dropdown (closes on click-outside / Escape). */
function Dropdown({ label, icon, active, children }: { label: string; icon: ReactNode; active?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="vgroup" ref={ref}>
      <button className={"vbtn" + (active ? " active" : "")} onClick={() => setOpen((o) => !o)}>
        <span className="ic">{icon}</span>
        <span>{label}</span>
        <span className="caret">▾</span>
      </button>
      {open && <div className="vmenu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

// Max auto-fit width for the tree panel (matches the manual-resize clamp).
const TREE_MAX_WIDTH = 560;
// Shared canvas 2D context for measuring tree label widths (no DOM/layout thrash).
let _treeMeasureCtx: CanvasRenderingContext2D | null = null;
function treeMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_treeMeasureCtx) _treeMeasureCtx = document.createElement("canvas").getContext("2d");
  return _treeMeasureCtx;
}

export function Viewer({ editor, onChangeCount, bytes, fileName, theme, georef, favorites, onToggleFavorite, bcfProject, onBcfProject, idsReport, onIdsReport, models, onAddModel, onRemoveModel, onPlacementMode }: Props) {
  const { t, lang } = useI18n();
  const { settings, update } = useSettings();
  const analyticsEnabled = settings.experimental.analytics;
  // The bottom area is single-occupancy: Filter / Clash / Analytics (absolute
  // .an-dock overlays) and Table (a flow panel) share it, so exactly one is open
  // at a time — opening one closes the others. The right-side IDS/BCF docks are
  // tracked separately (see `dock`) and can coexist with a bottom panel.
  const [bottomDock, setBottomDock] = useState<BottomDock>("none");
  const bottomDockRef = useRef(bottomDock);
  bottomDockRef.current = bottomDock;
  const toggleBottom = (d: BottomDock) => setBottomDock((c) => (c === d ? "none" : d));
  // Mirrors the current projection so the empty-deps keydown handler reads a fresh
  // value when toggling with "O" (avoids a stale closure).
  const projectionRef = useRef(settings.viewer.projection);
  projectionRef.current = settings.viewer.projection;
  const hostRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const measureRef = useRef<MeasureTool | null>(null);
  const storeRef = useRef<IfcDataStore | null>(null);
  const georefRef = useRef<GeorefInfo | null>(georef);

  const allIDsRef = useRef<number[]>([]);
  const hiddenRef = useRef<Set<number>>(new Set());
  const isolatedRef = useRef<Set<number> | null>(null);
  const selectedRef = useRef<Set<number>>(new Set());
  const lastHiddenRef = useRef<number[]>([]);
  const sectionRef = useRef(false);

  // Federation: per-model store registry (keyed by model id) + which models are
  // loaded in the engine + per-model visibility (hidden global ids and ids set).
  const modelStoresRef = useRef<Map<string, { store: IfcDataStore; offset: number; localIDs: number[]; globalIDs: number[]; fileName: string; schema: IfcSchema }>>(new Map());
  const loadedModelIdsRef = useRef<Set<string>>(new Set());
  const hiddenModelsRef = useRef<Set<string>>(new Set());
  const modelHiddenRef = useRef<Set<number>>(new Set());
  // The owning model + local id of the (single) current selection, for editing.
  const editTargetRef = useRef<{ modelId: string; localId: number } | null>(null);

  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  // Mirror the mode in a ref so the empty-deps keydown handler (which captures
  // chooseMeasure once) always toggles against the CURRENT mode, not the initial.
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  const [snapOpts, setSnapOpts] = useState({ ...settings.viewer.snap });
  const toggleSnap = (k: "vertex" | "midpoint" | "edge" | "face") =>
    setSnapOpts((s) => {
      const next = { ...s, [k]: !s[k] };
      if (engineRef.current) engineRef.current.snapOptions = next;
      return next;
    });
  const [section, setSection] = useState(false);
  const [secPos, setSecPos] = useState(50);
  const [secFlip, setSecFlip] = useState(false);
  const [secSize, setSecSize] = useState(18); // section indicator size (% of half-diagonal)
  const [propGroups, setPropGroups] = useState<PropGroup[] | null>(null);
  const [propsKey, setPropsKey] = useState(0);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [selHeader, setSelHeader] = useState<{ name: string; type: string } | null>(null);
  // In-3D editing: edit mode on/off + the structured snapshot the EditPanel renders.
  const [editing, setEditing] = useState(false);
  // Holds the latest edit-toggle logic so the empty-deps keydown handler always
  // sees current state/closures (mirrors the toolbar Edit button's behavior).
  const toggleEditRef = useRef<() => void>(() => {});
  const [editDetail, setEditDetail] = useState<SelectionDetail | null>(null);
  // Only the primary model is editable; its id (federation offset 0).
  const primaryId = useMemo(() => models.find((m) => m.primary)?.id ?? models[0]?.id, [models]);
  const [propsWidth, setPropsWidth] = usePersistedNumber("propsWidth", 340);
  const [treeWidth, setTreeWidth] = usePersistedNumber("treeWidth", 300);
  // Vertical size of the "Modele" panel. null = auto (CSS-capped at 40%); once the
  // user drags the divider it becomes a fixed pixel height.
  const [modelsHeight, setModelsHeight] = usePersistedNumber("modelsHeight", null);
  // Filter dock rules live here (not in FilterPanel) so closing/reopening the
  // dock — or opening another dock — doesn't discard a built-up rule set.
  const [filterRules, setFilterRules] = useState<FilterRule[]>(DEFAULT_FILTER_RULES);
  const [filterCombinator, setFilterCombinator] = useState<"AND" | "OR">("AND");
  // Per-model forests (one MODEL root per model). Built by rebuildForests().
  const [spatialRoots, setSpatialRoots] = useState<TreeNode[] | null>(null);
  const [classRoots, setClassRoots] = useState<TreeNode[] | null>(null);
  const [materialRoots, setMaterialRoots] = useState<TreeNode[] | null>(null);
  // Active left-panel view: spatial hierarchy, grouped by IFC class, or by material.
  const [treeView, setTreeView] = useState<"spatial" | "class" | "material">("spatial");
  // Tree expansion is owned here (one open-id set per view) so it survives switching
  // between Spațial/Clase/Materiale tabs — IfcTree no longer remounts/loses state.
  const [expandedByView, setExpandedByView] = useState<Record<"spatial" | "class" | "material", Set<number>>>({
    spatial: new Set(),
    class: new Set(),
    material: new Set(),
  });
  // Models list shown in the "Modele" panel; bumped version re-memoizes pivot input.
  const [modelList, setModelList] = useState<{ id: string; fileName: string; primary: boolean; visible: boolean; schema: string }[]>([]);
  const [busyAdd, setBusyAdd] = useState(false);
  const [modelsVersion, setModelsVersion] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [ready, setReady] = useState(false);
  // The right dock hosts the IDS or BCF panel (toolbar toggles; mutually exclusive).
  // Filter lives in `bottomDock` — it renders as a bottom .an-dock, not on the right.
  const [dock, setDock] = useState<"none" | "ids" | "bcf">("none");
  // Mirror for the empty-deps keydown handler (Escape closes the open dock).
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const [idsEditorOpen, setIdsEditorOpen] = useState(false);
  // Model-info panel is open by default on load; it can be closed (×) or toggled
  // from the toolbar. A selection still takes over the right panel with props.
  const [showInfo, setShowInfo] = useState(true);
  // Per-element colors from the data-table "color by group" toggle (null = off).
  // Takes priority over the IDS red-paint when both could apply.
  const [groupColorMap, setGroupColorMap] = useState<Map<number, Rgba> | null>(null);
  // "Color by model" (left panel): paints each federated model a distinct color.
  const [colorByModel, setColorByModel] = useState(false);
  // Suppress the persistent auto overlays (IDS red, color-by-model) — set by the
  // BCF "reset view" so the model returns fully neutral; cleared when the user
  // re-enables an overlay (new IDS run / color-by-model on).
  const [baseColorsOff, setBaseColorsOff] = useState(false);
  // B4: locally-saved viewpoints (camera + visibility), persisted per file.
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([]);
  const vpSeq = useRef(0);
  // Bottom data-table (pivot) config — persists while the panel (bottomDock ===
  // "table") is toggled off/on.
  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    // Default grouping = Model → IFC class. "model" is auto-ignored when only one
    // model is loaded (it's not in the discovered fields then), so it falls back
    // to grouping by class alone.
    groupBy: ["model", "class"],
    values: [], // start with just the built-in "Număr" column; add value columns via ⚙
    showTotals: true,
  });

  // Each view is a forest of per-model MODEL roots (built in rebuildForests).
  const activeRoots = treeView === "class" ? classRoots : treeView === "material" ? materialRoots : spatialRoots;
  const expanded = expandedByView[treeView];

  const toggleNode = (id: number) =>
    setExpandedByView((m) => {
      const next = new Set(m[treeView]);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...m, [treeView]: next };
    });
  const collapseAllTree = () => setExpandedByView((m) => ({ ...m, [treeView]: new Set<number>() }));
  const expandAllTree = () => setExpandedByView((m) => ({ ...m, [treeView]: collectAllIds(activeRoots ?? []) }));

  // Pivot input: all loaded models' stores (memoized on the loaded-set version).
  const pivotModels = useMemo<PivotModel[]>(
    () => [...modelStoresRef.current.entries()].map(([id, r]) => ({ id, fileName: r.fileName, store: r.store, localIDs: r.localIDs, offset: r.offset })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelsVersion],
  );

  // Auto-fit the tree panel width to the longest visible label (grow-only, capped),
  // so deep/long hierarchy names are not truncated. Measures the actual font with a
  // canvas (no layout thrash); the user can still resize down manually.
  useEffect(() => {
    const roots = activeRoots;
    if (!roots || !roots.length) return;
    const ctx = treeMeasureCtx();
    if (!ctx) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const px = rem * 0.85; // .ifctree font-size
    const ff = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    const fontNormal = `${px}px ${ff}`;
    const fontBold = `600 ${px}px ${ff}`; // branch rows are bold
    let max = 0;
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        const hasChildren = n.children.length > 0;
        ctx.font = hasChildren ? fontBold : fontNormal;
        // 72 = paddings + caret + eye + gaps + scrollbar margin; 14/level indent; 19 = model icon.
        const w = 72 + depth * 14 + (n.type === "MODEL" ? 19 : 0) + ctx.measureText(nodeLabel(n)).width;
        if (w > max) max = w;
        if (hasChildren && expanded.has(n.expressID)) walk(n.children, depth + 1);
      }
    };
    walk(roots, 0);
    const target = Math.min(TREE_MAX_WIDTH, Math.ceil(max));
    setTreeWidth((w) => (target > w ? target : w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoots, expanded, treeView, lang, modelsVersion]);

  useEffect(() => {
    if (!hasWebGPU) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || engineRef.current) return;
    let disposed = false;

    const engine = new ViewerEngine(canvas);
    engineRef.current = engine;
    (window as any).__engine = engine;
    engine.setState({ clearColor: VIEWER_BG[theme] });

    // Resize on the next animation frame (not a 100ms timeout): opening/closing a
    // dock or the props panel changes the viewer width, and a slow resize leaves
    // the WebGPU canvas stretched for a moment. rAF coalesces bursts (e.g. while
    // dragging a divider) without the visible lag.
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => engineRef.current?.resize());
    });
    ro.observe(host);

    (async () => {
      try {
        await engine.init();
        engine.resize();
        if (disposed) return;
        // Load the PRIMARY model; federated extras are added by the diff effect.
        const primary = models.find((m) => m.primary) ?? models[0];
        const { store, offset, localIDs, globalIDs } = await engine.addModel(primary.id, primary.bytes, primary.fileName, { fitView: true });
        if (disposed) return;
        storeRef.current = store;
        allIDsRef.current = engine.allIDs;
        modelStoresRef.current.set(primary.id, { store, offset, localIDs, globalIDs, fileName: primary.fileName, schema: detectSchema(primary.bytes) });
        loadedModelIdsRef.current.add(primary.id);
        setVisibleIds(new Set(engine.allIDs));

        measureRef.current = new MeasureTool(engine, host);
        measureRef.current.setGeoref(georefRef.current);
        engine.onSectionMove = (pos) => setSecPos(pos); // keep the slider in sync with the drag handle
        wireEvents(host);

        // Model centroid in IFC absolute coords (handles real-coordinate models
        // whose IfcMapConversion has a zero Eastings/Northings offset).
        const mb = engine.modelBounds();
        const centroid = mb
          ? engine.worldToIfc({ x: (mb.min[0] + mb.max[0]) / 2, y: (mb.min[1] + mb.max[1]) / 2, z: (mb.min[2] + mb.max[2]) / 2 })
          : { x: engine.rtcOffset.x, y: engine.rtcOffset.y, z: engine.rtcOffset.z };
        setFileInfo(
          gatherFileInfo(store, globalIDs.length, bytes.length, fileName, detectSchema(bytes), georefRef.current, centroid),
        );
        // Tell App whether this model can be placed on the globe. Uses the same
        // computePlacement logic as the globe: placeable only when the anchor is a
        // real Romanian location (a zero/degenerate georef → "none").
        const pMode = computePlacement(georefRef.current, { minX: centroid.x, minY: centroid.y, minZ: centroid.z, maxX: centroid.x, maxY: centroid.y, maxZ: centroid.z }, null).mode;
        onPlacementMode?.(pMode);
        setReady(true);
      } catch (e: any) {
        if (!disposed) console.error("Viewer: failed to load model", e);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      measureRef.current?.dispose();
      engine.dispose();
      // Detach the native host handlers wired in wireEvents (they close over refs
      // we're nulling; leaving them attached could fire during teardown).
      host.onclick = null;
      host.ondblclick = null;
      host.onmousemove = null;
      measureRef.current = null;
      engineRef.current = null;
      delete (window as any).__engine;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background: a settings override (hex) wins over the theme default.
  useEffect(() => {
    const bg = settings.viewer.background;
    engineRef.current?.setState({ clearColor: bg ? hexToRgba(bg) : VIEWER_BG[theme] });
  }, [theme, settings.viewer.background]);

  // Camera projection follows the setting.
  useEffect(() => {
    engineRef.current?.setProjection(settings.viewer.projection);
  }, [settings.viewer.projection, ready]);

  // Default snap options come from settings (toolbar toggles still override live).
  useEffect(() => {
    const next = { ...settings.viewer.snap };
    setSnapOpts(next);
    if (engineRef.current) engineRef.current.snapOptions = next;
  }, [settings.viewer.snap]);

  useEffect(() => {
    georefRef.current = georef;
    measureRef.current?.setGeoref(georef);
  }, [georef]);

  // Federation: react to the models list — add newcomers, remove the departed,
  // then rebuild the per-model forests. Runs once primary is ready, then on every
  // models change. Guarded against duplicate adds (StrictMode / re-runs).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    let cancelled = false;
    (async () => {
      for (const m of models) {
        if (loadedModelIdsRef.current.has(m.id) || engine.hasModel(m.id)) continue;
        setBusyAdd(true);
        try {
          const { store, offset, localIDs, globalIDs } = await engine.addModel(m.id, m.bytes, m.fileName, { fitView: false });
          if (cancelled) return;
          modelStoresRef.current.set(m.id, { store, offset, localIDs, globalIDs, fileName: m.fileName, schema: detectSchema(m.bytes) });
          loadedModelIdsRef.current.add(m.id);
        } catch (e) {
          console.error("Federare: nu am putut adăuga modelul", m.fileName, e);
        }
      }
      for (const id of [...loadedModelIdsRef.current]) {
        if (models.some((m) => m.id === id)) continue;
        engine.removeModel(id);
        const rec = modelStoresRef.current.get(id);
        if (rec) for (const g of rec.globalIDs) modelHiddenRef.current.delete(g);
        hiddenModelsRef.current.delete(id);
        modelStoresRef.current.delete(id);
        loadedModelIdsRef.current.delete(id);
      }
      if (cancelled) return;
      setBusyAdd(false);
      allIDsRef.current = engine.allIDs;
      rebuildForests();
      applyVisibility();
      setModelList(models.map((m) => ({ id: m.id, fileName: m.fileName, primary: m.primary, visible: !hiddenModelsRef.current.has(m.id), schema: detectSchema(m.bytes) })));
      setModelsVersion((v) => v + 1);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, ready]);

  // Rebuild the per-model forests when the language changes so the localised
  // tree labels (e.g. the material buckets) follow the switch. Skips the initial
  // render (the model effect builds them) and any time models aren't ready yet.
  const didMountLang = useRef(false);
  useEffect(() => {
    if (!didMountLang.current) { didMountLang.current = true; return; }
    if (ready && engineRef.current) rebuildForests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Turning the section tool OFF removes the plane. Turning it ON only ARMS the
  // tool — the plane is created when the user double-clicks a face.
  useEffect(() => {
    if (!section) engineRef.current?.clearSection();
  }, [section]);

  // Keep the fullscreen flag in sync (handles Esc / external exit too).
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else mainRef.current?.requestFullscreen?.();
  };

  // Keyboard: Esc cancels; H hide/restore selection; Z zoom extents; C frame selection; F filter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Don't let viewer shortcuts fire behind an open modal (Settings/Help/Filter/IDS editor).
      if (document.querySelector(".modal-backdrop")) return;
      // Nor while the viewer pane is hidden (Glob 3D tab active — the Viewer stays
      // mounted for state, but its shortcuts must not act invisibly).
      if (hostRef.current && hostRef.current.offsetParent === null) return;
      if (e.key === "Escape") {
        // Cancel an active tool first; then the bottom panel; then the right dock
        // — the same Escape-to-close the modals already have.
        if (measureModeRef.current !== "none" || sectionRef.current) {
          chooseMeasure("none");
          if (sectionRef.current) toggleSection();
        } else if (bottomDockRef.current !== "none") {
          setBottomDock("none");
        } else if (dockRef.current !== "none") {
          setDock("none");
        }
      } else if (e.key === "h" || e.key === "H") {
        toggleHideSelection();
      } else if (e.key === "a" || e.key === "A") {
        showAll();
      } else if (e.key === "z" || e.key === "Z") {
        engineRef.current?.fit();
      } else if (e.key === "c" || e.key === "C") {
        if (selectedRef.current.size) engineRef.current?.zoomToSelection(selectedRef.current); // frame selection
      } else if (e.key === "l" || e.key === "L") {
        if (selectedRef.current.size) isolateIds([...selectedRef.current]); // isolate selection
      } else if (e.key === "s" || e.key === "S") {
        toggleSection();
      } else if (e.key === "e" || e.key === "E") {
        toggleEditRef.current(); // toggle the attribute/property editor
      } else if (e.key === "m" || e.key === "M") {
        chooseMeasure("length");
      } else if (e.key === "t" || e.key === "T") {
        toggleBottom("table");
      } else if (e.key === "b" || e.key === "B") {
        setDock((d) => (d === "bcf" ? "none" : "bcf"));
      } else if (e.key === "i" || e.key === "I") {
        setDock((d) => (d === "ids" ? "none" : "ids"));
      } else if (e.key === "f" || e.key === "F") {
        toggleBottom("filter");
      } else if (e.key === "o" || e.key === "O") {
        update({ viewer: { projection: projectionRef.current === "perspective" ? "orthographic" : "perspective" } });
      } else if (e.key === "/") {
        e.preventDefault();
        (document.querySelector(".ifctree-search input") as HTMLInputElement | null)?.focus();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        engineRef.current?.zoomBy(-200);
      } else if (e.key === "-") {
        e.preventDefault();
        engineRef.current?.zoomBy(200);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (measureRef.current?.hasSelection()) { e.preventDefault(); measureRef.current.deleteSelected(); }
      } else if (e.key === "1") {
        engineRef.current?.setPresetView("top");
      } else if (e.key === "2") {
        engineRef.current?.setPresetView("bottom");
      } else if (e.key === "3") {
        engineRef.current?.setPresetView("front");
      } else if (e.key === "4") {
        engineRef.current?.setPresetView("back");
      } else if (e.key === "5") {
        engineRef.current?.setPresetView("left");
      } else if (e.key === "6") {
        engineRef.current?.setPresetView("right");
      } else if (e.key === "0") {
        engineRef.current?.setViewDirection([1, 1, 1]); // isometric
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Color overrides have two drivers sharing one channel: the data-table
  // "color by group" map (takes priority) and the IDS red-paint of non-conforming
  // elements. The base layer is memoized separately from the selection fill so a
  // plain selection click doesn't rebuild the whole map (a full GPU re-upload).
  const baseColorMap = useMemo(() => {
    // Base layer priority: data-table group colors > color-by-model > IDS red.
    const map = new Map<number, [number, number, number, number]>();
    if (!ready) return map;
    if (groupColorMap && groupColorMap.size) {
      for (const [id, c] of groupColorMap) map.set(id, c);
    } else if (!baseColorsOff && colorByModel) {
      let i = 0;
      for (const rec of modelStoresRef.current.values()) {
        const c = groupColor(i++);
        for (const g of rec.globalIDs) map.set(g, c);
      }
    } else if (!baseColorsOff && idsReport) {
      for (const spec of idsReport.specificationResults)
        for (const e of spec.entityResults) if (!e.passed) map.set(e.expressId, IDS_FAIL_COLOR);
    }
    return map;
    // `models` so color-by-model picks up newly federated models (modelStoresRef is a ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupColorMap, colorByModel, idsReport, baseColorsOff, ready, models]);
  // The last map actually pushed to the GPU — skip re-uploads when nothing changed
  // (e.g. selection clicks while the fill tint is off, the default).
  const lastColorMapRef = useRef<Map<number, [number, number, number, number]> | null>(null);
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !ready) return;
    // Selection fill tints the selected elements on top (when a fill color is set).
    const fill = settings.viewer.selection.fill;
    let map = baseColorMap;
    if (fill && selectedIds.size) {
      map = new Map(baseColorMap);
      const c = hexToRgba(fill);
      for (const id of selectedIds) map.set(id, c);
    }
    if (map === lastColorMapRef.current) return; // same base, no fill → GPU already up to date
    if (!map.size && !lastColorMapRef.current?.size) { lastColorMapRef.current = map; return; }
    lastColorMapRef.current = map;
    if (map.size) eng.setColorOverrideMap(map);
    else eng.clearColorOverrides();
  }, [baseColorMap, ready, selectedIds, settings.viewer.selection.fill]);

  // A fresh IDS run should reveal its coloring even after a previous reset.
  useEffect(() => { if (idsReport) setBaseColorsOff(false); }, [idsReport]);

  // Selection outline color follows the setting.
  useEffect(() => {
    engineRef.current?.setOutlineColor(settings.viewer.selection.outline);
  }, [settings.viewer.selection.outline, ready]);

  // Validate an authored IDS doc (from the editor) against the loaded model. The
  // editor stays OPEN (so the user can keep editing / exporting); the report is
  // pushed to the IDS panel behind the modal and returned for an inline summary.
  const validateAuthoredIds = async (doc: IDSDocument): Promise<IDSValidationReport | null> => {
    setDock("ids");
    try {
      const report = await runIdsValidation(bytes, doc, fileName);
      onIdsReport?.(report);
      return report;
    } catch (e) {
      console.error("IDS validation failed", e);
      return null;
    }
  };

  // IDS → BCF: one topic per failing entity, merged into the shared project,
  // then flip the dock to BCF so the new topics are visible.
  const exportIdsToBcf = (report: IDSValidationReport) => {
    const generated = createBCFFromIDSReport(
      {
        title: report.document.info.title || "IDS",
        description: report.document.info.description,
        specificationResults: report.specificationResults,
      },
      { projectName: report.document.info.title || fileName, version: "2.1" },
    );
    if (bcfProject) {
      for (const t of generated.topics.values()) addTopicToProject(bcfProject, t);
      onBcfProject?.({ ...bcfProject });
    } else {
      onBcfProject?.(generated);
    }
    setDock("bcf");
  };

  function wireEvents(host: HTMLElement) {
    host.onclick = async (ev: MouseEvent) => {
      // Only the 3D canvas drives picking/measurement. Overlays inside the host
      // (ViewBar, NavCube, section controls) are interactive and must NOT fall
      // through to a pick — React's stopPropagation can't stop this native
      // host-level handler (React listens at the root, above the host), so we
      // gate on the target instead. The SVG overlays are pointer-events:none, so
      // genuine 3D clicks still land on the canvas.
      if (ev.target !== canvasRef.current) return;
      const measure = measureRef.current;
      if (measure && measure.mode !== "none") return measure.onClick(ev);
      if (sectionRef.current) return;
      // Outside measure mode, a click first tries to select an existing
      // measurement; only if none is hit do we fall through to element picking.
      if (measure && measure.selectAt(ev.clientX, ev.clientY)) { clearSelection(); return; }
      const engine = engineRef.current;
      if (!engine) return;
      const additive = ev.shiftKey; // Shift+click → multi-select (toggle)
      const hit = await engine.pick(ev.clientX, ev.clientY);
      if (hit && hit.expressId != null) {
        selectIds([hit.expressId], hit.expressId, additive);
      } else if (!additive) {
        clearSelection();
      }
    };
    host.ondblclick = (ev: MouseEvent) => {
      const measure = measureRef.current;
      if (measure && measure.mode === "area") return measure.onDblClick();
      if (measure && measure.mode !== "none") return;
      // Only when the section tool is armed: double-click a face → create the cut there.
      if (sectionRef.current) sectionFromFace(ev);
    };
    host.onmousemove = (ev: MouseEvent) => {
      const measure = measureRef.current;
      if (measure && measure.mode !== "none") { measure.onMove(ev); return; }
    };
  }

  const isPrimary = (modelId: string) => modelId === primaryId;

  // --- selection ----------------------------------------------------------
  // `additive` (Shift+click) toggles the given ids into the current selection
  // instead of replacing it, for multi-select in the 3D viewer.
  const selectIds = (ids: number[], expressID?: number, additive = false) => {
    if (ids.length) lastHiddenRef.current = [];
    let next: number[];
    if (additive) {
      const cur = new Set(selectedRef.current);
      for (const id of ids) (cur.has(id) ? cur.delete(id) : cur.add(id));
      next = [...cur];
    } else {
      next = ids;
    }
    selectedRef.current = new Set(next);
    setSelectedIds(new Set(next));
    engineRef.current?.setSelectionOutline(next);
    // Selecting something new exits any active edit form.
    setEditing(false);
    setEditDetail(null);
    // The clicked element drives the properties panel — but only if it's still
    // selected after an additive toggle; otherwise fall back to a lone selection.
    const clicked = expressID ?? (ids.length === 1 ? ids[0] : undefined);
    const propId =
      clicked != null && selectedRef.current.has(clicked)
        ? clicked
        : next.length === 1
          ? next[0]
          : undefined;
    // Route the global id back to its owning model's store for properties.
    const r = propId != null ? engineRef.current?.resolveGlobal(propId) : null;
    if (r) {
      editTargetRef.current = { modelId: r.modelId, localId: r.localId };
      // Primary elements read through App's editor (mutation-aware, so applied
      // edits persist on reselect). Federated models are view-only.
      if (isPrimary(r.modelId)) {
        const detail = editor.getSelection(r.localId);
        setSelHeader(detail.header);
        setPropGroups(detailToPropGroups(detail));
      } else {
        const { header, groups } = getSelectionProps(r.store, r.localId);
        setSelHeader(header);
        setPropGroups(groups);
      }
      setPropsKey((k) => k + 1);
    } else {
      editTargetRef.current = null;
      setPropGroups(null);
      setSelHeader(null);
    }
  };

  const clearSelection = () => {
    selectedRef.current = new Set();
    setSelectedIds(new Set());
    engineRef.current?.setSelectionOutline([]);
    editTargetRef.current = null;
    setEditing(false);
    setEditDetail(null);
    setPropGroups(null);
    setSelHeader(null);
  };

  // --- editing (primary model only) ---------------------------------------
  // Editable whenever the selection resolves to a single real entity on the
  // primary model. editTargetRef is only set when resolveGlobal maps a real
  // positive id to an owning model, so synthetic class-group / MODEL-root rows
  // (negative ids) stay non-editable while non-geometric spatial containers —
  // whose own expressId resolves — become editable.
  const canEditSelection = !!editTargetRef.current && isPrimary(editTargetRef.current.modelId);

  const startEdit = () => {
    const t = editTargetRef.current;
    if (!t || !isPrimary(t.modelId)) return;
    setEditDetail(editor.getSelection(t.localId));
    setEditing(true);
  };

  const onEditSaved = () => {
    const t = editTargetRef.current;
    if (!t) return;
    // Edits were applied to App's editor by the EditPanel; refresh + report.
    const detail = editor.getSelection(t.localId);
    setPropGroups(detailToPropGroups(detail));
    setSelHeader(detail.header);
    setEditing(false);
    setEditDetail(null);
    onChangeCount(editor.changeCount());
  };

  const exitEdit = () => {
    setEditing(false);
    setEditDetail(null);
  };

  // Keep the "E" shortcut bound to the current closures (the keydown effect's deps
  // are empty, so it reads this ref instead of stale state).
  toggleEditRef.current = () => {
    if (editing) exitEdit();
    else if (canEditSelection) startEdit();
  };

  // Rebuild the three per-model forests (one MODEL root per loaded model). Spatial
  // keeps the per-container class subgrouping; ids are offset into global space.
  const rebuildForests = () => {
    const spatial: TreeNode[] = [];
    const cls: TreeNode[] = [];
    const mat: TreeNode[] = [];
    let idx = 0;
    for (const m of models) {
      const rec = modelStoresRef.current.get(m.id);
      if (!rec) continue;
      const rootId = -(2_000_000 + idx);
      const localSet = new Set(rec.localIDs);
      const sRaw = buildTree(rec.store, localSet);
      const sGrouped = sRaw ? groupByClass(sRaw, { n: 0 }) : null;
      spatial.push(modelRootNode(rootId, rec.fileName, sGrouped ? [offsetTree(sGrouped, rec.offset)] : [], rec.globalIDs));
      cls.push(modelRootNode(rootId, rec.fileName, buildClassTree(rec.store, localSet).map((n) => offsetTree(n, rec.offset)), rec.globalIDs));
      mat.push(modelRootNode(rootId, rec.fileName, buildMaterialTree(rec.store, localSet).map((n) => offsetTree(n, rec.offset)), rec.globalIDs));
      idx++;
    }
    setSpatialRoots(spatial);
    setClassRoots(cls);
    setMaterialRoots(mat);
    // Seed each view's expansion with its default-open nodes. Rebuilds happen on
    // federation changes (add/remove model), where resetting expansion is expected.
    setExpandedByView({
      spatial: collectDefaultOpen(spatial),
      class: collectDefaultOpen(cls),
      material: collectDefaultOpen(mat),
    });
  };

  // --- visibility ---------------------------------------------------------
  const applyVisibility = () => {
    const eng = engineRef.current;
    if (!eng) return;
    // Effective hidden = element-level hides ∪ per-model hides.
    const hidden = new Set<number>(hiddenRef.current);
    for (const id of modelHiddenRef.current) hidden.add(id);
    eng.setState({ hiddenIds: hidden, isolatedIds: isolatedRef.current ? new Set(isolatedRef.current) : null });
    const all = allIDsRef.current;
    const iso = isolatedRef.current;
    const next = new Set<number>(iso ? [...iso] : all);
    for (const id of hidden) next.delete(id);
    setVisibleIds(next);
  };

  // Per-model visibility toggle (folds the model's global ids into the hidden set).
  const toggleModelVisible = (id: string, visible: boolean) => {
    const rec = modelStoresRef.current.get(id);
    if (!rec) return;
    if (visible) {
      hiddenModelsRef.current.delete(id);
      for (const g of rec.globalIDs) modelHiddenRef.current.delete(g);
    } else {
      hiddenModelsRef.current.add(id);
      for (const g of rec.globalIDs) modelHiddenRef.current.add(g);
    }
    applyVisibility();
    setModelList((l) => l.map((m) => (m.id === id ? { ...m, visible } : m)));
  };

  const hideIds = (ids: number[]) => {
    for (const id of ids) hiddenRef.current.add(id);
    applyVisibility();
    clearSelection();
  };
  const showIds = (ids: number[]) => {
    for (const id of ids) hiddenRef.current.delete(id);
    applyVisibility();
  };
  const isolateIds = (ids: number[]) => {
    isolatedRef.current = new Set(ids);
    hiddenRef.current.clear();
    applyVisibility();
    clearSelection();
  };
  const showAll = () => {
    isolatedRef.current = null;
    hiddenRef.current.clear();
    applyVisibility();
  };

  // --- saved viewpoints (B4) ----------------------------------------------
  const vpKey = `viewpoints:${fileName}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`viewpoints:${fileName}`);
      const list: Viewpoint[] = raw ? JSON.parse(raw) : [];
      setViewpoints(Array.isArray(list) ? list : []);
      vpSeq.current = Array.isArray(list) ? list.length : 0;
    } catch {
      setViewpoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);
  const persistViewpoints = (list: Viewpoint[]) => {
    setViewpoints(list);
    try { localStorage.setItem(vpKey, JSON.stringify(list)); } catch { /* quota — keep in memory */ }
  };
  const saveViewpoint = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const vp: Viewpoint = {
      id: `vp-${Date.now()}-${++vpSeq.current}`,
      name: t("viewpoints.defaultName", { n: viewpoints.length + 1 }),
      cam: eng.getCameraState(),
      hidden: [...hiddenRef.current],
      isolated: isolatedRef.current ? [...isolatedRef.current] : null,
    };
    persistViewpoints([...viewpoints, vp]);
  };
  const restoreViewpoint = (vp: Viewpoint) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.applyCameraState(vp.cam);
    if (vp.isolated) isolateIds(vp.isolated);
    else { showAll(); if (vp.hidden.length) hideIds(vp.hidden); }
  };
  const deleteViewpoint = (id: string) => persistViewpoints(viewpoints.filter((v) => v.id !== id));
  const hideSelection = () => {
    const ids = [...selectedRef.current];
    if (!ids.length) return;
    lastHiddenRef.current = ids;
    hideIds(ids);
  };
  const toggleHideSelection = () => {
    if (selectedRef.current.size) {
      hideSelection();
    } else if (lastHiddenRef.current.length) {
      showIds(lastHiddenRef.current);
      lastHiddenRef.current = [];
    }
  };

  // --- tools --------------------------------------------------------------
  const chooseMeasure = (mode: MeasureMode) => {
    const next = measureModeRef.current === mode ? "none" : mode;
    setMeasureMode(next);
    measureRef.current?.setMode(next);
    // Measurement and an active section coexist — do NOT reset the section here.
  };

  const toggleSection = () => {
    const on = !sectionRef.current;
    sectionRef.current = on;
    setSection(on);
  };

  // Double-click a face → section plane aligned to that face (normal = face
  // normal), through the hit point. Visible + movable afterwards via the slider.
  const sectionFromFace = (ev: MouseEvent) => {
    const eng = engineRef.current;
    if (!eng) return;
    const r = eng.raycast(ev.clientX, ev.clientY);
    if (!r) return;
    const n = r.intersection.normal;
    const p = r.intersection.point;
    const pos = eng.orientSection([n.x, n.y, n.z], [p.x, p.y, p.z]);
    sectionRef.current = true;
    setSection(true);
    setSecPos(pos);
    setSecFlip(false);
  };

  const clearSections = () => {
    sectionRef.current = false;
    setSection(false);
  };

  // Pointer events (not mouse) on all panel resizers so touch/pen work too.
  const startPropsResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    // Width is measured from the panel's right edge (which stays fixed as the
    // panel grows leftward), NOT the window edge — otherwise an open IDS/BCF
    // dock sitting to the right throws the math off by its width.
    const right = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().right;
    const onMove = (ev: PointerEvent) => setPropsWidth(Math.min(640, Math.max(260, right - ev.clientX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Drive the 3D scene from the analytics dashboard: isolate + color the matched
  // set, or reset when the selection is cleared.
  const onAnalyticsFilter = (ids: number[] | null, colors: Map<number, Rgba> | null) => {
    if (ids === null) {
      showAll();
      setGroupColorMap(null);
    } else {
      isolateIds(ids);
      setGroupColorMap(colors && colors.size ? colors : null);
    }
  };

  // Clash panel: isolate the two clashing elements, paint them (A red / B orange)
  // and frame them so the interference is centered in the view.
  const onClashShow = (ids: number[], colors: Map<number, Rgba>, focus?: { center: [number, number, number]; half: number }) => {
    isolateIds(ids);
    setGroupColorMap(colors.size ? colors : null);
    if (focus) engineRef.current?.zoomToBox(focus.center, focus.half);
    else engineRef.current?.zoomToSelection(ids);
  };
  const onClashReset = () => {
    showAll();
    setGroupColorMap(null);
  };

  // Map BCF GlobalIds to GLOBAL ids across all federated models (each model's
  // local expressIds are offset into the global id space).
  const guidsToGlobalIds = (guids: string[]): number[] => {
    if (!guids.length) return [];
    const out: number[] = [];
    for (const rec of modelStoresRef.current.values()) {
      for (const local of globalIdsToExpressIds(rec.store, guids)) out.push(local + rec.offset);
    }
    return out;
  };

  // Parse a BCF ARGB/RGB hex color (e.g. "FFDB2626") to a renderer Rgba (0..1).
  const argbToRgba = (hex: string): Rgba => {
    const h = hex.replace(/^#/, "");
    const has8 = h.length >= 8;
    const a = has8 ? parseInt(h.slice(0, 2), 16) : 255;
    const o = has8 ? 2 : 0;
    return [parseInt(h.slice(o, o + 2), 16) / 255, parseInt(h.slice(o + 2, o + 4), 16) / 255, parseInt(h.slice(o + 4, o + 6), 16) / 255, a / 255];
  };

  // Reset the scene after a BCF viewpoint: restore full visibility, drop the
  // viewpoint coloring and clear the selection.
  const onResetView = () => {
    showAll();
    setGroupColorMap(null);
    setBaseColorsOff(true); // also drop the IDS / color-by-model overlays
    selectIds([]);
  };

  // Apply a BCF viewpoint to the scene: camera, isolation, coloring and selection
  // — so opening a topic (clash/IDS/manual) reproduces its view, not just selects.
  const onApplyViewpoint = (vp: BCFViewpoint) => {
    const eng = engineRef.current;
    if (!eng) return;
    const bounds = eng.getModelBoundsState() ?? undefined;
    const state = extractViewpointState(vp, bounds);
    const visIds = guidsToGlobalIds(state.visibleGuids);
    const selIds = guidsToGlobalIds(state.selectedGuids);
    const colorMap = new Map<number, Rgba>();
    for (const c of state.coloredGuids) {
      const rgba = argbToRgba(c.color);
      for (const g of guidsToGlobalIds(c.guids)) colorMap.set(g, rgba);
    }
    if (state.camera) eng.applyCameraState(state.camera);
    if (visIds.length) isolateIds(visIds);
    setGroupColorMap(colorMap.size ? colorMap : null);
    if (selIds.length) selectIds(selIds, selIds.length === 1 ? selIds[0] : undefined);
    // No saved camera (e.g. IDS topics) -> frame the isolated/selected element(s).
    if (!state.camera) eng.zoomToSelection(visIds.length ? visIds : selIds);
  };
  const startModelsResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    // The panel sits directly before the divider; measure from its top edge so the
    // height tracks the cursor regardless of the toolbar/header above it.
    const panel = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const top = panel?.getBoundingClientRect().top ?? 0;
    const onMove = (ev: PointerEvent) =>
      setModelsHeight(Math.min(window.innerHeight * 0.75, Math.max(80, ev.clientY - top)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startTreeResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => setTreeWidth(Math.min(560, Math.max(200, ev.clientX - 12)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const selArr = () => [...selectedIds];

  if (!hasWebGPU) {
    return (
      <div className="viewer-wrap">
        <div className="viewer-main">
          <div className="alert error" style={{ margin: 24 }}>
            {t("viewer.webgpuPre")}<b>WebGPU</b>{t("viewer.webgpuPost")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-wrap">
      <aside className="ifctree-panel" style={{ width: treeWidth }}>
        <ModelsPanel
          models={modelList}
          busy={busyAdd}
          onToggleVisible={toggleModelVisible}
          onRemove={onRemoveModel}
          onAddModel={onAddModel}
          colorByModel={colorByModel}
          onColorByModel={(v) => { setColorByModel(v); if (v) setBaseColorsOff(false); }}
          height={modelsHeight}
        />
        <div className="models-resize" onPointerDown={startModelsResize} title={t("viewer.resizeModels")} />
        <div className="tree-tabs">
          <button className={"tree-tab" + (treeView === "spatial" ? " active" : "")} onClick={() => setTreeView("spatial")}>{t("viewer.treeSpatial")}</button>
          <button className={"tree-tab" + (treeView === "class" ? " active" : "")} onClick={() => setTreeView("class")}>{t("viewer.treeClass")}</button>
          <button className={"tree-tab" + (treeView === "material" ? " active" : "")} onClick={() => setTreeView("material")}>{t("viewer.treeMaterial")}</button>
        </div>
        {activeRoots ? (
          <IfcTree
            roots={activeRoots}
            expanded={expanded}
            onToggle={toggleNode}
            onCollapseAll={collapseAllTree}
            onExpandAll={expandAllTree}
            visibleIds={visibleIds}
            selectedIds={selectedIds}
            onSelect={(ids, expressID) => selectIds(ids, expressID)}
            onToggleVisible={(ids, visible) => (visible ? showIds(ids) : hideIds(ids))}
          />
        ) : (
          <div className="ifctree-empty">{t("viewer.treeLoading")}</div>
        )}
        <div className="tree-resize" onPointerDown={startTreeResize} title={t("viewer.resize")} />
      </aside>

      <div className="viewer-main" ref={mainRef}>
        <div className="vtoolbar">
          <Dropdown label={t("viewer.measure")} icon={<ToolIcon kind="measure" />} active={measureMode !== "none"}>
            <button className={"vmenu-item" + (measureMode === "length" ? " active" : "")} onClick={() => chooseMeasure("length")}><span className="ic"><ToolIcon kind="distance" /></span> {t("viewer.measureLength")}</button>
            <button className={"vmenu-item" + (measureMode === "point" ? " active" : "")} onClick={() => chooseMeasure("point")}><span className="ic"><ToolIcon kind="point" /></span> {t("viewer.measurePoint")}</button>
            <button className={"vmenu-item" + (measureMode === "area" ? " active" : "")} onClick={() => chooseMeasure("area")}><span className="ic"><UiIcon kind="area" /></span> {t("viewer.measureArea")}</button>
            <div className="vmenu-sep" />
            <div onClick={(e) => e.stopPropagation()} style={{ padding: "4px 12px", fontSize: 12 }}>
              <div style={{ opacity: 0.7, margin: "2px 0 4px" }}>{t("viewer.snapTo")}</div>
              {([["vertex", t("viewer.snapVertex")], ["midpoint", t("viewer.snapMid")], ["edge", t("viewer.snapEdge")], ["face", t("viewer.snapFace")]] as const).map(([k, lbl]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={snapOpts[k]} onChange={() => toggleSnap(k)} /> {lbl}
                </label>
              ))}
            </div>
            <div className="vmenu-sep" />
            <button className="vmenu-item danger" onClick={() => measureRef.current?.clearAll()}><span className="ic"><UiIcon kind="trash" /></span><span>{t("viewer.clearMeasures")}</span></button>
          </Dropdown>

          <span className="vsep" />

          <Dropdown label={t("viewer.section")} icon={<ToolIcon kind="section" />} active={section}>
            <button className={"vmenu-item" + (section ? " active" : "")} onClick={toggleSection}>
              <span className="ic"><ToolIcon kind="section" /></span><span>{t("viewer.sectionPlane")}</span><span className="vmenu-key">S</span>
            </button>
            <div className="vmenu-sep" />
            <button className="vmenu-item danger" onClick={clearSections}><span className="ic"><UiIcon kind="trash" /></span><span>{t("viewer.clearSections")}</span></button>
          </Dropdown>

          <span className="vsep" />

          <Dropdown label={t("viewer.visibility")} icon={<UiIcon kind="eye" />}>
            <button className="vmenu-item" onClick={() => hideIds(selArr())}>
              <span className="ic"><VisIcon kind="hide" /></span><span>{t("viewer.hideSel")}</span><span className="vmenu-key">H</span>
            </button>
            <button className="vmenu-item" onClick={() => isolateIds(selArr())}>
              <span className="ic"><VisIcon kind="isolate" /></span><span>{t("viewer.isolateSel")}</span><span className="vmenu-key">I</span>
            </button>
            <button className="vmenu-item" onClick={() => { if (selectedRef.current.size) engineRef.current?.zoomToSelection(selectedRef.current); }}>
              <span className="ic"><VisIcon kind="frame" /></span><span>{t("viewer.frameSel")}</span><span className="vmenu-key">C</span>
            </button>
            <div className="vmenu-sep" />
            <button className="vmenu-item" onClick={showAll}><span className="ic"><VisIcon kind="show" /></span><span>{t("viewer.showAll")}</span></button>
          </Dropdown>

          <span className="vsep" />

          <Dropdown label={t("viewer.views")} icon={<ToolIcon kind="views" />}>
            <button className="vmenu-item" onClick={() => engineRef.current?.setPresetView("top")}>
              <span className="ic"><ViewIcon kind="up" /></span><span>{t("viewer.viewTop")}</span><span className="vmenu-key">1</span>
            </button>
            <button className="vmenu-item" onClick={() => engineRef.current?.setPresetView("bottom")}>
              <span className="ic"><ViewIcon kind="down" /></span><span>{t("viewer.viewBottom")}</span><span className="vmenu-key">2</span>
            </button>
            <button className="vmenu-item" onClick={() => engineRef.current?.setPresetView("front")}>
              <span className="ic"><ViewIcon kind="front" /></span><span>{t("viewer.viewFront")}</span><span className="vmenu-key">3</span>
            </button>
            <button className="vmenu-item" onClick={() => engineRef.current?.setPresetView("back")}>
              <span className="ic"><ViewIcon kind="back" /></span><span>{t("viewer.viewBack")}</span><span className="vmenu-key">4</span>
            </button>
            <button className="vmenu-item" onClick={() => engineRef.current?.setPresetView("left")}>
              <span className="ic"><ViewIcon kind="left" /></span><span>{t("viewer.viewLeft")}</span><span className="vmenu-key">5</span>
            </button>
            <button className="vmenu-item" onClick={() => engineRef.current?.setPresetView("right")}>
              <span className="ic"><ViewIcon kind="right" /></span><span>{t("viewer.viewRight")}</span><span className="vmenu-key">6</span>
            </button>
            <div className="vmenu-sep" />
            <button className="vmenu-item" onClick={() => engineRef.current?.fit()}>
              <span className="ic"><UiIcon kind="fit" /></span><span>{t("viewer.fitAll")}</span><span className="vmenu-key">Z</span>
            </button>
            <div className="vmenu-sep" />
            <button className="vmenu-item" onClick={saveViewpoint}>
              <span className="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></span><span>{t("viewpoints.save")}</span>
            </button>
            {viewpoints.length > 0 && (
              <div className="vp-list" onClick={(e) => e.stopPropagation()}>
                {viewpoints.map((vp) => (
                  <div className="vp-row" key={vp.id}>
                    <span className="vp-name" title={t("viewpoints.restore")} onClick={() => restoreViewpoint(vp)}>{vp.name}</span>
                    <span className="vp-del" title={t("viewpoints.delete")} onClick={() => deleteViewpoint(vp.id)}>×</span>
                  </div>
                ))}
              </div>
            )}
          </Dropdown>

          <span className="vsep" />

          <button className={"vbtn" + (bottomDock === "filter" ? " active" : "")} onClick={() => toggleBottom("filter")} title={t("filter.title")}>
            <span className="ic"><ToolIcon kind="filter" /></span>
            <span>{t("filter.tab")}</span>
          </button>

          <button className={"vbtn" + (dock === "ids" ? " active" : "")} onClick={() => setDock((d) => (d === "ids" ? "none" : "ids"))}>
            <span className="ic"><ToolIcon kind="ids" /></span>
            <span>IDS</span>
          </button>

          <button className={"vbtn" + (dock === "bcf" ? " active" : "")} onClick={() => setDock((d) => (d === "bcf" ? "none" : "bcf"))}>
            <span className="ic"><ToolIcon kind="bcf" /></span>
            <span>BCF</span>
          </button>

          <button className={"vbtn" + (bottomDock === "table" ? " active" : "")} onClick={() => toggleBottom("table")}>
            <span className="ic"><ToolIcon kind="table" /></span>
            <span>{t("dataTable.tab")}</span>
          </button>

          {analyticsEnabled && (
            <button className={"vbtn" + (bottomDock === "analytics" ? " active" : "")} onClick={() => toggleBottom("analytics")} title={t("analytics.title")}>
              <span className="ic"><ToolIcon kind="analytics" /></span>
              <span>{t("analytics.tab")}</span>
            </button>
          )}


          <button className={"vbtn" + (bottomDock === "clash" ? " active" : "")} onClick={() => toggleBottom("clash")} disabled={pivotModels.length === 0} title={t("clash.title")}>
            <span className="ic"><ToolIcon kind="clash" /></span>
            <span>{t("clash.tab")}</span>
          </button>

          <span className="vsep" />

          <button className={"vbtn" + (showInfo ? " active" : "")} onClick={() => setShowInfo((s) => !s)} title={t("viewer.modelInfoTitle")}>
            <span className="ic"><ToolIcon kind="info" /></span>
            <span>{t("viewer.info")}</span>
          </button>
        </div>

        <div className="viewer-host" ref={hostRef} style={{ position: "relative" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
          {analyticsEnabled && bottomDock === "analytics" && ready && pivotModels.length > 0 && (
            <Suspense fallback={<div className="an-dock" style={{ height: 380 }} />}>
              <AnalyticsPanel models={pivotModels} onFilter={onAnalyticsFilter} onClose={() => setBottomDock("none")} />
            </Suspense>
          )}
          {bottomDock === "filter" && (
            <FilterPanel
              editor={editor}
              pivotModels={pivotModels}
              rules={filterRules}
              onRules={setFilterRules}
              combinator={filterCombinator}
              onCombinator={setFilterCombinator}
              onResult={(ids, isolate) => { if (isolate) isolateIds(ids); else selectIds(ids); }}
              onClose={() => setBottomDock("none")}
            />
          )}
          {bottomDock === "clash" && ready && pivotModels.length > 0 && engineRef.current && (
            <Suspense fallback={<div className="an-dock" style={{ height: 360 }} />}>
              <ClashPanel
                engine={engineRef.current}
                models={pivotModels}
                bcfProject={bcfProject}
                onBcfProject={onBcfProject}
                onOpenBcf={() => setDock("bcf")}
                fileName={fileName}
                onShow={onClashShow}
                onReset={onClashReset}
                onClose={() => setBottomDock("none")}
              />
            </Suspense>
          )}
          {ready && settings.viewer.navCube && (
            <NavCube
              getTransform={() => engineRef.current?.cubeMatrix() ?? ""}
              onFace={(v) => engineRef.current?.setPresetView(v)}
              onOrbit={(dx, dy) => engineRef.current?.orbit(dx, dy)}
            />
          )}
          {ready && settings.viewer.viewBar && (
            <ViewBar
              onFit={() => engineRef.current?.fit()}
              onFrame={() => { if (selectedIds.size) engineRef.current?.zoomToSelection(selectedIds); }}
              onHide={toggleHideSelection}
              onIsolate={() => { if (selectedIds.size) isolateIds([...selectedIds]); }}
              onShowAll={showAll}
              onMeasure={() => chooseMeasure("length")}
              onSection={toggleSection}
              onFullscreen={toggleFullscreen}
              hasSelection={selectedIds.size > 0}
              measuring={measureMode !== "none"}
              section={section}
              fullscreen={fullscreen}
            />
          )}
          {section && (
            <div className="section-ctl" style={sectionCtlStyle}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>{t("viewer.sectionHint")}</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12 }}>{t("viewer.position")}</span>
                <input
                  type="range" min={0} max={100} value={secPos}
                  onChange={(e) => { const v = Number(e.target.value); setSecPos(v); engineRef.current?.sectionSetPos(v); }}
                  style={{ width: 140 }}
                />
                <span style={{ fontSize: 12, width: 32 }}>{secPos}%</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12 }}>{t("viewer.size")}</span>
                <input
                  type="range" min={2} max={100} value={secSize}
                  onChange={(e) => { const v = Number(e.target.value); setSecSize(v); engineRef.current?.setSectionSize(v / 100); }}
                  style={{ width: 120 }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox" checked={secFlip}
                  onChange={(e) => { setSecFlip(e.target.checked); engineRef.current?.sectionSetFlipped(e.target.checked); }}
                /> {t("viewer.flip")}
              </label>
            </div>
          )}
        </div>

        {bottomDock === "table" && ready && pivotModels.length > 0 && (
          <DataTablePanel
            models={pivotModels}
            fileName={fileName}
            config={pivotConfig}
            onConfigChange={setPivotConfig}
            onSelectRows={(ids) => selectIds(ids)}
            onColorByGroup={setGroupColorMap}
            onClose={() => setBottomDock("none")}
          />
        )}
      </div>

      {(propGroups || showInfo) && (
      <aside className="props-panel" style={{ width: propsWidth }}>
        <div className="props-resize" onPointerDown={startPropsResize} title={t("viewer.resize")} />
        <div className="props-head">
          <span>{propGroups ? t("viewer.propsTitle") : t("viewer.modelInfoTitle")}</span>
          <span className="props-close" onClick={() => (propGroups ? clearSelection() : setShowInfo(false))} title={t("viewer.deselect")}>×</span>
        </div>
        <div className="props-body">
          {propGroups ? (
            <>
              {selHeader && (
                <div className="sel-header">
                  <div className="sel-title">
                    <div className="sel-name" title={selHeader.name}>{selHeader.name || t("viewer.unnamed")}</div>
                    {selHeader.type && <div className="sel-type">{selHeader.type}</div>}
                  </div>
                  <div className="sel-actions">
                    <button
                      className={"sel-btn" + (editing ? " active" : "")}
                      title={editing ? t("viewer.editClose") : canEditSelection ? t("viewer.editOpen") : t("viewer.editPrimaryOnly")}
                      disabled={!editing && !canEditSelection}
                      onClick={() => (editing ? exitEdit() : startEdit())}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                    <button className="sel-btn" title={t("viewer.frameElement")} onClick={() => engineRef.current?.zoomToSelection(selectedRef.current)}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                      </svg>
                    </button>
                    <button className="sel-btn" title={t("viewer.hideElement")} onClick={hideSelection}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /><path d="M3 3l18 18" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              {editing && editDetail && editTargetRef.current ? (
                <EditPanel
                  editor={editor}
                  id={editTargetRef.current.localId}
                  detail={editDetail}
                  schema={editor.schema()}
                  onSaved={onEditSaved}
                  onCancel={exitEdit}
                />
              ) : (
                <PropAccordion key={propsKey} groups={propGroups} favorites={favorites} onToggleFavorite={onToggleFavorite} />
              )}
            </>
          ) : fileInfo ? (
            <FileInfoPanel info={fileInfo} />
          ) : (
            <div className="props-empty">{t("viewer.propsEmpty")}</div>
          )}
        </div>
      </aside>
      )}

      {dock === "ids" && onIdsReport && (
        <IdsPanel
          bytes={bytes}
          fileName={fileName}
          report={idsReport ?? null}
          onReport={onIdsReport}
          onSelectEntity={(id) => {
            selectIds([id], id);
            engineRef.current?.zoomToSelection(new Set([id]));
          }}
          onExportBcf={exportIdsToBcf}
          onOpenEditor={() => setIdsEditorOpen(true)}
          onClose={() => setDock("none")}
        />
      )}

      {idsEditorOpen && (
        <IdsEditorModal
          schema={detectSchema(bytes) as any}
          pivotModels={pivotModels}
          initialDoc={idsReport?.document ?? null}
          onValidate={validateAuthoredIds}
          onClose={() => setIdsEditorOpen(false)}
        />
      )}

      {dock === "bcf" && (
        <BcfPanel
          engine={engineRef.current}
          store={storeRef.current}
          fileName={fileName}
          selectedIds={[...selectedIds]}
          onApplyViewpoint={onApplyViewpoint}
          onResetView={onResetView}
          bcfProject={bcfProject ?? null}
          onBcfProject={(p) => onBcfProject?.(p)}
          onClose={() => setDock("none")}
        />
      )}

    </div>
  );
}

// Friendly labels for the IfcRoot attribute rows in the read-only panel.
// Translated at call time (the attribute name stays the IFC identifier).
const ATTR_LABEL_KEYS: Record<string, I18nKey> = {
  Name: "viewer.attr.name",
  Description: "viewer.attr.description",
  ObjectType: "viewer.attr.objectType",
  Tag: "viewer.attr.tag",
};
const attrLabel = (name: string): string => {
  const k = ATTR_LABEL_KEYS[name];
  return k ? t(k) : name;
};

// Flatten an editor's view-aware selection into the read-only PropAccordion shape
// (so applied edits show in the non-edit panel too). GlobalId rows are kept.
function detailToPropGroups(detail: SelectionDetail): PropGroup[] {
  return detail.groups.map((g) => ({
    name: g.kind === "attribute" ? t("viewer.attrGroup") : g.name,
    rows: g.rows
      .filter((r) => r.value.length)
      .map((r) => ({ k: g.kind === "attribute" ? attrLabel(r.name) : r.name, v: r.value, edited: r.edited })),
  })).filter((g) => g.rows.length);
}

// Ids of every node that starts open by default (mirrors IfcTree's per-node rule).
function collectDefaultOpen(roots: TreeNode[], depth = 0, acc = new Set<number>()): Set<number> {
  for (const n of roots) {
    if (defaultNodeOpen(n, depth)) acc.add(n.expressID);
    collectDefaultOpen(n.children, depth + 1, acc);
  }
  return acc;
}

// Ids of every node that has children (i.e. everything that can be expanded).
function collectAllIds(roots: TreeNode[], acc = new Set<number>()): Set<number> {
  for (const n of roots) {
    if (n.children.length) acc.add(n.expressID);
    collectAllIds(n.children, acc);
  }
  return acc;
}

// Spatial containers are never grouped; element children are grouped by IFC class.
const SPATIAL_TYPES = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE", "IFCFACILITY", "IFCBRIDGE", "IFCROAD", "IFCRAILWAY", "IFCMARINEFACILITY", "IFCFACILITYPART"]);

function groupByClass(node: TreeNode, ctr: { n: number }): TreeNode {
  const children = node.children.map((c) => groupByClass(c, ctr));
  const containers: TreeNode[] = [];
  const elements: TreeNode[] = [];
  for (const c of children) (SPATIAL_TYPES.has(c.type) ? containers : elements).push(c);

  const groups: TreeNode[] = [];
  if (elements.length) {
    const byType = new Map<string, TreeNode[]>();
    for (const e of elements) {
      const arr = byType.get(e.type);
      if (arr) arr.push(e);
      else byType.set(e.type, [e]);
    }
    for (const [type, items] of byType) {
      const ids: number[] = [];
      for (const it of items) ids.push(...it.ids);
      groups.push({ expressID: --ctr.n, type, name: "", ids, children: items, count: items.length, defaultOpen: false });
    }
    groups.sort((a, b) => a.type.localeCompare(b.type));
  }
  return { ...node, children: [...containers, ...groups], defaultOpen: true };
}
