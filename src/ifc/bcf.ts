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

// --- import repair ----------------------------------------------------------
// @ifc-lite/bcf's regex-based reader has two interop defects (found by
// tests/bcf.test.ts): (1) comment TEXT is lost entirely on read, and (2) XML
// entities (&quot; &lt; …) are left encoded in every text field. Any conformant
// .bcfzip (including our own exports) hits both. Until fixed upstream, the app
// imports through readBcfFile(), which re-extracts comments from the raw markup
// and decodes entities. Best-effort: on any repair failure the base read stands.

/** Decode the XML character entities used by BCF markup (amp handled last). */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Read a .bcfzip with the library, then repair comment text + XML entities. */
export async function readBcfFile(
  data: File | Blob | ArrayBuffer,
): Promise<import("@ifc-lite/bcf").BCFProject> {
  const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const project = await readBCF(buf);
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    for (const [guid, topic] of project.topics) {
      // Re-extract comment texts (the reader drops them): the markup nests a
      // <Comment> text tag inside the <Comment Guid="…"> element.
      const entry = zip.files[`${guid}/markup.bcf`];
      const fixed = new Set<string>();
      if (entry) {
        const xml = await entry.async("string");
        const texts = new Map<string, string>();
        for (const m of xml.matchAll(/<Comment\s+Guid="([^"]+)"[\s\S]*?<Comment>([\s\S]*?)<\/Comment>/g)) {
          texts.set(m[1], decodeXml(m[2]));
        }
        for (const c of topic.comments) {
          const text = texts.get(c.guid);
          if (text != null) {
            c.comment = text;
            fixed.add(c.guid);
          }
        }
      }
      topic.title = decodeXml(topic.title);
      if (topic.description != null) topic.description = decodeXml(topic.description);
      if (topic.assignedTo != null) topic.assignedTo = decodeXml(topic.assignedTo);
      if (topic.labels) topic.labels = topic.labels.map(decodeXml);
      for (const c of topic.comments) {
        c.author = decodeXml(c.author);
        if (!fixed.has(c.guid)) c.comment = decodeXml(c.comment);
      }
    }
    if (project.name) project.name = decodeXml(project.name);
  } catch {
    /* repair is best-effort */
  }
  return project;
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
