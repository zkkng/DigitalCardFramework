import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin, code } from "./helpers.js";
import { codesFixture } from "./codes-fixtures.mjs";
import { MemoryStore } from "../src/index.js";
const seller = (x) => ({ ...x.alice, role: "admin" });
const shop = (x) =>
  x.core.createShop(seller(x), { key: "shop", name: "Shop", kind: "admin" });
const listing = (x, shopId, extra = {}) =>
  x.core.createListing(seller(x), {
    key: "listing",
    shopId,
    title: "A card",
    price: { currencyId: "credits", amount: 20 },
    items: { kind: "mint-card", variantId: "dawn.standard", quantity: 2 },
    ...extra,
  });
const buy = (x, id, actor = x.bob, key = "buy") =>
  x.core.buyListing(actor, {
    ...x.core.quoteListing(actor, { listingId: id }),
    key,
  });

test("admin stock reserves edition supply; quote/settlement/retry preserve exact units and ledger", () => {
  const x = fixture(),
    s = shop(x),
    l = listing(x, s.id);
  assert.equal(x.core.audit(admin).ok, true);
  const q = x.core.quoteListing(x.bob, { listingId: l.id });
  const o = x.core.buyListing(x.bob, { ...q, key: "buy" });
  assert.deepEqual(x.core.buyListing(x.bob, { ...q, key: "buy" }), o);
  assert.equal(x.core.wallet(x.bob).credits, 9980);
  assert.equal(x.core.wallet(x.alice).credits, 10020);
  const c = x.core.inspectCard(x.bob, o.items[0].copyId);
  assert.equal(c.provenance.listingId, l.id);
  assert.equal(c.openedBy, x.bob.userId);
  assert.equal(c.metadata.acquisition.orderId, o.id);
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});
test("stale unit quote never substitutes another serial or double-charges", () => {
  const x = fixture(),
    s = shop(x),
    l = listing(x, s.id),
    q = x.core.quoteListing(x.bob, { listingId: l.id });
  buy(x, l.id);
  assert.throws(
    () => x.core.buyListing(x.bob, { ...q, key: "another" }),
    code("STALE_QUOTE"),
  );
  assert.equal(x.core.wallet(x.bob).credits, 9980);
  x.core.close();
});
test("player shops are opt-in; players cannot mint, use custom handlers or spend another account stock", () => {
  const x = fixture();
  assert.throws(
    () => x.core.createShop(x.alice, { key: "s", name: "Mine" }),
    code("FORBIDDEN"),
  );
  x.core.configureCommerce(admin, {
    key: "config",
    expectedRevision: 0,
    settings: { playerShops: true },
  });
  const s = x.core.createShop(x.alice, { key: "s", name: "Mine" });
  const make = (items) =>
    x.core.createListing(x.alice, {
      key: "bad",
      shopId: s.id,
      title: "Bad",
      price: { currencyId: "credits", amount: 1 },
      items,
    });
  assert.throws(
    () => make({ kind: "mint-card", variantId: "dawn.standard", quantity: 1 }),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => make({ kind: "action", handler: "external.unlock", quantity: 1 }),
    code("FORBIDDEN"),
  );
  const foreign = x.open("common", x.bob)[0];
  assert.throws(
    () => make({ kind: "copies", ids: [foreign.id] }),
    code("NOT_OWNED"),
  );
  x.core.close();
});
test("player listing locks cards against trade, follows policies, and cancel always releases stock", () => {
  const x = fixture();
  x.core.configureCommerce(admin, {
    key: "config",
    expectedRevision: 0,
    settings: { playerShops: true },
  });
  const s = x.core.createShop(x.alice, { key: "s", name: "Mine" }),
    copy = x.open()[0];
  const l = x.core.createListing(x.alice, {
    key: "list",
    shopId: s.id,
    title: "Used card",
    price: { currencyId: "credits", amount: 5 },
    items: { kind: "copies", ids: [copy.id] },
  });
  assert.throws(
    () =>
      x.core.proposeTrade(x.alice, {
        key: "t",
        toUserId: x.bob.userId,
        give: { copyIds: [copy.id], currencies: [] },
        receive: { copyIds: [], currencies: [] },
      }),
    code("CARD_LOCKED"),
  );
  x.core.setCardTransferLock(admin, {
    key: "lock",
    copyId: copy.id,
    reason: "Restricted",
  });
  assert.throws(() => buy(x, l.id), code("TRANSFER_BLOCKED"));
  x.core.cancelListing(x.alice, { key: "cancel", listingId: l.id });
  assert.equal(x.core.inspectCard(x.alice, copy.id).lockedBy, undefined);
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});
test("scheduled previews, release boundaries, quota, closure and insufficient funds are enforced on the server", () => {
  let now = "2026-10-01T00:00:00Z";
  const x = fixture({ clock: () => now }),
    s = shop(x),
    l = listing(x, s.id, {
      previewAt: now,
      startsAt: "2026-10-01T01:00:00Z",
      endsAt: "2026-10-01T02:00:00Z",
      perBuyerLimit: 1,
    });
  assert.equal(x.core.listings(x.bob).items[0].phase, "upcoming");
  assert.throws(() => buy(x, l.id), code("LISTING_CLOSED"));
  now = "2026-10-01T01:00:00Z";
  buy(x, l.id);
  assert.throws(() => buy(x, l.id, x.bob, "more"), code("PURCHASE_LIMIT"));
  now = "2026-10-01T02:00:00Z";
  assert.throws(() => buy(x, l.id), code("LISTING_CLOSED"));
  assert.equal(x.core.expireListings(admin).count, 1);
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});
test("sealed shop packs cannot open while listed and transfer all code entitlements without exposing outcomes", () => {
  const x = codesFixture(),
    s = shop(x),
    l = listing(x, s.id, {
      items: { kind: "mint-pack", productId: "bundle", quantity: 1 },
    });
  const p = x.core.packs(x.alice)[0];
  assert.throws(
    () => x.core.openPack(x.alice, { key: "open-stock", packId: p.id }),
    code("PACK_LOCKED"),
  );
  const q = x.core.quoteListing(x.bob, { listingId: l.id });
  assert(!JSON.stringify(q).includes("SECRET-REWARD"));
  assert.equal(q.items[0].pack.copyIds, undefined);
  const o = x.core.buyListing(x.bob, { ...q, key: "buy" }),
    receipt = x.core.openPack(x.bob, {
      key: "open",
      packId: o.items[0].packId,
    });
  const reward = receipt.cards.find((c) => c.cardId === "reward");
  assert.equal(
    x.core.revealCode(x.bob, { key: "reveal", codeId: reward.codes[0].id })
      .code,
    "SECRET-REWARD-0",
  );
  assert.throws(
    () =>
      x.core.revealCode(x.alice, { key: "old", codeId: reward.codes[0].id }),
    code("NOT_FOUND"),
  );
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});
test("custom goods create durable actions only after successful payment", async () => {
  const calls = [];
  const x = fixture({
      actionHandlers: { "external.item": async (job) => calls.push(job) },
    }),
    s = shop(x),
    l = listing(x, s.id, {
      items: {
        kind: "action",
        handler: "external.item",
        quantity: 1,
        params: { sku: "hat" },
      },
    });
  assert.equal(calls.length, 0);
  const order = buy(x, l.id);
  assert.equal(order.fulfillment, "pending");
  await x.core.dispatchActions(admin);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, x.bob.userId);
  assert.equal(calls[0].source.orderId, order.id);
  assert.equal(x.core.orders(x.bob).items[0].fulfillment, "complete");
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});
test("raffle draws unique winners once, restricts claims and releases unclaimed reservations", () => {
  let now = "2026-10-01T00:00:00Z";
  const x = fixture({ clock: () => now, raffleRandom: () => 0 }),
    s = shop(x),
    l = listing(x, s.id, {
      raffle: {
        entryClosesAt: "2026-10-01T01:00:00Z",
        claimSeconds: 60,
        winners: 1,
      },
    });
  const third = x.core.registerUser(admin, {
      provider: "test",
      subject: "third",
      displayName: "Third",
    }),
    actor = { userId: third.id };
  x.core.enterRaffle(x.bob, { key: "entry", listingId: l.id });
  x.core.enterRaffle(x.bob, { key: "duplicate", listingId: l.id });
  x.core.enterRaffle(actor, { key: "entry", listingId: l.id });
  assert.equal(x.core.raffleStatus(x.bob, { listingId: l.id }).entryCount, 2);
  assert.throws(() => buy(x, l.id), code("RAFFLE_CLAIM"));
  now = "2026-10-01T01:00:00Z";
  const draw = x.core.drawRaffle(admin, { key: "draw", listingId: l.id });
  assert.equal(draw.winners.length, 1);
  assert.deepEqual(
    x.core.drawRaffle(admin, { key: "redraw", listingId: l.id }),
    draw,
  );
  assert.throws(() => buy(x, l.id, actor), code("RAFFLE_CLAIM"));
  buy(x, l.id);
  assert.throws(() => buy(x, l.id, x.bob, "twice"), code("RAFFLE_CLAIM"));
  now = "2026-10-01T01:01:00Z";
  x.core.expireListings(admin);
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});

