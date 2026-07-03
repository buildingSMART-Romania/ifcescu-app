// Shared @ifc-lite parse provider — replaces the old web-ifc getIfcApi() singleton.
// Parses IFC bytes into a columnar IfcDataStore ONCE and caches it, so the editor,
// the 3D viewer and the globe all reuse the same parse (keyed by the bytes identity).
import { IfcParser, type IfcDataStore } from "@ifc-lite/parser";

export type IfcSchema = "IFC2X3" | "IFC4" | "IFC4X3";

// Keyed by the bytes identity so every loaded model keeps its own parse (federation
// loads several at once). A WeakMap lets a store be GC'd once its bytes are dropped.
const cache = new WeakMap<Uint8Array, Promise<IfcDataStore>>();

/** A standalone ArrayBuffer view of `bytes` (no Buffer offset surprises). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Parse (and cache) the columnar store for these exact bytes. */
export async function parseStore(bytes: Uint8Array): Promise<IfcDataStore> {
  const hit = cache.get(bytes);
  if (hit) return hit;
  const p = new IfcParser().parseColumnar(toArrayBuffer(bytes));
  // Don't pin a failed parse — drop it so a later retry re-parses.
  p.catch(() => { if (cache.get(bytes) === p) cache.delete(bytes); });
  cache.set(bytes, p);
  return p;
}

/** Read the IFC schema from the STEP header (first 8 KB). @ifc-lite parses IFC4X3 natively. */
export function detectSchema(bytes: Uint8Array): IfcSchema {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8192));
  const s = (head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "").toUpperCase();
  if (s.startsWith("IFC2X3")) return "IFC2X3";
  if (s.startsWith("IFC4X3") || s.startsWith("IFC4_3") || s.startsWith("IFC4.3")) return "IFC4X3";
  return "IFC4";
}
