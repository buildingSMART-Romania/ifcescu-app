// Build the viewer's UI data (spatial tree, property groups, file overview) from
// an @ifc-lite IfcDataStore — replaces web-ifc-viewer's getSpatialStructure /
// getProperties. The presentational components (IfcTree, PropsPanel) are unchanged.
import {
  SpatialHierarchyBuilder,
  extractRootAttributesFromEntity,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  buildMaterialUsageIndex,
  type IfcDataStore,
} from "@ifc-lite/parser";
import type { TreeNode } from "../components/IfcTree";
import { t } from "../i18n";
import type { PropGroup, FileInfo } from "../components/PropsPanel";
import type { GeorefInfo } from "../ifc/editor";
import { STEREO70, STEREO70_BOUNDS } from "../ifc/constants";
import { stereo70ToWgs84 } from "../geo/crs";

interface SpatialNodeLike {
  expressId: number;
  name: string;
  children: SpatialNodeLike[];
  elements: number[];
}

export function entityType(store: IfcDataStore, id: number): string {
  return (store as any).getEntity(id)?.type ?? "";
}
export function entityName(store: IfcDataStore, id: number): string {
  const e = (store as any).getEntity(id);
  return e ? extractRootAttributesFromEntity(e).name ?? "" : "";
}

/** Build the spatial-structure tree (containers + element leaves) for IfcTree. */
export function buildTree(store: IfcDataStore, allIDs: Set<number>): TreeNode | null {
  let hierarchy;
  try {
    hierarchy = new SpatialHierarchyBuilder().build(
      store.entities,
      store.relationships,
      store.strings,
      store.source,
      store.entityIndex,
      (store as any).lengthUnitScale,
    );
  } catch {
    return null;
  }
  const root = hierarchy.project as unknown as SpatialNodeLike;

  const walk = (node: SpatialNodeLike): TreeNode => {
    const children: TreeNode[] = node.children.map(walk);
    // Element leaves contained directly in this container (only ones with geometry).
    for (const id of node.elements) {
      if (!allIDs.has(id)) continue;
      children.push({
        expressID: id,
        type: entityType(store, id),
        name: entityName(store, id),
        ids: [id],
        children: [],
      });
    }
    // The container itself is always selectable/editable (so non-geometric
    // spatial entities — IfcProject/Site/Building/Storey/facilities — can have
    // official properties added), followed by its renderable descendants.
    const ids: number[] = [node.expressId];
    for (const c of children) ids.push(...c.ids);
    return {
      expressID: node.expressId,
      type: entityType(store, node.expressId),
      name: node.name ?? entityName(store, node.expressId),
      ids,
      children,
    };
  };
  return walk(root);
}

/**
 * Build a tree grouped purely by IFC class (flat, not nested in spatial
 * containers): top level = one group per class ("IfcWall (243)") whose children
 * are the individual elements. Group rows carry the raw uppercase type so the
 * IfcTree formatter renders the PascalCase label; only renderable geometry is
 * included (intersection with `allIDs`). Returned as a forest of class groups —
 * no IfcProject wrapper (the Class view shows classes only).
 */
export function buildClassTree(store: IfcDataStore, allIDs: Set<number>): TreeNode[] {
  const groups: TreeNode[] = [];
  for (const [type, idsAll] of store.entityIndex.byType) {
    const items: TreeNode[] = [];
    const ids: number[] = [];
    for (const id of idsAll) {
      if (!allIDs.has(id)) continue; // renderable geometry only
      items.push({ expressID: id, type, name: entityName(store, id), ids: [id], children: [] });
      ids.push(id);
    }
    if (!items.length) continue;
    items.sort((a, b) => a.expressID - b.expressID);
    // expressID is patched below to a unique synthetic id for the group row.
    groups.push({ expressID: 0, type, name: "", ids, children: items, count: items.length, defaultOpen: false });
  }
  groups.sort((a, b) => a.type.localeCompare(b.type));
  let synthetic = -1;
  for (const g of groups) g.expressID = synthetic--;
  return groups;
}

/**
 * Build a tree grouped by material (IfcRelAssociatesMaterial, resolved per
 * element occurrence or via its type): top level = one group per material
 * ("Concrete (120)") whose children are the elements using it. Elements with no
 * material fall into a trailing "Fără material" bucket (UI chrome stays Romanian,
 * consistent with the rest of the app; only IFC class names are de-translated).
 * Returned as a forest of material groups — no IfcProject wrapper.
 */
export function buildMaterialTree(store: IfcDataStore, allIDs: Set<number>): TreeNode[] {
  const usage = buildMaterialUsageIndex(store);
  const groups: TreeNode[] = [];
  const used = new Set<number>();
  let synthetic = -1;
  for (const mu of usage.values()) {
    const items: TreeNode[] = [];
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const e of mu.entries) {
      const id = e.entityId;
      if (!allIDs.has(id) || seen.has(id)) continue; // renderable + dedupe multi-layer
      seen.add(id);
      used.add(id);
      items.push({ expressID: id, type: entityType(store, id), name: entityName(store, id), ids: [id], children: [] });
      ids.push(id);
    }
    if (!items.length) continue;
    items.sort((a, b) => a.type.localeCompare(b.type) || a.expressID - b.expressID);
    groups.push({ expressID: synthetic--, type: "IFCMATERIAL", name: mu.name || t("model.unnamedMaterial"), ids, children: items, count: items.length, defaultOpen: false });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));

  // Renderable elements not covered by any material → trailing bucket.
  const noMat: TreeNode[] = [];
  const noIds: number[] = [];
  for (const id of allIDs) {
    if (used.has(id)) continue;
    noMat.push({ expressID: id, type: entityType(store, id), name: entityName(store, id), ids: [id], children: [] });
    noIds.push(id);
  }
  if (noMat.length) {
    noMat.sort((a, b) => a.type.localeCompare(b.type) || a.expressID - b.expressID);
    groups.push({ expressID: synthetic--, type: "IFCMATERIAL", name: t("model.noMaterial"), ids: noIds, children: noMat, count: noMat.length, defaultOpen: false });
  }
  return groups;
}

