import { describe, it, expect } from "vitest";
import { PropertyValueType } from "@ifc-lite/data";
import { IfcEditor } from "../src/ifc/editor";

// Minimal, self-contained IFC4 model (an IfcProject + context + units). Lets the
// editing round-trip run in CI without an external sample. We edit the IfcProject
// itself (it's an IfcRoot / IfcObject, so it accepts attribute + property edits).
const TINY_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('tiny.ifc','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Test',$,$,$,$,(#2),#3);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
#3=IFCUNITASSIGNMENT((#5));
#4=IFCAXIS2PLACEMENT3D(#6,$,$);
#5=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#6=IFCCARTESIANPOINT((0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

const valueOf = (ed: IfcEditor, id: number, group: string, name: string): string | undefined =>
  ed.getSelection(id).groups.find((g) => g.name === group)?.rows.find((r) => r.name === name)?.value;

describe("IfcEditor inline round-trip", () => {
  it("edits an attribute + property + new pset on a tiny model; survives export+reopen", async () => {
    const bytes = new TextEncoder().encode(TINY_IFC);
    const ed = await IfcEditor.open(bytes);
    expect(ed.hasChanges()).toBe(false);

    const PROJECT_ID = 1;
    ed.setRootAttribute(PROJECT_ID, "Name", "Proiect Nou");
    ed.setProperty(PROJECT_ID, "Pset_Test", "MyProp", "hello", PropertyValueType.Text);
    ed.createPropertySet(PROJECT_ID, "Pset_Custom", [
      { name: "Code", value: "ABC-123", type: PropertyValueType.Identifier },
    ]);
    expect(ed.hasChanges()).toBe(true);
    expect(valueOf(ed, PROJECT_ID, "Atribute", "Name")).toBe("Proiect Nou");

    const out = ed.export();
    ed.close();

    const ed2 = await IfcEditor.open(out);
    expect(valueOf(ed2, PROJECT_ID, "Atribute", "Name")).toBe("Proiect Nou");
    expect(valueOf(ed2, PROJECT_ID, "Pset_Test", "MyProp")).toBe("hello");
    expect(valueOf(ed2, PROJECT_ID, "Pset_Custom", "Code")).toBe("ABC-123");
    ed2.close();
  });

  it("deletes a property and a whole pset; the deletion survives export+reopen", async () => {
    const PROJECT_ID = 1;
    // Seed a model that actually contains two psets (via a first export pass).
    const seed = await IfcEditor.open(new TextEncoder().encode(TINY_IFC));
    seed.createPropertySet(PROJECT_ID, "Pset_Keep", [
      { name: "Stays", value: "yes", type: PropertyValueType.Text },
      { name: "Goes", value: "no", type: PropertyValueType.Text },
    ]);
    seed.createPropertySet(PROJECT_ID, "Pset_Drop", [
      { name: "Anything", value: "x", type: PropertyValueType.Text },
    ]);
    const seeded = seed.export();
    seed.close();

    const ed = await IfcEditor.open(seeded);
    expect(valueOf(ed, PROJECT_ID, "Pset_Keep", "Goes")).toBe("no");
    expect(valueOf(ed, PROJECT_ID, "Pset_Drop", "Anything")).toBe("x");

    ed.removeProperty(PROJECT_ID, "Pset_Keep", "Goes");
    ed.removePropertySet(PROJECT_ID, "Pset_Drop");
    expect(ed.hasChanges()).toBe(true);
    // The overlay view reflects deletions immediately (before export).
    expect(valueOf(ed, PROJECT_ID, "Pset_Keep", "Goes")).toBeUndefined();
    expect(ed.getSelection(PROJECT_ID).groups.find((g) => g.name === "Pset_Drop")).toBeUndefined();

    const out = ed.export();
    ed.close();

    const ed2 = await IfcEditor.open(out);
    expect(valueOf(ed2, PROJECT_ID, "Pset_Keep", "Stays")).toBe("yes"); // untouched sibling survives
    expect(valueOf(ed2, PROJECT_ID, "Pset_Keep", "Goes")).toBeUndefined();
    expect(ed2.getSelection(PROJECT_ID).groups.find((g) => g.name === "Pset_Drop")).toBeUndefined();
    ed2.close();
  });
});
