// Build a minimal binary glTF (GLB) from a single indexed triangle mesh, so the
// IFC model can be loaded as a robust Cesium.Model (handles bounding volumes,
// lighting, 2D/CV, picking) instead of a hand-rolled Primitive.
//
// Positions are written verbatim; the caller places the model with a modelMatrix
// and Axis.Z up so local (X,Y,Z) = (East, North, Up).

const UBYTE = 5121;
const FLOAT = 5126;
const UINT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export function buildGlb(
  positions: Float32Array,
  normals: Float32Array,
  colors: Uint8Array, // r,g,b,a per vertex (0–255)
  indices: Uint32Array,
  min: [number, number, number],
  max: [number, number, number],
): Uint8Array {
  const posBytes = positions.byteLength;
  const nrmBytes = normals.byteLength;
  const colBytes = colors.byteLength; // vertexCount*4, already 4-aligned
  const idxBytes = indices.byteLength;
  const binLen = posBytes + nrmBytes + colBytes + idxBytes;
  const vertexCount = positions.length / 3;

  const gltf = {
    asset: { version: "2.0", generator: "ifcescu" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] },
    ],
    materials: [
      {
        // White base; the per-vertex IFC colours come through COLOR_0.
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: posBytes, byteLength: nrmBytes, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: posBytes + nrmBytes, byteLength: colBytes, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: posBytes + nrmBytes + colBytes, byteLength: idxBytes, target: ELEMENT_ARRAY_BUFFER },
    ],
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: vertexCount, type: "VEC3", min, max },
      { bufferView: 1, componentType: FLOAT, count: vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: UBYTE, normalized: true, count: vertexCount, type: "VEC4" },
      { bufferView: 3, componentType: UINT, count: indices.length, type: "SCALAR" },
    ],
  };

  // Binary chunk: positions | normals | colors | indices.
  const bin = new Uint8Array(binLen);
  bin.set(new Uint8Array(positions.buffer, positions.byteOffset, posBytes), 0);
  bin.set(new Uint8Array(normals.buffer, normals.byteOffset, nrmBytes), posBytes);
  bin.set(new Uint8Array(colors.buffer, colors.byteOffset, colBytes), posBytes + nrmBytes);
  bin.set(new Uint8Array(indices.buffer, indices.byteOffset, idxBytes), posBytes + nrmBytes + colBytes);

  // JSON chunk, padded with spaces to a 4-byte boundary.
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(json.length + jsonPad);
    padded.set(json);
    padded.fill(0x20, json.length);
    json = padded;
  }
  // Binary chunk padded with zeros (already aligned here, but be safe).
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunkLen = bin.length + binPad;

  const total = 12 + 8 + json.length + 8 + binChunkLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint32(o, 0x46546c67, true); o += 4; // "glTF"
  dv.setUint32(o, 2, true); o += 4; // version
  dv.setUint32(o, total, true); o += 4; // total length
  // JSON chunk
  dv.setUint32(o, json.length, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4; // "JSON"
  out.set(json, o); o += json.length;
  // BIN chunk
  dv.setUint32(o, binChunkLen, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4; // "BIN\0"
  out.set(bin, o);
  return out;
}
