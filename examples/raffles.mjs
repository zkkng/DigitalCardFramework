import assert from "node:assert/strict";
import { exampleFramework } from "./commerce-fixture.mjs";
let now = "2026-01-01T00:00:00Z";
const { core, buyer, operator } = exampleFramework({ clock: () => now });
const shop = core.createShop(operator, {
  key: "shop",
  kind: "admin",
  name: "Limited drops",
});
const listing = core.createListing(operator, {
  key: "drop",
  shopId: shop.id,
  title: "Limited card",
  price: { currencyId: "credits", amount: 25 },
  items: { kind: "mint-card", variantId: "aurora.holo", quantity: 1 },
  previewAt: now,
  startsAt: "2026-01-01T01:00:00Z",
  raffle: {
    entryClosesAt: "2026-01-01T02:00:00Z",
    claimSeconds: 3600,
    winners: 1,
  },
});
assert.equal(core.listings(buyer).items[0].phase, "upcoming");
now = "2026-01-01T01:00:00Z";
core.enterRaffle(buyer, { key: "entry", listingId: listing.id });
assert.equal(core.wallet(buyer).credits, 100);
now = "2026-01-01T02:00:00Z";
core.drawDueRaffles(operator);
assert.equal(core.raffleStatus(buyer, { listingId: listing.id }).winner, true);
core.buyListing(buyer, {
  ...core.quoteListing(buyer, { listingId: listing.id }),
  key: "claim",
});
assert.equal(core.wallet(buyer).credits, 75);
assert.equal(core.drawDueRaffles(operator).length, 0);
assert.equal(core.audit(operator).ok, true);
console.log(
  "Verified scheduled preview, free entry, durable draw and paid winner claim.",
);
core.close();
