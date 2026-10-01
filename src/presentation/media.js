import { ensure } from "./data.js";
/** Read dimensions before invoking a browser image decoder. */
export function rasterDimensions(bytes, mediaType) {
  ensure(
    bytes instanceof Uint8Array && bytes.length >= 12,
    "MEDIA",
    "Truncated image",
  );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height;
  if (mediaType === "image/png") {
    ensure(
      bytes.length >= 33 &&
        v.getUint32(0) === 0x89504e47 &&
        v.getUint32(4) === 0x0d0a1a0a &&
        v.getUint32(12) === 0x49484452,
      "MEDIA",
      "Invalid PNG header",
    );
    width = v.getUint32(16);
    height = v.getUint32(20);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = v.getUint32(offset),
        tag = v.getUint32(offset + 4);
      ensure(
        offset + 12 + length <= bytes.length,
        "MEDIA",
        "Truncated PNG chunk",
      );
      ensure(
        tag !== 0x6163544c,
        "MEDIA",
        "Animated PNG requires an explicit animation adapter",
      );
      offset += 12 + length;
      if (tag === 0x49454e44) break;
    }
  } else if (mediaType === "image/webp") {
    ensure(
      v.getUint32(0) === 0x52494646 &&
        v.getUint32(8) === 0x57454250 &&
        v.getUint32(4, true) + 8 === bytes.length,
      "MEDIA",
      "Invalid WebP header",
    );
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4)),
        length = v.getUint32(offset + 4, true),
        data = offset + 8;
      ensure(data + length <= bytes.length, "MEDIA", "Truncated WebP chunk");
      if (tag === "VP8X") {
        ensure(length >= 10, "MEDIA", "Invalid extended WebP");
        ensure(
          (bytes[data] & 2) === 0,
          "MEDIA",
          "Animated WebP requires an explicit animation adapter",
        );
        width =
          1 +
          bytes[data + 4] +
          (bytes[data + 5] << 8) +
          (bytes[data + 6] << 16);
        height =
          1 +
          bytes[data + 7] +
          (bytes[data + 8] << 8) +
          (bytes[data + 9] << 16);
        break;
      }
      if (tag === "VP8 ") {
        ensure(
          length >= 10 &&
            bytes[data + 3] === 0x9d &&
            bytes[data + 4] === 1 &&
            bytes[data + 5] === 0x2a,
          "MEDIA",
          "Invalid WebP frame",
        );
        width = v.getUint16(data + 6, true) & 16383;
        height = v.getUint16(data + 8, true) & 16383;
        break;
      }
      if (tag === "VP8L") {
        ensure(
          length >= 5 && bytes[data] === 0x2f,
          "MEDIA",
          "Invalid lossless WebP",
        );
        const bits = v.getUint32(data + 1, true);
        width = 1 + (bits & 16383);
        height = 1 + ((bits >>> 14) & 16383);
        break;
      }
      offset = data + length + (length % 2);
    }
  } else if (mediaType === "image/jpeg") {
    ensure(bytes[0] === 255 && bytes[1] === 216, "MEDIA", "Invalid JPEG");
    let offset = 2,
      segments = 0;
    while (offset + 4 <= bytes.length && segments++ < 10000) {
      ensure(bytes[offset++] === 255, "MEDIA", "Invalid JPEG marker");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = v.getUint16(offset);
      ensure(
        length >= 2 && offset + length <= bytes.length,
        "MEDIA",
        "Truncated JPEG segment",
      );
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        ensure(length >= 8, "MEDIA", "Invalid JPEG frame");
        height = v.getUint16(offset + 3);
        width = v.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  ensure(
    Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0 &&
      width <= 16384 &&
      height <= 16384 &&
      width * height <= 64 * 1024 * 1024,
    "MEDIA",
    "Unsupported or excessive raster dimensions",
  );
  return { width, height };
}
