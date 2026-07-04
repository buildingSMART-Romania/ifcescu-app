import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/react";
import { ToolIcon } from "./icons";
import type { PivotModel, Rgba } from "../viewer/pivot";
import type { ViewerEngine } from "../viewer/engine";
import {
  detectClashesAsync, mergeStatuses, pairKey, yieldToEventLoop,
  type ClashOptions, type ClashResult, type ClashStatus, type ClashElement,
} from "../viewer/clash";
import { entityType, entityName } from "../viewer/model";
import {
  createViewpoint, createBCFTopic, addViewpointToTopic, createBCFProject, addTopicToProject,
  expressIdsToGlobalIds, type BCFProject,
} from "../ifc/bcf";
import { formatLength } from "../settings/format";
import { useDockResize } from "../hooks/useDockResize";
import type { SnapshotTask } from "../viewer/snapshot";
import { cameraToBcf } from "../viewer/bcfCoords";

// Highlight colors for a selected clash pair (Set A element / Set B element).
const RED: Rgba = [0.86, 0.15, 0.15, 1];
const ORANGE: Rgba = [1, 0.6, 0.1, 1];
const STATUSES: ClashStatus[] = ["new", "active", "resolved", "approved", "ignored"];
const CLOSED: ClashStatus[] = ["resolved", "approved", "ignored"];
const DEFAULT_AUTHOR = "ifcescu";

interface Row extends ClashResult {
  aLabel: string;
  bLabel: string;
  aModel: string;
  bModel: string;
  guidA?: string;
  guidB?: string;
}

interface Props {
  engine: ViewerEngine;
  models: PivotModel[];
  bcfProject?: BCFProject | null;
  onBcfProject?: (p: BCFProject) => void;
  /** Open the BCF panel after clashes are sent to it. */
  onOpenBcf?: () => void;
  /** Capture per-clash snapshots behind the viewer's cover overlay (invisible). */
  onCaptureSnapshots?: (tasks: SnapshotTask[]) => Promise<Map<string, string>>;
  fileName: string;
  /** Isolate + color the clash pair and frame the interference region in 3D. */
  onShow: (ids: number[], colors: Map<number, Rgba>, focus?: { center: [number, number, number]; half: number }) => void;
  /** Restore full visibility and clear clash colors. */
  onReset: () => void;
  onClose: () => void;
}

/** Per-file-set localStorage key for clash statuses (stable across reloads). */
function statusKey(models: PivotModel[]): string {
  return `ifc-clash-status:${models.map((m) => m.fileName).sort().join("|")}`;
}
function loadStatuses(models: PivotModel[]): Map<string, ClashStatus> {
  try {
    const raw = localStorage.getItem(statusKey(models));
    if (raw) return new Map(Object.entries(JSON.parse(raw)) as [string, ClashStatus][]);
  } catch { /* ignore */ }
  return new Map();
}
function persistStatus(models: PivotModel[], key: string, status: ClashStatus): void {
  try {
    const k = statusKey(models);
    const obj = JSON.parse(localStorage.getItem(k) || "{}");
    obj[key] = status;
    localStorage.setItem(k, JSON.stringify(obj));
  } catch { /* ignore */ }
}

/** Multi-select dropdown of models for a clash set (A or B). Top-level so its
 *  open state survives the parent's re-renders when a checkbox is toggled. */
