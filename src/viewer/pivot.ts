// Pivot/data-table layer: discover the aggregatable fields in a model, resolve
// a field's value for any element, and build a grouped+aggregated row model
// (Excel "Rows + Values" style — nested group-by rows, aggregated value columns,
// totals). Pure data; the React panel (DataTablePanel) renders the result.
import {
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  buildMaterialUsageIndex,
  type IfcDataStore,
} from "@ifc-lite/parser";
import { entityType } from "./model";
import { friendly } from "../components/IfcTree";
import { t, type I18nKey } from "../i18n";

export type AggKind = "sum" | "avg" | "count" | "min" | "max";
export type FieldKind = "categorical" | "numeric";

export interface FieldDef {
  key: string;
  label: string;
  source: "model" | "class" | "material" | "property" | "quantity";
  pset?: string;
  name?: string;
  kind: FieldKind;
}

export interface ValueColumn {
  fieldKey: string;
  agg: AggKind;
}

export interface PivotConfig {
  groupBy: string[]; // ordered field keys → nested grouping
  values: ValueColumn[];
  showTotals: boolean;
}

export interface PivotRow {
  label: string;
  depth: number;
  ids: number[]; // all element ids under this (sub)group
  count: number;
  values: (number | null)[]; // one per config.values column
  children: PivotRow[];
}

export interface PivotResult {
  columns: { label: string }[];
  rows: PivotRow[];
  totals: { count: number; values: (number | null)[] };
}

// Internal sentinel for "no value" — used for bucketing/sorting comparisons, so
// it must stay a STABLE constant (not language-dependent). Translate only when
// rendering, via displayLabel().
export const NO_VALUE = "(fără valoare)";

/** Translate the known sentinel labels at render time; data values pass through. */
export const displayLabel = (label: string): string => (label === NO_VALUE ? t("pivot.noValue") : label);

// --- group coloring (data-table → 3D viewer) ------------------------------
export type Rgba = [number, number, number, number];

/** A distinct, evenly-spread color per group index (golden-angle hue rotation). */
export function groupColor(i: number): Rgba {
  const [r, g, b] = hslToRgb(((i * 137.508) % 360) / 360, 0.6, 0.55);
  return [r, g, b, 1];
}

/** CSS color string for a swatch, from a 0..1 RGBA tuple. */
export function rgbaCss([r, g, b]: Rgba): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}

export const AGG_KINDS: AggKind[] = ["sum", "avg", "count", "min", "max"];
const AGG_KEY: Record<AggKind, I18nKey> = {
  sum: "dataTable.aggregate.sum",
  avg: "dataTable.aggregate.avg",
  count: "dataTable.aggregate.count",
  min: "dataTable.aggregate.min",
  max: "dataTable.aggregate.max",
};
/** Localised aggregation label (resolved at call time). */
export const aggLabel = (kind: AggKind): string => t(AGG_KEY[kind]);

// Property keys keep the pset so same-named properties stay distinct. Quantities
// are merged by NAME only: official IFC Qto_ sets are split per class
// (Qto_BeamBaseQuantities, Qto_WallBaseQuantities, …), so merging lets one
// quantity (NetVolume, Length, …) aggregate across all classes/materials.
const propKey = (pset: string, name: string) => `prop:${pset}::${name}`;
const qtyKey = (name: string) => `qty:${name}`;

function coerceNumeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// --- field discovery (memoised per store) ---------------------------------
const fieldCache = new WeakMap<IfcDataStore, FieldDef[]>();

/** One federated model's data for the pivot: its store, the renderable LOCAL
 *  ids, and the id offset that turns those into global ids (for 3D selection). */
export interface PivotModel {
  id: string;
  fileName: string;
  store: IfcDataStore;
  localIDs: number[];
  offset: number;
}

/** All fields available across ALL models: Model + Class + Material pseudo-fields,
 *  then every distinct property/quantity name unioned over the models' stores. */
