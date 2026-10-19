import { describe, it, expect } from "vitest";
import { escapeNonAscii, findNonAscii } from "../scripts/asciiOnly";

// Evaluate a JS expression before and after escaping — the escaped source must
// be pure ASCII and behave identically.
function same(expr: string) {
  const escaped = escapeNonAscii(expr);
  expect(findNonAscii(escaped)).toEqual([]);
  expect(new Function(`return (${escaped});`)()).toEqual(new Function(`return (${expr});`)());
  return escaped;
}

describe("escapeNonAscii", () => {
  it("escapes UI glyphs and diacritics in strings", () => {
    expect(same(`"▶ 3D ✓ ✕ × Informații"`)).toBe(`"\\u25B6 3D \\u2713 \\u2715 \\u00D7 Informa\\u021Bii"`);
  });

  it("keeps regex literals working (the case esbuild leaves untouched)", () => {
    same(`/[«»“”‘’]/.test("x“y")`);
    same(`"Doit être".replace(/^Doit être/i, "Ne doit pas être")`);
  });

  it("drops a backslash that escaped the non-ASCII char itself", () => {
    expect(same(String.raw`/a\«b/.test("a«b")`)).toBe('/a\\u00ABb/.test("a\\u00ABb")');
    same(String.raw`/a\\«/.test("a\\«")`); // escaped backslash, then a plain «
  });

  it("handles astral characters, also in u-flag regexes", () => {
    same(`"🏠".length`);
    same(`/^🏠$/u.test("🏠")`);
  });

  it("escapes identifiers and leaves ASCII-only code untouched", () => {
    same(`(() => { const înălțime = 3; return înălțime * 2; })()`);
    const ascii = `const a = "plain"; /x/.test(a);`;
    expect(escapeNonAscii(ascii)).toBe(ascii);
  });
});

describe("findNonAscii", () => {
  it("reports positions and respects the limit", () => {
    expect(findNonAscii("ab✓c✕")).toEqual([{ index: 2, char: "✓" }, { index: 4, char: "✕" }]);
    expect(findNonAscii("ăăă", 2)).toHaveLength(2);
    expect(findNonAscii("ascii")).toEqual([]);
  });
});
