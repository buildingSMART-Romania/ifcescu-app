import { describe, it, expect } from "vitest";
import { parseStore } from "../src/ifc/store";
import {
  chartData, combineFilter, kpiValue, filteredModels, selectExcept,
  sortChartData, topNData, scatterData, slicerValues, cardCsv, parseDashboardState, alignColors,
  OTHERS, TILE_MIN_W, TILE_MIN_H,
  type ChartDatum, type ChartCard,
} from "../src/viewer/analytics";
import { NO_VALUE, type PivotModel } from "../src/viewer/pivot";

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

// --- richer fixture with quantities (NetVolume: wall#10=2, wall#11=4, slab none) ---
const IFC_QTY = `ISO-10303-21;
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
#30=IFCQUANTITYVOLUME('NetVolume',$,$,2.,$);
#31=IFCELEMENTQUANTITY('4qset0000000000000000A',$,'Qto_WallBaseQuantities',$,$,(#30));
#32=IFCRELDEFINESBYPROPERTIES('5rel00000000000000000A',$,$,$,(#10),#31);
#33=IFCQUANTITYVOLUME('NetVolume',$,$,4.,$);
#34=IFCELEMENTQUANTITY('4qset0000000000000000B',$,'Qto_WallBaseQuantities',$,$,(#33));
#35=IFCRELDEFINESBYPROPERTIES('5rel00000000000000000B',$,$,$,(#11),#34);
ENDSEC;
END-ISO-10303-21;
`;
const NETVOL = "qty:NetVolume";

async function qtyFixture(): Promise<PivotModel[]> {
  const store = await parseStore(new TextEncoder().encode(IFC_QTY));
  return [{ id: "m", fileName: "t.ifc", store, localIDs: [10, 11, 12], offset: 0 }];
}

describe("analytics full aggregation set", () => {
  it("chartData supports avg/min/max, not just count/sum", async () => {
    const models = await qtyFixture();
    const avg = chartData(models, { id: "c", type: "bar", dimKey: "class", measure: { agg: "avg", fieldKey: NETVOL } });
    const byLabel = Object.fromEntries(avg.map((d) => [d.label, d.value]));
    expect(byLabel["IfcWall"]).toBe(3); // (2+4)/2
    const max = chartData(models, { id: "c", type: "bar", dimKey: "class", measure: { agg: "max", fieldKey: NETVOL } });
    expect(Object.fromEntries(max.map((d) => [d.label, d.value]))["IfcWall"]).toBe(4);
  });

  it("kpiValue returns the aggregate, and null when no numeric values exist", async () => {
    const models = await qtyFixture();
    expect(kpiValue(models, { agg: "min", fieldKey: NETVOL })).toBe(2);
    expect(kpiValue(models, { agg: "avg", fieldKey: NETVOL })).toBe(3);
    // Slab only → no NetVolume anywhere → null, not 0.
    const slabOnly = [{ ...models[0], localIDs: [12] }];
    expect(kpiValue(slabOnly, { agg: "sum", fieldKey: NETVOL })).toBeNull();
    expect(kpiValue(slabOnly, { agg: "count" })).toBe(1);
  });
});

describe("analytics.sortChartData", () => {
  const data: ChartDatum[] = [
    { label: "B", value: 5, ids: [1], color: [1, 0, 0, 1] },
    { label: NO_VALUE, value: 9, ids: [2], color: [0, 1, 0, 1] },
    { label: "A", value: 5, ids: [3], color: [0, 0, 1, 1] },
    { label: "C", value: 1, ids: [4], color: [1, 1, 0, 1] },
  ];

  it("keeps the input order when sort is undefined", () => {
    expect(sortChartData(data)).toBe(data);
  });

  it("valueDesc / valueAsc order by value; equal values keep input order (stable)", () => {
    expect(sortChartData(data, "valueDesc").map((d) => d.label)).toEqual([NO_VALUE, "B", "A", "C"]);
    expect(sortChartData(data, "valueAsc").map((d) => d.label)).toEqual(["C", "B", "A", NO_VALUE]);
  });

  it("labelAsc sorts alphabetically with the no-value bucket last, colors preserved", () => {
    const out = sortChartData(data, "labelAsc");
    expect(out.map((d) => d.label)).toEqual(["A", "B", "C", NO_VALUE]);
    expect(out.find((d) => d.label === "A")!.color).toEqual([0, 0, 1, 1]);
  });
});

