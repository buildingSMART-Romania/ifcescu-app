import { describe, it, expect } from "vitest";
import { serializeIds, parseIdsXml } from "../src/ifc/ids";
import { auditIDSDocument } from "@ifc-lite/ids";
import type { IDSDocument } from "../src/ifc/ids";

// A document exercising every facet type and every constraint type, in both
// applicability and requirements, with each optionality. The serializer is
// checked against the package's own parser + auditor (the oracle).
const DOC: IDSDocument = {
  info: {
    title: "Test IDS",
    author: "test@example.com",
    version: "1.0",
    date: "2024-01-01",
    description: "round-trip fixture",
  },
  specifications: [
    {
      id: "spec-1",
      name: "Walls have fire rating",
      ifcVersions: ["IFC4"],
      minOccurs: 0,
      maxOccurs: "unbounded",
      applicability: {
        facets: [
          { type: "entity", name: { type: "simpleValue", value: "IFCWALL" }, predefinedType: { type: "simpleValue", value: "SOLIDWALL" } },
        ],
      },
      requirements: [
        { id: "r1", optionality: "required", facet: { type: "property", propertySet: { type: "simpleValue", value: "Pset_WallCommon" }, baseName: { type: "simpleValue", value: "FireRating" }, dataType: { type: "simpleValue", value: "IFCLABEL" } } },
        { id: "r2", optionality: "required", facet: { type: "attribute", name: { type: "simpleValue", value: "Name" } } },
        { id: "r3", optionality: "optional", facet: { type: "classification", system: { type: "simpleValue", value: "Uniclass" }, value: { type: "pattern", pattern: "EF_.*" } } },
        { id: "r4", optionality: "prohibited", facet: { type: "material", value: { type: "enumeration", values: ["Wood", "Timber"] } } },
        { id: "r5", optionality: "required", facet: { type: "partOf", relation: "IfcRelAggregates", entity: { type: "entity", name: { type: "simpleValue", value: "IFCBUILDING" } } } },
      ],
    },
    {
      id: "spec-2",
      name: "Doors width bounds",
      ifcVersions: ["IFC4", "IFC2X3"],
      applicability: { facets: [{ type: "entity", name: { type: "simpleValue", value: "IFCDOOR" } }] },
      requirements: [
        { id: "r6", optionality: "required", facet: { type: "property", propertySet: { type: "simpleValue", value: "Pset_DoorCommon" }, baseName: { type: "simpleValue", value: "OverallWidth" }, dataType: { type: "simpleValue", value: "IFCLENGTHMEASURE" }, value: { type: "bounds", minInclusive: 0.8, maxInclusive: 2.0, base: "xs:double" } } },
      ],
    },
  ],
};

describe("serializeIds", () => {
  it("produces structurally valid IDS XML (XSD + coherence, no errors)", async () => {
    const xml = serializeIds(DOC);
    expect(xml).toContain("http://standards.buildingsmart.org/IDS");
    // Skip IFC-schema content cross-checks (the fixture uses synthetic content);
    // we're verifying the serializer's XML/XSD structure + restriction coherence.
    const audit = await auditIDSDocument(xml, { ifcSchemaChecks: false });
    const errors = audit.issues.filter((i) => i.severity === "error");
    if (errors.length) console.error("audit errors:", errors);
    expect(errors).toHaveLength(0);
  });

  it("emits IFC4X3 as the standard IFC4X3_ADD2 token, and parses it back to IFC4X3", () => {
    const doc: IDSDocument = {
      info: { title: "v" },
      specifications: [{
        id: "s", name: "s", ifcVersions: ["IFC4X3"],
        applicability: { facets: [{ type: "entity", name: { type: "simpleValue", value: "IFCWALL" } }] },
        requirements: [],
      }],
    };
    const xml = serializeIds(doc);
    expect(xml).toContain('ifcVersion="IFC4X3_ADD2"');
    expect(parseIdsXml(xml).specifications[0].ifcVersions).toContain("IFC4X3");
  });

  it("omits a non-email author (IDS XSD requires an email)", () => {
    const bad: IDSDocument = { info: { title: "t", author: "12" }, specifications: [{ id: "s", name: "s", ifcVersions: ["IFC4"], applicability: { facets: [{ type: "entity", name: { type: "simpleValue", value: "IFCWALL" } }] }, requirements: [] }] };
    expect(serializeIds(bad)).not.toContain("<author>");
    const ok: IDSDocument = { ...bad, info: { title: "t", author: "a@b.com" } };
    expect(serializeIds(ok)).toContain("<author>a@b.com</author>");
  });

  it("round-trips: parse(serialize(doc)) preserves the structure", () => {
    const back = parseIdsXml(serializeIds(DOC));
    expect(back.specifications).toHaveLength(2);

    const s1 = back.specifications[0];
    expect(s1.name).toBe("Walls have fire rating");
    expect(s1.ifcVersions).toContain("IFC4");
    // applicability entity + predefined type
    const app = s1.applicability.facets[0];
    expect(app.type).toBe("entity");
    expect(app.type === "entity" && app.name).toEqual({ type: "simpleValue", value: "IFCWALL" });

    // requirements: facet types + optionality preserved
    expect(s1.requirements.map((r) => r.facet.type)).toEqual(["property", "attribute", "classification", "material", "partOf"]);
    expect(s1.requirements.map((r) => r.optionality)).toEqual(["required", "required", "optional", "prohibited", "required"]);

    const prop = s1.requirements[0].facet;
    expect(prop.type === "property" && prop.dataType).toEqual({ type: "simpleValue", value: "IFCLABEL" });

    const cls = s1.requirements[2].facet;
    expect(cls.type === "classification" && cls.value?.type).toBe("pattern");

    const mat = s1.requirements[3].facet;
    expect(mat.type === "material" && mat.value?.type).toBe("enumeration");
    expect(mat.type === "material" && mat.value?.type === "enumeration" && mat.value.values).toEqual(["Wood", "Timber"]);

    const partOf = s1.requirements[4].facet;
    expect(partOf.type === "partOf" && partOf.relation).toBe("IfcRelAggregates");

    // spec 2 bounds
    const w = back.specifications[1].requirements[0].facet;
    expect(w.type === "property" && w.value?.type).toBe("bounds");
    expect(w.type === "property" && w.value?.type === "bounds" && w.value.minInclusive).toBe(0.8);
  });
});