test("insufficient funds, nontradable resale currency and edition exhaustion leave no partial stock or ledger changes", () => {
  const store = new MemoryStore(),
    x = fixture({ store }),
    s = shop(x),
    l = listing(x, s.id, { price: { currencyId: "credits", amount: 20000 } }),
    before = store.read((s) => s);
  assert.throws(() => buy(x, l.id), code("INSUFFICIENT_FUNDS"));
  assert.deepEqual(
    store.read((s) => s),
    before,
  );
  assert.throws(
    () =>
      listing(x, s.id, {
        key: "limited",
        items: { kind: "mint-card", variantId: "solstice.unique", quantity: 2 },
      }),
    code("SOLD_OUT"),
  );
  assert.deepEqual(
    store.read((s) => s),
    before,
  );
  x.core.configureCommerce(admin, {
    key: "config",
    expectedRevision: 0,
    settings: { playerShops: true },
  });
  const player = x.core.createShop(x.alice, { key: "player", name: "Player" }),
    copy = x.open()[0];
  assert.throws(
    () =>
      x.core.createListing(x.alice, {
        key: "units",
        shopId: player.id,
        title: "No",
        price: { currencyId: "stamps", amount: 1 },
        items: { kind: "copies", ids: [copy.id] },
      }),
    code("TRANSFER_BLOCKED"),
  );
  x.core.close();
});

