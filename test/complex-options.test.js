import test from "node:test";
import assert from "node:assert/strict";
import { fixture, pngRGBA, png } from "./presentation-fixtures.mjs";
import {
  analyzePerformance,
  enforcePerformance,
  createAlbumMotion,
  createAuthoring,
} from "../src/presentation/index.js";
import { inspectGIF, parseGIFSource } from "../src/presentation/gif-source.js";
import { layeredPackage } from "../src/presentation/layered-package.js";
import { validateScene } from "../src/presentation/validate.js";
import { encodePNG } from "../src/presentation/png-encode.js";
import { inflateSync } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import { sceneSchema } from "../src/presentation/schema.js";

test("performance defaults warn, locate exact layers and never reject a costly valid card", () => {
  const p = fixture();
  p.manifest.assets.find((a) => a.id === "art").bytes = 9 * 1024 * 1024;
  const report = analyzePerformance(p);
  assert.equal(report.accepted, true);
  const warning = report.issues.find((i) => i.code === "LAYER_DOWNLOAD");
  assert.ok(warning.layerId);
  assert.ok(warning.path);
  assert.ok(warning.assetIds.includes("art"));
  assert.ok(warning.remedy);
  assert.equal(enforcePerformance(report), report);
  assert.throws(
    () => enforcePerformance(analyzePerformance(p, { mode: "reject" })),
    { code: "PERFORMANCE_POLICY" },
  );
  assert.equal(analyzePerformance(p, { mode: "off" }).issues.length, 0);
});
test("performance report deduplicates shared textures while identifying every expensive draw", () => {
  const p = fixture(),
    scene = p.scenes.get(p.manifest.faces.front.scene);
  scene.nodes = Array.from({ length: 50 }, (_, i) => ({
    ...scene.nodes[0],
    id: "layer-" + i,
  }));
  const report = analyzePerformance(p);
  assert.equal(report.faces.front.estimatedTextureBytes, 16);
  assert.equal(
    report.issues.filter((i) => i.face === "front" && i.code === "FACE_LAYERS")
      .length,
    50,
  );
  for (const config of [
    { mode: "oops" },
    { drawLayers: -1 },
    { layerTextureBytes: NaN },
    { arbitrary: 1 },
  ])
    assert.throws(() => analyzePerformance(p, config));
});
test("automated authoring emits performance report and honors host rejection policy", async () => {
  const events = [],
    authoring = createAuthoring({
      performance: { layerDownloadBytes: 1 },
      onEvent: (e) => events.push(e),
    });
  const result = await authoring.build({
    source: { bytes: png(), mediaType: "image/png" },
  });
  assert.ok(result.performance.issues.length);
  assert.ok(events.at(-1).performance);
  await assert.rejects(
    createAuthoring({
      performance: { layerDownloadBytes: 1, mode: "reject" },
    }).build({ source: { bytes: png(), mediaType: "image/png" } }),
    { code: "PERFORMANCE_POLICY" },
  );
});
test("album defaults independent, groups synchronize selectively and limits remain per member", () => {
  const motion = createAlbumMotion({
    members: [
      { id: "a", motion: { syncGroup: "pair" } },
      {
        id: "b",
        motion: {
          syncGroup: "pair",
          scale: [-1, 1],
          limits: { x: [-0.3, 0.3], y: [-0.5, 0.5] },
        },
      },
      { id: "c" },
    ],
  });
  motion.setInputs("a", { tilt: { x: 1, y: -1 } });
  const s = motion.snapshot();
  assert.equal(s.a.tilt.x, 1);
  assert.equal(s.b.tilt.x, -0.3);
  assert.equal(s.b.tilt.y, -0.5);
  assert.equal(s.c.tilt.x, 0);
  assert.equal(s.b.rotation.y, -3.5999999999999996);
  s.a.tilt.x = 10;
  assert.equal(motion.snapshot().a.tilt.x, 1);
  assert.throws(() => motion.setInputs("a", { tilt: { x: Infinity } }));
  motion.dispose();
  motion.setInputs("a", { tilt: { x: 1 } });
  assert.deepEqual(motion.snapshot(), {});
});
test("album motion can be disabled, host driven, and validates limits before mounting", () => {
  const m = createAlbumMotion({
    defaults: { enabled: false },
    members: [
      { id: "a" },
      { id: "b", motion: { enabled: true, maxRotation: [0, 0] } },
    ],
  });
  m.setAll({ tilt: { x: 0.8 } });
  assert.equal(m.snapshot().a.tilt.x, 0);
  assert.equal(m.snapshot().b.rotation.y, 0);
  for (const motion of [
    { maxRotation: [90, 1] },
    { limits: { x: [1, -1], y: [-1, 1] } },
    { scale: [NaN, 1] },
  ])
    assert.throws(() => createAlbumMotion({ members: [{ id: "a", motion }] }));
});

