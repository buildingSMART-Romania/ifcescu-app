import { describe, it, expect } from "vitest";
import { convertFacet, defaultFacet, type IDSFacet } from "../src/ifc/ids";

const sv = (value: string) => ({ type: "simpleValue" as const, value });

describe("convertFacet (switch a facet's type in the IDS creator)", () => {
  it("is a no-op for the same type", () => {
    const f: IDSFacet = { type: "property", propertySet: sv("Pset_WallCommon"), baseName: sv("IsExternal") };
    expect(convertFacet(f, "property")).toBe(f);
  });

  it("starts from the new type's defaults", () => {
    for (const tp of ["entity", "attribute", "property", "classification", "material", "partOf"] as const) {
      expect(convertFacet({ type: "material" }, tp)).toEqual(tp === "material" ? { type: "material" } : defaultFacet(tp));
    }
  });

  it("keeps the value across attribute / property / classification / material", () => {
    const value = { type: "enumeration" as const, values: ["A", "B"] };
    const prop: IDSFacet = { type: "property", propertySet: sv("Pset_X"), baseName: sv("Y"), dataType: sv("IFCLABEL"), value };
    // Pset/property name and data type have no counterpart and are dropped.
    expect(convertFacet(prop, "attribute")).toEqual({ type: "attribute", name: sv("Name"), value });
    expect(convertFacet(prop, "classification")).toEqual({ type: "classification", value });
    expect(convertFacet(prop, "material")).toEqual({ type: "material", value });
    expect(convertFacet({ type: "material", value: sv("Concrete") }, "property")).toEqual({
      type: "property", propertySet: sv(""), baseName: sv(""), value: sv("Concrete"),
    });
  });

  it("drops the value where the new type has none", () => {
    expect(convertFacet({ type: "attribute", name: sv("Name"), value: sv("x") }, "entity")).toEqual(defaultFacet("entity"));
  });

  it("maps an Entity class to Part of's parent entity and back", () => {
    const ent: IDSFacet = { type: "entity", name: sv("IFCBUILDINGSTOREY"), predefinedType: sv("BASEMENT") };
    const part = convertFacet(ent, "partOf");
    expect(part).toEqual({
      type: "partOf",
      relation: "IfcRelContainedInSpatialStructure",
      entity: { type: "entity", name: sv("IFCBUILDINGSTOREY"), predefinedType: sv("BASEMENT") },
    });
    expect(convertFacet(part, "entity")).toEqual(ent);
    expect(convertFacet({ type: "entity", name: sv("IFCWALL") }, "partOf")).toEqual({
      type: "partOf", relation: "IfcRelContainedInSpatialStructure", entity: { type: "entity", name: sv("IFCWALL") },
    });
  });

  it("returns a copy, not shared constraint objects", () => {
    const value = sv("Concrete");
    const out = convertFacet({ type: "material", value }, "classification");
    expect(out.type === "classification" && out.value).not.toBe(value);
  });
});
