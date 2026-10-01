import { parseGIF, decompressFrame } from "gifuct-js";
import { ensure, text } from "./data.js";

/** Validate bounded block structure before allowing a decoder to allocate pixels. */
export function inspectGIF(
  bytes,
  { frames = 100, pixels = 32 * 1024 * 1024, edge = 4096 } = {},
) {
  ensure(
    bytes instanceof Uint8Array &&
      bytes.length >= 14 &&
      bytes.length <= 64 * 1024 * 1024,
    "GIF_LIMIT",
    "Invalid GIF size",
  );
  ensure(
    ["GIF87a", "GIF89a"].includes(text(bytes.subarray(0, 6))),
    "GIF",
    "Not a GIF",
  );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    width = v.getUint16(6, true),
    height = v.getUint16(8, true);
  ensure(
    width > 0 && height > 0 && width <= edge && height <= edge,
    "GIF_LIMIT",
    "GIF canvas exceeds import bounds",
  );
  let p = 13,
    count = 0;
  const skip = (n) => {
    ensure(p + n <= bytes.length, "GIF", "Truncated GIF block");
    p += n;
  };
  const blocks = () => {
    while (true) {
      ensure(p < bytes.length, "GIF", "Truncated GIF data");
      const n = bytes[p++];
      if (!n) break;
      skip(n);
    }
  };
  if (bytes[10] & 128) skip(3 * 2 ** ((bytes[10] & 7) + 1));
  while (p < bytes.length) {
    const block = bytes[p++];
    if (block === 59) {
      ensure(
        count > 0 && p === bytes.length,
        "GIF",
        "Empty GIF or trailing data",
      );
      return { width, height, frames: count };
    }
    if (block === 33) {
      skip(1);
      const label = bytes[p - 1];
      ensure(
        [249, 254, 255].includes(label),
        "GIF",
        "Unsupported GIF extension; export raster frames",
      );
      if (label === 249)
        ensure(
          p + 6 <= bytes.length && bytes[p] === 4 && bytes[p + 5] === 0,
          "GIF",
          "Malformed graphic control extension",
        );
      if (label === 255)
        ensure(bytes[p] === 11, "GIF", "Malformed application extension");
      blocks();
      continue;
    }
    ensure(block === 44, "GIF", "Unknown GIF block");
    ensure(p + 9 <= bytes.length, "GIF", "Truncated image descriptor");
    const x = v.getUint16(p, true),
      y = v.getUint16(p + 2, true),
      w = v.getUint16(p + 4, true),
      h = v.getUint16(p + 6, true),
      packed = bytes[p + 8];
    ensure(
      w > 0 && h > 0 && x + w <= width && y + h <= height,
      "GIF",
      "GIF frame outside canvas",
    );
    ensure(
      ++count <= frames && count * width * height <= pixels,
      "GIF_LIMIT",
      "Decoded GIF frame budget exceeded",
    );
    skip(9);
    if (packed & 128) skip(3 * 2 ** ((packed & 7) + 1));
    ensure(bytes[p] >= 2 && bytes[p] <= 8, "GIF", "Invalid LZW code size");
    skip(1);
    blocks();
  }
  ensure(false, "GIF", "Missing GIF trailer");
}

/** Produces full composited transparent PNG frames. Run untrusted imports in a bounded worker. */
export async function parseGIFSource(
  bytes,
  { encodeRGBA, limits = {}, signal } = {},
) {
  const size = inspectGIF(bytes, limits),
    gif = parseGIF(bytes),
    images = gif.frames.filter((f) => f.image);
  ensure(images.length === size.frames, "GIF", "Decoder frame count mismatch");
  const canvas = new Uint8ClampedArray(size.width * size.height * 4),
    frames = [];
  const background = gif.gct?.[gif.lsd.backgroundColorIndex] ?? [0, 0, 0];
  let prior, saved;
  const clear = (dims, transparent) => {
    for (let y = dims.top; y < dims.top + dims.height; y++)
      for (let x = dims.left; x < dims.left + dims.width; x++) {
        const i = (y * size.width + x) * 4;
        canvas.set(transparent ? [0, 0, 0, 0] : [...background, 255], i);
      }
  };
  for (const image of images) {
    signal?.throwIfAborted();
    const d = image.image.descriptor;
    ensure(
      [d.left, d.top, d.width, d.height].every(Number.isInteger) &&
        d.width > 0 &&
        d.height > 0 &&
        d.left >= 0 &&
        d.top >= 0 &&
        d.left + d.width <= size.width &&
        d.top + d.height <= size.height,
      "GIF_LIMIT",
      "Decoder dimensions differ from validated canvas",
    );
    const f = decompressFrame(image, gif.gct, true);
    ensure(
      f &&
        f.patch.length === f.dims.width * f.dims.height * 4 &&
        (f.disposalType ?? 0) <= 3,
      "GIF",
      "Invalid decoded frame",
    );
    if (!prior)
      clear(
        { top: 0, left: 0, width: size.width, height: size.height },
        f.transparentIndex !== undefined,
      );
    if (prior?.disposalType === 2)
      clear(prior.dims, prior.transparentIndex !== undefined);
    if (prior?.disposalType === 3) canvas.set(saved);
    saved = f.disposalType === 3 ? canvas.slice() : null;
    for (let y = 0; y < f.dims.height; y++)
      for (let x = 0; x < f.dims.width; x++) {
        const from = (y * f.dims.width + x) * 4,
          to = ((y + f.dims.top) * size.width + x + f.dims.left) * 4;
        if (f.patch[from + 3]) canvas.set(f.patch.subarray(from, from + 4), to);
      }
    frames.push({
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      rect: [0, 0, size.width, size.height],
      bytes: await encodeRGBA({
        width: size.width,
        height: size.height,
        data: canvas.slice(),
      }),
      duration: Math.max(20, image.gce ? image.gce.delay * 10 : 100),
    });
    prior = f;
  }
  return {
    width: size.width,
    height: size.height,
    title: "Imported animation",
    poster: frames[0].bytes,
    report: {
      format: "gif",
      issues: [],
      notes: [
        "GIF compositing and transparency preserved. Animation follows card angle by default; time playback is an explicit motion-graph choice. Delays below 20ms are clamped.",
      ],
      layerCount: 1,
    },
    layers: [
      {
        id: "animation",
        type: "image",
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        bytes: frames[0].bytes,
        ...(frames.length > 1
          ? { animation: { progress: ["input", "angle"], loop: false, frames } }
          : {}),
      },
    ],
  };
}