test("pack resale is opt-in and policy restricted; primary issuance bypasses type default but never individual locks", () => {
  const x = fixture(),
    s = shop(x),
    l = listing(x, s.id, {
      items: { kind: "mint-card", variantId: "dawn.standard", quantity: 1 },
    }),
    copy = x.core.inventory(x.alice)[0];
  x.core.setCardTransferLock(admin, {
    key: "lock",
    copyId: copy.id,
    reason: "Hold",
  });
  assert.throws(() => buy(x, l.id), code("TRANSFER_BLOCKED"));
  x.core.setCardTransferLock(admin, {
    key: "unlock",
    copyId: copy.id,
    locked: false,
  });
  buy(x, l.id);
  const pack = x.buy().packs[0];
  assert.throws(
    () =>
      listing(x, s.id, {
        key: "pack",
        items: { kind: "packs", ids: [pack.id] },
      }),
    code("FORBIDDEN"),
  );
  x.core.configureCommerce(admin, {
    key: "config",
    expectedRevision: 0,
    settings: { packResale: true },
  });
  const resale = listing(x, s.id, {
    key: "pack",
    items: { kind: "packs", ids: [pack.id] },
  });
  const order = buy(x, resale.id, x.bob, "packbuy");
  assert.equal(
    x.core.openPack(x.bob, { key: "open-pack", packId: order.items[0].packId })
      .cards.length,
    1,
  );
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});

test("empty raffles, expired claims, disabled shops, buyer blocks and automatic due draws are deterministic", () => {
  let now = "2026-10-01T00:00:00Z";
  const x = fixture({ clock: () => now, raffleRandom: () => 0 }),
    s = shop(x),
    l = listing(x, s.id, {
      raffle: {
        entryClosesAt: "2026-10-01T01:00:00Z",
        claimSeconds: 60,
        winners: 1,
      },
    });
  now = "2026-10-01T01:00:00Z";
  const draws = x.core.drawDueRaffles(admin);
  assert.equal(draws[0].winners.length, 0);
  assert.equal(x.core.drawDueRaffles(admin).length, 0);
  const live = listing(x, s.id, { key: "live" });
  x.core.setShopEnabled(admin, {
    key: "disable",
    shopId: s.id,
    enabled: false,
  });
  assert.throws(() => buy(x, live.id), code("SHOP_DISABLED"));
  x.core.setShopEnabled(admin, { key: "enable", shopId: s.id, enabled: true });
  x.core.setPreferences(x.alice, {
    key: "block",
    blockedUserIds: [x.bob.userId],
  });
  assert.throws(() => buy(x, live.id), code("TRANSFER_BLOCKED"));
  x.core.close();
});