export function discoverFields(models: PivotModel[]): FieldDef[] {
  const byKey = new Map<string, FieldDef>();
  // "Model" only makes sense to group by when more than one model is loaded.
  if (models.length > 1) byKey.set("model", { key: "model", label: t("pivot.model"), source: "model", kind: "categorical" });
  byKey.set("class", { key: "class", label: t("pivot.classField"), source: "class", kind: "categorical" });
  byKey.set("material", { key: "material", label: t("pivot.material"), source: "material", kind: "categorical" });
  for (const m of models) {
    for (const f of discoverFieldsForStore(m.store, m.localIDs)) {
      const ex = byKey.get(f.key);
      if (!ex) byKey.set(f.key, { ...f });
      else if (f.kind === "numeric") ex.kind = "numeric"; // numeric wins across stores
    }
  }
  return [...byKey.values()].sort(fieldSort);
}

/** Per-store field discovery (memoised per store, keyed by local ids). */
function discoverFieldsForStore(store: IfcDataStore, allIDs: number[]): FieldDef[] {
  const cached = fieldCache.get(store);
  if (cached) return cached;

  // class/material labels here are placeholders — discoverFields() overrides them
  // with localised labels (this per-store result is cached, so it must not bake in
  // a language-specific label).
  const fields: FieldDef[] = [
    { key: "class", label: "class", source: "class", kind: "categorical" },
    { key: "material", label: "material", source: "material", kind: "categorical" },
  ];
  const seen = new Set<string>(fields.map((f) => f.key));
  // A property is numeric if ANY sampled value coerces to a number.
  const propNumeric = new Map<string, boolean>();

  for (const id of allIDs) {
    for (const set of extractPropertiesOnDemand(store, id)) {
      const pset = set.name || "PropertySet";
      for (const p of set.properties) {
        if (!p.name) continue;
        const key = propKey(pset, p.name);
        const num = coerceNumeric(p.value) != null;
        propNumeric.set(key, (propNumeric.get(key) ?? false) || num);
        if (seen.has(key)) continue;
        seen.add(key);
        fields.push({ key, label: `${p.name} · ${pset}`, source: "property", pset, name: p.name, kind: "categorical" });
      }
    }
    for (const set of extractQuantitiesOnDemand(store, id)) {
      for (const q of set.quantities) {
        if (!q.name) continue;
        const key = qtyKey(q.name);
        if (seen.has(key)) continue;
        seen.add(key);
        // Merged across all Qto_ sets (see qtyKey note) — label is just the name.
        fields.push({ key, label: q.name, source: "quantity", name: q.name, kind: "numeric" });
      }
    }
  }
  // Apply discovered numeric-ness to property fields.
  for (const f of fields) {
    if (f.source === "property" && propNumeric.get(f.key)) f.kind = "numeric";
  }
  fields.sort(fieldSort);
  fieldCache.set(store, fields);
  return fields;
}

// Keep Model/Class/Material first, then alphabetical by label.
function fieldSort(a: FieldDef, b: FieldDef): number {
  const rank = (f: FieldDef) => (f.key === "model" ? 0 : f.key === "class" ? 1 : f.key === "material" ? 2 : 3);
  return rank(a) - rank(b) || a.label.localeCompare(b.label, "ro");
}

export function fieldByKey(fields: FieldDef[], key: string): FieldDef | undefined {
  return fields.find((f) => f.key === key);
}

export function valueColumnLabel(fields: FieldDef[], col: ValueColumn): string {
  const f = fieldByKey(fields, col.fieldKey);
  return `${aggLabel(col.agg)}: ${f?.name ?? f?.label ?? col.fieldKey}`;
}

// --- per-element value resolution (memoised per store) --------------------
const valueCache = new WeakMap<IfcDataStore, Map<string, string | number | null>>();
const materialCache = new WeakMap<IfcDataStore, Map<number, string>>();

function materialByElement(store: IfcDataStore): Map<number, string> {
  let m = materialCache.get(store);
  if (m) return m;
  m = new Map();
  for (const usage of buildMaterialUsageIndex(store).values()) {
    for (const e of usage.entries) {
      if (!m.has(e.entityId)) m.set(e.entityId, usage.name || NO_VALUE);
    }
  }
  materialCache.set(store, m);
  return m;
}

