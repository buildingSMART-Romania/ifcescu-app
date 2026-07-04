// Pure data logic for the analytics dashboard (charts + cross-filter to 3D).
// Built on the existing pivot layer so charts and the data table share one
// aggregation path. No DOM / Recharts here — keeps this unit-testable.
import {
  buildPivot, displayLabel, getFieldValue, groupColor, aggLabel, csvCell, fmtCsvNum,
  NO_VALUE,
  type AggKind, type FieldDef, type PivotModel, type Rgba, type ValueColumn,
} from "./pivot";

export type ChartType =
  | "bar" | "donut" | "treemap" | "stacked" | "histogram" | "kpi"
  | "table" | "scatter" | "gauge" | "line" | "area" | "slicer";

/** A measure: element count, or an aggregation of a numeric field/quantity. */
export interface Measure {
  agg: AggKind;
  fieldKey?: string;
}

export type SortMode = "valueDesc" | "valueAsc" | "labelAsc";

export interface ChartCard {
  id: string;
  type: ChartType;
  /** User-edited title; undefined = auto-generated from the config. */
  title?: string;
  /** FieldDef.key of the (categorical) dimension to group by. */
  dimKey: string;
  /** Second categorical dimension for stacked bars (the series/legend). */
  stackKey?: string;
  /** Primary measure (scatter: the X-axis measure). */
  measure: Measure;
  /** Scatter only: Y-axis measure (required to render). */
  measureY?: Measure;
  /** Scatter only: optional bubble-size measure. */
  sizeMeasure?: Measure;
  /** Numeric field for the histogram. */
  histKey?: string;
  /** Histogram bucket count (default 10). */
  bins?: number;
  /** Category sort; undefined keeps pivot order (label collation, NO_VALUE last). */
  sort?: SortMode;
  /** Keep the top N categories (after sort), folding the rest into "Others". */
  topN?: number;
  /** Show value labels on the marks (bar/donut/line/area/histogram). */
  showLabels?: boolean;
  /** Gauge target value. */
  target?: number;
}

export interface ChartDatum {
  /** Display label (NO_VALUE already translated). */
  label: string;
  value: number;
  /** Global element ids in this category. */
  ids: number[];
  color: Rgba;
  /** Set only on the synthetic "Others" datum: the folded category labels.
   *  Clicking Others toggles ALL of these in the selection (the sentinel label
   *  itself never enters `selected`, so combineFilter stays unchanged). */
  othersLabels?: string[];
}

/** One aggregated point per category for the scatter/bubble chart. */
export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  size?: number;
  ids: number[];
  color: Rgba;
}

/** Tile geometry (absolute px inside the dashboard canvas). Lives here so the
 *  persisted-dashboard parser can be unit-tested without the DOM. */
export interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TILE_MIN_W = 220;
export const TILE_MIN_H = 150;

/** Stable sentinel for the top-N "Others" bucket (like NO_VALUE — translate at
 *  render time; callers can pass a translated label to topNData directly). */
export const OTHERS = "(altele)";

// --- measures ---------------------------------------------------------------

/** Pivot value columns for a measure ([] for count — pivot rows carry count). */
function measureColumns(m: Measure): ValueColumn[] {
  return m.agg !== "count" && m.fieldKey ? [{ fieldKey: m.fieldKey, agg: m.agg }] : [];
}

/** Read a measure off a pivot row shape ({count, values}); null = no numeric data. */
function measureOf(row: { count: number; values: (number | null)[] }, m: Measure, valueIdx = 0): number | null {
  if (m.agg === "count" || !m.fieldKey) return row.count;
  return row.values[valueIdx] ?? null;
}

/** Human label for a measure ("Count" or "Sum · NetVolume"), for titles/CSV. */
export function measureLabel(m: Measure, fieldLabel: (key: string) => string): string {
  if (m.agg === "count" || !m.fieldKey) return aggLabel("count");
  return `${aggLabel(m.agg)} · ${fieldLabel(m.fieldKey)}`;
}

// --- per-card data ------------------------------------------------------------

/** Aggregate one card into chart data: one datum per category of its dimension. */
export function chartData(models: PivotModel[], card: ChartCard): ChartDatum[] {
  const res = buildPivot(models, { groupBy: [card.dimKey], values: measureColumns(card.measure), showTotals: false });
  return res.rows.map((r, i) => ({
    label: displayLabel(r.label),
    value: measureOf(r, card.measure) ?? 0,
    ids: r.ids,
    color: groupColor(i),
  }));
}

/** Restrict each model's element set to the given global ids (null → unchanged).
 *  Reuses the same stores so pivot caches stay valid. Used for cross-filtering:
 *  recompute a visual over the subset the OTHER visuals filtered to. */
