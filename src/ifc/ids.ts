// Thin wrapper around @ifc-lite/ids — IDS (Information Delivery Specification)
// validation. Parses an IDS XML, then validates the currently loaded model's
// columnar store against it. The store is obtained via parseStore (cached by
// bytes identity, so this reuses the same parse the viewer/editor already did).
//
// IDS rule/failure descriptions are produced in English by the package's
// translation service; our surrounding UI labels stay Romanian.
import { parseIDS, validateIDS, createTranslationService, auditIDSStructure } from "@ifc-lite/ids";
import type {
  IDSDocument,
  IDSValidationReport,
  ValidationProgress,
  IDSSpecification,
  IDSRequirement,
  IDSFacet,
  IDSAuditReport,
} from "@ifc-lite/ids";
// The store→accessor bridge lives ONLY on the /bridge subpath, not the root.
import { createDataAccessor, narrowSchemaVersion } from "@ifc-lite/ids/bridge";
import { parseStore, detectSchema } from "./store";

export { serializeIds, isXsDate } from "./idsWriter";

export type {
  IDSDocument,
  IDSValidationReport,
  IDSSpecificationResult,
  IDSEntityResult,
  IDSRequirementResult,
  // Authoring model (used by the IDS creator)
  IDSInfo,
  IDSSpecification,
  IDSApplicability,
  IDSRequirement,
  IDSFacet,
  FacetType,
  IDSEntityFacet,
  IDSAttributeFacet,
  IDSPropertyFacet,
  IDSClassificationFacet,
  IDSMaterialFacet,
  IDSPartOfFacet,
  PartOfRelation,
  IDSConstraint,
  IDSSimpleValue,
  IDSPatternConstraint,
  IDSEnumerationConstraint,
  IDSBoundsConstraint,
  RequirementOptionality,
  IFCVersion,
  IDSAuditReport,
  IDSAuditIssue,
} from "@ifc-lite/ids";

/** Parse buildingSMART IDS XML text into a document. Throws IDSParseError on malformed input. */
export function parseIdsXml(xml: string): IDSDocument {
  return parseIDS(xml);
}

/** XSD + IFC-schema audit of an authored (in-memory) IDS document — used by the
 *  IDS creator to surface structural/schema issues live, without serialising. */
export function auditIds(doc: IDSDocument): Promise<IDSAuditReport> {
  return auditIDSStructure(doc);
}

let uidSeq = 0;
/** Stable-ish unique id for new specs/requirements (crypto when available). */
export function idsUid(prefix = "id"): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${(uidSeq++).toString(36)}`;
  }
}

/** A fresh, empty IDS document (one starter specification). Title is left blank
 *  on purpose — the IDS audit treats the literal "Untitled IDS" as no title, and
 *  a real document needs a real name (the editor gates export on it). */
export function emptyIdsDoc(): IDSDocument {
  return { info: { title: "" }, specifications: [emptySpec()] };
}

/**
 * True when the document is more than a pristine emptyIdsDoc() — i.e. an actual
 * authored document worth treating as the "active IDS" and worth confirming
 * before New/Load discards it. A single spec that was merely renamed does not
 * count as content on purpose.
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

/** A fresh specification: applies to everything, no requirements yet. */
export function emptySpec(): IDSSpecification {
  return {
    id: idsUid("spec"),
    name: "New specification",
    ifcVersions: ["IFC4"],
    applicability: { facets: [] },
    requirements: [],
  };
}

/** A requirement wrapper around a facet (default: required). */
export function emptyRequirement(facet: IDSFacet): IDSRequirement {
  return { id: idsUid("req"), facet, optionality: "required" };
}

/** A default facet of the given kind, with empty constraints. */
export function defaultFacet(type: IDSFacet["type"]): IDSFacet {
  const sv = (value = "") => ({ type: "simpleValue" as const, value });
  switch (type) {
    case "entity": return { type: "entity", name: sv() };
    case "attribute": return { type: "attribute", name: sv("Name") };
    case "property": return { type: "property", propertySet: sv(), baseName: sv() };
    case "classification": return { type: "classification" };
    case "material": return { type: "material" };
    case "partOf": return { type: "partOf", relation: "IfcRelContainedInSpatialStructure" };
  }
}

/**
 * Validate the model (parsed from `bytes`) against an IDS document.
 * `fileName` is used as the report's modelId. `onProgress` surfaces validator
 * progress so the UI can show a bar on large documents.
 */
export async function runIdsValidation(
  bytes: Uint8Array,
  idsDoc: IDSDocument,
  fileName: string,
  onProgress?: (p: ValidationProgress) => void,
): Promise<IDSValidationReport> {
  const store = await parseStore(bytes);
  const accessor = createDataAccessor(store);
  const modelInfo = {
    modelId: fileName,
    schemaVersion: narrowSchemaVersion(detectSchema(bytes)),
    entityCount: store.entityIndex.byId.size,
  };
  return validateIDS(idsDoc, accessor, modelInfo, {
    translator: createTranslationService("en"),
    onProgress,
    includePassingEntities: false,
  });
}
