// Authoring catalogs for the IDS creator: suggestions for the editor's
// comboboxes (IFC classes, PredefinedType values, standard property sets +
// properties, data types) from @ifc-lite/data — the same source EditPanel uses —
// plus "from the current model" lists. All are suggestions (the editor uses
// type-or-choose <datalist> inputs), never hard limits.
import {
  getEntities,
  getPropertySets,
  getDataTypes,
  findEntity,
  type IfcSchemaVersion,
  type IfcPropertySetInfo,
} from "@ifc-lite/data";
import { discoverFields, type PivotModel } from "../viewer/pivot";

// --- standard buildingSMART catalogs (per schema, cached) ------------------
const classCache = new Map<string, string[]>();
const psetCache = new Map<string, IfcPropertySetInfo[]>();
const dataTypeCache = new Map<string, string[]>();

/** Instantiable IFC class names (UPPERCASE, as IDS uses them) for a schema. */
export async function ifcClasses(schema: IfcSchemaVersion): Promise<string[]> {
  const hit = classCache.get(schema);
  if (hit) return hit;
  const ents = await getEntities(schema);
  const names = [...new Set(ents.filter((e) => !e.abstract).map((e) => e.name.toUpperCase()))].sort();
  classCache.set(schema, names);
  return names;
}

/** PredefinedType enum values for an IFC class (empty if none / unknown). */
export async function predefinedTypes(schema: IfcSchemaVersion, className: string): Promise<string[]> {
  if (!className.trim()) return [];
  const e = await findEntity(schema, className);
  return e?.predefinedTypes ? [...e.predefinedTypes] : [];
}

/** All standard property sets for a schema (name + properties + data types). */
export async function propertySets(schema: IfcSchemaVersion): Promise<IfcPropertySetInfo[]> {
  const hit = psetCache.get(schema);
  if (hit) return hit;
  const all = [...(await getPropertySets(schema))];
  psetCache.set(schema, all);
  return all;
}

/** IFC data-type names (UPPERCASE, e.g. "IFCLABEL") for the property dataType picker. */
export async function dataTypes(schema: IfcSchemaVersion): Promise<string[]> {
  const hit = dataTypeCache.get(schema);
  if (hit) return hit;
  const names = [...new Set((await getDataTypes(schema)).map((d) => d.name.toUpperCase()))].sort();
  dataTypeCache.set(schema, names);
  return names;
}

// --- "from the current model" ----------------------------------------------
export interface ModelCatalog {
  /** Distinct UPPERCASE IFC class names present in the loaded model(s). */
  classes: string[];
  /** Distinct property-set names present. */
  psets: string[];
  /** Distinct property names present. */
  properties: string[];
  /** Distinct quantity names present. */
  quantities: string[];
}

/** Enumerate the classes / pset / property / quantity names actually in the model(s). */
export function modelCatalog(models: PivotModel[]): ModelCatalog {
  const classes = new Set<string>();
  for (const m of models) {
    const byType: Map<string, number[]> | undefined = (m.store as any)?.entityIndex?.byType;
    if (byType) for (const t of byType.keys()) classes.add(t.toUpperCase());
  }
  const psets = new Set<string>();
  const properties = new Set<string>();
  const quantities = new Set<string>();
  for (const f of discoverFields(models)) {
    if (f.source === "property") {
      if (f.pset) psets.add(f.pset);
      if (f.name) properties.add(f.name);
    } else if (f.source === "quantity") {
      if (f.name) quantities.add(f.name);
    }
  }
  const sort = (s: Set<string>) => [...s].sort();
  return { classes: sort(classes), psets: sort(psets), properties: sort(properties), quantities: sort(quantities) };
}
