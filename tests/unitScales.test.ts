import { describe, it, expect } from "vitest";
import { QuantityType } from "@ifc-lite/data";
import { IfcEditor } from "../src/ifc/editor";
import { fromSI, siSymbol, toSI, type UnitScales } from "../src/ifc/unitScales";

// Millimetre model with areas/volumes declared in SI (the common convention):
// the SI-display boundary must convert lengths ×1000 on write and ÷1000 on read,
// while areas/volumes pass through.
const MM_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mm.ifc','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9M',$,'Test',$,$,$,$,(#2),#3);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
#3=IFCUNITASSIGNMENT((#5,#7,#8));
#4=IFCAXIS2PLACEMENT3D(#6,$,$);
#5=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#6=IFCCARTESIANPOINT((0.,0.,0.));
#7=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#8=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
ENDSEC;
END-ISO-10303-21;
`;

describe("unit scale helpers", () => {
  const scales: UnitScales = { length: 0.001, area: 1, volume: 1 };

  it("converts per measure and rounds to 3 decimals", () => {
    expect(toSI(3600, QuantityType.Length, scales)).toBe(3.6);
    expect(fromSI(3.6, QuantityType.Length, scales)).toBe(3600);
    expect(toSI(12.5, QuantityType.Area, scales)).toBe(12.5);
    expect(fromSI(0.359428, QuantityType.Volume, scales)).toBe(0.359);
    expect(toSI(19120.508193969727, QuantityType.Length, scales)).toBe(19.121);
    expect(toSI(7, QuantityType.Count, scales)).toBe(7); // pass-through
  });

  it("names the SI display units", () => {
    expect(siSymbol(QuantityType.Length)).toBe("m");
    expect(siSymbol(QuantityType.Area)).toBe("m²");
    expect(siSymbol(QuantityType.Volume)).toBe("m³");
    expect(siSymbol(QuantityType.Count)).toBeNull();
  });
});

describe("SI conversion boundary on a millimetre model (editor round-trip)", () => {
  it("writes SI values as file units and reads them back as SI with symbols", async () => {
    const ID = 1;
    const ed = await IfcEditor.open(new TextEncoder().encode(MM_IFC));
    // The app hands SI to the editor: 3.6 m, 12 m², 0.36 m³.
    ed.setQuantity(ID, "Qto_WallBaseQuantities", "Length", 3.6, QuantityType.Length);
    ed.setQuantity(ID, "Qto_WallBaseQuantities", "NetSideArea", 12, QuantityType.Area);
    ed.setQuantity(ID, "Qto_WallBaseQuantities", "NetVolume", 0.36, QuantityType.Volume);
    const out = ed.export();
    ed.close();

    // In the STEP file: lengths in mm (3600), areas/volumes in their SI units.
    const step = new TextDecoder().decode(out);
    expect(step).toMatch(/IFCQUANTITYLENGTH\('Length',\$,\$,3600\./);
    expect(step).toMatch(/IFCQUANTITYAREA\('NetSideArea',\$,\$,12\./);
    expect(step).toMatch(/IFCQUANTITYVOLUME\('NetVolume',\$,\$,0\.36/);

    // Reopened, the selection displays SI values with SI symbols again.
    const ed2 = await IfcEditor.open(out);
    const qto = ed2.getSelection(ID).groups.find((g) => g.kind === "quantity" && g.name === "Qto_WallBaseQuantities");
    expect(qto).toBeDefined();
    const row = (name: string) => qto!.rows.find((r) => r.name === name);
    expect(Number(row("Length")!.value)).toBeCloseTo(3.6, 6);
    expect(row("Length")!.unit).toBe("m");
    expect(Number(row("NetSideArea")!.value)).toBeCloseTo(12, 6);
    expect(row("NetSideArea")!.unit).toBe("m²");
    expect(Number(row("NetVolume")!.value)).toBeCloseTo(0.36, 6);
    expect(row("NetVolume")!.unit).toBe("m³");
    ed2.close();
  });
});
