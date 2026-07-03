// Client-side IFC reader/editor/writer built on @ifc-lite (parser + mutations + export).
//
// Edits (attributes, property/quantity values, new property sets) accumulate in an
// @ifc-lite MutablePropertyView overlay and materialise at export() via StepExporter,
// which is natively non-destructive (untouched STEP lines + full numeric precision
// preserved). One IfcEditor wraps ONE model store; the 3D viewer keeps one per
// federated model (see Viewer.modelEditorsRef).
import {
  extractGeoreferencingOnDemand,
  extractRootAttributesFromEntity,
  getRawNamedAttributes,
  type IfcDataStore,
} from "@ifc-lite/parser";
import { IFC_ENTITY_NAMES, IfcTypeEnum } from "@ifc-lite/data";
import { PropertyValueType, QuantityType } from "@ifc-lite/data";
import { MutablePropertyView, BulkQueryEngine } from "@ifc-lite/mutations";
import { StepExporter } from "@ifc-lite/export";
import { parseStore, detectSchema, type IfcSchema } from "./store";

// Query types for the Filter feature (BulkQueryEngine.select).
export type { SelectionCriteria, FilterOperator } from "@ifc-lite/mutations";

/** Map an IFC class name (any case, e.g. "IFCWALL"/"IfcWall") to its IfcTypeEnum
 *  number for BulkQueryEngine's `entityTypes`, or null when not in the enum. */
export function classToTypeEnum(name: string): number | null {
  if (!name) return null;
  const pretty = IFC_ENTITY_NAMES[name.toUpperCase()] ?? name;
  const v = (IfcTypeEnum as Record<string, unknown>)[pretty];
  return typeof v === "number" ? v : null;
}

export interface GeorefInfo {
  /** Projected CRS name, e.g. "EPSG:3844". */
  crsName: string;
  /** Eastings (X / Est) of the model origin in the projected CRS. */
  eastings: number;
  /** Northings (Y / Nord) of the model origin in the projected CRS. */
  northings: number;
  /** Orthogonal height (cotă) of the model origin. */
  height: number;
  /** Grid rotation of the model X axis towards north, in degrees. */
  rotationDeg: number;
  /** Uniform scale from model units to the projected CRS. */
  scale: number;
}

// --- editable selection (the in-3D edit panel) ----------------------------
export type EditGroupKind = "attribute" | "pset" | "quantity";

export interface EditRow {
  /** Property/quantity/attribute name (the real IFC name, used for mutations). */
  name: string;
  /** Current value, stringified for the input (enum values are shown without dots). */
  value: string;
  /** Property value type (pset rows) — drives the mutation's typing. */
  propType?: PropertyValueType;
  /** Quantity type (quantity rows). */
  qtyType?: QuantityType;
  unit?: string;
  /** Read-only rows (e.g. GlobalId) are shown but not editable. */
  readonly?: boolean;
  /** Enum-valued attribute (e.g. PredefinedType) — edited as a dropdown. */
  isEnum?: boolean;
  /** True when this row has a pending edit (shown with an "editat" badge). */
  edited?: boolean;
}

export interface EditGroup {
  kind: EditGroupKind;
  /** "Atribute" for the attribute group, else the pset / qset name. */
  name: string;
  rows: EditRow[];
}

export interface SelectionDetail {
  header: { name: string; type: string };
  /** Raw uppercase IFC type, e.g. "IFCWALL" (for standard-pset lookups). */
  ifcClass: string;
  groups: EditGroup[];
}

/** IfcRoot attributes we expose for editing (in order). */
const EDITABLE_ATTRS = ["Name", "Description", "ObjectType", "Tag"] as const;

/** Canonical PascalCase IFC type name ("IFCWALL" → "IfcWall"). */
function prettyType(type: string): string {
  if (!type) return "";
  const hit = IFC_ENTITY_NAMES[type.toUpperCase()];
  if (hit) return hit;
  const rest = type.replace(/^IFC/i, "");
  return "Ifc" + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
}

/** Read a named raw attribute (entity refs come back as numbers, lists as number[]). */
function rawAttr(entity: any, name: string): unknown {
  const hit = getRawNamedAttributes(entity).find((p) => p.name === name);
  return hit ? hit.raw : null;
}

const str = (v: unknown) => (v == null ? "" : String(v));

export class IfcEditor {
  private view: MutablePropertyView;