export function filteredModels(models: PivotModel[], ids: Set<number> | null): PivotModel[] {
  if (!ids) return models;
  return models.map((m) => ({ ...m, localIDs: m.localIDs.filter((l) => ids.has(l + m.offset)) }));
}

/** Copy of `selected` without the given dimension keys (a visual ignores its own
 *  dimensions when cross-filtering, so it stays full while others narrow). */
export function selectExcept(selected: Record<string, string[]>, keys: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(selected)) if (!keys.includes(k)) out[k] = selected[k];
  return out;
}

/** Single aggregate over ALL elements (KPI/gauge). Null when a numeric agg has
 *  no numeric values to aggregate (distinct from a legitimate 0). */
export function kpiValue(models: PivotModel[], measure: Measure): number | null {
  const res = buildPivot(models, { groupBy: [], values: measureColumns(measure), showTotals: true });
  return measureOf(res.totals, measure);
}

export interface StackedResult {
  /** One object per primary category: { label, [series]: value }. */
  rows: Array<Record<string, number | string>>;
  series: { key: string; color: Rgba }[];
}

/** Two-dimension data for a stacked bar chart (primary on X, `stackKey` as series). */
export function stackedData(models: PivotModel[], card: ChartCard): StackedResult {
  if (!card.stackKey) return { rows: [], series: [] };
  const res = buildPivot(models, { groupBy: [card.dimKey, card.stackKey], values: measureColumns(card.measure), showTotals: false });
  const seriesIdx = new Map<string, number>();
  const rows = res.rows.map((r) => {
    const row: Record<string, number | string> = { label: displayLabel(r.label) };
    for (const c of r.children) {
      const s = displayLabel(c.label);
      row[s] = measureOf(c, card.measure) ?? 0;
      if (!seriesIdx.has(s)) seriesIdx.set(s, seriesIdx.size);
    }
    return row;
  });
  const series = [...seriesIdx.entries()].map(([key, i]) => ({ key, color: groupColor(i) }));
  return { rows, series };
}

/** One aggregated point per category: X/Y (and optional bubble size) measures.
 *  Categories where X or Y has no numeric value are dropped. Empty until
 *  `measureY` is configured. */
export function scatterData(models: PivotModel[], card: ChartCard): ScatterPoint[] {
  if (!card.measureY) return [];
  const measures = [card.measure, card.measureY, ...(card.sizeMeasure ? [card.sizeMeasure] : [])];
  const values: ValueColumn[] = [];
  const idx: number[] = measures.map((m) => {
    if (m.agg === "count" || !m.fieldKey) return -1;
    values.push({ fieldKey: m.fieldKey, agg: m.agg });
    return values.length - 1;
  });
  const res = buildPivot(models, { groupBy: [card.dimKey], values, showTotals: false });
  const read = (r: { count: number; values: (number | null)[] }, mi: number): number | null =>
    idx[mi] < 0 ? r.count : r.values[idx[mi]] ?? null;
  const out: ScatterPoint[] = [];
  res.rows.forEach((r, i) => {
    const x = read(r, 0);
    const y = read(r, 1);
    if (x == null || y == null) return;
    const size = card.sizeMeasure ? read(r, 2) : null;
    out.push({
      label: displayLabel(r.label),
      x, y,
      ...(size != null ? { size } : {}),
      ids: r.ids,
      color: groupColor(i),
    });
  });
  return out;
}

const roundN = (n: number): number => Math.round(n * 100) / 100;

/** Bucket a numeric field's values into `bins` ranges; ids per bucket for filtering. */
export function histogramData(models: PivotModel[], field: FieldDef, bins = 10): ChartDatum[] {
  const vals: { v: number; id: number }[] = [];
  for (const m of models) {
    for (const l of m.localIDs) {
      const v = getFieldValue(m.store, l, field);
      if (typeof v === "number" && Number.isFinite(v)) vals.push({ v, id: l + m.offset });
    }
  }
  if (!vals.length) return [];
  let min = Infinity, max = -Infinity;
  for (const x of vals) { if (x.v < min) min = x.v; if (x.v > max) max = x.v; }
  if (min === max) {
    return [{ label: String(roundN(min)), value: vals.length, ids: vals.map((x) => x.id), color: groupColor(0) }];
  }
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({ lo: min + i * width, hi: min + (i + 1) * width, ids: [] as number[] }));
  for (const x of vals) {
    let bi = Math.floor((x.v - min) / width);
    if (bi >= bins) bi = bins - 1;
    if (bi < 0) bi = 0;
    buckets[bi].ids.push(x.id);
  }
  return buckets.map((b, i) => ({ label: `${roundN(b.lo)}–${roundN(b.hi)}`, value: b.ids.length, ids: b.ids, color: groupColor(i) }));
}

// --- sort / top-N / colors ----------------------------------------------------

/** The translated no-value label (chartData labels are already display-ready). */
const noValueLabel = (): string => displayLabel(NO_VALUE);

