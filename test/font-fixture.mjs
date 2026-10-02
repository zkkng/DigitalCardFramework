/** Generates a minimal two-glyph TrueType fixture; no bundled font asset. */
export function testFont() {
  const tables = new Map(),
    put = (name, length) => {
      const b = new Uint8Array(length);
      tables.set(name, b);
      return new DataView(b.buffer);
    };
  let v = put("head", 54);
  v.setUint32(0, 0x00010000);
  v.setUint32(12, 0x5f0f3cf5);
  v.setUint16(18, 1000);
  v.setInt16(36, 0);
  v.setInt16(38, 0);
  v.setInt16(40, 500);
  v.setInt16(42, 700);
  v.setInt16(50, 1);
  v = put("hhea", 36);
  v.setUint32(0, 0x00010000);
  v.setInt16(4, 800);
  v.setInt16(6, -200);
  v.setUint16(10, 600);
  v.setUint16(34, 2);
  v = put("maxp", 32);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 2);
  v.setUint16(6, 4);
  v.setUint16(8, 1);
  v = put("hmtx", 8);
  v.setUint16(0, 600);
  v.setUint16(4, 600);
  v = put("loca", 12);
  v.setUint32(0, 0);
  v.setUint32(4, 0);
  v.setUint32(8, 34);
  v = put("glyf", 34);
  v.setInt16(0, 1);
  v.setInt16(6, 500);
  v.setInt16(8, 700);
  v.setUint16(10, 3);
  v.setUint16(12, 0);
  for (let i = 14; i < 18; i++) v.setUint8(i, 1);
  [0, 500, 0, -500].forEach((n, i) => v.setInt16(18 + i * 2, n));
  [0, 0, 700, 0].forEach((n, i) => v.setInt16(26 + i * 2, n));
  v = put("cmap", 274);
  v.setUint16(2, 1);
  v.setUint16(4, 3);
  v.setUint16(6, 1);
  v.setUint32(8, 12);
  v.setUint16(12, 0);
  v.setUint16(14, 262);
  for (let c = 32; c < 127; c++) v.setUint8(18 + c, 1);
  const names = [
      "Test Sans",
      "Regular",
      "Test Sans Regular",
      "TestSans-Regular",
    ],
    ids = [1, 2, 4, 6],
    encoded = names.map((n) =>
      Uint8Array.from([...n].flatMap((c) => [0, c.charCodeAt(0)])),
    );
  v = put(
    "name",
    6 + names.length * 12 + encoded.reduce((n, a) => n + a.length, 0),
  );
  v.setUint16(2, names.length);
  v.setUint16(4, 6 + names.length * 12);
  let off = 0;
  for (let i = 0; i < names.length; i++) {
    const at = 6 + i * 12;
    v.setUint16(at, 3);
    v.setUint16(at + 2, 1);
    v.setUint16(at + 4, 0x409);
    v.setUint16(at + 6, ids[i]);
    v.setUint16(at + 8, encoded[i].length);
    v.setUint16(at + 10, off);
    new Uint8Array(v.buffer).set(encoded[i], 6 + names.length * 12 + off);
    off += encoded[i].length;
  }
  v = put("post", 32);
  v.setUint32(0, 0x00030000);
  const size =
      12 +
      tables.size * 16 +
      [...tables.values()].reduce((n, b) => n + Math.ceil(b.length / 4) * 4, 0),
    out = new Uint8Array(size),
    header = new DataView(out.buffer);
  header.setUint32(0, 0x00010000);
  header.setUint16(4, tables.size);
  let offset = 12 + tables.size * 16,
    index = 0;
  for (const [name, bytes] of [...tables].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const at = 12 + index++ * 16;
    for (let i = 0; i < 4; i++) out[at + i] = name.charCodeAt(i);
    header.setUint32(at + 8, offset);
    header.setUint32(at + 12, bytes.length);
    out.set(bytes, offset);
    offset += Math.ceil(bytes.length / 4) * 4;
  }
  return out;
}
