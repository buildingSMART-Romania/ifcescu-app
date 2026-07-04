import { describe, it, expect, beforeEach } from "vitest";
import { loadIdsDraft, saveIdsDraft, clearIdsDraft, hasIdsContent } from "../src/ifc/idsDraft";
import { emptyIdsDoc, emptySpec, emptyRequirement, defaultFacet, type IDSDocument } from "../src/ifc/ids";

// vitest runs in node with no localStorage — install a Map-backed shim.
function installStorage(): Map<string, string> {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
  return m;
}

beforeEach(() => { installStorage(); });

describe("idsDraft persistence", () => {
  it("round-trips a doc containing values serializeIds would drop", () => {
    // author is not an email and date isn't xs:date — serializeIds would omit
    // both, so persisting raw JSON (not XML) is what preserves the in-progress draft.
    const doc: IDSDocument = emptyIdsDoc();
    doc.info.title = "Draft";
    doc.info.author = "not-an-email";
    doc.info.date = "2026-1";
    doc.specifications[0].applicability.facets.push(defaultFacet("entity"));

    saveIdsDraft(doc);
    const restored = loadIdsDraft();
    expect(restored).toEqual(doc);
    expect(restored!.info.author).toBe("not-an-email");
    expect(restored!.info.date).toBe("2026-1");
  });

  it("clearIdsDraft removes the stored draft", () => {
    const doc = emptyIdsDoc();
    doc.info.title = "X";
    saveIdsDraft(doc);
    expect(loadIdsDraft()).not.toBeNull();
    clearIdsDraft();
    expect(loadIdsDraft()).toBeNull();
  });

  it("returns null on corrupt JSON", () => {
    (globalThis as any).localStorage.setItem("ifc-ids:draft", "{not json");
    expect(loadIdsDraft()).toBeNull();
  });

  it("rejects a wrong envelope version", () => {
    (globalThis as any).localStorage.setItem(
      "ifc-ids:draft",
      JSON.stringify({ v: 999, savedAt: "x", doc: emptyIdsDoc() }),
    );
    expect(loadIdsDraft()).toBeNull();
  });

  it("rejects a malformed doc (missing specifications)", () => {
    (globalThis as any).localStorage.setItem(
      "ifc-ids:draft",
      JSON.stringify({ v: 1, savedAt: "x", doc: { info: { title: "t" } } }),
    );
    expect(loadIdsDraft()).toBeNull();
  });

  it("returns null (no throw) when localStorage is unavailable", () => {
    delete (globalThis as any).localStorage;
    expect(loadIdsDraft()).toBeNull();
    // save/clear must also swallow the absence
    expect(() => saveIdsDraft(emptyIdsDoc())).not.toThrow();
    expect(() => clearIdsDraft()).not.toThrow();
  });
});

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