/** Sort chart data. Stable; "no value" sinks to the end under labelAsc.
 *  undefined keeps the pivot's order (label collation, NO_VALUE last). */
export function sortChartData(data: ChartDatum[], sort?: SortMode): ChartDatum[] {
  if (!sort) return data;
  const nv = noValueLabel();
  const arr = [...data];
  arr.sort((a, b) => {
    if (sort === "valueDesc") return b.value - a.value;
    if (sort === "valueAsc") return a.value - b.value;
    if (a.label === nv || a.label === NO_VALUE) return 1;
    if (b.label === nv || b.label === NO_VALUE) return -1;
    return a.label.localeCompare(b.label, "ro", { numeric: true });
  });
  return arr;
}

/** Keep the first `n` data points, folding the rest into one "Others" bucket.
 *  Others carries the union of the folded ids and the folded labels (so a click
 *  can toggle the real labels — the sentinel never enters the selection). */
export function topNData(data: ChartDatum[], n?: number, othersLabel: string = OTHERS): ChartDatum[] {
  if (!n || n <= 0 || data.length <= n) return data;
  const kept = data.slice(0, n);
  const folded = data.slice(n);
  const ids: number[] = [];
  for (const d of folded) ids.push(...d.ids);
  kept.push({
    label: othersLabel,
    value: folded.reduce((s, d) => s + d.value, 0),
    ids,
    color: [0.55, 0.55, 0.58, 1],
    othersLabels: folded.map((d) => d.label),
  });
  return kept;
}

/** Recolor `data` so labels shared with `reference` use the reference's colors
 *  (keeps a filtered/sorted subset visually consistent with the full dimension,
 *  which is also what colors the 3D scene). */
export function alignColors(reference: ChartDatum[], data: ChartDatum[]): ChartDatum[] {
  const ref = new Map(reference.map((d) => [d.label, d.color]));
  return data.map((d) => {
    const c = d.othersLabels ? undefined : ref.get(d.label);
    return c ? { ...d, color: c } : d;
  });
}

// --- slicer ---------------------------------------------------------------

/** Filter + cap a dimension's values for the slicer list. Query is a
 *  case-insensitive substring match; `more` counts the matches beyond the cap. */
export function slicerValues(
  data: ChartDatum[],
  query: string,
  cap = 200,
): { items: ChartDatum[]; more: number } {
  const q = query.trim().toLowerCase();
  const matched = q ? data.filter((d) => d.label.toLowerCase().includes(q)) : data;
  const items = matched.slice(0, cap);
  return { items, more: matched.length - items.length };
}

// --- cross-filter -----------------------------------------------------------

/**
 * Combine per-dimension category selections into one element filter.
 * Within a dimension the selected categories are OR-ed (union of their ids);
 * across dimensions they are AND-ed (intersection). Matched elements are colored
 * by their category in `colorDimKey` (falls back to the first active dimension),
 * matching the chart segment colors. Returns null when nothing is selected.
 */
export function combineFilter(
  selections: Record<string, string[]>,
  dataByDim: Record<string, ChartDatum[]>,
  colorDimKey: string | null,
): { ids: number[]; colors: Map<number, Rgba> } | null {
  const activeDims = Object.keys(selections).filter((k) => selections[k]?.length);
  if (!activeDims.length) return null;

  let acc: Set<number> | null = null;
  for (const dim of activeDims) {
    const sel = new Set(selections[dim]);
    const union = new Set<number>();
    for (const d of dataByDim[dim] ?? []) if (sel.has(d.label)) for (const id of d.ids) union.add(id);
    if (acc === null) {
      acc = union;
    } else {
      const next = new Set<number>();
      for (const id of acc) if (union.has(id)) next.add(id);
      acc = next;
    }
  }
  const ids = acc ? Array.from(acc) : [];

  const cDim = colorDimKey && selections[colorDimKey]?.length ? colorDimKey : activeDims[0];
  const cSel = new Set(selections[cDim] ?? []);
  const matched = new Set(ids);
  const colors = new Map<number, Rgba>();
  for (const d of dataByDim[cDim] ?? []) {
    if (!cSel.has(d.label)) continue;
    for (const id of d.ids) if (matched.has(id)) colors.set(id, d.color);
  }
  return { ids, colors };
}

// --- CSV per card -----------------------------------------------------------

/** The card data shapes cardCsv accepts (mirrors the panel's CardData union). */
export type CardCsvData =
  | { kind: "list"; data: ChartDatum[] }
  | { kind: "stacked"; stacked: StackedResult }
  | { kind: "scatter"; points: ScatterPoint[] }
  | { kind: "kpi"; value: number | null };