describe("analytics.topNData", () => {
  const data: ChartDatum[] = [
    { label: "A", value: 10, ids: [1, 2], color: [1, 0, 0, 1] },
    { label: "B", value: 5, ids: [3], color: [0, 1, 0, 1] },
    { label: "C", value: 2, ids: [4], color: [0, 0, 1, 1] },
    { label: "D", value: 1, ids: [5], color: [1, 1, 0, 1] },
  ];

  it("folds the tail into an Others bucket with the union of ids and the folded labels", () => {
    const out = topNData(data, 2);
    expect(out).toHaveLength(3);
    const others = out[2];
    expect(others.label).toBe(OTHERS);
    expect(others.value).toBe(3);
    expect(others.ids.sort()).toEqual([4, 5]);
    expect(others.othersLabels).toEqual(["C", "D"]);
    // Invariant the multi-label toggle relies on: every folded label exists in the input data.
    for (const l of others.othersLabels!) expect(data.some((d) => d.label === l)).toBe(true);
  });

  it("uses a caller-provided (translated) Others label", () => {
    expect(topNData(data, 2, "Altele")[2].label).toBe("Altele");
  });

  it("returns the input unchanged when n covers everything or is unset", () => {
    expect(topNData(data, 4)).toBe(data);
    expect(topNData(data, undefined)).toBe(data);
  });
});

describe("analytics.scatterData", () => {
  it("one aggregated point per category with x/y/size measures and ids", async () => {
    const models = await qtyFixture();
    const card: ChartCard = {
      id: "s", type: "scatter", dimKey: "class",
      measure: { agg: "count" },
      measureY: { agg: "sum", fieldKey: NETVOL },
      sizeMeasure: { agg: "max", fieldKey: NETVOL },
    };
    const pts = scatterData(models, card);
    // Slab has no NetVolume → y is null → dropped. Only the wall point remains.
    expect(pts).toHaveLength(1);
    expect(pts[0].label).toBe("IfcWall");
    expect(pts[0].x).toBe(2); // count
    expect(pts[0].y).toBe(6); // sum
    expect(pts[0].size).toBe(4); // max
    expect(pts[0].ids.sort()).toEqual([10, 11]);
  });

  it("is empty until a Y measure is configured", async () => {
    const models = await qtyFixture();
    expect(scatterData(models, { id: "s", type: "scatter", dimKey: "class", measure: { agg: "count" } })).toEqual([]);
  });
});

describe("analytics.slicerValues", () => {
  const data: ChartDatum[] = ["Alpha", "Beta", "Gamma", "alphabet"].map((label, i) => ({
    label, value: i, ids: [i], color: [0, 0, 0, 1],
  }));

  it("filters case-insensitively and reports the overflow beyond the cap", () => {
    const r = slicerValues(data, "alpha");
    expect(r.items.map((d) => d.label)).toEqual(["Alpha", "alphabet"]);
    expect(r.more).toBe(0);
    const capped = slicerValues(data, "", 2);
    expect(capped.items).toHaveLength(2);
    expect(capped.more).toBe(2);
  });
});