test("reserved identifiers cannot address prototypes through operator controls", () => {
  const x = fixture();
  assert.throws(
    () =>
      x.core.setCardTransferLock(admin, { key: "bad", copyId: "__proto__" }),
    code("NOT_FOUND"),
  );
  assert.throws(
    () =>
      x.core.setShopEnabled(admin, {
        key: "bad-shop",
        shopId: "__proto__",
        enabled: true,
      }),
    code("NOT_FOUND"),
  );
  assert.equal(Object.prototype.enabled, undefined);
  assert.equal(Object.prototype.transferLock, undefined);
  x.core.close();
});

test("purchase previews redact legacy private variant bindings and preserve public data", () => {
  const store = new MemoryStore(),
    x = fixture({
      store,
      change(c) {
        c.variants.find((v) => v.id === "dawn.standard").bindings = {
          "example.secret": {
            visibility: "owner",
            transfer: "follow",
            data: { value: "PRIVATE-BINDING" },
          },
        };
      },
    }),
    s = shop(x),
    l = listing(x, s.id);
  // Earlier stored snapshots may retain the original binding specification.
  store.transact((state) => {
    for (const copy of Object.values(state.copies))
      copy.variant.bindings = {
        "example.secret": {
          visibility: "owner",
          factory: "private.factory",
          data: { value: "PRIVATE-BINDING" },
        },
      };
  });
  const q = x.core.quoteListing(x.bob, { listingId: l.id });
  assert(!JSON.stringify(q).includes("PRIVATE-BINDING"));
  assert(!JSON.stringify(q).includes("private.factory"));
  const o = x.core.buyListing(x.bob, { ...q, key: "buy-private" });
  assert.equal(
    x.core.inspectCard(x.bob, o.items[0].copyId).bindings["example.secret"].data
      .value,
    "PRIVATE-BINDING",
  );
  x.core.close();
});

test("secondary sales enforce account age, live cooldown and global currency trading", () => {
  let now = "2026-10-01T00:00:00Z";
  const x = fixture({ clock: () => now }),
    s = shop(x),
    cards = x.open("common", x.alice, 2);
  const l = listing(x, s.id, {
    items: { kind: "copies", ids: cards.map((c) => c.id) },
  });
  x.core.configureTrading(admin, {
    key: "age",
    expectedRevision: 0,
    policy: { minAccountAgeSeconds: 60, cooldownSeconds: 60 },
  });
  assert.throws(() => buy(x, l.id), code("TRANSFER_BLOCKED"));
  now = "2026-10-01T00:01:00Z";
  buy(x, l.id);
  assert.throws(() => buy(x, l.id, x.bob, "second"), code("TRANSFER_BLOCKED"));
  now = "2026-10-01T00:02:00Z";
  x.c.version = 2;
  x.c.features.currencyTrading = false;
  x.core.publishCatalog(admin, x.c);
  assert.throws(
    () => buy(x, l.id, x.bob, "disabled"),
    code("FEATURE_DISABLED"),
  );
  assert.equal(x.core.wallet(x.bob).credits, 9980);
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});

test("resale removes album placements with a new album revision and clears favorites", () => {
  const x = fixture(),
    s = shop(x),
    copy = x.open()[0];
  const album = x.core.saveAlbum(x.alice, {
    key: "album",
    name: "Collection",
    placements: [{ copyId: copy.id }],
  });
  x.core.setPreferences(x.alice, {
    key: "favorite",
    favoriteCopyIds: [copy.id],
  });
  const l = listing(x, s.id, { items: { kind: "copies", ids: [copy.id] } });
  buy(x, l.id);
  const updated = x.core.albums(x.alice).find((a) => a.id === album.id);
  assert.equal(updated.version, album.version + 1);
  assert.deepEqual(updated.placements, []);
  assert.deepEqual(x.core.me(x.alice).preferences.favoriteCopyIds, []);
  x.core.close();
});