  private constructor(
    private store: IfcDataStore,
    private schemaName: IfcSchema,
  ) {
    this.view = new MutablePropertyView(null, "0");
    this.view.setExpressIdWatermark(this.maxExpressId());
    // Wire base reads so getPropertyValue / getForEntity return existing + mutated values.
    this.view.setOnDemandExtractor((id) => (this.store as any).getProperties(id) ?? []);
    this.view.setQuantityExtractor?.((id: number) => (this.store as any).getQuantities(id) ?? []);
  }

  /** Parse bytes and wrap the resulting store. */
  static async open(bytes: Uint8Array): Promise<IfcEditor> {
    const store = await parseStore(bytes);
    return new IfcEditor(store, detectSchema(bytes));
  }

  /** Wrap an already-parsed store (the 3D engine parses each federated model). */
  static fromStore(store: IfcDataStore, schema: IfcSchema): IfcEditor {
    return new IfcEditor(store, schema);
  }

  private getEntity(id: number): any {
    return (this.store as any).getEntity(id);
  }
  private maxExpressId(): number {
    let m = 0;
    for (const k of this.store.entityIndex.byId.keys()) if (k > m) m = k;
    const def = (this.store as any).deferredEntityIndex;
    if (def) for (const k of def.keys()) if (k > m) m = k;
    return m;
  }

  schema(): IfcSchema {
    return this.schemaName;
  }
  /** No-op kept for API compatibility. */
  close(): void {}

  /** True when any mutation has been recorded. */
  hasChanges(): boolean {
    return this.view.hasChanges();
  }

  /** Number of DISTINCT things changed (an attribute/property/set edited twice
   *  counts once), not the raw mutation-operation count. */
  changeCount(): number {
    const keys = new Set<string>();
    for (const m of this.view.getMutations()) {
      const k =
        m.type === "UPDATE_ATTRIBUTE" || m.type === "UPDATE_POSITIONAL_ATTRIBUTE"
          ? `a:${m.entityId}:${m.attributeName ?? ""}`
          : m.type === "CREATE_PROPERTY_SET" || m.type === "DELETE_PROPERTY_SET"
            ? `s:${m.entityId}:${m.psetName ?? ""}`
            : `p:${m.entityId}:${m.psetName ?? ""}:${m.propName ?? ""}`;
      keys.add(k);
    }
    return keys.size;
  }

  // --- selection read (edit panel) ----------------------------------------
  /** Structured, view-aware read of an element so saved edits show immediately. */
  getSelection(id: number): SelectionDetail {
    const e = this.getEntity(id);
    const root = e ? extractRootAttributesFromEntity(e) : { name: "", globalId: "" };

    // Overlay attribute edits + track which rows were edited (for "editat" badges).
    const overlay = new Map<string, string>();
    const editedAttrs = new Set<string>();   // attribute names
    const editedKeys = new Set<string>();    // `${set}::${name}` (props + quantities)
    const createdSets = new Set<string>();   // whole new property sets
    for (const m of this.view.getMutationsForEntity(id)) {
      if (m.type === "UPDATE_ATTRIBUTE" && m.attributeName) {
        overlay.set(m.attributeName, str(m.newValue));
        editedAttrs.add(m.attributeName);
      } else if (m.type === "CREATE_PROPERTY_SET" && m.psetName) {
        createdSets.add(m.psetName);
      } else if (m.psetName && m.propName) {
        editedKeys.add(`${m.psetName}::${m.propName}`);
      }
    }
    const attrVal = (name: string): string =>
      overlay.has(name) ? overlay.get(name)! : str(name === "Name" ? root.name : rawAttr(e, name));

    const groups: EditGroup[] = [];
    const attrRows: EditRow[] = EDITABLE_ATTRS.map((n) => ({ name: n, value: attrVal(n), edited: editedAttrs.has(n) }));
    // PredefinedType (enum) only when the entity's class actually declares it.
    if (e && getRawNamedAttributes(e).some((p) => p.name === "PredefinedType")) {
      const noDots = attrVal("PredefinedType").replace(/^\./, "").replace(/\.$/, "");
      attrRows.push({ name: "PredefinedType", value: noDots, isEnum: true, edited: editedAttrs.has("PredefinedType") });
    }
    attrRows.push({ name: "GlobalId", value: str(root.globalId), readonly: true });
    groups.push({ kind: "attribute", name: "Atribute", rows: attrRows });

    for (const set of this.view.getForEntity(id)) {
      const psetNew = createdSets.has(set.name);
      const rows: EditRow[] = set.properties
        .filter((p) => p.name)
        .map((p) => ({ name: p.name, value: str(p.value), propType: p.type, unit: p.unit, edited: psetNew || editedKeys.has(`${set.name}::${p.name}`) }));
      groups.push({ kind: "pset", name: set.name || "PropertySet", rows });
    }
    for (const set of this.view.getQuantitiesForEntity(id)) {
      const rows: EditRow[] = set.quantities
        .filter((q) => q.name)
        .map((q) => ({ name: q.name, value: str(q.value), qtyType: q.type, unit: q.unit, edited: editedKeys.has(`${set.name}::${q.name}`) }));
      groups.push({ kind: "quantity", name: set.name || "Qto", rows });
    }

    return {
      header: { name: attrVal("Name"), type: prettyType(e?.type ?? "") },
      ifcClass: (e?.type ?? "").toUpperCase(),
      groups,
    };
  }

