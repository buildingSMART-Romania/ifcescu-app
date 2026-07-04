// Persistence for the single "active" IDS document the editor works on.
//
// An IDS describes requirements, not a model, so the draft is GLOBAL (one key),
// not per-file like viewpoints — it is routinely validated against many models.
// We persist the raw document as JSON rather than serialized IDS XML: serializeIds
// deliberately drops an in-progress author/date that isn't yet valid and rewrites
// an empty title, which would corrupt a draft. IDSInfo/spec data is plain JSON.
import type { IDSDocument } from "./ids";

const KEY = "ifc-ids:draft";
const VERSION = 1;

interface DraftEnvelope {
  v: number;
  savedAt: string;
  doc: IDSDocument;
}

/** Load the persisted draft, or null if absent/corrupt/older schema. Never throws. */
export function loadIdsDraft(): IDSDocument | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as DraftEnvelope;
    if (
      !env ||
      env.v !== VERSION ||
      typeof env.doc?.info?.title !== "string" ||
      !Array.isArray(env.doc?.specifications)
    ) {
      return null;
    }
    return env.doc;
  } catch {
    return null;
  }
}

/** Persist the draft. Swallows quota/private-mode failures. */
export function saveIdsDraft(doc: IDSDocument): void {
  try {
    const env: DraftEnvelope = { v: VERSION, savedAt: new Date().toISOString(), doc };
    localStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    /* storage unavailable — the in-memory doc still works */
  }
}

/** Remove the persisted draft. Never throws. */
export function clearIdsDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

/**
 * True when the document is more than a pristine emptyIdsDoc() — i.e. worth
 * persisting and worth confirming before New/Load discards it. A single spec
 * that was merely renamed does not count as content on purpose.
 */
export function hasIdsContent(doc: IDSDocument | null | undefined): boolean {
  if (!doc) return false;
  const i = doc.info;
  if (
    i.title?.trim() ||
    i.author ||
    i.version ||
    i.description ||
    i.date ||
    i.purpose ||
    i.milestone ||
    i.copyright
  ) {
    return true;
  }
  const specs = doc.specifications ?? [];
  if (specs.length > 1) return true;
  return specs.some(
    (s) => (s.applicability?.facets?.length ?? 0) > 0 || (s.requirements?.length ?? 0) > 0,
  );
}
