import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync, deflateRawSync } from "node:zlib";
import {
  parseJSON,
  canonical,
  utf8,
  sha256,
  seededRandom,
} from "../src/presentation/data.js";
import {
  evaluate,
  validateExpression,
  selectFrame,
  normalizedInputs,
} from "../src/presentation/motion.js";
import {
  validateManifest,
  validateScene,
} from "../src/presentation/validate.js";
import {
  buildPackage,
  importPackage,
  writeZip,
  readZip,
  crc32,
} from "../src/presentation/package.js";

function png() {
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
function fixture() {
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
const build = (f) => buildPackage(f.manifest, f.scenes, f.assets);

test("canonical JSON vectors and strict parsing reject ambiguous or excessive data", () => {
  assert.equal(
    canonical(parseJSON('{"z":0,"a":1e-7,"b":1e+30,"x":-0}')),
    '{"a":1e-7,"b":1e+30,"x":0,"z":0}',
  );
  assert.equal(parseJSON(' [true, null, -2.3e2, "\\uD83D\\uDE00"] ')[3], "😀");
  for (const input of [
    '{"a":1,"a":2}',
    '{"a":{"x":1,"x":2}}',
    "[1,]",
    "01",
    "1e999",
    '"\\uD800"',
    "true false",
    '{"x":undefined}',
  ])
    assert.throws(() => parseJSON(input));
  assert.throws(() => parseJSON("[[[0]]]", { maxDepth: 1 }));
  assert.throws(() => parseJSON("[1,2,3]", { maxNodes: 2 }));
  assert.equal(
    Object.getPrototypeOf(parseJSON('{"__proto__":{"polluted":true}}')),
    null,
  );
  assert.equal({}.polluted, undefined);
});
test("ZIP round trip is deterministic; no extraction paths, links or trailing directory data", async () => {
  const files = new Map([
    ["assets/b.txt", utf8("b")],
    ["assets/a.txt", utf8("a")],
  ]);
  const zip = writeZip(files);
  assert.deepEqual(await readZip(zip), new Map([...files].sort()));
  assert.deepEqual(zip, writeZip(new Map([...files].reverse())));
  for (const path of [
    "../a",
    "a/../b",
    "a\\b",
    "/a",
    "C:/a",
    "a/%2e%2e/b",
    "CON.txt",
    "a./b",
  ])
    assert.throws(() => writeZip(new Map([[path, utf8("x")]])));
  assert.throws(() =>
    writeZip(
      new Map([
        ["A", utf8("a")],
        ["a", utf8("b")],
      ]),
    ),
  );
  const corrupt = zip.slice();
  corrupt[40] ^= 7;
  await assert.rejects(readZip(corrupt));
  const link = zip.slice(),
    view = new DataView(link.buffer);
  let p = 0;
  while (view.getUint32(p, true) !== 0x02014b50) p++;
  view.setUint32(p + 38, 0xa1ff0000, true);
  await assert.rejects(readZip(link), /Links/);
  await assert.rejects(readZip(zip, { entries: 1 }), /directory/);
  await assert.rejects(readZip(zip, { inflated: 1 }), /Inflation/);
});
test("deflate imports enforce actual output limit and reject misleading local metadata", async () => {
  const plain = utf8("x".repeat(1000)),
    compressed = new Uint8Array(deflateRawSync(plain));
  const stored = writeZip(new Map([["test.txt", plain]])),
    v = new DataView(stored.buffer);
  const nameLength = v.getUint16(26, true),
    oldCentral = 30 + nameLength + plain.length;
  const local = stored.slice(0, 30 + nameLength),
    central = stored.slice(oldCentral, stored.length - 22),
    end = stored.slice(-22);
  const lv = new DataView(local.buffer),
    cv = new DataView(central.buffer),
    ev = new DataView(end.buffer);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, compressed.length, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, compressed.length, true);
  ev.setUint32(16, local.length + compressed.length, true);
  const archive = new Uint8Array(
    Buffer.concat([local, compressed, central, end]),
  );
  assert.deepEqual((await readZip(archive)).get("test.txt"), plain);
  const forged = archive.slice(),
    fv = new DataView(forged.buffer);
  fv.setUint32(22, 5, true);
  fv.setUint32(local.length + compressed.length + 24, 5, true);
  await assert.rejects(readZip(forged));
});
test("real card export/import verifies scene/media closure and stable identity", async () => {
  const f = fixture(),
    first = await build(f),
    second = await build(f);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.archive, second.archive);
  const result = await importPackage(first.archive);
  assert.equal(result.digest, first.digest);
  assert.equal(result.scenes.size, 2);
  assert.equal(result.manifest.title, "Synthetic");
  const modified = new Map(result.files);
  modified.set("assets/art.png", utf8("malicious replacement"));
  await assert.rejects(importPackage(writeZip(modified)), /integrity/);
  f.manifest.title = "Revision";
  const revision = await build(f);
  assert.notEqual(first.digest, revision.digest);
});
test("invalid exports reject missing references, executable fields and media masquerading", async () => {
  for (const mutate of [
    (f) => (f.manifest.assets[0].sha256 = "bad"),
    (f) => (f.manifest.faces.front.poster = "missing"),
    (f) => (f.scenes.get("scenes/front.json").nodes[0].script = "alert(1)"),
    (f) => (f.scenes.get("scenes/front.json").nodes[0].asset = "missing"),
    (f) =>
      f.scenes
        .get("scenes/front.json")
        .nodes.push({ ...f.scenes.get("scenes/front.json").nodes[0] }),
    (f) =>
      (f.scenes.get("scenes/front.json").nodes[0].bindings = {
        x: ["eval", "alert(1)"],
      }),
    (f) =>
      (f.scenes.get("scenes/front.json").nodes[0].bindings = {
        "__proto__.polluted": 1,
      }),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => {
      validateManifest(f.manifest);
      validateScene(f.scenes.get("scenes/front.json"), f.manifest);
    });
  }
  const f = fixture();
  f.assets.set("assets/art.png", utf8("<script>hello</script>"));
  await assert.rejects(build(f), /PNG/);
});
test("input effects seek/reverse, graphs have quotas and seeded layouts repeat", () => {
  const expr = ["smooth", 0.1, 0.9, ["input", "angle"]];
  validateExpression(expr);
  assert.equal(evaluate(expr, { angle: 0.1 }), 0);
  assert.equal(evaluate(expr, { angle: 0.9 }), 1);
  assert.equal(evaluate(expr, { angle: 0.5 }), 0.5);
  assert.equal(evaluate(["div", 3, 0]), 0);
  assert.throws(
    () => evaluate(expr, { angle: 0.5 }, { remaining: 1 }),
    /budget/,
  );
  assert.throws(() => validateExpression(["input", "host.secret"]));
  assert.throws(() =>
    validateExpression([
      "curve",
      0,
      [
        [1, 0],
        [0, 1],
      ],
    ]),
  );
  const a = seededRandom(19),
    b = seededRandom(19);
  assert.deepEqual(
    Array.from({ length: 100 }, a),
    Array.from({ length: 100 }, b),
  );
  const frames = {
    progress: ["input", "angle"],
    frames: [
      { duration: 1, name: "a" },
      { duration: 2, name: "b" },
    ],
  };
  assert.equal(selectFrame(frames, { angle: 0 }).name, "a");
  assert.equal(selectFrame(frames, { angle: 1 }).name, "b");
  assert.equal(selectFrame(frames, { angle: 0.1 }).name, "a");
  assert.equal(normalizedInputs({ tilt: { x: 99, y: -99 } })["tilt.x"], 1);
});
test("SHA-256 published known-answer vector", async () => {
  assert.equal(
    await sha256(utf8("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
