import { describe, it, expect } from "vitest";
import { boqPresetConfig } from "../src/viewer/boqReport";
import type { FieldDef } from "../src/viewer/pivot";

// boqPresetConfig is pure: it picks the base quantities present (in report order)
// and groups by class → material. (The HTML report itself needs a DOM and is
// verified manually.)
const fields: FieldDef[] = [
  { key: "class", label: "Class", source: "class", kind: "categorical" },
  { key: "material", label: "Material", source: "material", kind: "categorical" },
  { key: "qty:Length", label: "Length", source: "quantity", name: "Length", kind: "numeric" },
  { key: "qty:NetVolume", label: "NetVolume", source: "quantity", name: "NetVolume", kind: "numeric" },
  { key: "prop:Pset_X::Foo", label: "Foo", source: "property", pset: "Pset_X", name: "Foo", kind: "categorical" },
];

describe("boqPresetConfig", () => {
  it("groups by class → material and sums the present base quantities in order", () => {
    const cfg = boqPresetConfig(fields);
    expect(cfg.groupBy).toEqual(["class", "material"]);
    expect(cfg.showTotals).toBe(true);
    // NetVolume is listed before Length in BOQ_QUANTITIES, so order is normalized.
    expect(cfg.values.map((v) => v.fieldKey)).toEqual(["qty:NetVolume", "qty:Length"]);
    expect(cfg.values.every((v) => v.agg === "sum")).toBe(true);
  });

  it("yields no value columns when the model has no base quantities", () => {
    const noQty = fields.filter((f) => f.source !== "quantity");
    const cfg = boqPresetConfig(noQty);
    expect(cfg.values).toEqual([]);
    expect(cfg.groupBy).toEqual(["class", "material"]);
  });
});
