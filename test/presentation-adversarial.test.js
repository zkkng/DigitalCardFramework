import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectGLB,
  inspectLottie,
  inspectDotLottie,
} from "../src/presentation/advanced-media.js";
import {
  writeZip,
  readZip,
  importPackage,
} from "../src/presentation/package.js";
import { utf8 } from "../src/presentation/data.js";
import { build, fixture, pngRGBA } from "./presentation-fixtures.mjs";
function glb(json, bin) {
  const j = utf8(JSON.stringify(json)),
    p = new Uint8Array(Math.ceil(j.length / 4) * 4).fill(32);
  p.set(j);
  const b = new Uint8Array(20 + p.length + (bin ? 8 + bin.length : 0)),
    v = new DataView(b.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, b.length, true);
  v.setUint32(12, p.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  b.set(p, 20);
  if (bin) {
    v.setUint32(20 + p.length, bin.length, true);
    v.setUint32(24 + p.length, 0x004e4942, true);
    b.set(bin, 28 + p.length);
  }
  return b;
}
const animation = () => ({
  v: "5.7.0",
  w: 16,
  h: 16,
  ip: 0,
  op: 30,
  fr: 30,
  layers: [],
});
test("GLB closure validates binary ranges, tree cycles, shared parents and embedded image dimensions", () => {
  assert.doesNotThrow(() =>
    inspectGLB(
      glb({ asset: { version: "2.0" }, nodes: [{ children: [1] }, {}] }),
    ),
  );
  for (const json of [
    { buffers: [{ byteLength: 128 }] },
    {
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 2, byteLength: 4 }],
    },
    { nodes: [{ children: [0] }] },
    { nodes: [{ children: [1] }, { children: [0] }] },
    { nodes: [{ children: [2] }, { children: [2] }, {}] },
    { nodes: [{ children: [99] }] },
    {
      nodes: Array.from({ length: 66 }, (_, i) =>
        i ? { children: [i - 1] } : {},
      ),
    },
    { images: [{ uri: "https://evil.invalid/image.png" }] },
    {
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteLength: 4 }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
    },
    { extensionsRequired: ["KHR_interactivity"] },
  ])
    assert.throws(() =>
      inspectGLB(
        glb({ asset: { version: "2.0" }, ...json }, new Uint8Array(4)),
      ),
    );
});
test("passive animation rejects external fonts, expression code and excessive inline images", () => {
  for (const payload of [
    { fonts: { list: [{ fPath: "https://evil.invalid/font.woff" }] } },
    { layers: [{ x: "alert(1)" }] },
    { assets: [{ u: "https://evil.invalid/", p: "image.png" }] },
  ])
    assert.throws(() => inspectLottie({ ...animation(), ...payload }));
  const png = pngRGBA(1, 1, new Uint8Array(4));
  new DataView(png.buffer).setUint32(16, 20000);
  assert.throws(
    () =>
      inspectLottie({
        ...animation(),
        assets: [
          { p: "data:image/png;base64," + Buffer.from(png).toString("base64") },
        ],
      }),
    /dimensions/,
  );
  assert.doesNotThrow(() => inspectLottie(animation()));
});
test("dotLottie rejects duplicate IDs and undeclared payloads", async () => {
  const make = (manifest, extra = []) =>
    writeZip(
      new Map([
        ["manifest.json", utf8(JSON.stringify(manifest))],
        ["a/main.json", utf8(JSON.stringify(animation()))],
        ...extra,
      ]),
    );
  await assert.rejects(
    inspectDotLottie(
      make({ animations: [{ id: "main" }, { id: "main" }] }),
      readZip,
    ),
    /Duplicate/,
  );
  await assert.rejects(
    inspectDotLottie(
      make({ animations: [{ id: "main" }] }, [["run.js", utf8("alert(1)")]]),
      readZip,
    ),
    /Undeclared/,
  );
});
test("seeded archive corruption corpus rejects every mutation without hanging", async () => {
  const pkg = await build(fixture());
  let seed = 0x5eed1234;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  // Damage local-file payload, where every changed byte is CRC/hash-covered.
  const archive = pkg.archive,
    view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true),
    size = view.getUint32(18, true);
  for (let i = 0; i < 128; i++) {
    const copy = archive.slice();
    copy[start + (random() % size)] ^= 1 + (random() % 255);
    await assert.rejects(importPackage(copy));
  }
});
