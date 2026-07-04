import { describe, it, expect } from "vitest";
import { idsReportCsv, idsReportHtml } from "../src/ifc/idsReport";
import { emptySpec, emptyRequirement, defaultFacet } from "../src/ifc/ids";
import type { IDSValidationReport, IDSSpecificationResult } from "../src/ifc/ids";

// Hand-built report fixture (no parser needed): one failing spec with a comma/
// quote/angle-bracket-laden entity (exercises CSV + HTML escaping) and one
// passing spec (collapses to a single CSV summary row).
function fixture(): IDSValidationReport {
  const req = emptyRequirement(defaultFacet("property"));
  const failSpec: IDSSpecificationResult = {
    specification: { ...emptySpec(), name: "Walls, \"fire\" rated" },
    status: "fail",
    applicableCount: 2,
    passedCount: 1,
    failedCount: 1,
    passRate: 50,
    entityResults: [
      {
        expressId: 10,
        modelId: "model",
        entityType: "IfcWall",
        entityName: "Wall <A> & Co",
        globalId: "1wall0000000000000000A",
        passed: false,
        requirementResults: [
          {
            requirement: req,
            status: "fail",
            facetType: "property",
            checkedDescription: "Property Pset_Test.FireRating must be F60",
            failureReason: "Value is F30, expected F60",
            expectedValue: "F60",
            actualValue: "F30",
          },
          {
            requirement: req,
            status: "pass",
            facetType: "property",
            checkedDescription: "This one passed and must NOT appear in the CSV",
          },
        ],
      },
    ],
  };
  const passSpec: IDSSpecificationResult = {
    specification: { ...emptySpec(), name: "Slabs exist" },
    status: "pass",
    applicableCount: 3,
    passedCount: 3,
    failedCount: 0,
    passRate: 100,
    entityResults: [],
  };
  return {
    document: { info: { title: "Exam spec" }, specifications: [] },
    modelInfo: { modelId: "t.ifc", schemaVersion: "IFC4", entityCount: 5 },
    timestamp: new Date("2026-07-04T10:00:00Z"),
    summary: {
      totalSpecifications: 2,
      passedSpecifications: 1,
      failedSpecifications: 1,
      totalEntitiesChecked: 5,
      totalEntitiesPassed: 4,
      totalEntitiesFailed: 1,
      overallPassRate: 80,
    },
    specificationResults: [failSpec, passSpec],
  };
}

describe("idsReportCsv", () => {
  it("emits a header + one row per failed requirement + a summary row per passing spec", () => {
    const lines = idsReportCsv(fixture());
    // header + 1 failed requirement row + 1 passing-spec summary row
    expect(lines).toHaveLength(3);
    expect(lines[0].split(",")).toHaveLength(10);
    // The passing requirement of the failing entity must not produce a row.
    expect(lines.join("\n")).not.toContain("must NOT appear");
  });

  it("escapes commas and quotes RFC-4180 style and carries the failure details", () => {
    const lines = idsReportCsv(fixture());
    const failRow = lines[1];
    expect(failRow).toContain('"Walls, ""fire"" rated"');
    expect(failRow).toContain("IfcWall");
    expect(failRow).toContain("1wall0000000000000000A");
    expect(failRow).toContain("Value is F30");
    expect(failRow).toContain("F60");
  });

  it("collapses a spec without failures to one row with empty entity columns", () => {
    const lines = idsReportCsv(fixture());
    const passRow = lines[2];
    expect(passRow.startsWith("Slabs exist,")).toBe(true);
    expect(passRow).toContain("100%");
    expect(passRow.endsWith(",,,,,,,")).toBe(true); // 7 empty trailing columns
  });
});

describe("idsReportHtml", () => {
  it("contains the heading, summary stats, and the failure details", () => {
    const html = idsReportHtml(fixture());
    expect(html).toContain("Exam spec");
    expect(html).toContain("t.ifc");
    expect(html).toContain("IFC4");
    expect(html).toContain("1/2"); // passed/total specifications
    expect(html).toContain("Value is F30, expected F60");
    expect(html).toContain("F60");
  });

  it("escapes HTML in entity names and spec titles", () => {
    const html = idsReportHtml(fixture());
    expect(html).toContain("Wall &lt;A&gt; &amp; Co");
    expect(html).not.toContain("Wall <A>");
  });

  it("renders a self-contained printable document", () => {
    const html = idsReportHtml(fixture());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("@media print");
    expect(html).not.toContain("var(--"); // no app CSS vars — standalone document
  });
});
