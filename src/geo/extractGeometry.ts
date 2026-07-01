// Extract and merge an IFC model's geometry into one buffer, in IFC model
// coordinates (Z-up; X≈East, Y≈North, Z=up) — the frame the globe placement
// (geo/placement.ts) expects. Powered by @ifc-lite/geometry (replaces web-ifc).
//
// We use the STREAMING path: it emits per-element meshes in the RENDERER frame
// (Y-up, RTC-subtracted, metres; world vertex = mesh.origin + positions) plus a
// clean `rtcOffset` in IFC Z-up. (The sync process() path leaves wasmRtcOffset
// undefined and pre-shifts positions, which we cannot reconstruct reliably.)
// Absolute IFC Z-up = flip(Y-up→Z-up) of the world vertex + rtcOffset. Verified
// against the SP4 Stereo 70 model (centre ≈ E 4.7e5 / N 4.0e5). Positions stay
// Float64 so large real-coordinate models survive before the globe localises them.
import { GeometryProcessor } from "@ifc-lite/geometry";

export interface MergedMesh {
  positions: Float64Array; // x,y,z … in IFC model coordinates
  normals: Float32Array; // nx,ny,nz …
  colors: Uint8Array; // r,g,b,a per vertex (0–255) from the IFC surface styles
  indices: Uint32Array;
  bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  vertexCount: number;
  triangleCount: number;
}

interface RawMesh {
  origin: [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
}

// @ifc-lite's geometry WASM allows only one active stream at a time. React
// StrictMode (dev) double-invokes effects, which would start two concurrent
// streams — so memoize by bytes identity and hand back the in-flight promise.
let meshCache: { bytes: Uint8Array; promise: Promise<MergedMesh> } | null = null;

/** Build the merged IFC-coordinate mesh for the globe from raw IFC bytes. */
export function extractMergedMeshFromBytes(bytes: Uint8Array): Promise<MergedMesh> {
  if (meshCache && meshCache.bytes === bytes) return meshCache.promise;
  const promise = buildMergedMesh(bytes);
  meshCache = { bytes, promise };
  return promise;
}

async function buildMergedMesh(bytes: Uint8Array): Promise<MergedMesh> {
  const proc = new GeometryProcessor();
  await proc.init();

  const raws: RawMesh[] = [];
  let rtc = { x: 0, y: 0, z: 0 };
  for await (const ev of proc.processStreaming(bytes)) {
    if (ev.type === "rtcOffset") rtc = ev.rtcOffset;
    else if (ev.type === "batch") {
      for (const m of ev.meshes) {
        raws.push({
          origin: m.origin ?? [0, 0, 0],
          positions: m.positions,
          normals: m.normals,
          indices: m.indices,
          color: m.color ?? [1, 1, 1, 1],
        });
      }
    } else if (ev.type === "complete" && ev.coordinateInfo?.wasmRtcOffset) {
      rtc = ev.coordinateInfo.wasmRtcOffset;
    }
  }
  proc.dispose?.();

  let totalVerts = 0;
  let totalIdx = 0;
  for (const m of raws) {
    totalVerts += m.positions.length / 3;
    totalIdx += m.indices.length;
  }

  const positions = new Float64Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Uint8Array(totalVerts * 4);
  const indices = new Uint32Array(totalIdx);
  const bbox = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  const to255 = (c: number) => Math.max(0, Math.min(255, Math.round((c ?? 0) * 255)));

  let pOff = 0; // vertex offset
  let iOff = 0;
  for (const m of raws) {
    const [ox, oy, oz] = m.origin;
    const n = m.positions.length / 3;
    const [cr, cg, cb, ca] = m.color;
    const r = to255(cr), g = to255(cg), b = to255(cb), a = ca != null ? to255(ca) : 255;
    for (let v = 0; v < n; v++) {
      // Renderer Y-up world position (RTC-subtracted).
      const wx = m.positions[v * 3] + ox;
      const wy = m.positions[v * 3 + 1] + oy;
      const wz = m.positions[v * 3 + 2] + oz;
      // Y-up → IFC Z-up, then add back the IFC-frame RTC offset → absolute IFC coords.
      const X = wx + rtc.x;
      const Y = -wz + rtc.y;
      const Z = wy + rtc.z;
      const o3 = (pOff + v) * 3;
      positions[o3] = X;
      positions[o3 + 1] = Y;
      positions[o3 + 2] = Z;
      // Normals: same Y-up→Z-up rotation (no translation).
      normals[o3] = m.normals[v * 3];
      normals[o3 + 1] = -m.normals[v * 3 + 2];
      normals[o3 + 2] = m.normals[v * 3 + 1];
      const o4 = (pOff + v) * 4;
      colors[o4] = r; colors[o4 + 1] = g; colors[o4 + 2] = b; colors[o4 + 3] = a;
      if (X < bbox.minX) bbox.minX = X; if (X > bbox.maxX) bbox.maxX = X;
      if (Y < bbox.minY) bbox.minY = Y; if (Y > bbox.maxY) bbox.maxY = Y;
      if (Z < bbox.minZ) bbox.minZ = Z; if (Z > bbox.maxZ) bbox.maxZ = Z;
    }
    for (let k = 0; k < m.indices.length; k++) indices[iOff + k] = m.indices[k] + pOff;
    pOff += n;
    iOff += m.indices.length;
  }

  return { positions, normals, colors, indices, bbox, vertexCount: totalVerts, triangleCount: totalIdx / 3 };
}