/**
 * Shift a tree's renderable ids (and real positive expressIDs) into the global
 * id space of a federated model. Synthetic group rows keep their negative
 * expressID (cosmetic, unique within the model's subtree).
 */
export function offsetTree(node: TreeNode, offset: number): TreeNode {
  return {
    ...node,
    expressID: node.expressID > 0 ? node.expressID + offset : node.expressID,
    ids: node.ids.map((id) => id + offset),
    children: node.children.map((c) => offsetTree(c, offset)),
  };
}

/** Per-model wrapper root (type "MODEL", labeled by file name) holding a model's
 *  forest. `rootId` must be a unique negative sentinel across the whole forest. */
export function modelRootNode(rootId: number, fileName: string, children: TreeNode[], globalIDs: number[]): TreeNode {
  return {
    expressID: rootId,
    type: "MODEL",
    name: fileName,
    ids: globalIDs,
    children,
    count: globalIDs.length,
    defaultOpen: true,
  };
}

/** "IFCCOLUMN" → "IfcColumn". */
export function prettyIfcType(t: string): string {
  if (!t) return "";
  if (/^IFC/i.test(t)) {
    const rest = t.slice(3);
    return "Ifc" + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
  }
  return t;
}

export interface SelectionProps {
  header: { name: string; type: string };
  groups: PropGroup[];
}

/** Build the property/quantity accordion for one element. */
export function getSelectionProps(store: IfcDataStore, id: number): SelectionProps {
  const e = (store as any).getEntity(id);
  const root = e ? extractRootAttributesFromEntity(e) : { name: "", globalId: "", description: "" };
  const header = { name: root.name ?? "", type: prettyIfcType(entityType(store, id)) };

  const groups: PropGroup[] = [];
  const attrs = [
    { k: t("viewer.attr.name"), v: root.name ?? "" },
    { k: "GlobalId", v: root.globalId ?? "" },
    { k: t("viewer.attr.description"), v: (root as any).description ?? "" },
  ].filter((r) => r.v.length);
  if (attrs.length) groups.push({ name: t("viewer.attrGroup"), rows: attrs });

  const fmt = (v: unknown) => (v == null ? "" : String(v));
  for (const set of extractPropertiesOnDemand(store, id)) {
    const rows = set.properties.map((p) => ({ k: p.name, v: fmt(p.value) })).filter((r) => r.k.length);
    if (rows.length) groups.push({ name: set.name || "PropertySet", rows });
  }
  // Quantity sets (Qto_*) always last.
  for (const set of extractQuantitiesOnDemand(store, id)) {
    const rows = set.quantities.map((q) => ({ k: q.name, v: fmt(q.value) })).filter((r) => r.k.length);
    if (rows.length) groups.push({ name: set.name || "Qto", rows });
  }
  return { header, groups };
}

/** Build the no-selection model overview panel. */
export function gatherFileInfo(
  store: IfcDataStore,
  elementsWithGeometry: number,
  byteLength: number,
  fileName: string,
  schema: string,
  georef: GeorefInfo | null,
  /** Model centroid in IFC absolute coordinates (Z-up). */
  centroid: { x: number; y: number; z: number },
): FileInfo {
  const byType = store.entityIndex.byType;
  const projIds = byType.get("IFCPROJECT") ?? [];
  let projectName = "";
  let projectGlobalId = "";
  if (projIds.length) {
    const root = extractRootAttributesFromEntity((store as any).getEntity(projIds[0]));
    projectName = root.name ?? "";
    projectGlobalId = root.globalId ?? "";
  }

  // Location pin = the model CENTROID mapped to Stereo 70 via the map conversion
  // (identity when there's no georef). Using the centroid — not the map origin —
  // makes models authored in real Stereo 70 coordinates with a zero Eastings/
  // Northings offset still resolve to their true location. Shown only inside Romania.
  let E = centroid.x;
  let N = centroid.y;
  if (georef) {
    const t = (georef.rotationDeg * Math.PI) / 180;
    const c = Math.cos(t), s = Math.sin(t);
    E = georef.eastings + georef.scale * (centroid.x * c - centroid.y * s);
    N = georef.northings + georef.scale * (centroid.x * s + centroid.y * c);
  }
  const b = STEREO70_BOUNDS;
  let location: FileInfo["location"] = null;
  if (E >= b.eMin && E <= b.eMax && N >= b.nMin && N <= b.nMax) {
    const { lonDeg, latDeg } = stereo70ToWgs84(E, N);
    location = { lat: latDeg, lon: lonDeg, crs: georef?.crsName || STEREO70.name };
  }

  return {
    fileName,
    fileSizeKB: byteLength / 1024,
    schema: schema || "—",
    projectName,
    projectGlobalId,
    totalEntities: store.entityIndex.byId.size,
    elementsWithGeometry,
    location,
  };
}
