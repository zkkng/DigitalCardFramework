import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture, build } from "./presentation-fixtures.mjs";
import { directoryResolver } from "../src/presentation/resolver.js";
import { createAuthoring } from "../src/presentation/authoring.js";
import { createProject } from "../src/presentation/project.js";
import {
  validateManifest,
  validateScene,
} from "../src/presentation/validate.js";
import { canonical, utf8, sha256 } from "../src/presentation/data.js";

async function host(t, files, intercept = () => false) {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(
      new URL(req.url, "http://local").pathname.slice(1),
    );
    if (intercept(p, res)) return;
    const bytes = files.get(p);
    res.writeHead(bytes ? 200 : 404);
    res.end(bytes ?? "missing");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}/`;
}
async function resign(files) {
  const index = {
    format: "digital-card-integrity",
    version: 1,
    files: await Promise.all(
      [...files]
        .filter(([p]) => p !== "integrity.json")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([path, b]) => ({
          path,
          bytes: b.length,
          sha256: await sha256(b),
        })),
    ),
  };
  const digest =
    "sha256:" +
    (await sha256(utf8("digital-card-package-v1\n" + canonical(index))));
  files.set("integrity.json", utf8(canonical({ ...index, digest })));
  return digest;
}
test("directory content closure rejects a validly hashed undeclared payload", async (t) => {
  const pkg = await build(fixture()),
    files = new Map(pkg.files);
  files.set("assets/extra.bin", new Uint8Array([1]));
  const digest = await resign(files);
  await assert.rejects(
    directoryResolver(await host(t, files), { digest }),
    /Undeclared/,
  );
});
test("directory rejects manifest/index disagreement before fetching media", async (t) => {
  const pkg = await build(fixture()),
    files = new Map(pkg.files),
    m = structuredClone(pkg.manifest);
  m.assets[0].sha256 = "f".repeat(64);
  files.set("card.json", utf8(canonical(m)));
  await resign(files);
  await assert.rejects(directoryResolver(await host(t, files)), /disagree/);
});
test("directory verifies lazy bytes, shares requests and revokes disposed resources", async (t) => {
  const pkg = await build(fixture()),
    files = new Map(pkg.files);
  let requests = 0;
  const resolver = await directoryResolver(
    await host(t, files, (p) => {
      if (p === "assets/art.png") requests++;
      return false;
    }),
    { digest: pkg.digest },
  );
  const [a, b] = await Promise.all([
    resolver.asset("art"),
    resolver.asset("art"),
  ]);
  assert.equal(a.url, b.url);
  assert.equal(requests, 1);
  resolver.dispose();
  await Promise.resolve();
  await assert.rejects(fetch(a.url));
  await assert.rejects(resolver.asset("art"), /disposed/);
  files.set(
    "assets/art.png",
    new Uint8Array(files.get("assets/art.png")).fill(0),
  );
  const bad = await directoryResolver(await host(t, files));
  await assert.rejects(bad.asset("art"), /Changed/);
  bad.dispose();
});
test("disposing directory resolver aborts an in-flight streamed asset", async (t) => {
  const pkg = await build(fixture());
  let started;
  const begun = new Promise((r) => (started = r));
  const resolver = await directoryResolver(
    await host(t, pkg.files, (p, res) => {
      if (p !== "assets/art.png") return false;
      res.writeHead(200);
      res.write(new Uint8Array([137]));
      started();
      return true;
    }),
  );
  const pending = resolver.asset("art");
  const rejected = assert.rejects(pending);
  await begun;
  resolver.dispose();
  await rejected;
});
test("creator rejects inherited importer, recipe and preset names", async () => {
  const pkg = await build(fixture()),
    creator = createAuthoring();
  for (const name of ["constructor", "toString", "__proto__"]) {
    await assert.rejects(
      creator.build({ source: { format: name } }),
      /importer/i,
    );
    await assert.rejects(
      creator.build({
        source: { format: "dcard", bytes: pkg.archive },
        effects: [{ id: name, node: "art" }],
      }),
      /recipe/i,
    );
    await assert.rejects(
      creator.build({
        source: { format: "dcard", bytes: pkg.archive },
        effects: [{ id: "preset", node: "art", parameters: { name } }],
      }),
      /preset/i,
    );
  }
});
test("batch snapshots all requests before awaiting an importer", async () => {
  const pkg = await build(fixture());
  let release;
  const wait = new Promise((r) => (release = r));
  const creator = createAuthoring({
    importers: {
      delayed: async () => {
        await wait;
        return pkg;
      },
    },
  });
  const requests = [
    { id: "first", source: { format: "delayed" } },
    { id: "second", source: { format: "delayed" } },
  ];
  const pending = creator.buildBatch(requests);
  requests[1].id = "changed";
  release();
  assert.deepEqual(
    (await pending).map((p) => p.manifest.id),
    ["first", "second"],
  );
});
test("requested identity cannot be rewritten by a transform", async () => {
  const pkg = await build(fixture());
  const creator = createAuthoring({
    transform: (p) => p.edit((p) => (p.manifest.id = "other")),
  });
  await assert.rejects(
    creator.build({
      id: "wanted",
      source: { format: "dcard", bytes: pkg.archive },
    }),
    /stable card ID/,
  );
});
test("undo restores asset bytes and failed edits cannot mutate source package", async () => {
  const pkg = await build(fixture()),
    project = createProject(pkg),
    before = pkg.files.get("assets/art.png").slice();
  assert.throws(() =>
    project.edit((p) => {
      p.assets.get("assets/art.png")[0] = 0;
      p.manifest.id = "";
    }),
  );
  assert.deepEqual(project.assets.get("assets/art.png"), before);
  assert.deepEqual(pkg.files.get("assets/art.png"), before);
  project.edit((p) => (p.assets.get("assets/art.png")[0] = 0));
  assert.equal(project.undoEdit(), true);
  assert.deepEqual(project.assets.get("assets/art.png"), before);
});
test("export captures an atomic snapshot during concurrent edits", async () => {
  const p = createProject(await build(fixture()));
  const pending = p.export();
  p.edit((p) => (p.scenes.get("scenes/front.json").nodes[0].opacity = 0.2));
  const exported = await pending;
  assert.equal(
    exported.scenes.get("scenes/front.json").nodes[0].opacity,
    undefined,
  );
});
test("numeric host defaults and bounds reject nonfinite, inverted and out-of-range values", () => {
  for (const input of [
    { type: "number", default: Infinity },
    { type: "number", default: 0, min: 2, max: 1 },
    { type: "number", default: 3, min: 0, max: 1 },
  ]) {
    const f = fixture();
    f.manifest.inputs = { "host.value": input };
    assert.throws(() => validateManifest(f.manifest));
  }
});
test("sampling modes are explicit and invalid spellings rejected", () => {
  const f = fixture(),
    s = f.scenes.get("scenes/front.json");
  s.nodes[0].sampling = "nearest";
  assert.doesNotThrow(() => validateScene(s, f.manifest));
  s.nodes[0].sampling = "near";
  assert.throws(() => validateScene(s, f.manifest), /sampling/);
});

test("poster replacement is undoable and captured media survives clean export", async () => {
  const project = createProject(await build(fixture())),
    before = project.manifest.faces.front.poster;
  await project.setPosters({
    front: new Blob([fixture().assets.get("assets/art.png")], {
      type: "image/png",
    }),
  });
  const replacement = project.manifest.faces.front.poster;
  assert.notEqual(replacement, before);
  const pkg = await project.export();
  assert(
    pkg.manifest.assets.some(
      (a) => a.id === replacement && a.role === "poster",
    ),
  );
  project.undoEdit();
  assert.equal(project.manifest.faces.front.poster, before);
});
test("unsupported isolated group compositing and ambiguous masks fail explicitly", () => {
  const f = fixture(),
    image = f.scenes.get("scenes/front.json").nodes[0];
  for (const properties of [
    { blend: "multiply" },
    { material: { kind: "foil" } },
    { mask: { asset: "art" } },
  ])
    assert.throws(
      () =>
        validateScene(
          {
            dialect: "dc.scene2d@0.1",
            nodes: [
              { id: "group", type: "group", children: [image], ...properties },
            ],
          },
          f.manifest,
        ),
      /group/i,
    );
  assert.throws(
    () =>
      validateScene(
        {
          dialect: "dc.scene2d@0.1",
          nodes: [
            {
              ...image,
              mask: {
                asset: "art",
                polygon: [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                ],
              },
            },
          ],
        },
        f.manifest,
      ),
    /one mask/,
  );
});
