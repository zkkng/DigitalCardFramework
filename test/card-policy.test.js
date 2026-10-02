import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin, code } from "./helpers.js";
import {
  resolveCardPolicy,
  validatePolicy,
  deriveStats,
  inspectCardPolicy,
} from "../src/card-policy.js";
import {
  fixture as presentationFixture,
  build,
} from "./presentation-fixtures.mjs";
import { createProject } from "../src/presentation/project.js";
import {
  addText,
  createMemoryLibrary,
  saveTemplate,
  loadTemplate,
  saveMask,
  applyMask,
  configureAuthoring,
  setStat,
} from "../src/presentation/authoring-tools.js";
import { layoutText } from "../src/presentation/text.js";

const document = (overrides = {}) => ({
  schemaVersion: 1,
  id: "cards.standard",
  revision: 1,
  name: "Standard",
  fields: [
    {
      key: "demo.power",
      label: "Power",
      type: "integer",
      required: true,
      minimum: 0,
      maximum: 100,
    },
  ],
  ...overrides,
});
const assignments = [{ scope: "installation", policy: "cards.standard@1" }];
function activate(core, doc = document()) {
  let registry = core.cardPolicies(admin);
  core.saveCardPolicy(admin, {
    key: "save-" + doc.id + "-" + doc.revision,
    expectedRevision: registry.revision,
    document: doc,
  });
  registry = core.cardPolicies(admin);
  const preview = core.previewCardPolicy(admin, {
    expectedRevision: registry.revision,
    policy: doc.id + "@" + doc.revision,
    assignments: [
      { scope: "installation", policy: doc.id + "@" + doc.revision },
    ],
  });
  return core.activateCardPolicy(admin, {
    ...preview,
    key: "activate-" + doc.id + "-" + doc.revision,
  });
}
test("reassigning a policy at a more specific scope reapplies its defaults",()=>{
  const a=document({defaults:{stats:{value:1}}}),b=document({id:"line.rules",defaults:{stats:{value:2}}});
  const result=resolveCardPolicy([a,b],[{scope:"installation",policy:"cards.standard@1"},{scope:"line",target:"line",policy:"line.rules@1"},{scope:"variant",target:"variant",policy:"cards.standard@1"}],{lineId:"line",variantId:"variant"});
  assert.equal(result.defaults.stats.value,1);
});

