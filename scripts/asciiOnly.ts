// Build-time guarantee that the shipped JS/CSS/HTML is pure ASCII (issue #3).
// A host or FTP transfer that mis-declares the encoding turned UI glyphs into
// mojibake ("▶" → "Ã¢â€“Â¶"). esbuild's `charset: "ascii"` escapes strings and
// identifiers but leaves regex literals alone (Cesium, @ifc-lite/ids ship some),
// so this plugin escapes whatever remains and fails the build if anything
// non-ASCII still reaches the output.
import type { Plugin } from "vite";

const NON_ASCII = /[^\x00-\x7f]/;
const CHECKED = /\.(js|mjs|css|html)$/i;

/** First non-ASCII characters in `text` as { index, char } (at most `limit`). */
export function findNonAscii(text: string, limit = 5): { index: number; char: string }[] {
  const hits: { index: number; char: string }[] = [];
  for (let i = 0; i < text.length && hits.length < limit; i++) {
    if (text.charCodeAt(i) > 0x7f) hits.push({ index: i, char: text[i] });
  }
  return hits;
}

/**
 * Replace every non-ASCII UTF-16 code unit in JS source with a `\uXXXX` escape.
 * Valid in string/template/regex literals, identifiers and comments alike
 * (astral chars become surrogate-pair escapes, which `u`-flag regexes still
 * read as one code point). A char that was itself backslash-escaped (`\«` in a
 * regex) drops that backslash so the result isn't a literal "«".
 * Caveat: in a TAGGED template (which esbuild also leaves raw) the cooked
 * string is unchanged but `.raw` now holds the escape — fine for the bundle
 * today (only regex literals reach this), worth knowing before adding
 * String.raw`…` with non-ASCII text.
 */
export function escapeNonAscii(code: string): string {
  if (!NON_ASCII.test(code)) return code;
  let out = "";
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c <= 0x7f) { out += code[i]; continue; }
    let slashes = 0;
    for (let j = out.length - 1; j >= 0 && out[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 1) out = out.slice(0, -1);
    out += "\\u" + c.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

export function asciiOnly(): Plugin {
  return {
    name: "ascii-only",
    apply: "build",
    enforce: "post",
    // After every renderChunk (incl. esbuild minify) has run.
    generateBundle(_opts, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type === "chunk") out.code = escapeNonAscii(out.code);
      }
    },
    writeBundle(_opts, bundle) {
      const bad: string[] = [];
      for (const out of Object.values(bundle)) {
        if (!CHECKED.test(out.fileName)) continue;
        const text = out.type === "chunk" ? out.code : typeof out.source === "string" ? out.source : new TextDecoder().decode(out.source);
        const hits = findNonAscii(text);
        if (hits.length) bad.push(`${out.fileName}: ${hits.map((h) => `U+${h.char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}@${h.index}`).join(", ")}`);
      }
      if (bad.length) this.error(`Non-ASCII characters in the build output:\n  ${bad.join("\n  ")}`);
    },
  };
}
