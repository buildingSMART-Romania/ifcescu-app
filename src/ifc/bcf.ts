// Thin wrapper around @ifc-lite/bcf — BCF (BIM Collaboration Format) topic
// authoring, import and export. Adds the project-specific glue: mapping our
// selection (expressIDs) to/from the IFC GlobalIds that BCF components use, and
// a download helper for the .bcfzip blob.
import {
  createBCFProject,
  createBCFTopic,
  createBCFComment,
  addTopicToProject,
  addCommentToTopic,
  addViewpointToTopic,
  updateTopicStatus,
  createViewpoint,
  extractViewpointState,
  createBCFFromIDSReport,
  readBCF,
  writeBCF,
} from "@ifc-lite/bcf";
import { extractRootAttributesFromEntity, type IfcDataStore } from "@ifc-lite/parser";

export {
  createBCFProject,
  createBCFTopic,
  createBCFComment,
  addTopicToProject,
  addCommentToTopic,
  addViewpointToTopic,
  updateTopicStatus,
  createViewpoint,
  extractViewpointState,
  createBCFFromIDSReport,
  readBCF,
  writeBCF,
};
export type {
  BCFProject,
  BCFTopic,
  BCFComment,
  BCFViewpoint,
  ViewerCameraState,
  ViewerBounds,
  IDSBCFExportOptions,
} from "@ifc-lite/bcf";

/** Remove a topic from a project (symmetric with addTopicToProject). */
export function removeTopicFromProject(
  project: import("@ifc-lite/bcf").BCFProject,
  guid: string,
): void {
  project.topics.delete(guid);
}

/** Read a .bcfzip from any browser source (readBCF wants an ArrayBuffer).
 *  @ifc-lite/bcf ≥1.15.7 reads comment text and decodes XML entities natively
 *  (the repair pass this wrapper used to carry was removed — re-decoding here
 *  would corrupt text that legitimately contains "&amp;" etc.). */
export async function readBcfFile(
  data: File | Blob | ArrayBuffer,
): Promise<import("@ifc-lite/bcf").BCFProject> {
  const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  return readBCF(buf);
}

/** Single-model identifier used for BCF modelId and the "modelId:expressId" keys. */
export const MODEL_ID = "model";

/** Map selected expressIDs → IFC GlobalIds (drops entities without a GlobalId). */
export function expressIdsToGlobalIds(store: IfcDataStore, ids: Iterable<number>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const guid = globalIdOf(store, id);
    if (guid) out.push(guid);
  }
  return out;
}

function globalIdOf(store: IfcDataStore, id: number): string | undefined {
  const e = (store as any).getEntity(id);
  if (!e) return undefined;
  try {
    return extractRootAttributesFromEntity(e).globalId ?? undefined;
  } catch {
    return undefined;
  }
}

// GlobalId → expressId reverse index, built lazily once per store (a full scan,
// so only paid on the first import/viewpoint-apply, then cached for the store's
// lifetime). Non-rooted entities have no GlobalId and are skipped.
const reverseCache = new WeakMap<IfcDataStore, Map<string, number>>();
function reverseIndex(store: IfcDataStore): Map<string, number> {
  const cached = reverseCache.get(store);
  if (cached) return cached;
  const map = new Map<string, number>();
  for (const id of store.entityIndex.byId.keys()) {
    const guid = globalIdOf(store, id);
    if (guid && !map.has(guid)) map.set(guid, id);
  }
  reverseCache.set(store, map);
  return map;
}

/** Map BCF GlobalIds → expressIDs in the current model (drops unknown GUIDs). */
export function globalIdsToExpressIds(store: IfcDataStore, guids: Iterable<string>): number[] {
  const idx = reverseIndex(store);
  const out: number[] = [];
  for (const g of guids) {
    const id = idx.get(g);
    if (id != null) out.push(id);
  }
  return out;
}

/** Serialise a BCF project to a .bcfzip and trigger a browser download. */
export async function downloadBcf(
  project: import("@ifc-lite/bcf").BCFProject,
  name: string,
): Promise<void> {
  const blob = await writeBCF(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.toLowerCase().endsWith(".bcfzip") ? name : `${name}.bcfzip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