test("policy requirements accumulate, defaults remain editable, conflicts and cycles reject", () => {
  const base = document({ defaults: { stats: { "demo.power": 7 } } }),
    child = document({
      id: "cards.child",
      inherits: ["cards.standard@1"],
      fields: [
        {
          key: "demo.power",
          label: "Power",
          type: "integer",
          minimum: 20,
          maximum: 80,
        },
      ],
      requirements: { allowUnknownStats: false },
    });
  const effective = resolveCardPolicy(
    [base, child],
    [{ scope: "installation", policy: "cards.child@1" }],
    {},
  );
  assert.equal(effective.fields[0].required, true);
  assert.equal(effective.fields[0].minimum, 20);
  assert.equal(
    inspectCardPolicy(effective, { card: { stats: { "demo.power": 30 } } })
      .length,
    0,
  );
  assert(
    inspectCardPolicy(effective, { card: { stats: { "demo.power": 0 } } }).some(
      (i) => i.code === "STAT_VALUE",
    ),
  );
  assert.throws(
    () =>
      resolveCardPolicy(
        [
          base,
          {
            ...child,
            fields: [
              {
                key: "demo.power",
                label: "Power",
                type: "integer",
                minimum: 200,
              },
            ],
          },
        ],
        [{ scope: "installation", policy: "cards.child@1" }],
        {},
      ),
    code("POLICY_CONFLICT"),
  );
  assert.throws(
    () =>
      resolveCardPolicy(
        [{ ...base, inherits: ["cards.child@1"] }, child],
        [{ scope: "installation", policy: "cards.child@1" }],
        {},
      ),
    code("POLICY_CYCLE"),
  );
  assert.throws(
    () => validatePolicy({ ...base, execute: "script" }),
    code("POLICY_SCHEMA"),
  );
});
test("policy activation previews grandfathered cards; imports enforce stats and stale reviews", () => {
  const { core } = fixture(),
    old = core.catalog();
  activate(core);
  assert.equal(core.catalog().version, old.version);
  let base = core.operatorCatalog(admin),
    card = { ...base.cards[0], stats: { "demo.power": 101 } };
  assert.throws(
    () =>
      core.previewImport(admin, {
        source: { cards: [card] },
        expectedVersion: base.version,
      }),
    code("CARD_POLICY"),
  );
  card.stats = { "demo.power": 0 };
  const preview = core.previewImport(admin, {
    source: { cards: [card] },
    expectedVersion: base.version,
  });
  activate(
    core,
    document({
      revision: 2,
      fields: [
        {
          key: "demo.power",
          label: "Power",
          type: "integer",
          required: true,
          minimum: 1,
        },
      ],
    }),
  );
  assert.throws(
    () =>
      core.commitImport(admin, {
        ...preview,
        key: "stale",
        expectedVersion: base.version,
      }),
    code("POLICY_CHANGED"),
  );
  assert.throws(
    () =>
      core.publishCatalog(admin, {
        ...base,
        version: base.version + 1,
        cards: base.cards.map((c) => (c.id === card.id ? card : c)),
      }),
    code("CARD_POLICY"),
  );
});
test("policy administration cannot be reached by a catalog publisher or injected import section", () => {
  const { core, alice } = fixture(),
    publisher = {
      ...alice,
      permissions: ["catalog.read", "catalog.preview", "catalog.publish"],
    };
  assert.throws(
    () =>
      core.saveCardPolicy(publisher, {
        key: "no",
        expectedRevision: 0,
        document: document(),
      }),
    code("FORBIDDEN"),
  );
  assert.throws(
    () =>
      core.previewImport(publisher, {
        source: { cardPolicies: [] },
        expectedVersion: core.catalog().version,
      }),
    code("INVALID_IMPORT"),
  );
  activate(core);
  assert.throws(
    () =>
      core.saveCardPolicy(admin, {
        key: "rewrite",
        expectedRevision: core.cardPolicies(admin).revision,
        document: document({ name: "Changed" }),
      }),
    code("POLICY_IMMUTABLE"),
  );
});
test("publication retries preserve policy evidence and private stat snapshots", () => {
  const x = fixture();
  activate(
    x.core,
    document({
      fields: [
        { key: "demo.public", label: "Public", type: "integer" },
        {
          key: "demo.owner",
          label: "Owner",
          type: "string",
          visibility: "owner",
        },
        {
          key: "demo.operator",
          label: "Operator",
          type: "string",
          visibility: "operator",
        },
      ],
    }),
  );
  const base = x.core.operatorCatalog(admin),
    card = {
      ...base.cards.find((c) => c.id === "dawn"),
      stats: {
        "demo.public": 0,
        "demo.owner": "owner value",
        "demo.operator": "operator value",
      },
    };
  const preview = x.core.previewImport(admin, {
      source: { cards: [card] },
      expectedVersion: base.version,
    }),
    input = {
      ...preview,
      key: "publish-private",
      expectedVersion: base.version,
    };
  assert.deepEqual(
    x.core.commitImport(admin, input),
    x.core.commitImport(admin, input),
  );
  assert.deepEqual(x.core.catalog().cards.find((c) => c.id === "dawn").stats, {
    "demo.public": 0,
  });
  const copy = x.open("common")[0];
  assert.deepEqual(copy.definition.stats, {
    "demo.public": 0,
    "demo.owner": "owner value",
  });
  assert(!JSON.stringify(copy.cardPolicy).includes("operator value"));
  const album = x.core.saveAlbum(x.alice, {
    key: "album",
    id: "private-stats",
    name: "Public",
    visibility: "public",
    expectedVersion: 0,
    placements: [{ copyId: copy.id, page: 0, slot: 0 }],
  });
  const publicView = x.core.viewAlbum(null, album.id);
  assert(!JSON.stringify(publicView).includes("owner value"));
  assert(!JSON.stringify(publicView).includes("operator value"));
});
test("a template name alone cannot satisfy protected geometry or mask requirements", () => {
  const policy = resolveCardPolicy(
    [
      document({
        fields: [],
        requirements: { templates: ["frame.standard@1"] },
      }),
    ],
    assignments,
    {},
  );
  const presentation = {
    manifest: {
      canvas: { width: 100, height: 150 },
      assets: [{ id: "mask", sha256: "a".repeat(64) }],
      authoring: { template: "frame.standard@1" },
      faces: { front: { scene: "front" } },
    },
    scenes: {
      front: {
        nodes: [{ id: "frame", type: "image", x: 5, mask: { asset: "mask" } }],
      },
    },
  };
  const template = {
    id: "frame.standard",
    revision: 1,
    canvas: { width: 100, height: 150 },
    slots: [{ nodeId: "frame", fixed: { x: 0, mask: { asset: "mask" } } }],
    assetDigests: { mask: "a".repeat(64) },
  };
  assert(
    inspectCardPolicy(policy, {
      card: { stats: {} },
      presentation,
      templates: [template],
    }).some((i) => i.code === "TEMPLATE_FIXED"),
  );
  presentation.scenes.front.nodes[0].x = 0;
  assert.equal(
    inspectCardPolicy(policy, {
      card: { stats: {} },
      presentation,
      templates: [template],
    }).length,
    0,
  );
  presentation.manifest.assets[0].sha256 = "b".repeat(64);
  assert(
    inspectCardPolicy(policy, {
      card: { stats: {} },
      presentation,
      templates: [template],
    }).some((i) => i.code === "TEMPLATE_ASSET"),
  );
});
test("editable text, stat snapshots and reusable masks survive history and portable round trips", async () => {
  const project = createProject(await build(presentationFixture())),
    library = createMemoryLibrary(),
    side = "front";
  const id = addText(project, side, {
    text: "A long title",
    typography: { size: 32, overflow: "shrink", minSize: 12 },
  });
  configureAuthoring(project, {
    policy: {
      fields: [{ key: "demo.power", label: "Power", type: "integer" }],
      defaults: {},
    },
  });
  setStat(project, "demo.power", 0);
  const original = project.serialize();
  project.undoEdit();
  project.redoEdit();
  assert.deepEqual(project.serialize(), original);
  const node = project.scenes
    .get(project.manifest.faces.front.scene)
    .nodes.find((n) => n.id === id);
  project.edit(
    () =>
      (node.mask = {
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      }),
  );
  const mask = await saveMask(project, side, id, library, {
    id: "mask.corner",
  });
  project.edit(() => delete node.mask);
  await applyMask(project, side, id, mask);
  assert.equal(node.mask.polygon.length, 3);
  const template = await saveTemplate(project, library, {
      id: "template.basic",
    }),
    loaded = await loadTemplate(template);
  assert.equal(loaded.manifest.authoring.template, "template.basic@1");
  assert.equal(loaded.manifest.authoring.values.card["demo.power"], 0);
  assert(
    loaded.scenes
      .get(loaded.manifest.faces.front.scene)
      .nodes.some((n) => n.id === id && n.text === "A long title"),
  );
});
test("text layout wraps and shrinks without changing glyph width or accepting silent overflow", () => {
  const measure = (s, size) => Array.from(s).length * size * 0.5;
  const base = {
    width: 100,
    height: 50,
    typography: { size: 20, lineHeight: 1, overflow: "wrap" },
  };
  const result = layoutText(base, "Words wrap over several lines", measure);
  assert(result.lines.length > 1);
  assert(result.overflow);
  const fit = layoutText(
    {
      ...base,
      typography: { ...base.typography, overflow: "shrink", minSize: 5 },
    },
    "Words wrap over several lines",
    measure,
  );
  assert.equal(fit.overflow, false);
  assert(fit.size < 20 && fit.size >= 5);
});
test("calculated values resolve dependencies and reject cycles", () => {
  const fields = [
    {
      key: "demo.double",
      label: "Double",
      type: "number",
      source: "calculated",
      calculate: ["mul", ["field", "demo.base"], 2],
    },
    { key: "demo.base", label: "Base", type: "number" },
  ];
  assert.equal(deriveStats(fields, { "demo.base": 4 })["demo.double"], 8);
  assert.throws(
    () =>
      resolveCardPolicy(
        [
          document({
            fields: [{ ...fields[0], calculate: ["field", "demo.double"] }],
          }),
        ],
        assignments,
        {},
      ),
    code("POLICY_CYCLE"),
  );
});