/** Resolve one field's value for one element (categorical → string, numeric →
 *  number). Returns null when the element has no value for that field. */
export function getFieldValue(store: IfcDataStore, id: number, field: FieldDef): string | number | null {
  let cache = valueCache.get(store);
  if (!cache) {
    cache = new Map();
    valueCache.set(store, cache);
  }
  const ck = `${id}|${field.key}`;
  const hit = cache.get(ck);
  if (hit !== undefined) return hit;

  let val: string | number | null = null;
  switch (field.source) {
    case "class": {
      const t = entityType(store, id);
      val = t ? friendly(t) : null;
      break;
    }
    case "material": {
      val = materialByElement(store).get(id) ?? null;
      break;
    }
    case "property": {
      for (const set of extractPropertiesOnDemand(store, id)) {
        if ((set.name || "PropertySet") !== field.pset) continue;
        const p = set.properties.find((x) => x.name === field.name);
        if (p) {
          val = field.kind === "numeric" ? coerceNumeric(p.value) : p.value == null ? null : String(p.value);
          break;
        }
      }
      break;
    }
    case "quantity": {
      // Match by name across every Qto_ set (merged field — see discoverFields).
      for (const set of extractQuantitiesOnDemand(store, id)) {
        const q = set.quantities.find((x) => x.name === field.name);
        if (q) {
          val = typeof q.value === "number" && Number.isFinite(q.value) ? q.value : null;
          break;
        }
      }
      break;
    }
  }
  cache.set(ck, val);
  return val;
}

/** Distinct values present in the loaded model(s) for a property — suggestions
 *  for the Filter panel's value combobox. With a pset it reuses getFieldValue's
 *  per-store cache; with an empty pset it matches the property name in ANY pset
 *  (mirroring how the filter's bulkSelect treats a blank pset). Capped so a
 *  per-element-unique property (tag-like) doesn't build a giant list. */
