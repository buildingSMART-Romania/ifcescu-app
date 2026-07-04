// Shared types/helpers for the analytics dashboard modules. No recharts here —
// only charts.tsx may import recharts (keeps it inside the lazy chunk).
import type { ChartCard, ChartDatum, ScatterPoint, StackedResult } from "../../viewer/analytics";

/** One card's precomputed dataset (see the shell's `cardData` memo). */
export type CardData =
  | { kind: "kpi"; value: number | null } // kpi + gauge
  | { kind: "stacked"; stacked: StackedResult }
  | { kind: "list"; data: ChartDatum[] } // bar/donut/treemap/histogram/table/line/area
  | { kind: "scatter"; points: ScatterPoint[] }
  | { kind: "missing"; fieldKey: string }; // a referenced field isn't in the model(s)
// (slicer has no CardData — it reads the full dataByDim list directly)

/** Dimension keys a card filters on (a card ignores these when cross-filtering
 *  itself). The slicer deliberately does NOT self-exclude: it must reflect its
 *  own dimension's selection state. */
export function ownDims(c: ChartCard): string[] {
  if (c.type === "kpi" || c.type === "gauge" || c.type === "slicer") return [];
  if (c.type === "histogram") return [`hist:${c.histKey}`];
  if (c.type === "stacked") return c.stackKey ? [c.dimKey, c.stackKey] : [c.dimKey];
  return [c.dimKey];
}

/** The selection key a card's clicks toggle. */
export const selDimKey = (c: ChartCard) => (c.type === "histogram" ? `hist:${c.histKey}` : c.dimKey);

/** Rendering context threaded from the shell into the chart renderers. */
export interface RenderCtx {
  /** Active selection for this card's dimension (undefined = none). */
  sel: string[] | undefined;
  /** Toggle one datum — handles the Others bucket (multi-label) transparently. */
  toggleDatum: (dimKey: string, d: ChartDatum) => void;
  /** Toggle a plain label (legend clicks, line/area category clicks). */
  toggle: (dimKey: string, label: string) => void;
  nf: Intl.NumberFormat;
  t: (k: any, p?: any) => string;
  fieldLabel: (key: string) => string;
}

/** Is this datum selected? Others counts as selected when ALL folded labels are. */
export function isDatumSelected(d: ChartDatum, sel: string[] | undefined): boolean {
  if (!sel) return false;
  if (d.othersLabels) return d.othersLabels.length > 0 && d.othersLabels.every((l) => sel.includes(l));
  return sel.includes(d.label);
}

/** Dim factor for unselected marks while a selection is active on the dim. */
export function datumOpacity(d: ChartDatum, sel: string[] | undefined): number {
  return sel && sel.length && !isDatumSelected(d, sel) ? 0.25 : 1;
}

/** Chart types rendered as recharts SVG (PNG export is possible for these). */
export const SVG_TYPES: ReadonlySet<string> = new Set([
  "bar", "donut", "treemap", "stacked", "histogram", "scatter", "gauge", "line", "area",
]);
