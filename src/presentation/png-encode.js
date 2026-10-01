import { crc32 } from "./package.js";
import { ensure } from "./data.js";
const join = (parts) => {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of parts) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const u32 = (n) => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n);
  return a;
};
const chunk = (type, bytes) => {
  const payload = join([new TextEncoder().encode(type), bytes]);
  return join([u32(bytes.length), payload, u32(crc32(payload))]);
};
/** Canvas-independent PNG encoding keeps GIF imports working in Safari workers. */
export async function encodePNG({ width, height, data }) {
  ensure(
    Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0 &&
      width * height <= 32 * 1024 * 1024 &&
      data.length === width * height * 4,
    "PNG_LIMIT",
    "Invalid RGBA buffer",
  );
  const rows = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++)
    rows.set(
      data.subarray(y * width * 4, (y + 1) * width * 4),
      y * (1 + width * 4) + 1,
    );
  let compressed;
  if (typeof CompressionStream !== "undefined")
    compressed = new Uint8Array(
      await new Response(
        new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
      ).arrayBuffer(),
    );
  else {
    const blocks = [new Uint8Array([0x78, 0x01])];
    let a = 1,
      b = 0;
    for (const byte of rows) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    for (let p = 0; p < rows.length; p += 65535) {
      const n = Math.min(65535, rows.length - p);
      blocks.push(
        new Uint8Array([
          p + n === rows.length ? 1 : 0,
          n & 255,
          n >>> 8,
          ~n & 255,
          (~n >>> 8) & 255,
        ]),
        rows.subarray(p, p + n),
      );
    }
    blocks.push(u32(((b << 16) | a) >>> 0));
    compressed = join(blocks);
  }
  const header = new Uint8Array(13);
  header.set(u32(width));
  header.set(u32(height), 4);
  header[8] = 8;
  header[9] = 6;
  return join([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ]);
}
