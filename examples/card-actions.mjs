import assert from "node:assert/strict";
import { exampleFramework } from "./commerce-fixture.mjs";
// Synthetic provider. A real remote service must persist its deduplication records.
const delivered = new Map();
const { core, buyer, operator } = exampleFramework({
  configureCatalog(catalog) {
    catalog.cards.find((c) => c.id === "dawn").type = "reward";
    catalog.variants.find((v) => v.id === "dawn.standard").onOpen = [
      {
        id: "badge",
        handler: "example.unlock",
        params: { sku: "welcome-badge" },
      },
    ];
  },
  actionHandlers: {
    "example.unlock": async ({ idempotencyKey, userId, params, signal }) => {
      if (signal.aborted) throw Error("Canceled");
      if (!delivered.has(idempotencyKey))
        delivered.set(idempotencyKey, { account: userId, sku: params.sku });
    },
  },
});
const bought = core.purchase(buyer, {
  ...core.quote(buyer, { productId: "example.pack" }),
  key: "buy",
});
core.openPack(buyer, { key: "open", packId: bought.packs[0].id });
core.openPack(buyer, { key: "replay", packId: bought.packs[0].id });
assert.equal(delivered.size, 0);
await core.dispatchActions(operator);
assert.equal(delivered.size, 1);
assert.equal(core.fulfillments(buyer).items[0].status, "succeeded");
assert.equal(core.audit(operator).ok, true);
console.log(
  "Verified code-free account reward, durable delivery and opening replay.",
);
core.close();
