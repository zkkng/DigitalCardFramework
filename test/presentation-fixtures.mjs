import { deflateSync } from "node:zlib";
import { crc32, buildPackage } from "../src/presentation/package.js";
export function pngRGBA(width, height, data) {
  const chunk = (name, payload) => {
      const buffer = Buffer.alloc(12 + payload.length);
      buffer.writeUInt32BE(payload.length);
      buffer.write(name, 4);
      buffer.set(payload, 8);
      buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
      return buffer;
    },
    header = Buffer.alloc(13),
    rows = Buffer.alloc(height * (1 + width * 4));
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  for (let y = 0; y < height; y++)
    rows.set(
      data.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
export function png() {
  const chunk = (name, payload) => {
    const buffer = Buffer.alloc(12 + payload.length);
    buffer.writeUInt32BE(payload.length);
    buffer.write(name, 4);
    buffer.set(payload, 8);
    buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
    return buffer;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk(
        "IDAT",
        deflateSync(
          Buffer.from([
            0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
            255,
          ]),
        ),
      ),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
export function fixture() {
  const bytes = png();
  const assets = ["front", "back", "art"].map((id) => ({
    id,
    path: `assets/${id}.png`,
    mediaType: "image/png",
    sha256: "0".repeat(64),
    bytes: bytes.length,
    width: 2,
    height: 2,
    role: id === "art" ? "color" : "poster",
  }));
  const manifest = {
    format: "digital-card",
    contractVersion: "0.1.0",
    id: "synthetic.card",
    revision: 1,
    title: "Synthetic",
    summary: "Generated test fixture",
    profile: "portable",
    canvas: { width: 1000, height: 1500 },
    faces: {
      front: {
        scene: "scenes/front.json",
        poster: "front",
        description: "Front",
      },
      back: { scene: "scenes/back.json", poster: "back", description: "Back" },
    },
    assets,
    capabilities: { required: ["dc.scene2d@0.1"], optional: [] },
    quality: { poster: { maxEdge: 500 }, lite: { maxEdge: 768 } },
  };
  const scene = {
    dialect: "dc.scene2d@0.1",
    nodes: [
      {
        id: "art",
        type: "image",
        asset: "art",
        x: 0,
        y: 0,
        width: 1000,
        height: 1500,
        bindings: { rotation: ["mul", ["input", "tilt.x"], 12] },
      },
    ],
  };
  return {
    manifest,
    scenes: new Map([
      ["scenes/front.json", scene],
      ["scenes/back.json", structuredClone(scene)],
    ]),
    assets: new Map(assets.map((a) => [a.path, bytes])),
  };
}
export const build = (f) => buildPackage(f.manifest, f.scenes, f.assets);
