import test from "node:test";
import assert from "node:assert/strict";
import { surfaceResolution } from "../src/presentation/resolution.js";
test("native density, pinch zoom and fractional layout use independent physical axes", () => {
  const base = { width: 362, height: 266, deviceDpr: 3 };
  assert.equal(surfaceResolution(base).width, 1086);
  assert.equal(surfaceResolution({ ...base, zoom: 3 }).width, 3258);
  const fractional = surfaceResolution({
    width: 177.3,
    height: 266.2,
    deviceDpr: 1.25,
  });
  assert.equal(fractional.width, 221);
  assert.equal(fractional.height, 332);
  assert.notEqual(fractional.scaleX, fractional.scaleY);
});
test("pixel, memory, zoom and hardware limits are bounded and recover when constraints are removed", () => {
  const base = { width: 362, height: 266, deviceDpr: 3, zoom: 3 };
  for (const extra of [
    { maxPixels: 100000 },
    { availableBytes: 400000 },
    { maxDimension: 256 },
  ]) {
    const r = surfaceResolution({ ...base, ...extra });
    assert(r.limited);
    if (extra.maxDimension) assert(Math.max(r.width, r.height) <= 256);
    else assert(r.width * r.height <= 100000);
  }
  assert.equal(surfaceResolution(base).width, 3258);
  assert.equal(surfaceResolution({ ...base, zoom: 100 }).width, 3258);
  assert.equal(
    surfaceResolution({ ...base, deviceDpr: 0, zoom: 0 }).width,
    362,
  );
});

test("reference host serves the resolution dependency used by the player", async () => {
  const { serveReference } = await import("../src/static.js");
  let body = "";
  assert.equal(
    await serveReference(
      { url: "/src/presentation/resolution.js", method: "GET" },
      {
        setHeader() {},
        end(value) {
          body = String(value);
        },
      },
    ),
    true,
  );
  assert.match(body, /export function surfaceResolution/);
});
