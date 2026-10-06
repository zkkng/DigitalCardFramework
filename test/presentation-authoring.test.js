import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthoring,
  imagePackage,
} from "../src/presentation/authoring.js";
import { importPackage } from "../src/presentation/package.js";
import { pngRGBA, fixture as presentationFixture, build } from "./presentation-fixtures.mjs";
import { fixture, admin } from "./helpers.js";
import { validateCatalog } from "../src/index.js";
import { createProject } from "../src/presentation/project.js";
import { addStatBlock, configureAuthoring, setStat } from "../src/presentation/authoring-tools.js";
import { textValue, inspectFont } from "../src/presentation/text.js";
import { testFont } from "./font-fixture.mjs";

test("font inspection reports decoded face metrics and declared terms survive export", async () => {
  const plain = inspectFont(testFont(),"font/ttf").info;
  assert.equal(plain.weight,undefined);
  assert.equal(plain.style,"normal");
  for (const style of ["italic","oblique"]) {
    const info = inspectFont(testFont({weight:700,style}),"font/ttf").info;
    assert.equal(info.weight,700);
    assert.equal(info.style,style);
    assert.equal(info.glyphs,2);
    assert.equal(info.codepoints.length,256);
  }
  const project = createProject(await build(presentationFixture())),
    asset = await project.addFont(new Blob([testFont()],{type:"font/ttf"}),{license:"Fixture embedding terms"});
  const restored = await importPackage((await project.export({retainSources:true})).archive);
  assert.equal(restored.manifest.assets.find(a=>a.id===asset.id).font.license,"Fixture embedding terms");
  assert.equal(restored.manifest.assets.find(a=>a.id===asset.id).sha256,asset.sha256);
});

test("mask inversion rejects truthy strings and preserves the previous mask", async () => {
  const project = createProject(await build(presentationFixture())),
    node = project.scenes.get(project.manifest.faces.front.scene).nodes[0],
    before = project.serialize();
  assert.throws(() => project.edit(() => { node.mask = {polygon:[[0,0],[1,0],[1,1]],invert:"false"}; }),
    error=>error.code === "MASK");
  assert.deepEqual(project.serialize(), before);
  project.edit(p=>{p.scenes.get(p.manifest.faces.front.scene).nodes[0].mask={polygon:[[0,0],[1,0],[1,1]],invert:false};});
  const restored = await importPackage((await project.export()).archive);
  assert.equal(restored.scenes.get(project.manifest.faces.front.scene).nodes[0].mask.invert,false);
});

test("stat blocks resolve explicit scopes and reject ambiguous or private fields before editing", async () => {
  const project = createProject(await build(presentationFixture()));
  configureAuthoring(project, { policy: { defaults: {}, fields: [
    { key: "score", label: "Card score", type: "integer", scope: "card" },
    { key: "score", label: "Variant score", type: "integer", scope: "variant" },
    { key: "secret", label: "Private score", type: "integer", visibility: "owner" },
  ] } });
  setStat(project, "score", 0, "card");
  setStat(project, "score", 57, "variant");
  const original = project.serialize();
  assert.throws(() => addStatBlock(project, "front", ["score"]), /one scope/);
  assert.throws(() => addStatBlock(project, "front", [null]), (error) => error.code === "STAT");
  assert.throws(() => addStatBlock(project, "front", [{ key: "score", scope: "variant" }, "secret"]), /public snapshot/);
  assert.deepEqual(project.serialize(), original);
  const ids = addStatBlock(project, "front", [
    { key: "score", scope: "card" }, { key: "score", scope: "variant" },
  ]);
  const scene = project.scenes.get(project.manifest.faces.front.scene);
  const nodes = ids.map((id) => scene.nodes.find((node) => node.id === id));
  assert.equal(textValue(nodes[0], project.manifest), "Card score 0");
  assert.equal(textValue(nodes[1], project.manifest), "Variant score 57");
  const decoded = await importPackage((await project.export()).archive);
  assert.deepEqual(decoded.scenes.get(project.manifest.faces.front.scene).nodes.slice(-2).map((n) => n.stat.scope), ["card", "variant"]);
});

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