export function distinctFieldValues(models: PivotModel[], pset: string, prop: string, cap = 200): string[] {
  const p = prop.trim(), ps = pset.trim();
  if (!p) return [];
  // Same key format as discoverFields so getFieldValue's cache is shared.
  const field: FieldDef | null = ps ? { key: propKey(ps, p), label: p, source: "property", pset: ps, name: p, kind: "categorical" } : null;
  const out = new Set<string>();
  outer: for (const m of models) {
    for (const id of m.localIDs) {
      if (field) {
        const v = getFieldValue(m.store, id, field);
        if (v != null && v !== "") out.add(String(v));
      } else {
        for (const set of extractPropertiesOnDemand(m.store, id)) {
          const pr = set.properties.find((x) => x.name === p);
          if (pr && pr.value != null && pr.value !== "") out.add(String(pr.value));
        }
      }
      if (out.size >= cap) break outer;
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// --- aggregation ----------------------------------------------------------
// An element flattened across models: its owning store, local id (for value
// lookups), global id (for 3D selection) and model name (for the "Model" field).
interface Elem { store: IfcDataStore; local: number; global: number; model: string; }

/** Resolve a field's value for one element, handling the model pseudo-field. */
function elemValue(e: Elem, field: FieldDef): string | number | null {
  return field.source === "model" ? e.model : getFieldValue(e.store, e.local, field);
}

function aggregate(fields: FieldDef[], elems: Elem[], col: ValueColumn): number | null {
  if (col.agg === "count") return elems.length;
  const field = fieldByKey(fields, col.fieldKey);
  if (!field) return null;
  let sum = 0, n = 0, min = Infinity, max = -Infinity;
  for (const e of elems) {
    const v = elemValue(e, field);
    const num = typeof v === "number" ? v : coerceNumeric(v);
    if (num == null) continue;
    sum += num; n++;
    if (num < min) min = num;
    if (num > max) max = num;
  }
  if (n === 0) return null;
  switch (col.agg) {
    case "sum": return sum;
    case "avg": return sum / n;
    case "min": return min;
    case "max": return max;
  }
  return null;
}

/** Group all models' elements by the nested group-by fields and compute the
 *  value columns. Row `ids` are GLOBAL ids so a row click selects in 3D. */
export function buildPivot(models: PivotModel[], config: PivotConfig): PivotResult {
  const fields = discoverFields(models);
  const groupFields = config.groupBy.map((k) => fieldByKey(fields, k)).filter(Boolean) as FieldDef[];

  const elems: Elem[] = [];
  for (const m of models) for (const l of m.localIDs) elems.push({ store: m.store, local: l, global: l + m.offset, model: m.fileName });

  const makeRows = (subset: Elem[], depth: number): PivotRow[] => {
    if (depth >= groupFields.length) return [];
    const field = groupFields[depth];
    const buckets = new Map<string, Elem[]>();
    for (const e of subset) {
      const v = elemValue(e, field);
      const label = v == null || v === "" ? NO_VALUE : String(v);
      const arr = buckets.get(label);
      if (arr) arr.push(e);
      else buckets.set(label, [e]);
    }
    const rows: PivotRow[] = [];
    for (const [label, bucket] of buckets) {
      rows.push({
        label,
        depth,
        ids: bucket.map((e) => e.global),
        count: bucket.length,
        values: config.values.map((c) => aggregate(fields, bucket, c)),
        children: makeRows(bucket, depth + 1),
      });
    }
    rows.sort(rowSort);
    return rows;
  };

  const rows = groupFields.length ? makeRows(elems, 0) : [];
  return {
    columns: config.values.map((c) => ({ label: valueColumnLabel(fields, c) })),
    rows,
    totals: {
      count: elems.length,
      values: config.values.map((c) => aggregate(fields, elems, c)),
    },
  };
}

// "(fără valoare)" always last; otherwise natural ro collation.
function rowSort(a: PivotRow, b: PivotRow): number {
  if (a.label === NO_VALUE) return 1;
  if (b.label === NO_VALUE) return -1;
  return a.label.localeCompare(b.label, "ro", { numeric: true });
}

// --- CSV export -----------------------------------------------------------
// Standard RFC-4180 CSV: comma separator, dot decimal, CRLF, fields quoted when
// they contain a comma/quote/newline. (Numbers use a dot decimal and FP noise is
// trimmed to 6 decimals.) A UTF-8 BOM keeps diacritics correct in Excel.
// Exported so other CSV producers (analytics card export) share one dialect.
export const fmtCsvNum = (v: number | null) => (v == null ? "" : String(Number(v.toFixed(6))));
export const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Join CSV lines (BOM + CRLF) into a Blob and trigger a `<base>.csv` download. */
export function csvDownload(lines: string[], baseName: string): void {
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Flatten the pivot (one column per group level + Număr + value columns) to a
 *  standard CSV and trigger a browser download. No totals row. */
export function exportPivotCsv(result: PivotResult, config: PivotConfig, fields: FieldDef[], fileName: string): void {
  const depth = config.groupBy.length;
  const groupHeaders = config.groupBy.map((k) => fieldByKey(fields, k)?.label ?? k);
  const header = [...groupHeaders, t("dataTable.count"), ...result.columns.map((c) => c.label)];
  const lines: string[] = [header.map(csvCell).join(",")];

  const walk = (rows: PivotRow[], path: string[]) => {
    for (const row of rows) {
      const labels = [...path, displayLabel(row.label)];
      if (row.children.length) {
        walk(row.children, labels);
      } else {
        const cells = [...labels];
        while (cells.length < depth) cells.push("");
        cells.push(String(row.count), ...row.values.map(fmtCsvNum));
        lines.push(cells.map(csvCell).join(","));
      }
    }
  };
  walk(result.rows, []);

  const base = fileName.replace(/\.[^.]+$/, "") || "model";
  csvDownload(lines, `${base}-${t("dataTable.csvSuffix")}`);
}
