import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { IfcParser } from "@ifc-lite/parser";
import { PropertyValueType } from "@ifc-lite/data";
import { IfcEditor, type SelectionDetail } from "../src/ifc/editor";

// Uses a real IFC so the model is valid. Defaults to the bundled sample so the
// test runs everywhere; override with IFC_SAMPLE=<path>. Skips if truly absent.
const SAMPLE =
  process.env.IFC_SAMPLE ??
  fileURLToPath(new URL("../public/samples/Building-Architecture.ifc", import.meta.url));
const hasSample = fs.existsSync(SAMPLE);

const ELEMENT_RE = /WALL|SLAB|BEAM|COLUMN|PROXY|PILE|DOOR|WINDOW|FOOTING|MEMBER|PLATE|RAILING|COVERING/;

/** Find a concrete building element's expressId by parsing the bytes directly. */
async function findElementId(bytes: Uint8Array): Promise<number | null> {
  const store = await new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  for (const [type, ids] of store.entityIndex.byType) {
    if (ELEMENT_RE.test(type) && ids.length) return ids[0];
  }
  return null;
}

const valueOf = (d: SelectionDetail, group: string, name: string): string | undefined =>
  d.groups.find((g) => g.name === group)?.rows.find((r) => r.name === name)?.value;

describe.runIf(hasSample)("IfcEditor round-trip", () => {
  it("edits an attribute + property + new pset; values survive export+reopen", async () => {
    const bytes = new Uint8Array(fs.readFileSync(SAMPLE));
    const id = await findElementId(bytes);
    expect(id).not.toBeNull();
    if (id == null) return;

    const ed = await IfcEditor.open(bytes);
    expect(ed.hasChanges()).toBe(false);

    ed.setRootAttribute(id, "Name", "Element Editat");
    ed.setRootAttribute(id, "Description", "Descriere test");
    ed.setProperty(id, "Pset_Test", "MyProp", "hello", PropertyValueType.Text);
    ed.createPropertySet(id, "Pset_Custom", [
      { name: "Code", value: "ABC-123", type: PropertyValueType.Identifier },
    ]);
    expect(ed.hasChanges()).toBe(true);

    // The same editor reflects edits immediately (view-aware read).
    const live = ed.getSelection(id);
    expect(valueOf(live, "Atribute", "Name")).toBe("Element Editat");
    expect(valueOf(live, "Pset_Test", "MyProp")).toBe("hello");

    const out = ed.export();

    // Reopen the exported bytes and confirm the edits were baked in.
    const ed2 = await IfcEditor.open(out);
    const sel = ed2.getSelection(id);
    expect(valueOf(sel, "Atribute", "Name")).toBe("Element Editat");
    expect(valueOf(sel, "Atribute", "Description")).toBe("Descriere test");
    expect(valueOf(sel, "Pset_Test", "MyProp")).toBe("hello");
    expect(valueOf(sel, "Pset_Custom", "Code")).toBe("ABC-123");
  });
});
