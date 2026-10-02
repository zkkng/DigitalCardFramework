import assert from "node:assert/strict";
import { CardFramework } from "../src/index.js";
import { resolveCardPolicy, inspectCardPolicy } from "../src/card-policy.js";
import { sampleCatalog } from "./catalog.js";
const museum = {
  schemaVersion: 1,
  id: "museum.postcards",
  revision: 1,
  name: "Museum postcards",
  defaults: { stats: { "museum.year": 2026 } },
  fields: [
    {
      key: "museum.year",
      label: "Year acquired",
      type: "integer",
      minimum: 1800,
      maximum: 2200,
    },
  ],
  requirements: {},
};
const permissive = resolveCardPolicy(
  [museum],
  [{ scope: "installation", policy: "museum.postcards@1" }],
  {},
);
assert.equal(
  inspectCardPolicy(permissive, { card: { stats: { "museum.year": 2026 } } })
    .length,
  0,
);
const framework = new CardFramework(),
  admin = { role: "admin" };
try {
  framework.publishCatalog(admin, structuredClone(sampleCatalog));
  const document = {
    ...museum,
    fields: museum.fields.map((f) => ({ ...f, required: true })),
  };
  framework.saveCardPolicy(admin, {
    key: "save",
    expectedRevision: 0,
    document,
  });
  const impact = framework.previewCardPolicy(admin, {
    expectedRevision: 1,
    policy: "museum.postcards@1",
    assignments: [{ scope: "installation", policy: "museum.postcards@1" }],
  });
  framework.activateCardPolicy(admin, { ...impact, key: "activate" });
  const base = framework.operatorCatalog(admin),
    card = base.cards[0];
  assert.throws(
    () =>
      framework.previewImport(admin, {
        expectedVersion: base.version,
        source: { cards: [{ ...card, stats: { "museum.year": 0 } }] },
      }),
    (e) => e.code === "CARD_POLICY",
  );
  const reviewed = framework.previewImport(admin, {
    expectedVersion: base.version,
    source: { cards: [{ ...card, stats: { "museum.year": 2026 } }] },
  });
  framework.saveCardPolicy(admin, {
    key: "draft-next",
    expectedRevision: 2,
    document: { ...document, revision: 2 },
  });
  assert.throws(
    () => framework.commitImport(admin, { ...reviewed, key: "stale" }),
    (e) => e.code === "POLICY_CHANGED",
  );
  const current = framework.previewImport(admin, {
    expectedVersion: base.version,
    source: { cards: [{ ...card, stats: { "museum.year": 2026 } }] },
  });
  const receipt = framework.commitImport(admin, { ...current, key: "publish" });
  assert.deepEqual(
    framework.commitImport(admin, { ...current, key: "publish" }),
    receipt,
  );
  console.log(
    "Policy defaults, strict publication, stale review and idempotent retry verified.",
  );
} finally {
  framework.close();
}
