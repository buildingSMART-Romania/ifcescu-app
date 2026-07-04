import { describe, it, expect } from "vitest";
import { emptyIdsDoc, emptySpec, emptyRequirement, defaultFacet, hasIdsContent } from "../src/ifc/ids";

// hasIdsContent decides whether an in-session IDS doc counts as an authored
// "active document" (button reads "Edit IDS", confirm before New/Load discards it).
describe("hasIdsContent", () => {
  it("is false for a pristine emptyIdsDoc", () => {
    expect(hasIdsContent(emptyIdsDoc())).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(hasIdsContent(null)).toBe(false);
    expect(hasIdsContent(undefined)).toBe(false);
  });

  it("is true once a title is set", () => {
    const d = emptyIdsDoc();
    d.info.title = "Spec";
    expect(hasIdsContent(d)).toBe(true);
  });

  it("is true once an optional info field is set", () => {
    const d = emptyIdsDoc();
    d.info.purpose = "Handover";
    expect(hasIdsContent(d)).toBe(true);
  });

  it("is true once a spec has an applicability facet", () => {
    const d = emptyIdsDoc();
    d.specifications[0].applicability.facets.push(defaultFacet("entity"));
    expect(hasIdsContent(d)).toBe(true);
  });

  it("is true once a spec has a requirement", () => {
    const d = emptyIdsDoc();
    d.specifications[0].requirements.push(emptyRequirement(defaultFacet("property")));
    expect(hasIdsContent(d)).toBe(true);
  });

  it("is true with more than one specification", () => {
    const d = emptyIdsDoc();
    d.specifications.push(emptySpec());
    expect(hasIdsContent(d)).toBe(true);
  });

  it("stays false when a single spec is merely renamed", () => {
    const d = emptyIdsDoc();
    d.specifications[0].name = "Renamed";
    expect(hasIdsContent(d)).toBe(false);
  });
});
