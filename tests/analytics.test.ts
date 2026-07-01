import { describe, it, expect } from "vitest";
import { parseStore } from "../src/ifc/store";
import { chartData, combineFilter, kpiValue, filteredModels, selectExcept, type ChartDatum } from "../src/viewer/analytics";
import type { PivotModel } from "../src/viewer/pivot";

// Inline IFC4 with two walls and a slab (no geometry needed — pivot groups by the
// entity type of the ids we pass as the model's element set).
const IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('t.ifc','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'P',$,$,$,$,$,$);
#10=IFCWALL('1wall0000000000000000A',$,'W1',$,$,$,$,$,$);
#11=IFCWALL('1wall0000000000000000B',$,'W2',$,$,$,$,$,$);
#12=IFCSLAB('1slab0000000000000000A',$,'S1',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
`;

describe("analytics.chartData", () => {
  it("aggregates element count per class with the category's global ids", async () => {
    const store = await parseStore(new TextEncoder().encode(IFC));
    const models: PivotModel[] = [{ id: "m", fileName: "t.ifc", store, localIDs: [10, 11, 12], offset: 0 }];
    const data = chartData(models, { id: "c", type: "bar", dimKey: "class", measure: { agg: "count" } });
    const byLabel = Object.fromEntries(data.map((d) => [d.label, d]));
    expect(byLabel["IfcWall"].value).toBe(2);
    expect(byLabel["IfcWall"].ids.sort()).toEqual([10, 11]);
    expect(byLabel["IfcSlab"].value).toBe(1);
    expect(byLabel["IfcSlab"].ids).toEqual([12]);
  });

  it("kpiValue counts all elements", async () => {
    const store = await parseStore(new TextEncoder().encode(IFC));
    const models: PivotModel[] = [{ id: "m", fileName: "t.ifc", store, localIDs: [10, 11, 12], offset: 0 }];
    expect(kpiValue(models, { agg: "count" })).toBe(3);
  });

  it("filteredModels restricts the element set to the given global ids (cross-filter)", async () => {
    const store = await parseStore(new TextEncoder().encode(IFC));
    const models: PivotModel[] = [{ id: "m", fileName: "t.ifc", store, localIDs: [10, 11, 12], offset: 0 }];
    const sub = filteredModels(models, new Set([10, 11])); // only the two walls
    expect(sub[0].localIDs).toEqual([10, 11]);
    const data = chartData(sub, { id: "c", type: "bar", dimKey: "class", measure: { agg: "count" } });
    expect(data.map((d) => d.label)).toEqual(["IfcWall"]);
    expect(data[0].value).toBe(2);
    // null ids → unchanged
    expect(filteredModels(models, null)[0].localIDs).toEqual([10, 11, 12]);
  });
});

describe("analytics.selectExcept", () => {
  it("drops the given dimension keys", () => {
    expect(selectExcept({ class: ["A"], material: ["B"] }, ["class"])).toEqual({ material: ["B"] });
  });
});

describe("analytics.combineFilter", () => {
  const classData: ChartDatum[] = [
    { label: "IfcWall", value: 2, ids: [1, 2], color: [1, 0, 0, 1] },
    { label: "IfcSlab", value: 1, ids: [3], color: [0, 1, 0, 1] },
  ];
  const matData: ChartDatum[] = [
    { label: "Concrete", value: 2, ids: [2, 3], color: [0, 0, 1, 1] },
    { label: "Steel", value: 1, ids: [1], color: [1, 1, 0, 1] },
  ];
  const dataByDim = { class: classData, material: matData };

  it("returns null when nothing is selected", () => {
    expect(combineFilter({}, dataByDim, null)).toBeNull();
  });

  it("ORs categories within one dimension", () => {
    const r = combineFilter({ class: ["IfcWall", "IfcSlab"] }, dataByDim, "class");
    expect(r!.ids.sort()).toEqual([1, 2, 3]);
    // colored by the class dimension
    expect(r!.colors.get(1)).toEqual([1, 0, 0, 1]);
    expect(r!.colors.get(3)).toEqual([0, 1, 0, 1]);
  });

  it("ANDs across dimensions (intersection)", () => {
    // IfcWall = {1,2}; Concrete = {2,3}  → intersection {2}
    const r = combineFilter({ class: ["IfcWall"], material: ["Concrete"] }, dataByDim, "material");
    expect(r!.ids).toEqual([2]);
    // colored by material dimension (Concrete)
    expect(r!.colors.get(2)).toEqual([0, 0, 1, 1]);
  });
});
