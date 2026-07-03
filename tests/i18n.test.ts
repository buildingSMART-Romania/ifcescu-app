import { describe, it, expect } from "vitest";
import { ro } from "../src/i18n/ro";
import { en } from "../src/i18n/en";

// Parity test for the two dictionaries. TypeScript already enforces this at
// compile time (en is typed against `typeof ro`), but the build can be skipped
// or the types loosened — this keeps the invariant executable in `npm test`.

/** Recursively flatten a nested dictionary into its leaf dot-paths. */
function leafKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix.replace(/\.$/, "")];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") out.push(...leafKeys(v, path));
    else out.push(path);
  }
  return out;
}

describe("i18n dictionary parity (ro ↔ en)", () => {
  const roKeys = leafKeys(ro);
  const enKeys = leafKeys(en);
  const roSet = new Set(roKeys);
  const enSet = new Set(enKeys);

  it("en has every ro key (nothing missing in en)", () => {
    const missingInEn = roKeys.filter((k) => !enSet.has(k));
    expect(missingInEn, `Keys present in ro.ts but missing from en.ts:\n  ${missingInEn.join("\n  ")}`).toEqual([]);
  });

  it("en has no keys that ro lacks (nothing extra in en)", () => {
    const extraInEn = enKeys.filter((k) => !roSet.has(k));
    expect(extraInEn, `Keys present in en.ts but missing from ro.ts:\n  ${extraInEn.join("\n  ")}`).toEqual([]);
  });

  it("every leaf is a non-empty string in both dictionaries", () => {
    const badLeaf = (dict: unknown, name: string) =>
      leafKeys(dict)
        .filter((k) => {
          const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p as never], dict);
          return typeof v !== "string" || v.length === 0;
        })
        .map((k) => `${name}:${k}`);
    expect([...badLeaf(ro, "ro"), ...badLeaf(en, "en")]).toEqual([]);
  });
});
