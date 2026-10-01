import test from "node:test";
import assert from "node:assert/strict";
import { writePsd } from "../src/presentation/node_modules/ag-psd/dist/index.js";
import { parseLayeredSource } from "../src/presentation/layered-source.js";
import { layeredPackage } from "../src/presentation/layered-package.js";
import { writeZip, importPackage } from "../src/presentation/package.js";
import { utf8 } from "../src/presentation/data.js";
import { pngRGBA } from "./presentation-fixtures.mjs";
const bitmap = (w, h, color) => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(
    Array.from({ length: w * h }, () => color).flat(),
  ),
});
const encodeRGBA = async (image) =>
  pngRGBA(image.width, image.height, image.data);
import { sourceFixtures } from "./presentation-layered-fixtures.mjs";
test("PSD, OpenRaster and layer ZIP preserve placement, dimensions, order and opacity", async () => {
  for (const [key, bytes] of Object.entries(sourceFixtures())) {
    const doc = await parseLayeredSource(bytes, {
      format: key === "zip" ? "layer-zip" : key,
      encodeRGBA,
    });
    assert.equal(doc.width, 6);
    assert.equal(doc.height, 8);
    assert.equal(doc.layers.length, 2);
    assert.equal(doc.layers[0].name, "Background");
    assert.equal(doc.layers[1].x, 3);
    assert.equal(doc.layers[1].y, 4);
    assert.equal(doc.report.issues.length, 0);
    if (key !== "zip")
      assert.equal(doc.layers[1].opacity, key === "psd" ? 128 / 255 : 0.5);
    else assert.equal(doc.layers[1].material.kind, "glitter");
    const pkg = await layeredPackage(doc, { poster: doc.merged });
    assert.equal(
      (await importPackage(pkg.archive)).scenes.get("scenes/front.json").nodes
        .length,
      2,
    );
  }
});
test("layered sources reject DTDs, traversal, oversized decode and unsupported PSD bit depth", async () => {
  const fixtures = sourceFixtures();
  await assert.rejects(
    parseLayeredSource(fixtures.psd, {
      format: "psd",
      encodeRGBA,
      limits: { pixels: 1 },
    }),
    /budget/,
  );
  const bad = fixtures.psd.slice();
  new DataView(bad.buffer).setUint16(22, 16);
  await assert.rejects(
    parseLayeredSource(bad, { format: "psd", encodeRGBA }),
    /8-bit/,
  );
  const ora = writeZip(
    new Map([
      ["mimetype", utf8("image/openraster")],
      [
        "stack.xml",
        utf8(
          '<!DOCTYPE image [<!ENTITY x SYSTEM "file:///secret">]><image w="6" h="8"><stack/></image>',
        ),
      ],
    ]),
  );
  await assert.rejects(
    parseLayeredSource(ora, { format: "ora", encodeRGBA }),
    /entities/,
  );
});
