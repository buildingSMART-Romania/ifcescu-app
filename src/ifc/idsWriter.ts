// Serialize an in-memory IDSDocument (the @ifc-lite/ids model) to buildingSMART
// IDS 1.0 XML. @ifc-lite/ids parses + validates + audits but does NOT write, so
// this is the missing half for the in-app IDS creator. Correctness is verified by
// round-tripping through parseIdsXml + auditIDSDocument (tests/idsWriter.test.ts).
import type {
  IDSDocument,
  IDSSpecification,
  IDSFacet,
  IDSConstraint,
  IDSEntityFacet,
  RequirementOptionality,
} from "@ifc-lite/ids";

const NS = "http://standards.buildingsmart.org/IDS";
const XS = "http://www.w3.org/2001/XMLSchema";
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const SCHEMA_LOCATION = "http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Indent a block of already-rendered lines by `n` levels (2 spaces each). */
function indent(lines: string[], n: number): string[] {
  const pad = "  ".repeat(n);
  return lines.map((l) => (l ? pad + l : l));
}

/** A constraint → the inner XML of an idsValue element (simpleValue or xs:restriction). */
function constraintLines(c: IDSConstraint): string[] {
  if (c.type === "simpleValue") return [`<simpleValue>${esc(c.value)}</simpleValue>`];
  const base = c.base ?? (c.type === "bounds" ? "xs:double" : "xs:string");
  const inner: string[] = [];
  if (c.type === "pattern") {
    inner.push(`<xs:pattern value="${esc(c.pattern)}"/>`);
  } else if (c.type === "enumeration") {
    for (const v of c.values) inner.push(`<xs:enumeration value="${esc(v)}"/>`);
  } else {
    const b = c as Extract<IDSConstraint, { type: "bounds" }>;
    const facet = (name: string, v: number | undefined) =>
      v != null ? inner.push(`<xs:${name} value="${esc(String(v))}"/>`) : 0;
    facet("minInclusive", b.minInclusive);
    facet("maxInclusive", b.maxInclusive);
    facet("minExclusive", b.minExclusive);
    facet("maxExclusive", b.maxExclusive);
    facet("length", b.length);
    facet("minLength", b.minLength);
    facet("maxLength", b.maxLength);
  }
  return [`<xs:restriction base="${esc(base)}">`, ...indent(inner, 1), `</xs:restriction>`];
}

/** Wrap a constraint in a named element, e.g. <name>…</name>. */
function valueEl(tag: string, c: IDSConstraint | undefined): string[] {
  if (!c) return [];
  const inner = constraintLines(c);
  if (inner.length === 1) return [`<${tag}>${inner[0]}</${tag}>`];
  return [`<${tag}>`, ...indent(inner, 1), `</${tag}>`];
}

/** The plain (simpleValue) string of a constraint, for attribute serialisation. */
function simpleString(c: IDSConstraint | undefined): string | null {
  return c && c.type === "simpleValue" ? c.value : null;
}

function entityChildren(f: IDSEntityFacet): string[] {
  return [...valueEl("name", f.name), ...valueEl("predefinedType", f.predefinedType)];
}

/** A facet element. `cardinality` (required/optional/prohibited) is emitted for
 *  requirement facets only — it's illegal on applicability facets. */
function facetLines(f: IDSFacet, cardinality?: RequirementOptionality, description?: string): string[] {
  const attrs: string[] = [];
  // property carries dataType as an attribute (plain string), not a child element.
  let dataType: string | null = null;
  if (f.type === "property") dataType = simpleString(f.dataType);
  if (dataType) attrs.push(`dataType="${esc(dataType)}"`);
  if (cardinality) attrs.push(`cardinality="${cardinality}"`);
  if (description) attrs.push(`instructions="${esc(description)}"`);
  const a = attrs.length ? " " + attrs.join(" ") : "";

  let tag: string;
  let children: string[];
  switch (f.type) {
    case "entity":
      tag = "entity";
      children = entityChildren(f);
      break;
    case "attribute":
      tag = "attribute";
      children = [...valueEl("name", f.name), ...valueEl("value", f.value)];
      break;
    case "property":
      tag = "property";
      children = [...valueEl("propertySet", f.propertySet), ...valueEl("baseName", f.baseName), ...valueEl("value", f.value)];
      break;
    case "classification":
      tag = "classification";
      children = [...valueEl("value", f.value), ...valueEl("system", f.system)];
      break;
    case "material":
      tag = "material";
      children = [...valueEl("value", f.value)];
      break;
    case "partOf": {
      tag = "partOf";
      const relAttr = ` relation="${esc(f.relation)}"`;
      const inner = f.entity ? [`<entity>`, ...indent(entityChildren(f.entity), 1), `</entity>`] : [];
      return inner.length
        ? [`<partOf${relAttr}${a}>`, ...indent(inner, 1), `</partOf>`]
        : [`<partOf${relAttr}${a}/>`];
    }
  }
  return children.length ? [`<${tag}${a}>`, ...indent(children, 1), `</${tag}>`] : [`<${tag}${a}/>`];
}