describe("analytics.cardCsv", () => {
  const fieldLabel = (k: string) => (k === "class" ? "Clasă" : k);

  it("list: header + label,value rows with RFC-4180 escaping", () => {
    const card: ChartCard = { id: "c", type: "bar", dimKey: "class", measure: { agg: "count" } };
    const lines = cardCsv(card, {
      kind: "list",
      data: [{ label: 'Beton, "C25"', value: 2.5, ids: [], color: [0, 0, 0, 1] }],
    }, fieldLabel);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"Beton, ""C25""",2.5');
  });

  it("stacked: one column per series", () => {
    const card: ChartCard = { id: "c", type: "stacked", dimKey: "class", stackKey: "material", measure: { agg: "count" } };
    const lines = cardCsv(card, {
      kind: "stacked",
      stacked: { rows: [{ label: "IfcWall", Beton: 2, Oțel: 1 }], series: [{ key: "Beton", color: [0, 0, 0, 1] }, { key: "Oțel", color: [0, 0, 0, 1] }] },
    }, fieldLabel);
    expect(lines[0].split(",")).toHaveLength(3);
    expect(lines[1]).toBe("IfcWall,2,1");
  });

  it("kpi: single header + single value row", () => {
    const card: ChartCard = { id: "c", type: "kpi", dimKey: "", measure: { agg: "count" } };
    const lines = cardCsv(card, { kind: "kpi", value: 42 }, fieldLabel);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("42");
  });
});

describe("analytics.parseDashboardState", () => {
  const goodCard: ChartCard = { id: "a1", type: "bar", dimKey: "class", measure: { agg: "count" } };

  it("round-trips a valid v1 blob", () => {
    const state = { v: 1, cards: [goodCard], geo: { a1: { x: 8, y: 8, w: 380, h: 280 } } };
    const parsed = parseDashboardState(JSON.parse(JSON.stringify(state)));
    expect(parsed).not.toBeNull();
    expect(parsed!.cards).toHaveLength(1);
    expect(parsed!.cards[0]).toMatchObject({ id: "a1", type: "bar", dimKey: "class" });
    expect(parsed!.geo.a1).toEqual({ x: 8, y: 8, w: 380, h: 280 });
  });

  it("rejects wrong versions and garbage", () => {
    expect(parseDashboardState({ v: 2, cards: [goodCard] })).toBeNull();
    expect(parseDashboardState("nope")).toBeNull();
    expect(parseDashboardState(null)).toBeNull();
    expect(parseDashboardState({ v: 1, cards: [] })).toBeNull();
  });

  it("drops unknown card types and invalid measures, clamps geo to tile minimums", () => {
    const state = {
      v: 1,
      cards: [goodCard, { id: "x", type: "hologram", dimKey: "class", measure: { agg: "count" } }, { id: "a2", type: "kpi", dimKey: "", measure: { agg: "teleport" } }],
      geo: { a1: { x: -50, y: 10, w: 10, h: 10 }, a2: { x: 1, y: 1, w: "wide", h: 2 } },
    };
    const parsed = parseDashboardState(state)!;
    expect(parsed.cards.map((c) => c.id)).toEqual(["a1", "a2"]); // hologram dropped
    expect(parsed.cards[1].measure).toEqual({ agg: "count" }); // invalid agg → count fallback
    expect(parsed.geo.a1).toEqual({ x: 0, y: 10, w: TILE_MIN_W, h: TILE_MIN_H }); // clamped
    expect(parsed.geo.a2).toBeUndefined(); // non-numeric geo dropped
  });
});

describe("analytics.alignColors", () => {
  it("recolors shared labels from the reference, leaves Others and unknowns alone", () => {
    const ref: ChartDatum[] = [
      { label: "A", value: 1, ids: [], color: [1, 0, 0, 1] },
      { label: "B", value: 2, ids: [], color: [0, 1, 0, 1] },
    ];
    const data: ChartDatum[] = [
      { label: "B", value: 2, ids: [], color: [0, 0, 1, 1] },
      { label: OTHERS, value: 9, ids: [], color: [0.5, 0.5, 0.5, 1], othersLabels: ["A"] },
    ];
    const out = alignColors(ref, data);
    expect(out[0].color).toEqual([0, 1, 0, 1]); // B took the reference color
    expect(out[1].color).toEqual([0.5, 0.5, 0.5, 1]); // Others keeps its neutral gray
  });
});