function SetDropdown({ label, ids, models, onToggle }: {
  label: string;
  ids: Set<string>;
  models: PivotModel[];
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const summary = !ids.size
    ? t("clash.pickModels")
    : ids.size === models.length
      ? t("clash.allModels")
      : models.filter((m) => ids.has(m.id)).map((m) => m.fileName).join(", ");
  return (
    <div className="clash-set">
      <span className="clash-set-label">{label}</span>
      <div className="clash-dd" ref={ref}>
        <button className="clash-dd-btn" onClick={() => setOpen((o) => !o)} title={summary}>
          <span className="clash-dd-text">{summary}</span>
          <svg className="clash-dd-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {open && (
          <div className="clash-dd-menu">
            {models.map((m) => (
              <label key={m.id} className="clash-dd-item" title={m.fileName}>
                <input type="checkbox" checked={ids.has(m.id)} onChange={() => onToggle(m.id)} />
                <span className="clash-dd-name">{m.fileName}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClashPanel({ engine, models, bcfProject, onBcfProject, onOpenBcf, onCaptureSnapshots, fileName, onShow, onReset, onClose }: Props) {
  const { t } = useI18n();
  const [setA, setSetA] = useState<Set<string>>(() => new Set(models.length ? [models[0].id] : []));
  const [setB, setSetB] = useState<Set<string>>(
    () => new Set(models.length > 1 ? models.slice(1).map((m) => m.id) : models.map((m) => m.id)),
  );
  const [tol, setTol] = useState(0.01);
  const [clearOn, setClearOn] = useState(false);
  const [clearVal, setClearVal] = useState(0.05);
  const [narrow, setNarrow] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hideClosed, setHideClosed] = useState(false);
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [bcfBusy, setBcfBusy] = useState(false);
  const [attachViews, setAttachViews] = useState(false);
  const { height: dockH, startResize: startResizeDock } = useDockResize("dockH:clash", 360);
  const abortRef = useRef<{ aborted: boolean } | null>(null);

  const toggle = (setter: (fn: (s: Set<string>) => Set<string>) => void, id: string) =>
    setter((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Yields a macrotask every ~12ms so the spinner animates and Stop stays
  // responsive while bounds/triangle soups are gathered for large sets.
  const buildSet = async (ids: Set<string>, withTris: boolean, signal: { aborted: boolean }): Promise<ClashElement[]> => {
    const out: ClashElement[] = [];
    let deadline = performance.now() + 12;
    for (const m of models) {
      if (!ids.has(m.id)) continue;
      for (const local of m.localIDs) {
        if (signal.aborted) return out;
        const gid = local + m.offset;
        const b = engine.elementBounds(gid);
        if (!b) continue;
        out.push({ id: gid, model: m.id, min: b.min, max: b.max, tris: withTris ? engine.elementTriangleSoup(gid) ?? undefined : undefined });
        if (performance.now() >= deadline) {
          await yieldToEventLoop();
          deadline = performance.now() + 12;
        }
      }
    }
    return out;
  };

  const enrich = (r: ClashResult): Row => {
    const ra = engine.resolveGlobal(r.a);
    const rb = engine.resolveGlobal(r.b);
    const guidA = ra ? expressIdsToGlobalIds(ra.store, [ra.localId])[0] : undefined;
    const guidB = rb ? expressIdsToGlobalIds(rb.store, [rb.localId])[0] : undefined;
    const key = guidA && guidB ? pairKey(guidA, guidB) : r.key;
    const label = (rr: ReturnType<ViewerEngine["resolveGlobal"]>) =>
      rr ? `${entityType(rr.store, rr.localId)} ${entityName(rr.store, rr.localId) || `#${rr.localId}`}`.trim() : "?";
    const modelName = (rr: ReturnType<ViewerEngine["resolveGlobal"]>) =>
      rr ? models.find((m) => m.id === rr.modelId)?.fileName ?? rr.modelId : "";
    return { ...r, key, guidA, guidB, aLabel: label(ra), bLabel: label(rb), aModel: modelName(ra), bModel: modelName(rb) };
  };

  const run = async () => {
    if (running) { if (abortRef.current) abortRef.current.aborted = true; return; }
    if (!setA.size || !setB.size) return;
    setRunning(true);
    setHasRun(true);
    setProgress(0);
    setRows([]);
    setActiveKey(null);
    const signal = { aborted: false };
    abortRef.current = signal;
    const opts: ClashOptions = { tolerance: tol, clearance: clearOn ? clearVal : null, narrowPhase: narrow };
    await yieldToEventLoop(); // let the spinner paint before the heavy set build
    const a = await buildSet(setA, narrow, signal);
    const b = await buildSet(setB, narrow, signal);
    const raw = await detectClashesAsync(a, b, opts, { onProgress: (d, total) => setProgress(total ? d / total : 1), signal });
    const merged = mergeStatuses(raw.map(enrich), loadStatuses(models)) as Row[];
    merged.sort((x, y) => {
      if (x.type !== y.type) return x.type === "hard" ? -1 : 1;
      return x.type === "hard" ? y.penetration - x.penetration : x.penetration - y.penetration;
    });
    setRows(merged);
    setRunning(false);
  };

  const changeStatus = (key: string, status: ClashStatus) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, status } : r)));
    persistStatus(models, key, status);
  };

  // Half-size of the cube to frame around a clash: from the interference size,
  // but capped to ~half the smaller element so there is some surrounding context.
  const clashHalf = (row: Row): number => {
    const diag = (b: ReturnType<ViewerEngine["elementBounds"]>) =>
      b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 0;
    const ctx = Math.min(diag(engine.elementBounds(row.a)), diag(engine.elementBounds(row.b))) || 2;
    // Floor at 0.3 m so a tiny clash box doesn't put the snapshot camera inside
    // the near plane (which yields a blank thumbnail).
    return Math.max(Math.min(Math.max(row.penetration * 3, 0.4), ctx * 0.5), 0.3);
  };

  // A camera framing the clash region, keeping the current view direction. Stored
  // in the BCF viewpoint so opening the topic zooms onto the clash (here and in
  // other BCF tools), instead of restoring some unrelated camera.
  const cameraForClash = (center: [number, number, number], half: number) => {
    const b = engine.getCameraState();
    let dx = b.target.x - b.position.x, dy = b.target.y - b.position.y, dz = b.target.z - b.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const fov = b.fov || Math.PI / 4;
    const dist = Math.max((half * 1.8) / Math.tan(fov / 2), half * 2, 1);
    return {
      position: { x: center[0] - dx * dist, y: center[1] - dy * dist, z: center[2] - dz * dist },
      target: { x: center[0], y: center[1], z: center[2] },
      up: b.up,
      fov,
      isOrthographic: b.isOrthographic,
      orthoScale: b.isOrthographic ? half * 2.5 : undefined,
    };
  };

  const showRow = (row: Row) => {
    setActiveKey(row.key);
    onShow([row.a, row.b], new Map([[row.a, RED], [row.b, ORANGE]]), { center: row.center as [number, number, number], half: clashHalf(row) });
  };

  const reset = () => { setActiveKey(null); onReset(); };

  const visibleRows = useMemo(() => {
    let out = hideClosed ? rows.filter((r) => !CLOSED.includes(r.status)) : rows;
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.aLabel, r.bLabel, r.aModel, r.bModel, r.guidA ?? "", r.guidB ?? ""].some((s) => s.toLowerCase().includes(q)),
      );
    }
    return out;
  }, [rows, hideClosed, query]);
  const counts = useMemo(() => ({
    hard: rows.filter((r) => r.type === "hard").length,
    clearance: rows.filter((r) => r.type === "clearance").length,
  }), [rows]);

  const exportBcf = async () => {
    if (!visibleRows.length || !onBcfProject || bcfBusy) return;
    const included = visibleRows.filter((r) => r.status !== "ignored");
    if (!included.length) return;
    setBcfBusy(true);
    try {
      const project = bcfProject ?? createBCFProject({ name: fileName, version: "2.1" });
      const bounds = engine.getModelBoundsStateForBcf() ?? undefined;
      // Optional per-clash snapshots — captured behind the viewer's cover overlay
      // (invisible). The camera is attached either way, so topics still frame the
      // clash in BCF tools even without thumbnails.
      const snapshots = attachViews && onCaptureSnapshots
        ? await onCaptureSnapshots(included.map((row) => {
            const h = clashHalf(row);
            const c = row.center as [number, number, number];
            return { key: row.key, min: [c[0] - h, c[1] - h, c[2] - h], max: [c[0] + h, c[1] + h, c[2] + h] };
          }))
        : new Map<string, string>();
      let n = 0;
      for (const row of included) {
        const guids = [row.guidA, row.guidB].filter(Boolean) as string[];
        // cameraForClash builds a render-local pose; shift it to BCF-absolute so
        // the topic opens on the real clash in other BCF tools (georeferenced RTC).
        const camera = cameraToBcf(cameraForClash(row.center as [number, number, number], clashHalf(row)), engine.rtcOffset);
        // Isolate the two elements and color them (A red / B orange) so opening the
        // topic reproduces the clash view instead of burying it in the model.
        const coloredGuids = [
          ...(row.guidA ? [{ color: "FFDB2626", guids: [row.guidA] }] : []),
          ...(row.guidB ? [{ color: "FFFF991A", guids: [row.guidB] }] : []),
        ];
        const viewpoint = createViewpoint({ camera, bounds, selectedGuids: guids, visibleGuids: guids, coloredGuids, snapshot: snapshots.get(row.key) });
        const typeLabel = t(row.type === "hard" ? "clash.typeHard" : "clash.typeClearance");
        const topic = createBCFTopic({
          title: `Clash: ${row.aLabel} x ${row.bLabel}`,
          description: `${typeLabel} - ${formatLength(row.penetration)} - ${row.aModel} / ${row.bModel}`,
          author: DEFAULT_AUTHOR,
          topicType: "Clash",
          topicStatus: row.status === "resolved" || row.status === "approved" ? "Closed" : "Open",
        });
        addViewpointToTopic(topic, viewpoint);
        addTopicToProject(project, topic);
        n++;
      }
      if (n) {
        onBcfProject({ ...project });
        onOpenBcf?.(); // open the BCF panel so the user reviews + exports from there
      }
    } finally {
      setBcfBusy(false);
    }
  };

  const exportCsv = () => {
    if (!visibleRows.length) return;
    const head = [t("clash.type"), t("clash.elementA"), t("clash.modelA"), t("clash.elementB"), t("clash.modelB"), t("clash.penetration"), t("clash.status")];
    const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of visibleRows) {
      lines.push([
        t(r.type === "hard" ? "clash.typeHard" : "clash.typeClearance"),
        r.aLabel, r.aModel, r.bLabel, r.bModel,
        r.penetration.toFixed(4),
        t(`clash.status_${r.status}`),
      ].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/\.ifc$/i, "")}-clashes.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="an-dock clash-dock" style={{ height: dockH }}>
      <div className="an-dock-resize" onPointerDown={startResizeDock} title={t("viewer.resize")} />
      <div className="an-bar clash-topbar">
        <strong className="an-title"><ToolIcon kind="clash" /> {t("clash.title")}</strong>
        <span className="clash-summary">
          {hasRun ? t("clash.summary", { total: String(rows.length), hard: String(counts.hard), clearance: String(counts.clearance) }) : ""}
        </span>
        <span className="clash-spacer" />
        {rows.length > 0 && (
          <input
            className="clash-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("clash.search")}
            aria-label={t("clash.search")}
          />
        )}
        <label className="clash-inline">
          <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />
          {t("clash.hideClosed")}
        </label>
        <label className="clash-inline">
          <input type="checkbox" checked={attachViews} onChange={(e) => setAttachViews(e.target.checked)} disabled={bcfBusy} />
          {t("ids.attachViews")}
        </label>
        <button className="btn secondary small" onClick={exportBcf} disabled={!visibleRows.length || bcfBusy}>
          {bcfBusy ? t("ids.bcfPreparing") : t("clash.exportBcf")}
        </button>
        <button className="btn secondary small" onClick={exportCsv} disabled={!visibleRows.length}>{t("clash.exportCsv")}</button>
        <button className="btn secondary small" onClick={reset}>{t("clash.reset")}</button>
        <button className="clash-close" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>x</button>
      </div>

      <div className="clash-config">
        <SetDropdown label={t("clash.setA")} ids={setA} models={models} onToggle={(id) => toggle(setSetA, id)} />
        <SetDropdown label={t("clash.setB")} ids={setB} models={models} onToggle={(id) => toggle(setSetB, id)} />
        <div className="clash-opts">
          <label className="clash-inline">
            {t("clash.tolerance")}
            <input type="number" min={0} step={0.005} value={tol} onChange={(e) => setTol(Math.max(0, Number(e.target.value) || 0))} />
            m
          </label>
          <label className="clash-inline">
            <input type="checkbox" checked={clearOn} onChange={(e) => setClearOn(e.target.checked)} />
            {t("clash.clearanceOn")}
          </label>
          <label className="clash-inline">
            <input type="number" min={0} step={0.01} value={clearVal} disabled={!clearOn} onChange={(e) => setClearVal(Math.max(0, Number(e.target.value) || 0))} />
            m
          </label>
          <label className="clash-inline">
            <input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} />
            {t("clash.narrowPhase")}
          </label>
          <button className="btn small" onClick={run} disabled={!setA.size || !setB.size}>
            {running ? t("clash.stop") : t("clash.run")}
          </button>
        </div>
      </div>

      {running && (
        <div className="clash-progress"><div className="clash-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      )}

      <div className="clash-list">
        {!visibleRows.length ? (
          <div className="clash-empty">{hasRun && !running ? t("clash.noClashes") : t("clash.hint")}</div>
        ) : (
          <table className="clash-table">
            <thead>
              <tr>
                <th>{t("clash.type")}</th>
                <th>{t("clash.elementA")}</th>
                <th>{t("clash.elementB")}</th>
                <th>{t("clash.penetration")}</th>
                <th>{t("clash.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.key} className={activeKey === r.key ? "active" : ""} onClick={() => showRow(r)}>
                  <td>
                    <span className={"clash-badge " + r.type}>{t(r.type === "hard" ? "clash.typeHard" : "clash.typeClearance")}</span>
                    {r.approximate && <span className="clash-approx" title={t("clash.approxHint")}>{t("clash.approx")}</span>}
                  </td>
                  <td title={r.aModel}><span className="clash-dot a" />{r.aLabel}</td>
                  <td title={r.bModel}><span className="clash-dot b" />{r.bLabel}</td>
                  <td>{formatLength(r.penetration)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select value={r.status} onChange={(e) => changeStatus(r.key, e.target.value as ClashStatus)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{t(`clash.status_${s}`)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ClashPanel;