function specLines(spec: IDSSpecification): string[] {
  const attrs = [`name="${esc(spec.name)}"`];
  if (spec.ifcVersions?.length) {
    // @ifc-lite normalises IFC4X3* to "IFC4X3"; emit the IDS-standard token.
    const versions = spec.ifcVersions.map((v) => (v === "IFC4X3" ? "IFC4X3_ADD2" : v));
    attrs.push(`ifcVersion="${esc(versions.join(" "))}"`);
  }
  if (spec.identifier) attrs.push(`identifier="${esc(spec.identifier)}"`);
  if (spec.description) attrs.push(`description="${esc(spec.description)}"`);
  if (spec.instructions) attrs.push(`instructions="${esc(spec.instructions)}"`);

  // Spec cardinality (minOccurs/maxOccurs) lives on <applicability> in IDS 1.0.
  // Always emit both: some validators (IfcTester) crash deriving the cardinality
  // when they're absent. Default to "optional" applicability (0..unbounded).
  const minOcc = spec.minOccurs != null ? spec.minOccurs : 0;
  const maxOcc = spec.maxOccurs != null ? spec.maxOccurs : "unbounded";
  const appA = ` minOccurs="${esc(String(minOcc))}" maxOccurs="${esc(String(maxOcc))}"`;

  const appFacets = spec.applicability.facets.flatMap((f) => facetLines(f));
  const appBlock = appFacets.length
    ? [`<applicability${appA}>`, ...indent(appFacets, 1), `</applicability>`]
    : [`<applicability${appA}/>`];

  const reqFacets = spec.requirements.flatMap((r) => facetLines(r.facet, r.optionality, r.description));
  const reqBlock = reqFacets.length ? [`<requirements>`, ...indent(reqFacets, 1), `</requirements>`] : [];

  return [`<specification ${attrs.join(" ")}>`, ...indent([...appBlock, ...reqBlock], 1), `</specification>`];
}

// IDS 1.0 XSD constrains <author> to an email and <date> to xs:date; emitting a
// value that doesn't match makes strict validators (e.g. IfcTester) reject the
// whole file, so we omit these when they don't fit rather than write junk.
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
// Anchored shape check plus Date.parse (ISO parsing rejects out-of-range
// month/day, e.g. "2026-13-01" or "2026-02-30") so only a real xs:date passes.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isXsDate = (s: string): boolean => DATE_RE.test(s) && !isNaN(Date.parse(s));

function infoLines(doc: IDSDocument): string[] {
  const i = doc.info;
  // Order per the IDS 1.0 ids.xsd info sequence; only <title> is required.
  const out: string[] = [`<title>${esc(i.title || "Untitled")}</title>`];
  const opt = (tag: string, v?: string) => v && out.push(`<${tag}>${esc(v)}</${tag}>`);
  opt("copyright", i.copyright);
  opt("version", i.version);
  opt("description", i.description);
  if (i.author && EMAIL_RE.test(i.author)) out.push(`<author>${esc(i.author)}</author>`);
  if (i.date && isXsDate(i.date)) out.push(`<date>${esc(i.date)}</date>`);
  opt("purpose", i.purpose);
  opt("milestone", i.milestone);
  return [`<info>`, ...indent(out, 1), `</info>`];
}

/** Serialize an IDSDocument to buildingSMART IDS 1.0 XML text. */
export function serializeIds(doc: IDSDocument): string {
  const specs = doc.specifications.flatMap((s) => specLines(s));
  const body = [
    ...infoLines(doc),
    `<specifications>`,
    ...indent(specs, 1),
    `</specifications>`,
  ];
  const schemaLoc = doc.schemaLocation || SCHEMA_LOCATION;
  const head =
    `<ids xmlns="${NS}" xmlns:xs="${XS}" xmlns:xsi="${XSI}" xsi:schemaLocation="${esc(schemaLoc)}">`;
  return ['<?xml version="1.0" encoding="UTF-8"?>', head, ...indent(body, 1), `</ids>`, ""].join("\n");
}
