import { describe, it, expect, vi, afterEach } from "vitest";
import { parseStore } from "../src/ifc/store";
import {
  buildPivot,
  discoverFields,
  getFieldValue,
  distinctFieldValues,
  exportPivotCsv,
  fieldByKey,
  NO_VALUE,
  type PivotModel,
  type PivotConfig,
} from "../src/viewer/pivot";

// Inline IFC4 fixture (same pattern as analytics.test.ts): two walls and a slab.
// - NetVolume quantity: wall #10 = 2, wall #11 = 4, slab #12 has NONE
//   (exercises missing-value handling in sum/avg/min/max).
// - Pset_Test.FireRating: F30 on #10, F60 on #11, slab has none (NO_VALUE bucket).
// - Pset_Test.Note on #10 only, with a comma + quotes (exercises CSV escaping).
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
#20=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('F30'),$);
#21=IFCPROPERTYSINGLEVALUE('Note',$,IFCTEXT('Beton, "C25"'),$);
#22=IFCPROPERTYSET('2pset0000000000000000A',$,'Pset_Test',$,(#20,#21));
#23=IFCRELDEFINESBYPROPERTIES('3rel00000000000000000A',$,$,$,(#10),#22);
#24=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('F60'),$);
#25=IFCPROPERTYSET('2pset0000000000000000B',$,'Pset_Test',$,(#24));
#26=IFCRELDEFINESBYPROPERTIES('3rel00000000000000000B',$,$,$,(#11),#25);
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
const FIRERATING = "prop:Pset_Test::FireRating";
const NOTE = "prop:Pset_Test::Note";

async function fixture(offset = 0): Promise<PivotModel[]> {
  const store = await parseStore(new TextEncoder().encode(IFC));
  return [{ id: "m", fileName: "t.ifc", store, localIDs: [10, 11, 12], offset }];
}

afterEach(() => vi.unstubAllGlobals());

describe("pivot.discoverFields", () => {
  it("finds class/material pseudo-fields plus discovered props and quantities", async () => {
    const models = await fixture();
    const fields = discoverFields(models);
    const keys = fields.map((f) => f.key);
    // Single model → no "model" pseudo-field; class/material sort first.
    expect(keys).not.toContain("model");
    expect(keys.slice(0, 2)).toEqual(["class", "material"]);
    expect(fieldByKey(fields, NETVOL)?.kind).toBe("numeric");
    expect(fieldByKey(fields, FIRERATING)?.kind).toBe("categorical");
    expect(keys).toContain(NOTE);
  });
});

describe("pivot.getFieldValue", () => {
  it("resolves class, quantity and missing values per element", async () => {
    const [m] = await fixture();
    const fields = discoverFields([m]);
    expect(getFieldValue(m.store, 10, fieldByKey(fields, "class")!)).toBe("IfcWall");
    expect(getFieldValue(m.store, 11, fieldByKey(fields, NETVOL)!)).toBe(4);
    // Slab has no NetVolume and no FireRating → null, not 0 / "".
    expect(getFieldValue(m.store, 12, fieldByKey(fields, NETVOL)!)).toBeNull();
    expect(getFieldValue(m.store, 12, fieldByKey(fields, FIRERATING)!)).toBeNull();
  });
});

describe("pivot.buildPivot aggregators", () => {
  const config: PivotConfig = {
    groupBy: ["class"],
    values: [
      { fieldKey: NETVOL, agg: "sum" },
      { fieldKey: NETVOL, agg: "avg" },
      { fieldKey: NETVOL, agg: "min" },
      { fieldKey: NETVOL, agg: "max" },
      { fieldKey: NETVOL, agg: "count" },
    ],
    showTotals: true,
  };

  it("computes sum/avg/min/max/count per group with global ids", async () => {
    const models = await fixture(100);
    const result = buildPivot(models, config);
    const byLabel = Object.fromEntries(result.rows.map((r) => [r.label, r]));
    const wall = byLabel["IfcWall"];
    expect(wall.count).toBe(2);
    expect(wall.ids.sort()).toEqual([110, 111]); // local id + offset
    expect(wall.values).toEqual([6, 3, 2, 4, 2]); // sum, avg, min, max, count
  });

  it("missing values don't corrupt aggregates: slab row is null, totals avg divides by n with values", async () => {
    const models = await fixture();
    const result = buildPivot(models, config);
    const slab = result.rows.find((r) => r.label === "IfcSlab")!;
    // No NetVolume on the slab → sum/avg/min/max are null (not 0/Infinity); count still counts the element.
    expect(slab.values).toEqual([null, null, null, null, 1]);
    // Totals: 3 elements but only 2 carry NetVolume → avg = 6/2 = 3, not 6/3.
    expect(result.totals.count).toBe(3);
    expect(result.totals.values).toEqual([6, 3, 2, 4, 3]);
  });

  it("buckets elements without a group value under NO_VALUE, sorted last", async () => {
    const models = await fixture();
    const result = buildPivot(models, { groupBy: [FIRERATING], values: [], showTotals: true });
    expect(result.rows.map((r) => r.label)).toEqual(["F30", "F60", NO_VALUE]);
    expect(result.rows[2].ids).toEqual([12]); // the slab
  });
});

describe("pivot.distinctFieldValues", () => {
  it("lists distinct values, respects the cap, and matches any pset when pset is blank", async () => {
    const models = await fixture();
    expect(distinctFieldValues(models, "Pset_Test", "FireRating")).toEqual(["F30", "F60"]);
    expect(distinctFieldValues(models, "Pset_Test", "FireRating", 1)).toHaveLength(1);
    expect(distinctFieldValues(models, "", "FireRating")).toEqual(["F30", "F60"]);
    expect(distinctFieldValues(models, "Pset_Test", "")).toEqual([]);
  });
});

describe("pivot.exportPivotCsv", () => {
  it("emits BOM + CRLF CSV with leaf rows and RFC-4180 escaping of commas/quotes", async () => {
    const models = await fixture();
    const fields = discoverFields(models);
    const config: PivotConfig = { groupBy: [NOTE], values: [{ fieldKey: NETVOL, agg: "sum" }], showTotals: true };
    const result = buildPivot(models, config);

    let captured: Blob | null = null;
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("URL", {
      createObjectURL: (b: Blob) => ((captured = b), "blob:test"),
      revokeObjectURL: () => {},
    });
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });

    exportPivotCsv(result, config, fields, "t.ifc");

    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toMatch(/^t-.+\.csv$/);
    // Check the BOM on the raw bytes: Blob.text() decodes as UTF-8 and STRIPS a
    // leading BOM, so it must be asserted at the byte level (EF BB BF).
    const bytes = new Uint8Array(await captured!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const text = await captured!.text();
    const lines = text.split("\r\n");
    // header + one row per Note bucket ('Beton, "C25"' and the no-value bucket)
    expect(lines).toHaveLength(3);
    expect(lines[0].split(",").length).toBeGreaterThanOrEqual(3); // group col + count + 1 value col
    // Value with comma + quotes is quoted and inner quotes doubled; sum of #10's NetVolume = 2.
    expect(lines[1]).toBe('"Beton, ""C25""",1,2');
    // The no-value bucket aggregates the remaining elements (#11 with NetVolume 4, slab with none).
    expect(lines[2].endsWith(",2,4")).toBe(true);
  });
});
