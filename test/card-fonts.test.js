import test from "node:test";
import assert from "node:assert/strict";
import { testFont } from "./font-fixture.mjs";
import {
  inspectFont,
  fontMeasure,
  fontDiagnostics,
  layoutText,
} from "../src/presentation/text.js";
import { fixture, admin, code } from "./helpers.js";
import { fixture as artFixture, build } from "./presentation-fixtures.mjs";
import { createProject } from "../src/presentation/project.js";
import { addText } from "../src/presentation/authoring-tools.js";

test("custom fonts are parsed, measured and checked for glyph coverage before publication", async () => {
  const bytes = testFont(),
    { font, info } = inspectFont(bytes, "font/ttf");
  assert.equal(info.family, "Test Sans");
  assert.equal(fontMeasure(font, {})("AB", 20), 24);
  assert.equal(fontDiagnostics(font, { id: "label" }, "ABC").length, 0);
  assert.equal(fontDiagnostics(font, { id: "label" }, "雪").length, 1);
  assert.throws(() => inspectFont(bytes, "font/woff2"), code("FONT"));
  const project = createProject(await build(artFixture())),
    asset = await project.addFont(new Blob([bytes], { type: "font/ttf" }));
  const id = addText(project, "front", {
    text: "Long text beyond the permitted region",
    width: 40,
    height: 20,
    typography: { fontAsset: asset.id, size: 20, overflow: "wrap" },
  });
  const pkg = await project.export();
  assert(pkg.manifest.assets.some((a) => a.id === asset.id));
  const { core } = fixture(),
    registration = await core.registerCardPresentation(admin, pkg.archive);
  assert.equal(registration.digest, pkg.digest);
  assert(
    registration.textIssues.some(
      (i) => i.nodeId === id && i.code === "TEXT_OVERFLOW",
    ),
  );
  const doc = {
    schemaVersion: 1,
    id: "font.rules",
    revision: 1,
    name: "Fonts",
    fields: [],
    requirements: { rejectOverflow: true, embeddedFonts: true },
  };
  core.saveCardPolicy(admin, {
    key: "save",
    expectedRevision: 0,
    document: doc,
  });
  const reviewed = core.previewCardPolicy(admin, {
    expectedRevision: 1,
    policy: "font.rules@1",
    assignments: [{ scope: "installation", policy: "font.rules@1" }],
  });
  core.activateCardPolicy(admin, { ...reviewed, key: "activate" });
  const c = core.operatorCatalog(admin),
    card = {
      ...c.cards[0],
      presentation: {
        contract: "digital-card@0.1",
        digest: pkg.digest,
        baseURL: "https://assets.example/",
      },
    };
  assert.throws(
    () =>
      core.previewImport(admin, {
        source: { cards: [card] },
        expectedVersion: c.version,
      }),
    code("CARD_POLICY"),
  );
});
