// Analytics dashboard shell: state, cross-filter plumbing, tile layout, and the
// dock chrome. Chart rendering lives in charts.tsx (the only recharts importer,
// so the library stays inside this lazily-loaded chunk).
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { numberFormat } from "../../settings/format";
import { ToolIcon } from "../icons";
import { useDockResize } from "../../hooks/useDockResize";
import { discoverFields, fieldByKey, type PivotModel, type Rgba } from "../../viewer/pivot";
import {
  chartData, stackedData, histogramData, kpiValue, scatterData, combineFilter, filteredModels,
  selectExcept, sortChartData, topNData, alignColors, measureLabel,
  TILE_MIN_W, TILE_MIN_H,
  type ChartCard, type ChartDatum, type Geo, type Measure, type SortMode,
} from "../../viewer/analytics";
import { ownDims, selDimKey, type CardData, type RenderCtx } from "./shared";
import { CardTile } from "./CardTile";
import { loadDashboard, useDashboardSave } from "./useDashboardPersistence";

interface Props {
  models: PivotModel[];
  onFilter: (ids: number[] | null, colors: Map<number, Rgba> | null) => void;
  onClose: () => void;
}

let cardSeq = 0;
const nextId = () => `a${++cardSeq}`;

const DEFAULT_CARDS = (): ChartCard[] => [
  { id: nextId(), type: "kpi", dimKey: "class", measure: { agg: "count" } },
  { id: nextId(), type: "bar", dimKey: "class", measure: { agg: "count" } },
  { id: nextId(), type: "donut", dimKey: "material", measure: { agg: "count" } },
];
const DEFAULT_GEO: Record<string, Geo> = {
  a1: { x: 8, y: 8, w: 240, h: 150 },
  a2: { x: 256, y: 8, w: 380, h: 300 },
  a3: { x: 644, y: 8, w: 340, h: 300 },
};

/** Snap drag/resize coordinates to a light 8px grid. */
const snap8 = (v: number) => Math.round(v / 8) * 8;

/** Default category sort per chart type (line/area read left→right by label). */
const defaultSort = (c: ChartCard): SortMode =>
  c.type === "line" || c.type === "area" ? "labelAsc" : "valueDesc";

/** Does this card type group by a categorical dimension? */
const usesDim = (c: ChartCard) => c.type !== "kpi" && c.type !== "gauge" && c.type !== "histogram";

