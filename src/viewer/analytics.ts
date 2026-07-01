// Pure data logic for the analytics dashboard (charts + cross-filter to 3D).
// Built on the existing pivot layer so charts and the data table share one
// aggregation path. No DOM / Recharts here — keeps this unit-testable.
import { buildPivot, displayLabel, getFieldValue, groupColor, type FieldDef, type PivotModel, type Rgba } from "./pivot";

export type ChartType = "bar" | "donut" | "treemap" | "stacked" | "histogram" | "kpi";

export interface ChartCard {
  id: string;
  type: ChartType;
  /** FieldDef.key of the (categorical) dimension to group by (bar/donut/treemap/stacked). */
  dimKey: string;
  /** Second categorical dimension for stacked bars (the series/legend). */
  stackKey?: string;
  /** Measure: element count, or the sum of a numeric field/quantity. */
  measure: { agg: "count" | "sum"; fieldKey?: string };
  /** Numeric field for the histogram. */
  histKey?: string;
  /** Histogram bucket count (default 10). */
  bins?: number;
}

export interface ChartDatum {
  /** Display label (NO_VALUE already translated). */
  label: string;
  value: number;
  /** Global element ids in this category. */
  ids: number[];
  color: Rgba;
}

/** Aggregate one card into chart data: one datum per category of its dimension. */
export function chartData(models: PivotModel[], card: ChartCard): ChartDatum[] {
  const values =
    card.measure.agg === "sum" && card.measure.fieldKey
      ? [{ fieldKey: card.measure.fieldKey, agg: "sum" as const }]
      : [];
  const res = buildPivot(models, { groupBy: [card.dimKey], values, showTotals: false });
  return res.rows.map((r, i) => ({
    label: displayLabel(r.label),
    value: card.measure.agg === "sum" ? r.values[0] ?? 0 : r.count,
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

/** Single aggregate over ALL elements (for a KPI card). */
export function kpiValue(models: PivotModel[], measure: ChartCard["measure"]): number {
  const values = measure.agg === "sum" && measure.fieldKey ? [{ fieldKey: measure.fieldKey, agg: "sum" as const }] : [];
  const res = buildPivot(models, { groupBy: [], values, showTotals: true });
  return measure.agg === "sum" ? res.totals.values[0] ?? 0 : res.totals.count;
}

export interface StackedResult {
  /** One object per primary category: { label, [series]: value }. */
  rows: Array<Record<string, number | string>>;
  series: { key: string; color: Rgba }[];
}

/** Two-dimension data for a stacked bar chart (primary on X, `stackKey` as series). */
export function stackedData(models: PivotModel[], card: ChartCard): StackedResult {
  if (!card.stackKey) return { rows: [], series: [] };
  const values = card.measure.agg === "sum" && card.measure.fieldKey ? [{ fieldKey: card.measure.fieldKey, agg: "sum" as const }] : [];
  const res = buildPivot(models, { groupBy: [card.dimKey, card.stackKey], values, showTotals: false });
  const seriesIdx = new Map<string, number>();
  const rows = res.rows.map((r) => {
    const row: Record<string, number | string> = { label: displayLabel(r.label) };
    for (const c of r.children) {
      const s = displayLabel(c.label);
      row[s] = card.measure.agg === "sum" ? c.values[0] ?? 0 : c.count;
      if (!seriesIdx.has(s)) seriesIdx.set(s, seriesIdx.size);
    }
    return row;
  });
  const series = [...seriesIdx.entries()].map(([key, i]) => ({ key, color: groupColor(i) }));
  return { rows, series };
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
