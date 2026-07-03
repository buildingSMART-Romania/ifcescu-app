import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, Treemap, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useI18n } from "../i18n/react";
import { ToolIcon } from "./icons";
import { usePersistedNumber } from "../hooks/usePersistedNumber";
import { discoverFields, rgbaCss, type PivotModel, type Rgba } from "../viewer/pivot";
import {
  chartData, stackedData, histogramData, kpiValue, combineFilter, filteredModels, selectExcept,
  type ChartCard, type ChartDatum, type ChartType,
} from "../viewer/analytics";

// Tile geometry on the canvas, in pixels (own lightweight drag/resize grid — no
// external layout lib, which proved unreliable in the bundle).
type Geo = { x: number; y: number; w: number; h: number };

interface Props {
  models: PivotModel[];
  onFilter: (ids: number[] | null, colors: Map<number, Rgba> | null) => void;
  onClose: () => void;
}

let cardSeq = 0;
const CHART_TYPES: ChartType[] = ["bar", "donut", "treemap", "stacked", "histogram", "kpi"];

/** Dimension keys a card filters on (a card ignores these when cross-filtering itself). */
function ownDims(c: ChartCard): string[] {
  if (c.type === "kpi") return [];
  if (c.type === "histogram") return [`hist:${c.histKey}`];
  if (c.type === "stacked") return c.stackKey ? [c.dimKey, c.stackKey] : [c.dimKey];
  return [c.dimKey];
}
const selDimKey = (c: ChartCard) => (c.type === "histogram" ? `hist:${c.histKey}` : c.dimKey);

