import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthoring,
  imagePackage,
} from "../src/presentation/authoring.js";
import { importPackage } from "../src/presentation/package.js";
import { pngRGBA } from "./presentation-fixtures.mjs";
import { fixture, admin } from "./helpers.js";
import { validateCatalog } from "../src/index.js";

const source = () => ({
  format: "image",
  mediaType: "image/png",
  bytes: pngRGBA(6, 8, new Uint8Array(6 * 8 * 4).fill(255)),
});
test("single image supports exact programmable glitter and installed replacement recipes", async () => {
  const events = [],
    creator = createAuthoring({
      onEvent: (event) => events.push(event.type),
      effects: {
        "mod.sparkle": (node, p) => ({
          ...node,
          material: { kind: "glitter", ...p },
          bindings: { "material.angle": ["input", "angle"] },
        }),
      },
    });
  const pkg = await creator.build({
    id: "single",
    title: "One image",
    source: source(),
    effects: [
      {
        id: "mod.sparkle",
        node: "art",
        parameters: {
          size: 28,
          density: 0.15,
          shape: "star",
          seed: 51,
          intensity: 2,
        },
      },
    ],
  });
  const decoded = await importPackage(pkg.archive),
    node = decoded.scenes.get("scenes/front.json").nodes[0];
  assert.equal(node.material.size, 28);
  assert.equal(node.material.shape, "star");
  assert.equal(node.bindings["material.angle"][1], "angle");
  assert.deepEqual(events, ["build.started", "build.completed"]);
  await assert.rejects(
    creator.build({
      source: source(),
      effects: [
        {
          id: "material",
          node: "art",
          parameters: { kind: "glitter", density: 2 },
        },
      ],
    }),
    /range/,
  );
});
test("headless pack publication uses real catalog validation and acquisition without a browser", async () => {
  const x = fixture(),
    catalog = structuredClone(x.c);
  catalog.version++;
  const published = [],
    creator = createAuthoring({
      validateCatalog,
      publish: async (pkg) => {
        published.push(pkg.digest);
        return {
          contract: "digital-card@0.1",
          digest: pkg.digest,
          baseURL: "https://assets.example/" + pkg.digest.slice(7) + "/",
        };
      },
      commitCatalog: async (catalog) => x.core.publishCatalog(admin, catalog),
      onEvent: () => {
        throw Error("Broken analytics");
      },
    });
  const result = await creator.publishPack({
    key: "line-v2",
    catalog,
    cards: [
      {
        id: "dawn",
        source: source(),
        effects: [
          {
            id: "preset",
            node: "art",
            parameters: { name: "Chunky holo", size: 24 },
          },
        ],
      },
    ],
  });
  assert.equal(published.length, 1);
  assert.equal(x.open()[0].definition.presentation.digest, result.digests[0]);
  const bad = structuredClone(catalog);
  bad.products[0].slots[0].pool[0].variantId = "missing";
  await assert.rejects(
    creator.publishPack({
      key: "bad",
      catalog: bad,
      cards: [{ id: "dawn", source: source() }],
    }),
  );
  assert.equal(published.length, 1);
});
test("batch IDs, cancellation and publisher integrity fail before catalog commit", async () => {
  let committed = false;
  const creator = createAuthoring({
    publish: async () => ({
      contract: "digital-card@0.1",
      digest: "sha256:" + "a".repeat(64),
      baseURL: "https://example.test/",
    }),
    commitCatalog: async () => (committed = true),
  });
  await assert.rejects(
    creator.buildBatch([
      { id: "same", source: source() },
      { id: "same", source: source() },
    ]),
    /unique/,
  );
  await assert.rejects(
    creator.build({ source: source() }, { signal: AbortSignal.abort() }),
  );
  await assert.rejects(
    creator.publishPack({
      key: "test",
      cards: [{ id: "one", source: source() }],
      catalog: { cards: [{ id: "one" }] },
    }),
    /different card digest/,
  );
  assert.equal(committed, false);
});
