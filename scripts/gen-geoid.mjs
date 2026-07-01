// One-off generator for the bundled geoid asset used by the Cesium globe view.
// Reads the GeographicLib EGM2008-5 .pgm geoid grid, clips the Romania region,
// and writes public/geoid/egm2008-ro.json (geoid undulation N = h_ellipsoid -
// H_orthometric, metres). Re-run only to regenerate the asset.
//
// Usage: node scripts/gen-geoid.mjs <path-to-egm2008-5.pgm>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PGM = process.argv[2] ?? path.join(__dirname, "_geoidtmp/geoids/egm2008-5.pgm");
const OUT = path.join(__dirname, "../public/geoid/egm2008-ro.json");

// Romania bounding box with a margin (degrees).
const LON_MIN = 19.5, LON_MAX = 30.5, LAT_MIN = 42.5, LAT_MAX = 49.5;

const buf = fs.readFileSync(PGM);

// --- Parse the binary PGM (P5) header, collecting Offset/Scale comments. ---
let pos = 0;
const readToken = () => {
  // Skip whitespace and full comment lines (#...\n), capturing comments.
  for (;;) {
    while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23) {
      // comment line
      const start = pos;
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      comments.push(buf.toString("latin1", start, pos));
      continue;
    }
    break;
  }
  const start = pos;
  while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) pos++;
  return buf.toString("latin1", start, pos);
};
const comments = [];
const magic = readToken();
if (magic !== "P5") throw new Error("Not a P5 PGM: " + magic);
const width = parseInt(readToken(), 10);
const height = parseInt(readToken(), 10);
const maxval = parseInt(readToken(), 10);
pos += 1; // exactly one whitespace byte separates maxval from binary data
const dataStart = pos;

const offMatch = comments.join("\n").match(/Offset\s+(-?[\d.]+)/i);
const sclMatch = comments.join("\n").match(/Scale\s+(-?[\d.eE]+)/i);
if (!offMatch || !sclMatch) throw new Error("Missing Offset/Scale in PGM header");
const offset = parseFloat(offMatch[1]);
const scale = parseFloat(sclMatch[1]);
console.log(`PGM ${width}x${height} maxval=${maxval} offset=${offset} scale=${scale} (${maxval > 255 ? 16 : 8}-bit)`);

// Grid geometry (GeographicLib convention): columns span lon [0,360), rows span
// lat [90,-90]; row 0 = +90, col 0 = 0°E.
const dLonSrc = 360 / width;
const dLatSrc = 180 / (height - 1);
const raw = (i, j) => {
  const ii = ((i % width) + width) % width;
  return buf.readUInt16BE(dataStart + 2 * (j * width + ii));
};
const undAt = (i, j) => offset + scale * raw(i, j);

// Native-resolution clip over Romania, stored south→north, west→east.
const colMin = Math.floor(LON_MIN / dLonSrc);
const colMax = Math.ceil(LON_MAX / dLonSrc);
const rowAtLat = (lat) => (90 - lat) / dLatSrc; // fractional row from north
const jNorth = Math.floor(rowAtLat(LAT_MAX)); // smaller j = more north
const jSouth = Math.ceil(rowAtLat(LAT_MIN));

const cols = colMax - colMin + 1;
const rows = jSouth - jNorth + 1;
const lonMin = colMin * dLonSrc;
const latMin = 90 - jSouth * dLatSrc;

const values = new Array(cols * rows);
let min = Infinity, max = -Infinity;
for (let r = 0; r < rows; r++) {
  const j = jSouth - r; // r=0 is southernmost (largest j)
  for (let c = 0; c < cols; c++) {
    const v = +undAt(colMin + c, j).toFixed(3);
    values[r * cols + c] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
}

const out = {
  model: "EGM2008-5",
  note: "Geoid undulation N (WGS84 ellipsoidal minus orthometric), metres. Romania clip, south->north, west->east, row-major.",
  lonMin: +lonMin.toFixed(6),
  latMin: +latMin.toFixed(6),
  dLon: +dLonSrc.toFixed(8),
  dLat: +dLatSrc.toFixed(8),
  cols,
  rows,
  values,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT}: ${cols}x${rows}=${values.length} pts, N range ${min.toFixed(2)}..${max.toFixed(2)} m, ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