  // --- edits --------------------------------------------------------------
  setRootAttribute(id: number, name: string, value: string): void {
    this.view.setAttribute(id, name, value);
  }
  setProperty(id: number, pset: string, prop: string, value: string, type: PropertyValueType = PropertyValueType.Text): void {
    this.view.setProperty(id, pset, prop, value, type);
  }
  createPropertySet(
    id: number,
    psetName: string,
    properties: Array<{ name: string; value: string; type?: PropertyValueType }>,
  ): void {
    this.view.createPropertySet(
      id,
      psetName,
      properties.map((p) => ({ name: p.name, value: p.value, type: p.type ?? PropertyValueType.Text })),
    );
  }
  setQuantity(id: number, qset: string, name: string, value: number, qType: QuantityType = QuantityType.Length): void {
    this.view.setQuantity(id, qset, name, value, qType);
  }

  // --- query selection (@ifc-lite BulkQueryEngine) for the Filter feature ---
  private bulk?: BulkQueryEngine;
  private bulkEngine(): BulkQueryEngine {
    const s = this.store as any;
    return (this.bulk ??= new BulkQueryEngine(s.entities, this.view, s.spatialHierarchy ?? null, s.properties, s.strings));
  }
  /** Resolve a selection criteria to matching express ids (Filter query-builder). */
  bulkSelect(criteria: import("@ifc-lite/mutations").SelectionCriteria): number[] {
    return this.bulkEngine().select(criteria);
  }
  /** Resolve an IFC class name to the express ids of its instances (fallback for
   *  the bulk class filter when the class isn't in IfcTypeEnum). */
  expressIdsOfClass(name: string): number[] {
    return this.store.entityIndex.byType.get(name.toUpperCase()) ?? [];
  }

  // --- georeferencing (read-only; the model's embedded IfcMapConversion) --
  /** True when the schema supports IfcMapConversion (IFC4 / IFC4x3, not IFC2x3). */
  supportsGeoref(): boolean {
    return this.schemaName !== "IFC2X3";
  }

  getGeoref(): GeorefInfo | null {
    const g = extractGeoreferencingOnDemand(this.store);
    if (!g?.mapConversion) return null;
    const mc = g.mapConversion;
    const ax = mc.xAxisAbscissa ?? 1;
    const ay = mc.xAxisOrdinate ?? 0;
    // A degenerate (0,0) axis means "no rotation given" (some exporters write it
    // instead of 1,0) — avoid atan2(0,0). A zero/non-finite scale is never valid
    // (it would collapse all geometry onto the anchor) — default it to 1.
    const rotationDeg = ax === 0 && ay === 0 ? 0 : (Math.atan2(ay, ax) * 180) / Math.PI;
    const scale = typeof mc.scale === "number" && Number.isFinite(mc.scale) && mc.scale !== 0 ? mc.scale : 1;
    return {
      crsName: g.projectedCRS?.name ?? "",
      eastings: mc.eastings,
      northings: mc.northings,
      height: mc.orthogonalHeight,
      rotationDeg,
      scale,
    };
  }

  // --- export -------------------------------------------------------------
  /**
   * Export the edited model via @ifc-lite/export (non-destructive: untouched STEP
   * lines preserved, full numeric precision). All overlay mutations apply here.
   */
  export(): Uint8Array {
    const result = new StepExporter(this.store, this.view).export({
      schema: this.schemaName,
      includeGeometry: true,
      includeProperties: true,
      includeQuantities: true,
      includeRelationships: true,
      applyMutations: true,
    });
    return result.content;
  }
}