/** Flatten one card to CSV lines (header + rows), in pivot's CSV dialect. */
export function cardCsv(card: ChartCard, cd: CardCsvData, fieldLabel: (key: string) => string): string[] {
  const dimLabel = fieldLabel(card.type === "histogram" ? card.histKey ?? "" : card.dimKey);
  const mLabel = measureLabel(card.measure, fieldLabel);
  switch (cd.kind) {
    case "list": {
      const lines = [[dimLabel, mLabel].map(csvCell).join(",")];
      for (const d of cd.data) lines.push([csvCell(d.label), fmtCsvNum(d.value)].join(","));
      return lines;
    }
    case "stacked": {
      const series = cd.stacked.series.map((s) => s.key);
      const lines = [[dimLabel, ...series].map(csvCell).join(",")];
      for (const row of cd.stacked.rows) {
        const cells = [csvCell(String(row.label))];
        for (const s of series) cells.push(fmtCsvNum(typeof row[s] === "number" ? (row[s] as number) : null));
        lines.push(cells.join(","));
      }
      return lines;
    }
    case "scatter": {
      const yLabel = card.measureY ? measureLabel(card.measureY, fieldLabel) : "y";
      const sLabel = card.sizeMeasure ? [measureLabel(card.sizeMeasure, fieldLabel)] : [];
      const lines = [[dimLabel, mLabel, yLabel, ...sLabel].map(csvCell).join(",")];
      for (const p of cd.points) {
        const cells = [csvCell(p.label), fmtCsvNum(p.x), fmtCsvNum(p.y)];
        if (card.sizeMeasure) cells.push(fmtCsvNum(p.size ?? null));
        lines.push(cells.join(","));
      }
      return lines;
    }
    case "kpi":
      return [csvCell(mLabel), fmtCsvNum(cd.value)];
  }
}

// --- persisted dashboard ------------------------------------------------------

const ALL_TYPES: ReadonlySet<string> = new Set<ChartType>([
  "bar", "donut", "treemap", "stacked", "histogram", "kpi",
  "table", "scatter", "gauge", "line", "area", "slicer",
]);
const AGGS: ReadonlySet<string> = new Set<AggKind>(["sum", "avg", "count", "min", "max"]);

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function sanitizeMeasure(v: unknown): Measure | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  const agg = str(m.agg);
  if (!agg || !AGGS.has(agg)) return undefined;
  return { agg: agg as AggKind, ...(str(m.fieldKey) ? { fieldKey: str(m.fieldKey) } : {}) };
}

/**
 * Validate/sanitize a persisted dashboard blob (any JSON shape → safe state or
 * null). Cards with unknown types are dropped; geo is coerced and clamped to the
 * tile minimums. Never throws.
 */
export function parseDashboardState(json: unknown): { cards: ChartCard[]; geo: Record<string, Geo> } | null {
  if (!json || typeof json !== "object") return null;
  const env = json as Record<string, unknown>;
  if (env.v !== 1 || !Array.isArray(env.cards)) return null;

  const cards: ChartCard[] = [];
  for (const raw of env.cards) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const id = str(c.id);
    const type = str(c.type);
    if (!id || !type || !ALL_TYPES.has(type)) continue;
    const sort = str(c.sort);
    cards.push({
      id,
      type: type as ChartType,
      dimKey: str(c.dimKey) ?? "",
      measure: sanitizeMeasure(c.measure) ?? { agg: "count" },
      ...(str(c.title) ? { title: str(c.title) } : {}),
      ...(str(c.stackKey) ? { stackKey: str(c.stackKey) } : {}),
      ...(sanitizeMeasure(c.measureY) ? { measureY: sanitizeMeasure(c.measureY) } : {}),
      ...(sanitizeMeasure(c.sizeMeasure) ? { sizeMeasure: sanitizeMeasure(c.sizeMeasure) } : {}),
      ...(str(c.histKey) ? { histKey: str(c.histKey) } : {}),
      ...(num(c.bins) != null ? { bins: num(c.bins) } : {}),
      ...(sort === "valueDesc" || sort === "valueAsc" || sort === "labelAsc" ? { sort: sort as SortMode } : {}),
      ...(num(c.topN) != null ? { topN: num(c.topN) } : {}),
      ...(typeof c.showLabels === "boolean" ? { showLabels: c.showLabels } : {}),
      ...(num(c.target) != null ? { target: num(c.target) } : {}),
    });
  }
  if (!cards.length) return null;

  const geo: Record<string, Geo> = {};
  const rawGeo = env.geo && typeof env.geo === "object" ? (env.geo as Record<string, unknown>) : {};
  for (const card of cards) {
    const g = rawGeo[card.id];
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h);
    if (x == null || y == null || w == null || h == null) continue;
    geo[card.id] = {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.max(TILE_MIN_W, w),
      h: Math.max(TILE_MIN_H, h),
    };
  }
  return { cards, geo };
}
