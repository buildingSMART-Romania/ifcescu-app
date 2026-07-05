// The app displays and aggregates every quantity uniformly in SI (m/m²/m³);
// IFC files keep their own declared units (a millimetre model routinely keeps
// areas/volumes in m²/m³ — they are declared independently). This module is
// the single conversion boundary: resolve the file's declared per-measure SI
// factors once per store, convert file→SI on read and SI→file on write. The
// exported STEP therefore stays correct in its own units (the @ifc-lite
// exporter cannot attach a per-quantity Unit override — it writes `Unit=$`).
import { extractProjectUnits, type IfcDataStore } from "@ifc-lite/parser";
import { QuantityType } from "@ifc-lite/data";

/** SI factors of the file's declared units: value_SI = value_file × factor
 *  (mm → 0.001, m² → 1). */
export interface UnitScales {
  length: number;
  area: number;
  volume: number;
}

export const SI_SCALES: UnitScales = { length: 1, area: 1, volume: 1 };

const cache = new WeakMap<IfcDataStore, UnitScales>();

/** The store's declared unit scales (cached; SI fallback when the unit
 *  assignment is absent or malformed). */
export function scalesFor(store: IfcDataStore): UnitScales {
  const hit = cache.get(store);
  if (hit) return hit;
  let units: ReturnType<typeof extractProjectUnits> | null = null;
  try {
    const s = store as { source?: Uint8Array; entityIndex?: Parameters<typeof extractProjectUnits>[1] };
    if (s.source && s.entityIndex) units = extractProjectUnits(s.source, s.entityIndex);
  } catch {
    /* fall back to SI */
  }
  const si = (measure: string) => units?.unitForMeasure(measure)?.siScale || 1;
  const scales: UnitScales = {
    length: si("IfcLengthMeasure"),
    area: si("IfcAreaMeasure"),
    volume: si("IfcVolumeMeasure"),
  };
  cache.set(store, scales);
  return scales;
}

function factor(qtype: QuantityType | undefined, scales: UnitScales): number {
  switch (qtype) {
    case QuantityType.Length: return scales.length;
    case QuantityType.Area: return scales.area;
    case QuantityType.Volume: return scales.volume;
    default: return 1; // Count/Weight/Time pass through unconverted
  }
}

/** Quantities display/store at 3 decimals: beyond mesh accuracy and what a
 *  bill of quantities needs, and it kills float noise (3600×0.001 must read
 *  3.6, not 3.6000000000000005). */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** File-unit value → SI, rounded to 3 decimals. */
export function toSI(value: number, qtype: QuantityType | undefined, scales: UnitScales): number {
  return round3(value * factor(qtype, scales));
}

/** SI value → the file's declared unit (write-back direction), 3 decimals. */
export function fromSI(value: number, qtype: QuantityType | undefined, scales: UnitScales): number {
  return round3(value / factor(qtype, scales));
}

/** Display symbol for the SI unit a quantity is shown in (null: unitless /
 *  not converted here). */
export function siSymbol(qtype: QuantityType | undefined): string | null {
  switch (qtype) {
    case QuantityType.Length: return "m";
    case QuantityType.Area: return "m²";
    case QuantityType.Volume: return "m³";
    default: return null;
  }
}