for (const disposal of [1, 2, 3])
  test(
    "transparent GIF compositing preserves disposal " +
      disposal +
      " and exports portable frames",
    async () => {
      const decoded = [];
      const doc = await parseGIFSource(gifFixture(disposal), {
        encodeRGBA: async (b) => {
          decoded.push([...b.data]);
          return pngRGBA(b.width, b.height, b.data);
        },
      });
      assert.deepEqual(decoded[0], [255, 0, 0, 255, 0, 0, 0, 0]);
      assert.deepEqual(decoded[1], [255, 0, 0, 255, 0, 255, 0, 255]);
      assert.deepEqual(
        decoded[2],
        disposal === 1
          ? decoded[1]
          : disposal === 2
            ? Array(8).fill(0)
            : decoded[0],
      );
      const pkg = await layeredPackage(doc, { poster: doc.poster });
      const animation = pkg.scenes.get(pkg.manifest.faces.front.scene).nodes[0]
        .animation;
      assert.equal(animation.frames.length, 3);
      assert.equal(animation.frames[0].duration, 50);
      assert.deepEqual(animation.progress, ["input", "angle"]);
    },
  );
test("GIF limits run before decoding; truncated, excessive and malformed input rejected", () => {
  const bytes = gifFixture();
  assert.equal(inspectGIF(bytes).frames, 3);
  assert.throws(() => inspectGIF(bytes, { frames: 2 }), { code: "GIF_LIMIT" });
  assert.throws(() => inspectGIF(bytes, { pixels: 5 }), { code: "GIF_LIMIT" });
  for (let i = 0; i < bytes.length; i++)
    assert.throws(() => inspectGIF(bytes.subarray(0, i)));
});
test("custom colored glitter and host effect recipes work on a single flat image", async () => {
  const api = createAuthoring({
    effects: {
      "example.sparkles": (node, p) => ({
        ...node,
        material: {
          kind: "glitter",
          shape: "star",
          size: p.size,
          flakeAsset: "front",
          flakeColor: "texture",
        },
      }),
    },
  });
  const pkg = await api.build({
    source: { bytes: png(), mediaType: "image/png" },
    effects: [
      { id: "example.sparkles", node: "art", parameters: { size: 25 } },
    ],
  });
  const scene = pkg.scenes.get(pkg.manifest.faces.front.scene);
  validateScene(scene, pkg.manifest);
  const schemaCheck = new Ajv2020({strict: true}).compile(sceneSchema);
  assert.equal(schemaCheck(scene), true, JSON.stringify(schemaCheck.errors));
  assert.equal(scene.nodes[0].material.size, 25);
  scene.nodes[0].material.flakeColor = "eval";
  assert.throws(() => validateScene(scene, pkg.manifest));
});

import { gifFixture } from "./gif-fixture.mjs";

test("canvas-independent PNG encoder retains exact RGBA with and without CompressionStream", async () => {
  const saved = globalThis.CompressionStream;
  try {
    for (const compression of [saved, undefined]) {
      globalThis.CompressionStream = compression;
      const data = new Uint8Array([255, 1, 2, 255, 8, 9, 10, 0]),
        bytes = await encodePNG({ width: 2, height: 1, data });
      let at = 8,
        payload;
      while (at < bytes.length) {
        const length = new DataView(
          bytes.buffer,
          bytes.byteOffset + at,
          4,
        ).getUint32(0);
        if (Buffer.from(bytes.subarray(at + 4, at + 8)).toString() === "IDAT")
          payload = bytes.subarray(at + 8, at + 8 + length);
        at += length + 12;
      }
      assert.deepEqual([...inflateSync(payload)], [0, ...data]);
    }
  } finally {
    globalThis.CompressionStream = saved;
  }
});
