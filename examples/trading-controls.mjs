import assert from "node:assert/strict";
import { exampleFramework } from "./commerce-fixture.mjs";
const contexts = [];
const { core, seller, buyer, operator } = exampleFramework({
  policies: {
    canTransfer: (copy, ownerId, context) => {
      contexts.push(context);
      return true;
    },
    canTrade: (offer) => offer.give.copyIds.length <= 2,
  },
});
const bought = core.purchase(seller, {
    ...core.quote(seller, { productId: "example.pack" }),
    key: "buy",
  }),
  copy = core.openPack(seller, { key: "open", packId: bought.packs[0].id })
    .cards[0];
const offer = (key) =>
  core.proposeTrade(seller, {
    key,
    toUserId: buyer.userId,
    give: { copyIds: [copy.id], currencies: [] },
    receive: { copyIds: [], currencies: [] },
  });
core.configureTrading(operator, {
  key: "rules",
  expectedRevision: 0,
  policy: {
    rules: [
      {
        id: "landscape-hold",
        decision: "deny",
        reason: "Landscape transfers are paused",
        match: { tags: ["landscape"] },
        channels: ["trade", "sale"],
      },
    ],
  },
});
assert.throws(
  () => offer("blocked"),
  (error) => error.code === "TRANSFER_BLOCKED",
);
core.configureTrading(operator, {
  key: "clear",
  expectedRevision: 1,
  policy: { maxCardsPerSide: 2, maxExpirySeconds: 3600 },
});
core.setCardTransferLock(operator, {
  key: "lock",
  copyId: copy.id,
  reason: "Review in progress",
});
assert.throws(
  () => offer("locked"),
  (error) => error.code === "TRANSFER_BLOCKED",
);
core.setCardTransferLock(operator, {
  key: "unlock",
  copyId: copy.id,
  locked: false,
});
const trade = offer("allowed");
core.acceptTrade(buyer, { key: "accept", tradeId: trade.id });
assert(contexts.some((context) => context.toUserId === buyer.userId));
assert.equal(core.audit(operator).ok, true);
console.log(
  "Verified category policy, individual lock, contextual hooks and completed transfer.",
);
core.close();