export function AnalyticsPanel({ models, onFilter, onClose }: Props) {
  const { t, lang } = useI18n();
  const fields = useMemo(() => discoverFields(models), [models, lang]);
  const dims = useMemo(() => fields.filter((f) => f.kind === "categorical"), [fields]);
  const numerics = useMemo(() => fields.filter((f) => f.kind === "numeric"), [fields]);
  const total = useMemo(() => models.reduce((n, m) => n + m.localIDs.length, 0), [models]);
  const nf = useMemo(() => new Intl.NumberFormat(lang === "en" ? "en-US" : "ro-RO", { maximumFractionDigits: 2 }), [lang]);

  const [cards, setCards] = useState<ChartCard[]>(() => [
    { id: `a${++cardSeq}`, type: "kpi", dimKey: "class", measure: { agg: "count" } },
    { id: `a${++cardSeq}`, type: "bar", dimKey: "class", measure: { agg: "count" } },
    { id: `a${++cardSeq}`, type: "donut", dimKey: "material", measure: { agg: "count" } },
  ]);
  const [geo, setGeo] = useState<Record<string, Geo>>(() => ({
    a1: { x: 8, y: 8, w: 240, h: 150 },
    a2: { x: 256, y: 8, w: 380, h: 300 },
    a3: { x: 644, y: 8, w: 340, h: 300 },
  }));
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [colorDimKey, setColorDimKey] = useState<string | null>(null);
  // Dock height (px) — bottom dock so the 3D model stays visible above it.
  const [dockH, setDockH] = usePersistedNumber("dockH:analytics", 380);
  const startResizeDock = (e: { clientY: number; preventDefault: () => void }) => {
    e.preventDefault();
    const sy = e.clientY, h0 = dockH;
    const move = (ev: PointerEvent) => setDockH(Math.max(160, Math.min(window.innerHeight - 140, h0 + (sy - ev.clientY))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Lightweight drag (from the tile header) + resize (bottom-right handle).
  const startDrag = (e: { clientX: number; clientY: number; preventDefault: () => void }, id: string, mode: "move" | "resize") => {
    e.preventDefault();
    const g = geo[id];
    if (!g) return;
    const sx = e.clientX, sy = e.clientY;
    const { x, y, w, h } = g;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      setGeo((p) => ({
        ...p,
        [id]: mode === "move"
          ? { x: Math.max(0, x + dx), y: Math.max(0, y + dy), w, h }
          : { x, y, w: Math.max(220, w + dx), h: Math.max(150, h + dy) },
      }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Per-dimension id data over the FULL model — drives both combineFilter (3D)
  // and each visual's cross-filter subset.
  const dataByDim = useMemo(() => {
    const out: Record<string, ChartDatum[]> = {};
    for (const c of cards) {
      if (c.type === "kpi") continue;
      if (c.type === "histogram") {
        const f = fields.find((x) => x.key === c.histKey);
        if (f && !out[`hist:${c.histKey}`]) out[`hist:${c.histKey}`] = histogramData(models, f, c.bins ?? 10);
        continue;
      }
      if (!out[c.dimKey]) out[c.dimKey] = chartData(models, { ...c, type: "bar", measure: { agg: "count" } });
      if (c.type === "stacked" && c.stackKey && !out[c.stackKey])
        out[c.stackKey] = chartData(models, { ...c, dimKey: c.stackKey, type: "bar", measure: { agg: "count" } });
    }
    return out;
  }, [cards, models, fields]);

  const filter = useMemo(() => combineFilter(selected, dataByDim, colorDimKey), [selected, dataByDim, colorDimKey]);
  const matched = filter ? filter.ids.length : total;

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

  const setCard = (id: string, patch: Partial<ChartCard>) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addCard = () => {
    const id = `a${++cardSeq}`;
    const bottom = Math.max(0, ...Object.values(geo).map((g) => g.y + g.h));
    setCards((cs) => [...cs, { id, type: "bar", dimKey: dims[0]?.key ?? "class", measure: { agg: "count" } }]);
    setGeo((p) => ({ ...p, [id]: { x: 8, y: bottom + 8, w: 380, h: 280 } }));
  };
  const removeCard = (id: string) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    setGeo((p) => { const n = { ...p }; delete n[id]; return n; });
  };
  const fieldLabel = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
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
            const subset = combineFilter(selectExcept(selected, ownDims(card)), dataByDim, null);
            const vModels = filteredModels(models, subset ? new Set(subset.ids) : null);
            const sel = selected[selDimKey(card)];
            const g = geo[card.id] ?? { x: 8, y: 8, w: 360, h: 280 };
            const stop = (e: any) => e.stopPropagation();
            return (
              <div className="an-tile" key={card.id} style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
                <div className="an-tile-head" onPointerDown={(e) => startDrag(e, card.id, "move")}>
                  <select value={card.type} onChange={(e) => setCard(card.id, { type: e.target.value as ChartType })} onPointerDown={stop}>
                    {CHART_TYPES.map((ty) => <option key={ty} value={ty}>{t(("analytics.type." + ty) as any)}</option>)}
                  </select>
                  {(card.type === "bar" || card.type === "donut" || card.type === "treemap" || card.type === "stacked") && (
                    <select value={card.dimKey} onChange={(e) => setCard(card.id, { dimKey: e.target.value })} onPointerDown={stop}>
                      {dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  )}
                  {card.type === "stacked" && (
                    <select value={card.stackKey ?? ""} onChange={(e) => setCard(card.id, { stackKey: e.target.value || undefined })} onPointerDown={stop}>
                      <option value="">{t("analytics.stackBy")}</option>
                      {dims.filter((d) => d.key !== card.dimKey).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  )}
                  {card.type === "histogram" && (
                    <select value={card.histKey ?? ""} onChange={(e) => setCard(card.id, { histKey: e.target.value || undefined })} onPointerDown={stop}>
                      <option value="">{t("analytics.pickNumeric")}</option>
                      {numerics.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  )}
                  {(card.type !== "histogram") && (
                    <select value={card.measure.agg === "count" ? "count" : `sum:${card.measure.fieldKey}`} onPointerDown={stop}
                      onChange={(e) => { const v = e.target.value; setCard(card.id, v === "count" ? { measure: { agg: "count" } } : { measure: { agg: "sum", fieldKey: v.slice(4) } }); }}>
                      <option value="count">{t("analytics.count")}</option>
                      {numerics.map((f) => <option key={f.key} value={`sum:${f.key}`}>{t("analytics.sum")}: {f.label}</option>)}
                    </select>
                  )}
                  <span className="an-tile-x" title={t("analytics.removeChart")} onClick={() => removeCard(card.id)} onPointerDown={stop}>×</span>
                </div>
                <div className="an-tile-body">
                  {renderChart(card, vModels, { sel, toggle, nf, t, fieldLabel })}
                </div>
                <div className="an-tile-resize" onPointerDown={(e) => startDrag(e, card.id, "resize")} title="" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- chart bodies ---------------------------------------------------------
interface RenderCtx {
  sel: string[] | undefined;
  toggle: (dimKey: string, label: string) => void;
  nf: Intl.NumberFormat;
  t: (k: any, p?: any) => string;
  fieldLabel: (key: string) => string;
}

function renderChart(card: ChartCard, models: PivotModel[], ctx: RenderCtx) {
  const { sel, toggle, nf, t } = ctx;
  const lbl = (d: any) => d?.label ?? d?.payload?.label ?? "";
  const op = (label: string) => (sel && !sel.includes(label) ? 0.25 : 1);

  if (card.type === "kpi") {
    const v = kpiValue(models, card.measure);
    return (
      <div className="an-kpi-card">
        <div className="an-kpi-big">{nf.format(v)}</div>
        <div className="an-kpi-cap">{card.measure.agg === "count" ? t("analytics.count") : `${t("analytics.sum")}: ${ctx.fieldLabel(card.measure.fieldKey ?? "")}`}</div>
      </div>
    );
  }

  if (card.type === "stacked") {
    if (!card.stackKey) return <div className="an-empty">{t("analytics.pickStack")}</div>;
    const { rows, series } = stackedData(models, card);
    if (!rows.length) return <div className="an-empty">{t("analytics.noData")}</div>;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(127,127,127,0.12)" }} />
          <Legend onClick={(e: any) => card.stackKey && toggle(card.stackKey, String(e?.value ?? e?.dataKey ?? ""))} wrapperStyle={{ fontSize: 11, cursor: "pointer" }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" fill={rgbaCss(s.color)} cursor="pointer" isAnimationActive={false} onClick={(d: any) => toggle(card.dimKey, lbl(d))} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const data: ChartDatum[] =
    card.type === "histogram"
      ? (() => { const f = discoverFields(models).find((x) => x.key === card.histKey); return f ? histogramData(models, f, card.bins ?? 10) : []; })()
      : chartData(models, card);

  if (!data.length) return <div className="an-empty">{card.type === "histogram" ? t("analytics.pickNumeric") : t("analytics.noData")}</div>;

  if (card.type === "donut") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" isAnimationActive={false} cursor="pointer" onClick={(d: any) => toggle(card.dimKey, lbl(d))}>
            {data.map((d) => <Cell key={d.label} fill={rgbaCss(d.color)} fillOpacity={op(d.label)} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (card.type === "treemap") {
    const tm = data.map((d) => ({ name: d.label, size: d.value, fill: rgbaCss(d.color), op: op(d.label) }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Treemap data={tm} dataKey="size" nameKey="name" stroke="var(--surface)" isAnimationActive={false} content={<TreemapCell />} onClick={(node: any) => toggle(card.dimKey, node?.name ?? "")} />
      </ResponsiveContainer>
    );
  }

  // bar (vertical) + histogram (columns)
  const dimKey = card.type === "histogram" ? `hist:${card.histKey}` : card.dimKey;
  const isBar = card.type === "bar";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={isBar ? "vertical" : "horizontal"} margin={{ left: 4, right: 12, top: 4, bottom: isBar ? 4 : 28 }}>
        {isBar ? <XAxis type="number" hide /> : <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted)" }} angle={-35} textAnchor="end" interval={0} height={40} />}
        {isBar ? <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 11, fill: "var(--muted)" }} /> : <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />}
        <Tooltip cursor={{ fill: "rgba(127,127,127,0.12)" }} contentStyle={tooltipStyle} />
        <Bar dataKey="value" cursor="pointer" isAnimationActive={false} onClick={(d: any) => toggle(dimKey, lbl(d))}>
          {data.map((d) => <Cell key={d.label} fill={rgbaCss(d.color)} fillOpacity={op(d.label)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TreemapCell(props: any) {
  const { x, y, width, height, name, fill, op } = props;
  if (width <= 0 || height <= 0) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill ?? "#888"} fillOpacity={op ?? 1} stroke="var(--surface)" strokeWidth={1} />
      {width > 46 && height > 18 && <text x={x + 4} y={y + 14} fontSize={10} fill="#fff" style={{ pointerEvents: "none" }}>{name}</text>}
    </g>
  );
}

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--text)",
} as const;

export default AnalyticsPanel;
