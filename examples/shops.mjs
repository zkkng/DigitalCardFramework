import assert from "node:assert/strict";
import { exampleFramework } from "./commerce-fixture.mjs";
const { core, seller, buyer, operator } = exampleFramework();
core.configureCommerce(operator, {
  key: "enable",
  expectedRevision: 0,
  settings: { playerShops: true, allowedCurrencyIds: ["credits"] },
});
const shop = core.createShop(operator, {
  key: "shop",
  name: "Example issuer",
  kind: "admin",
});
const listing = core.createListing(operator, {
  key: "stock",
  shopId: shop.id,
  title: "Dawn card",
  price: { currencyId: "credits", amount: 20 },
  items: { kind: "mint-card", variantId: "dawn.standard", quantity: 2 },
  metadata: { campaign: "launch" },
});
const order = core.buyListing(buyer, {
  ...core.quoteListing(buyer, { listingId: listing.id }),
  key: "buy",
});
const resaleShop = core.createShop(buyer, {
  key: "my-shop",
  name: "Collector shop",
});
const resale = core.createListing(buyer, {
  key: "resale",
  shopId: resaleShop.id,
  title: "Dawn resale",
  price: { currencyId: "credits", amount: 15 },
  items: { kind: "copies", ids: [order.items[0].copyId] },
});
core.buyListing(seller, {
  ...core.quoteListing(seller, { listingId: resale.id }),
  key: "resale-buy",
});
assert.equal(
  core.inspectCard(seller, order.items[0].copyId).ownerId,
  seller.userId,
);
assert.equal(core.audit(operator).ok, true);
console.log(
  "Verified admin issuance, player shop resale and atomic currency settlement.",
);
core.close();
