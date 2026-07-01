// Unit-aware formatting helpers driven by the settings singleton. Imported by
// non-React overlays (e.g. the measure tool) and React panels alike;
// they read getSettings() live so changes apply on the next redraw/render.
import { getSettings } from "./index";

const LEN_FACTOR: Record<string, number> = { m: 1, cm: 100, mm: 1000 };
const LEN_SYMBOL: Record<string, string> = { m: "m", cm: "cm", mm: "mm" };

/** Decimal places used for coordinates and measurement readouts. */
export function coordDecimals(): number {
  const d = getSettings().units.decimals;
  return Number.isFinite(d) && d >= 0 && d <= 6 ? Math.round(d) : 3;
}

/** Format a length given in metres in the configured unit (e.g. "12.345 m"). */
export function formatLength(meters: number): string {
  const { length } = getSettings().units;
  const v = meters * (LEN_FACTOR[length] ?? 1);
  return `${v.toFixed(coordDecimals())} ${LEN_SYMBOL[length] ?? "m"}`;
}

/** Format an area given in m² in the configured unit (m² or hectares). */
export function formatArea(m2: number): string {
  const { area } = getSettings().units;
  if (area === "ha") return `${(m2 / 10_000).toFixed(Math.max(coordDecimals(), 4))} ha`;
  return `${m2.toFixed(coordDecimals())} m²`;
}
