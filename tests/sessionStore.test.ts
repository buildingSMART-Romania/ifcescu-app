import { describe, it, expect } from "vitest";
import { mergeState } from "../src/session/store";

describe("session.mergeState", () => {
  it("sets the patched fields and keeps the others", () => {
    const cur = { idsXml: "<ids/>", idsValidated: true };
    expect(mergeState(cur, { measures: [] })).toEqual({ idsXml: "<ids/>", idsValidated: true, measures: [] });
  });

  it("removes a field patched with undefined (e.g. the BCF was cleared)", () => {
    const blob = new Blob(["x"]);
    const next = mergeState({ bcf: blob, idsXml: "<ids/>" }, { bcf: undefined });
    expect(next).toEqual({ idsXml: "<ids/>" });
    expect("bcf" in next).toBe(false);
  });

  it("doesn't mutate the stored state", () => {
    const cur = { idsXml: "a" };
    mergeState(cur, { idsXml: "b" });
    expect(cur).toEqual({ idsXml: "a" });
  });
});