export function AnalyticsPanel({ models, onFilter, onClose }: Props) {
  const { t, lang } = useI18n();
  const { settings } = useSettings();
  const fields = useMemo(() => discoverFields(models), [models, lang]);
  const dims = useMemo(() => fields.filter((f) => f.kind === "categorical"), [fields]);
  const numerics = useMemo(() => fields.filter((f) => f.kind === "numeric"), [fields]);
  const total = useMemo(() => models.reduce((n, m) => n + m.localIDs.length, 0), [models]);
  const nf = useMemo(
    () => numberFormat(lang === "en" ? "en-US" : "ro-RO", settings.units.decimals),
    [lang, settings.units.decimals],
  );

  // Restore the saved dashboard (global, survives dock close + reload); fall
  // back to the default three cards. cardSeq is re-seeded past restored ids so
  // "Add chart" never collides with them.
  const [initial] = useState(() => {
    const saved = loadDashboard();
    if (saved) {
      for (const c of saved.cards) {
        const m = /^a(\d+)$/.exec(c.id);
        if (m) cardSeq = Math.max(cardSeq, Number(m[1]));
      }
      return saved;
    }
    return { cards: DEFAULT_CARDS(), geo: DEFAULT_GEO };
  });
  const [cards, setCards] = useState<ChartCard[]>(initial.cards);
  const [geo, setGeo] = useState<Record<string, Geo>>(initial.geo);
  useDashboardSave(cards, geo);

  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [colorDimKey, setColorDimKey] = useState<string | null>(null);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Dock height (px) — bottom dock so the 3D model stays visible above it.
  const { height: dockH, startResize: startResizeDock } = useDockResize("dockH:analytics", 380);

  // Lightweight drag (from the tile header) + resize (bottom-right handle),
  // snapped to an 8px grid. The active drag's teardown lives in a ref so
  // unmounting mid-drag removes the window listeners instead of leaking them.
  const dragStopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragStopRef.current?.(), []);
  const startDrag = (e: { clientX: number; clientY: number; preventDefault: () => void }, id: string, mode: "move" | "resize") => {
    e.preventDefault();
    const g = geo[id];
    if (!g) return;
    dragStopRef.current?.(); // never stack two drags
    const sx = e.clientX, sy = e.clientY;
    const { x, y, w, h } = g;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      setGeo((p) => ({
        ...p,
        [id]: mode === "move"
          ? { x: Math.max(0, snap8(x + dx)), y: Math.max(0, snap8(y + dy)), w, h }
          : { x, y, w: Math.max(TILE_MIN_W, snap8(w + dx)), h: Math.max(TILE_MIN_H, snap8(h + dy)) },
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragStopRef.current = null;
    };
    dragStopRef.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Per-dimension id data over the FULL model — drives combineFilter (3D), each
  // visual's cross-filter subset, color alignment, and the slicer lists.
  const dataByDim = useMemo(() => {
    const out: Record<string, ChartDatum[]> = {};
    const addDim = (key: string | undefined) => {
      if (!key || out[key] || !fieldByKey(fields, key)) return;
      out[key] = chartData(models, { id: "_", type: "bar", dimKey: key, measure: { agg: "count" } });
    };
    for (const c of cards) {
      if (c.type === "histogram") {
        const f = fieldByKey(fields, c.histKey ?? "");
        if (f && !out[`hist:${c.histKey}`]) out[`hist:${c.histKey}`] = histogramData(models, f, c.bins ?? 10);
        continue;
      }
      if (usesDim(c)) addDim(c.dimKey);
      if (c.type === "stacked") addDim(c.stackKey);
    }
    return out;
  }, [cards, models, fields]);

  const filter = useMemo(() => combineFilter(selected, dataByDim, colorDimKey), [selected, dataByDim, colorDimKey]);
  const matched = filter ? filter.ids.length : total;

  // Every card's aggregated dataset (cross-filtered to the OTHER visuals'
  // selections), computed once per data change. Deliberately independent of
  // `geo`/maximize/editing, so layout interactions never re-aggregate.
  const cardData = useMemo(() => {
    const missingKey = (c: ChartCard): string | null => {
      const missing = (k?: string) => (k && !fieldByKey(fields, k) ? k : null);
      const measureMissing = (m?: Measure) => (m && m.agg !== "count" ? missing(m.fieldKey) : null);
      if (c.type === "histogram") return missing(c.histKey);
      if (usesDim(c) && c.dimKey) {
        const mk = missing(c.dimKey);
        if (mk) return mk;
      }
      if (c.type === "stacked") {
        const mk = missing(c.stackKey);
        if (mk) return mk;
      }
      return measureMissing(c.measure) ?? measureMissing(c.measureY) ?? measureMissing(c.sizeMeasure);
    };

    const othersLabel = t("analytics.others");
    const out: Record<string, CardData> = {};
    for (const card of cards) {
      if (card.type === "slicer") continue; // reads dataByDim directly
      const mk = missingKey(card);
      if (mk) {
        out[card.id] = { kind: "missing", fieldKey: mk };
        continue;
      }
      const subset = combineFilter(selectExcept(selected, ownDims(card)), dataByDim, null);
      const vModels = filteredModels(models, subset ? new Set(subset.ids) : null);
      if (card.type === "kpi" || card.type === "gauge") {
        out[card.id] = { kind: "kpi", value: kpiValue(vModels, card.measure) };
      } else if (card.type === "stacked") {
        out[card.id] = { kind: "stacked", stacked: stackedData(vModels, card) };
      } else if (card.type === "histogram") {
        const f = fieldByKey(fields, card.histKey ?? "");
        out[card.id] = { kind: "list", data: f ? histogramData(vModels, f, card.bins ?? 10) : [] };
      } else if (card.type === "scatter") {
        out[card.id] = { kind: "scatter", points: scatterData(vModels, card) };
      } else {
        // bar / donut / treemap / table / line / area: align the filtered
        // subset's colors to the full dimension (also what colors the 3D
        // scene), then sort and fold the tail into Others.
        let data = alignColors(dataByDim[card.dimKey] ?? [], chartData(vModels, card));
        data = sortChartData(data, card.sort ?? defaultSort(card));
        data = topNData(data, card.topN, othersLabel);
        out[card.id] = { kind: "list", data };
      }
    }
    return out;
  }, [cards, selected, dataByDim, models, fields, t]);

  useEffect(() => {
    onFilter(filter ? filter.ids : null, filter ? filter.colors : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useEffect(() => () => onFilter(null, null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (dimKey: string, label: string) => {
    if (!label) return;
    setColorDimKey(dimKey);
    setSelected((s) => {
      const cur = new Set(s[dimKey] ?? []);
      cur.has(label) ? cur.delete(label) : cur.add(label);
      const next = { ...s };
      if (cur.size) next[dimKey] = [...cur];
      else delete next[dimKey];
      return next;
    });
  };
  /** Toggle a set of labels together (the Others bucket): all-in → remove all. */
  const toggleMany = (dimKey: string, labels: string[]) => {
    if (!labels.length) return;
    setColorDimKey(dimKey);
    setSelected((s) => {
      const cur = new Set(s[dimKey] ?? []);
      const allIn = labels.every((l) => cur.has(l));
      for (const l of labels) allIn ? cur.delete(l) : cur.add(l);
      const next = { ...s };
      if (cur.size) next[dimKey] = [...cur];
      else delete next[dimKey];
      return next;
    });
  };
  const toggleDatum = (dimKey: string, d: ChartDatum) => {
    if (d.othersLabels) toggleMany(dimKey, d.othersLabels);
    else toggle(dimKey, d.label);
  };
  const clearDim = (dimKey: string) =>
    setSelected((s) => {
      const next = { ...s };
      delete next[dimKey];
      return next;
    });

  const setCard = (id: string, patch: Partial<ChartCard>) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addCard = () => {
    const id = nextId();
    const bottom = Math.max(0, ...Object.values(geo).map((g) => g.y + g.h));
    setCards((cs) => [...cs, { id, type: "bar", dimKey: dims[0]?.key ?? "class", measure: { agg: "count" } }]);
    setGeo((p) => ({ ...p, [id]: { x: 8, y: snap8(bottom + 8), w: 380, h: 280 } }));
    setEditingId(id); // a fresh card starts in its editor
  };
  const removeCard = (id: string) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    setGeo((p) => { const n = { ...p }; delete n[id]; return n; });
    if (editingId === id) setEditingId(null);
    if (maximizedId === id) setMaximizedId(null);
  };

  const fieldLabel = (key: string) => fieldByKey(fields, key)?.label ?? key;
  const autoTitle = (c: ChartCard): string => {
    if (c.type === "slicer") return fieldLabel(c.dimKey);
    if (c.type === "kpi" || c.type === "gauge") return measureLabel(c.measure, fieldLabel);
    if (c.type === "histogram") return fieldLabel(c.histKey ?? "");
    const m = measureLabel(c.measure, fieldLabel);
    const dim = c.type === "stacked" && c.stackKey
      ? `${fieldLabel(c.dimKey)} / ${fieldLabel(c.stackKey)}`
      : fieldLabel(c.dimKey);
    if (c.type === "scatter") {
      const my = c.measureY ? measureLabel(c.measureY, fieldLabel) : "?";
      return t("analytics.byDim", { measure: `${m} × ${my}`, dim });
    }
    return t("analytics.byDim", { measure: m, dim });
  };

  const contentH = Math.max(320, ...Object.values(geo).map((g) => g.y + g.h)) + 16;

  return (
    <div className="an-dock" style={{ height: dockH }}>
      <div className="an-dock-resize" onPointerDown={startResizeDock} title={t("viewer.resize")} />
      <div className="an-bar">
        <span className="an-title"><ToolIcon kind="analytics" /> {t("analytics.title")}</span>
        <span className="an-kpi-inline"><b>{nf.format(matched)}</b> {t("analytics.ofTotal", { total: nf.format(total) })}</span>
        {filter && <button className="an-clear" onClick={() => setSelected({})}>{t("analytics.clearFilter")}</button>}
        <span style={{ flex: 1 }} />
        <button className="an-bar-btn" onClick={addCard}>＋ {t("analytics.addChart")}</button>
        <button className="an-bar-btn" onClick={onClose}>✕ {t("common.close")}</button>
      </div>

      <div className="an-canvas">
        <div className="an-grid" style={{ height: contentH }}>
          {cards.map((card) => {
            const g = geo[card.id] ?? { x: 8, y: 8, w: 360, h: 280 };
            const ctx: RenderCtx = {
              sel: selected[selDimKey(card)],
              toggle,
              toggleDatum,
              nf,
              t,
              fieldLabel,
            };
            return (
              <CardTile
                key={card.id}
                card={card}
                cd={cardData[card.id]}
                slicerData={card.type === "slicer" ? dataByDim[card.dimKey] : undefined}
                ctx={ctx}
                dims={dims}
                numerics={numerics}
                maximized={maximizedId === card.id}
                editing={editingId === card.id}
                autoTitle={autoTitle(card)}
                onStartDrag={startDrag}
                setCard={setCard}
                onRemove={removeCard}
                onToggleEdit={(id) => setEditingId((e) => (e === id ? null : id))}
                onToggleMax={(id) => setMaximizedId((m) => (m === id ? null : id))}
                onClearDim={clearDim}
                style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AnalyticsPanel;
