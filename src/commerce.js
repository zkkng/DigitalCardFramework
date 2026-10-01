import { randomUUID, randomInt } from "node:crypto";
import { check, integer, text, jsonObject } from "./catalog.js";
import { hasPermission } from "./access.js";
import { safeData, page } from "./data.js";
import { contentDigest } from "./importer.js";
import { enqueueAction } from "./actions.js";

export const commerceDefaults = Object.freeze({
  enabled: true,
  playerShops: false,
  packResale: false,
  allowedCurrencyIds: null,
  maxListingsPerShop: 200,
  maxStockPerListing: 100,
  maxRaffleEntries: 10000,
});
const find = (rows, id) => rows.find((x) => x.id === id),
  clone = structuredClone;
const record = (rows, id) =>
  rows && typeof id === "string" && Object.hasOwn(rows, id)
    ? rows[id]
    : undefined;
const active = (l) => l.status === "active";
const permission = (actor, p) =>
  check(
    hasPermission(actor, p),
    "FORBIDDEN",
    "Operator authority required: " + p,
    403,
  );
const initialize = (s) => {
  s.shops ??= {};
  s.listings ??= {};
  s.orders ??= {};
};
function date(value, name) {
  check(
    value === null ||
      (typeof value === "string" && Number.isFinite(Date.parse(value))),
    "INVALID_INPUT",
    "Invalid " + name,
  );
  return value;
}
function object(value, keys) {
  const clean = jsonObject(value);
  check(
    Object.keys(clean).every((k) => keys.includes(k)),
    "INVALID_INPUT",
    "Unknown configuration field",
  );
  return clean;
}
function config(s) {
  return s.commerceSettings?.settings ?? commerceDefaults;
}
function stock(l) {
  return l.units.filter((u) => u.status === "available");
}
function terms(l) {
  return {
    id: l.id,
    shopId: l.shopId,
    sellerId: l.sellerId,
    title: l.title,
    price: l.price,
    kind: l.kind,
    previewAt: l.previewAt,
    startsAt: l.startsAt,
    endsAt: l.endsAt,
    perBuyerLimit: l.perBuyerLimit,
    metadata: l.metadata,
    raffle: l.raffle,
    createdAt: l.createdAt,
  };
}
function digest(l, units) {
  return contentDigest({ terms: terms(l), unitIds: units.map((u) => u.id) });
}
function publicListing(s, l, at, userId) {
  const now = Date.parse(at),
    phase = !active(l)
      ? l.status
      : now < Date.parse(l.startsAt)
        ? "upcoming"
        : l.endsAt && now >= Date.parse(l.endsAt)
          ? "expired"
          : l.raffle
            ? l.draw
              ? "claiming"
              : now >= Date.parse(l.raffle.entryClosesAt)
                ? "awaiting-draw"
                : "entries-open"
            : "live";
  return {
    ...terms(l),
    description: l.description,
    shopName: s.shops[l.shopId]?.name,
    sellerName: s.users[l.sellerId]?.displayName,
    status: l.status,
    phase,
    remaining: stock(l).length,
    preview: clone(l.preview),
    mine: l.sellerId === userId,
    entryCount: Object.keys(l.entries ?? {}).length,
    drawnAt: l.draw?.at ?? null,
    claimUntil: l.draw?.claimUntil ?? null,
  };
}
export class CommerceService {
  #b;
  #random;
  constructor(bridge, { random = randomInt } = {}) {
    this.#b = bridge;
    this.#random = random;
  }
  settings() {
    return this.#b.read(
      (s) =>
        s.commerceSettings ?? {
          revision: 0,
          settings: clone(commerceDefaults),
        },
    );
  }
  configure(actor, { key, expectedRevision, settings }) {
    object(settings, Object.keys(commerceDefaults));
    const clean = { ...commerceDefaults, ...safeData(settings) };
    for (const k of ["enabled", "playerShops", "packResale"])
      check(
        typeof clean[k] === "boolean",
        "INVALID_INPUT",
        "Invalid commerce switch",
      );
    for (const [k, max] of Object.entries({
      maxListingsPerShop: 10000,
      maxStockPerListing: 1000,
      maxRaffleEntries: 100000,
    }))
      integer(clean[k], k, 1, max);
    check(
      clean.allowedCurrencyIds === null ||
        (Array.isArray(clean.allowedCurrencyIds) &&
          clean.allowedCurrencyIds.length <= 100 &&
          clean.allowedCurrencyIds.every((x) => typeof x === "string")),
      "INVALID_INPUT",
      "Invalid currency allowlist",
    );
    return this.#b.operator(
      actor,
      key,
      "commerce.manage",
      "commerce.configured",
      { expectedRevision, settings: clean },
      (s) => {
        check(
          (s.commerceSettings?.revision ?? 0) === expectedRevision,
          "POLICY_CHANGED",
          "Commerce settings changed",
          409,
        );
        for (const id of clean.allowedCurrencyIds ?? [])
          this.#b.currency(s, id);
        s.commerceSettings = {
          revision: expectedRevision + 1,
          settings: clean,
        };
        return s.commerceSettings;
      },
    );
  }
  createShop(actor, { key, name, kind = "player", ownerId, metadata = {} }) {
    text(name, "shop name", 100);
    check(
      ["admin", "player"].includes(kind),
      "INVALID_INPUT",
      "Invalid shop kind",
    );
    jsonObject(metadata);
    return this.#b.command(
      actor,
      key,
      "shop.created",
      { name, kind, ownerId, metadata },
      (s, u) => {
        initialize(s);
        const manage = hasPermission(actor, "commerce.manage");
        check(
          (kind === "player" && config(s).playerShops) || manage,
          "FORBIDDEN",
          "Player shops are disabled",
          403,
        );
        const owner = ownerId ?? u.id;
        check(
          owner === u.id || manage,
          "FORBIDDEN",
          "Cannot create another account shop",
          403,
        );
        check(record(s.users, owner), "NOT_FOUND", "Shop owner not found", 404);
        check(
          kind !== "admin" || manage,
          "FORBIDDEN",
          "Admin shop authority required",
          403,
        );
        const shop = {
          id: randomUUID(),
          name,
          kind,
          ownerId: owner,
          enabled: true,
          metadata: clone(metadata),
          createdAt: this.#b.now(),
        };
        s.shops[shop.id] = shop;
        return shop;
      },
    );
  }
  setShop(actor, { key, shopId, enabled }) {
    check(
      typeof enabled === "boolean",
      "INVALID_INPUT",
      "enabled must be boolean",
    );
    return this.#b.operator(
      actor,
      key,
      "commerce.manage",
      "shop.status",
      { shopId, enabled },
      (s) => {
        const shop = record(s.shops, shopId);
        check(shop, "NOT_FOUND", "Shop not found", 404);
        shop.enabled = enabled;
        return shop;
      },
    );
  }
  shops(actor, options = {}) {
    return this.#b.read((s) => {
      const user = this.#b.user(s, actor);
      return page(
        Object.values(s.shops ?? {})
          .filter(
            (shop) =>
              shop.enabled ||
              shop.ownerId === user.id ||
              hasPermission(actor, "commerce.manage"),
          )
          .map((shop) => ({ ...shop, mine: shop.ownerId === user.id })),
        options,
      );
    });
  }
  #own(s, actor, shopId) {
    const u = this.#b.user(s, actor),
      shop = record(s.shops, shopId);
    check(
      shop &&
        (shop.ownerId === u.id || hasPermission(actor, "commerce.manage")),
      "NOT_FOUND",
      "Shop not found",
      404,
    );
    if (shop.kind === "admin") permission(actor, "commerce.manage");
    else
      check(
        config(s).playerShops || hasPermission(actor, "commerce.manage"),
        "FORBIDDEN",
        "Player shops are disabled",
        403,
      );
    return shop;
  }
  #currency(s, shop, price) {
    object(price, ["currencyId", "amount"]);
    text(price.currencyId, "currency ID", 100);
    integer(price.amount, "unit price", 0);
    const currency = this.#b.currency(s, price.currencyId);
    check(
      !config(s).allowedCurrencyIds ||
        config(s).allowedCurrencyIds.includes(price.currencyId),
      "TRANSFER_BLOCKED",
      "Currency is not accepted by shops",
      403,
    );
    if (shop.kind === "player")
      check(
        currency.tradable === true,
        "TRANSFER_BLOCKED",
        "Currency cannot be transferred to player shops",
        403,
      );
  }
  createListing(actor, input) {
    const {
      key,
      shopId,
      title,
      description = "",
      price,
      items,
      previewAt = null,
      startsAt = this.#b.now(),
      endsAt = null,
      perBuyerLimit = 10,
      metadata = {},
      raffle = null,
    } = input;
    text(title, "listing title", 200);
    check(
      typeof description === "string" && description.length <= 2000,
      "INVALID_INPUT",
      "Description too long",
    );
    integer(perBuyerLimit, "buyer limit", 1, 1000);
    jsonObject(metadata);
    date(previewAt, "preview time");
    date(startsAt, "start time");
    check(startsAt, "INVALID_INPUT", "Start time required");
    date(endsAt, "end time");
    check(
      !endsAt || Date.parse(endsAt) > Date.parse(startsAt),
      "INVALID_INPUT",
      "End must follow start",
    );
    check(
      !previewAt || Date.parse(previewAt) <= Date.parse(startsAt),
      "INVALID_INPUT",
      "Preview must precede start",
    );
    if (raffle) {
      object(raffle, ["entryClosesAt", "claimSeconds", "winners"]);
      date(raffle.entryClosesAt, "entry deadline");
      check(
        raffle.entryClosesAt &&
          Date.parse(raffle.entryClosesAt) > Date.parse(startsAt),
        "INVALID_INPUT",
        "Entry deadline must follow start",
      );
      integer(raffle.claimSeconds, "claim seconds", 60, 604800);
      integer(raffle.winners, "winners", 1, 1000);
      check(
        !endsAt ||
          Date.parse(endsAt) >
            Date.parse(raffle.entryClosesAt) + raffle.claimSeconds * 1000,
        "INVALID_INPUT",
        "Listing end must allow the full claim window",
      );
    }
    object(items, [
      "kind",
      "ids",
      "variantId",
      "productId",
      "quantity",
      "handler",
      "params",
    ]);
    check(
      ["copies", "packs", "mint-card", "mint-pack", "action"].includes(
        items.kind,
      ),
      "INVALID_INPUT",
      "Invalid stock kind",
    );
    return this.#b.command(
      actor,
      key,
      "listing.created",
      {
        shopId,
        title,
        description,
        price,
        items,
        previewAt,
        startsAt: input.startsAt ?? null,
        endsAt,
        perBuyerLimit,
        metadata,
        raffle,
      },
      (s, u) => {
        initialize(s);
        const shop = this.#own(s, actor, shopId);
        check(shop.enabled, "SHOP_DISABLED", "Shop is disabled", 409);
        this.#currency(s, shop, price);
        check(
          Object.values(s.listings).filter(
            (l) => l.shopId === shopId && active(l),
          ).length < config(s).maxListingsPerShop,
          "INSTALLATION_CAPACITY",
          "Shop listing limit reached",
          507,
        );
        const listing = {
          id: randomUUID(),
          shopId,
          sellerId: shop.ownerId,
          title,
          description,
          price: clone(price),
          kind: items.kind,
          previewAt: previewAt ?? startsAt,
          startsAt,
          endsAt,
          perBuyerLimit,
          metadata: clone(metadata),
          raffle: clone(raffle),
          entries: {},
          draw: null,
          units: [],
          preview: null,
          status: "active",
          createdAt: this.#b.now(),
        };
        const primary = ["mint-card", "mint-pack", "action"].includes(
          items.kind,
        );
        if (primary) {
          check(
            shop.kind === "admin",
            "FORBIDDEN",
            "Only admin shops can issue stock or custom items",
            403,
          );
          permission(actor, "commerce.manage");
          integer(
            items.quantity,
            "stock quantity",
            1,
            config(s).maxStockPerListing,
          );
        } else {
          check(
            Array.isArray(items.ids) &&
              items.ids.length > 0 &&
              items.ids.length <= config(s).maxStockPerListing &&
              new Set(items.ids).size === items.ids.length &&
              items.ids.every((x) => typeof x === "string"),
            "INVALID_INPUT",
            "Select unique owned stock",
          );
        }
        let copies = [],
          packs = [];
        if (items.kind === "mint-card") {
          const variant = find(s.catalog.variants, items.variantId);
          check(
            variant && variant.enabled !== false,
            "NOT_FOUND",
            "Variant not available",
            404,
          );
          for (let i = 0; i < items.quantity; i++)
            copies.push(
              this.#b.mint(s, shop.ownerId, items.variantId, {
                type: "shop-stock",
                listingId: listing.id,
                stockIndex: i,
              }),
            );
        }
        if (items.kind === "mint-pack") {
          const product = find(s.catalog.products, items.productId);
          check(
            product && product.enabled !== false,
            "NOT_FOUND",
            "Pack product unavailable",
            404,
          );
          packs = this.#b
            .allocatePacks(
              s,
              s.users[shop.ownerId],
              product,
              items.quantity,
              { listingId: listing.id },
              false,
            )
            .map((p) => s.packs[p.id]);
        }
        if (items.kind === "copies")
          copies = items.ids.map((id) => {
            const c = s.copies[id];
            check(
              c?.ownerId === shop.ownerId && c.state === "owned",
              "NOT_OWNED",
              "Stock must be owned cards",
              403,
            );
            this.#b.transferAllowed(s, c, shop.ownerId, null, "sale", false);
            return c;
          });
        if (items.kind === "packs") {
          check(
            config(s).packResale,
            "FORBIDDEN",
            "Pack resale is disabled",
            403,
          );
          packs = items.ids.map((id) => {
            const p = s.packs[id];
            check(
              p?.ownerId === shop.ownerId && !p.openedAt && !p.lockedBy,
              "NOT_OWNED",
              "Stock must be unreserved sealed packs",
              403,
            );
            for (const id of p.copyIds)
              this.#b.transferAllowed(
                s,
                s.copies[id],
                shop.ownerId,
                null,
                "sale",
                false,
              );
            return p;
          });
        }
        check(
          new Set(copies.map((c) => c.variantId)).size <= 1 &&
            new Set(packs.map((p) => p.productId + ":" + p.productRevision))
              .size <= 1,
          "INVALID_INPUT",
          "One listing must contain the same variant or pack revision",
        );
        const lock = "market:" + listing.id;
        for (const c of copies) {
          check(!c.lockedBy, "CARD_LOCKED", "Card already reserved", 409);
          c.lockedBy = lock;
          listing.units.push({
            id: randomUUID(),
            kind: "copy",
            copyId: c.id,
            primary,
            status: "available",
          });
        }
        for (const p of packs) {
          p.lockedBy = lock;
          for (const id of p.copyIds) s.copies[id].lockedBy = lock;
          listing.units.push({
            id: randomUUID(),
            kind: "pack",
            packId: p.id,
            primary,
            status: "available",
          });
        }
        if (items.kind === "action") {
          text(items.handler, "action handler", 100);
          jsonObject(items.params ?? {});
          for (let i = 0; i < items.quantity; i++)
            listing.units.push({
              id: randomUUID(),
              kind: "action",
              handler: items.handler,
              params: clone(items.params ?? {}),
              primary: true,
              status: "available",
            });
        }
        if (copies.length)
          listing.preview = {
            kind: "card",
            name: copies[0].definition.name,
            cardId: copies[0].cardId,
            variantId: copies[0].variantId,
          };
        else if (packs.length)
          listing.preview = {
            kind: "pack",
            name: packs[0].product.name,
            productId: packs[0].productId,
            preallocated: true,
          };
        else listing.preview = { kind: "custom", name: title };
        check(
          !raffle || raffle.winners <= listing.units.length,
          "INVALID_INPUT",
          "Winners exceed reserved stock",
        );
        if (this.#b.canList)
          check(
            this.#b.canList({
              actor: clone(actor),
              shop: clone(shop),
              listing: publicListing(s, listing, this.#b.now(), u.id),
            }) === true,
            "FORBIDDEN",
            "Host listing policy rejected stock",
            403,
          );
        s.listings[listing.id] = listing;
        return publicListing(s, listing, this.#b.now(), u.id);
      },
    );
  }
  listings(actor, { shopId, ...options } = {}) {
    return this.#b.read((s) => {
      const u = this.#b.user(s, actor),
        at = this.#b.now();
      return page(
        Object.values(s.listings ?? {})
          .filter(
            (l) =>
              (!shopId || l.shopId === shopId) &&
              (l.sellerId === u.id ||
                hasPermission(actor, "commerce.manage") ||
                (s.shops[l.shopId]?.enabled &&
                  Date.parse(l.previewAt) <= Date.parse(at))),
          )
          .map((l) => publicListing(s, l, at, u.id)),
        options,
      );
    });
  }
  #eligible(s, l, u) {
    const shop = s.shops[l.shopId],
      at = this.#b.now();
    check(
      config(s).enabled &&
        shop?.enabled &&
        (shop.kind === "admin" || config(s).playerShops),
      "SHOP_DISABLED",
      "Shop purchasing is disabled",
      409,
    );
    check(
      active(l) &&
        Date.parse(at) >= Date.parse(l.startsAt) &&
        (!l.endsAt || Date.parse(at) < Date.parse(l.endsAt)),
      "LISTING_CLOSED",
      "Listing is not open",
      409,
    );
    check(u.id !== l.sellerId, "FORBIDDEN", "Cannot buy your own stock", 403);
    check(
      !this.#b.blocked(s, u.id, l.sellerId),
      "TRANSFER_BLOCKED",
      "Transactions between these accounts are blocked",
      403,
    );
    this.#currency(s, shop, l.price);
    if (this.#b.canPurchase) {
      const decision = this.#b.canPurchase({
        user: clone(u),
        shop: clone(shop),
        listing: publicListing(s, l, at, u.id),
      });
      check(
        decision === true,
        "FORBIDDEN",
        typeof decision === "string"
          ? decision
          : "Host purchase policy rejected account",
        403,
      );
    }
  }
  #selection(s, l, u, quantity) {
    this.#eligible(s, l, u);
    integer(quantity, "quantity", 1, 1000);
    const bought = Object.values(s.orders ?? {})
      .filter((o) => o.listingId === l.id && o.buyerId === u.id)
      .reduce((n, o) => n + o.quantity, 0);
    check(
      bought + quantity <= l.perBuyerLimit,
      "PURCHASE_LIMIT",
      "Buyer limit reached",
      409,
    );
    if (l.raffle) {
      const win = l.draw?.winners.find((w) => w.userId === u.id);
      check(
        win &&
          !win.orderId &&
          quantity === 1 &&
          Date.parse(this.#b.now()) < Date.parse(l.draw.claimUntil),
        "RAFFLE_CLAIM",
        "No active purchase right",
        403,
      );
      return l.units.filter(
        (unit) => unit.id === win.unitId && unit.status === "available",
      );
    }
    const units = stock(l).slice(0, quantity);
    check(
      units.length === quantity,
      "OUT_OF_STOCK",
      "Not enough listing stock",
      409,
    );
    return units;
  }
  #unitView(s, unit) {
    if (unit.kind === "copy")
      return {
        unitId: unit.id,
        kind: "copy",
        copy: this.#b.copyView(s, s.copies[unit.copyId], null),
      };
    if (unit.kind === "pack")
      return {
        unitId: unit.id,
        kind: "pack",
        pack: this.#b.packView(s.packs[unit.packId]),
      };
    return { unitId: unit.id, kind: "custom" };
  }
  quote(actor, { listingId, quantity = 1 }) {
    return this.#b.read((s) => {
      const u = this.#b.user(s, actor),
        l = record(s.listings, listingId);
      check(l, "NOT_FOUND", "Listing not found", 404);
      const units = this.#selection(s, l, u, quantity);
      integer(l.price.amount * quantity, "total", 0);
      return {
        listingId,
        quantity,
        unitIds: units.map((x) => x.id),
        digest: digest(l, units),
        price: {
          currencyId: l.price.currencyId,
          amount: l.price.amount * quantity,
        },
        items: units.map((unit) => this.#unitView(s, unit)),
      };
    });
  }
  buy(
    actor,
    { key, listingId, quantity = 1, unitIds, digest: expectedDigest },
  ) {
    check(
      Array.isArray(unitIds) && unitIds.length === quantity,
      "INVALID_INPUT",
      "Quoted unit IDs required",
    );
    return this.#b.command(
      actor,
      key,
      "shop.purchased",
      { listingId, quantity, unitIds, digest: expectedDigest },
      (s, u) => {
        initialize(s);
        const l = record(s.listings, listingId);
        check(l, "NOT_FOUND", "Listing not found", 404);
        const units = this.#selection(s, l, u, quantity);
        check(
          units.length === quantity &&
            JSON.stringify(units.map((x) => x.id)) ===
              JSON.stringify(unitIds) &&
            digest(l, units) === expectedDigest,
          "STALE_QUOTE",
          "Stock or terms changed; review a new quote",
          409,
        );
        const order = {
          id: randomUUID(),
          listingId,
          shopId: l.shopId,
          buyerId: u.id,
          sellerId: l.sellerId,
          quantity,
          unitIds: [...unitIds],
          paid: {
            currencyId: l.price.currencyId,
            amount: l.price.amount * quantity,
          },
          createdAt: this.#b.now(),
          items: [],
          actionJobIds: [],
        };
        integer(order.paid.amount, "total", 0);
        if (units.some((unit) => !unit.primary))
          this.#b.checkResale(s, l.sellerId, u.id, units, order.paid);
        this.#b.adjust(
          s,
          u.id,
          order.paid.currencyId,
          -order.paid.amount,
          "shop.purchase",
          order.id,
        );
        this.#b.adjust(
          s,
          l.sellerId,
          order.paid.currencyId,
          order.paid.amount,
          "shop.proceeds",
          order.id,
        );
        for (const unit of units) {
          const lock = "market:" + l.id;
          if (unit.kind === "copy") {
            const c = s.copies[unit.copyId];
            check(
              c?.ownerId === l.sellerId && c.lockedBy === lock,
              "STOCK_CHANGED",
              "Card reservation changed",
              409,
            );
            if (!unit.primary)
              this.#b.transferAllowed(s, c, l.sellerId, u.id, "sale", true);
            this.#b.deliverCopy(s, c, l.sellerId, u.id, order.id, unit.primary);
            order.items.push({ kind: "copy", copyId: c.id });
          } else if (unit.kind === "pack") {
            const p = s.packs[unit.packId];
            check(
              p?.ownerId === l.sellerId && p.lockedBy === lock && !p.openedAt,
              "STOCK_CHANGED",
              "Pack reservation changed",
              409,
            );
            for (const id of p.copyIds) {
              const c = s.copies[id];
              check(
                c.ownerId === l.sellerId && c.lockedBy === lock,
                "STOCK_CHANGED",
                "Pack contents changed",
                409,
              );
              if (!unit.primary)
                this.#b.transferAllowed(s, c, l.sellerId, u.id, "sale", true);
            }
            this.#b.deliverPack(s, p, l.sellerId, u.id, order.id);
            order.items.push({ kind: "pack", packId: p.id });
          } else {
            const job = enqueueAction(
              s,
              {
                handler: unit.handler,
                params: unit.params,
                userId: u.id,
                source: {
                  type: "shop.purchased",
                  orderId: order.id,
                  listingId: l.id,
                  unitId: unit.id,
                },
              },
              this.#b.now(),
            );
            order.actionJobIds.push(job.id);
            order.items.push({ kind: "custom", jobId: job.id });
          }
          unit.status = "sold";
          unit.orderId = order.id;
        }
        if (l.raffle)
          l.draw.winners.find((w) => w.userId === u.id).orderId = order.id;
        s.orders[order.id] = order;
        this.#b.event(s, "shop.order-created", {
          orderId: order.id,
          userId: u.id,
          shopId: l.shopId,
          listingId: l.id,
        });
        return this.#orderView(s, order);
      },
    );
  }
  #orderView(s, o) {
    const jobs = o.actionJobIds.map((id) => s.actionJobs[id]);
    return {
      ...o,
      fulfillment: jobs.some((j) => j.status === "dead")
        ? "attention-required"
        : jobs.some((j) => j.status !== "succeeded")
          ? "pending"
          : "complete",
    };
  }
  orders(actor, options = {}) {
    return this.#b.read((s) => {
      const u = this.#b.user(s, actor);
      return page(
        Object.values(s.orders ?? {})
          .filter((o) => o.buyerId === u.id || o.sellerId === u.id)
          .map((o) => this.#orderView(s, o)),
        options,
      );
    });
  }
  #release(s, l, status) {
    for (const unit of stock(l)) {
      const lock = "market:" + l.id;
      if (unit.kind === "copy") {
        const copy = s.copies[unit.copyId];
        if (copy?.lockedBy === lock) delete copy.lockedBy;
      } else if (unit.kind === "pack") {
        const p = s.packs[unit.packId];
        if (p?.lockedBy === lock) delete p.lockedBy;
        for (const id of p?.copyIds ?? [])
          if (s.copies[id]?.lockedBy === lock) delete s.copies[id].lockedBy;
      }
      unit.status = "released";
    }
    l.status = status;
    l.closedAt = this.#b.now();
    this.#b.event(s, "listing." + status, {
      listingId: l.id,
      userId: l.sellerId,
    });
  }
  cancel(actor, { key, listingId }) {
    return this.#b.command(
      actor,
      key,
      "listing.canceled",
      { listingId },
      (s, u) => {
        const l = record(s.listings, listingId);
        check(
          l && (l.sellerId === u.id || hasPermission(actor, "commerce.manage")),
          "NOT_FOUND",
          "Listing not found",
          404,
        );
        if (active(l)) this.#release(s, l, "canceled");
        return publicListing(s, l, this.#b.now(), u.id);
      },
    );
  }
  expire(actor) {
    permission(actor, "maintenance.run");
    return this.#b.transact((s) => {
      let count = 0;
      for (const l of Object.values(s.listings ?? {}))
        if (
          active(l) &&
          ((l.endsAt && Date.parse(l.endsAt) <= Date.parse(this.#b.now())) ||
            (l.draw &&
              Date.parse(l.draw.claimUntil) <= Date.parse(this.#b.now())))
        ) {
          this.#release(s, l, "expired");
          count++;
        }
      return { count };
    });
  }
  enter(actor, { key, listingId }) {
    return this.#b.command(
      actor,
      key,
      "raffle.entered",
      { listingId },
      (s, u) => {
        const l = record(s.listings, listingId);
        check(l?.raffle, "NOT_FOUND", "Raffle not found", 404);
        this.#eligible(s, l, u);
        check(
          !l.draw &&
            Date.parse(this.#b.now()) < Date.parse(l.raffle.entryClosesAt),
          "RAFFLE_CLOSED",
          "Entries are closed",
          409,
        );
        if (!l.entries[u.id]) {
          check(
            Object.keys(l.entries).length < config(s).maxRaffleEntries,
            "INSTALLATION_CAPACITY",
            "Raffle entry limit reached",
            507,
          );
          l.entries[u.id] = { userId: u.id, at: this.#b.now() };
        }
        return this.#raffleView(l, u.id);
      },
    );
  }
  #raffleView(l, userId) {
    const win = l.draw?.winners.find((w) => w.userId === userId);
    return {
      listingId: l.id,
      entryCount: Object.keys(l.entries).length,
      entered: !!l.entries[userId],
      drawnAt: l.draw?.at ?? null,
      winner: !!win,
      orderId: win?.orderId ?? null,
      claimUntil: win ? l.draw.claimUntil : null,
      status: l.status,
    };
  }
  raffleStatus(actor, { listingId }) {
    return this.#b.read((s) => {
      const u = this.#b.user(s, actor),
        l = record(s.listings, listingId);
      check(
        l?.raffle &&
          (Date.parse(l.previewAt) <= Date.parse(this.#b.now()) ||
            l.sellerId === u.id ||
            hasPermission(actor, "commerce.manage")),
        "NOT_FOUND",
        "Raffle not found",
        404,
      );
      return this.#raffleView(l, u.id);
    });
  }
  draw(actor, { key, listingId }) {
    return this.#b.operator(
      actor,
      key,
      "raffles.draw",
      "raffle.drawn",
      { listingId },
      (s) => {
        const l = record(s.listings, listingId);
        check(l?.raffle, "NOT_FOUND", "Raffle not found", 404);
        if (l.draw) return clone(l.draw);
        check(
          active(l) &&
            (!l.endsAt || Date.parse(l.endsAt) > Date.parse(this.#b.now())) &&
            Date.parse(this.#b.now()) >= Date.parse(l.raffle.entryClosesAt),
          "RAFFLE_CLOSED",
          "Raffle is not ready to draw",
          409,
        );
        const entries = Object.keys(l.entries),
          units = stock(l),
          winners = [];
        const count = Math.min(entries.length, l.raffle.winners, units.length);
        for (let i = 0; i < count; i++) {
          const n = this.#random(entries.length);
          check(
            Number.isInteger(n) && n >= 0 && n < entries.length,
            "INVALID_PROVIDER",
            "Invalid raffle random draw",
            500,
          );
          const [userId] = entries.splice(n, 1);
          winners.push({ userId, unitId: units[i].id, orderId: null });
        }
        l.draw = {
          id: randomUUID(),
          at: this.#b.now(),
          claimUntil: new Date(
            Math.min(
              Date.parse(this.#b.now()) + l.raffle.claimSeconds * 1000,
              l.endsAt ? Date.parse(l.endsAt) : Infinity,
            ),
          ).toISOString(),
          winners,
        };
        for (const win of winners)
          this.#b.notify(s, win.userId, "raffle.won", {
            listingId: l.id,
            claimUntil: l.draw.claimUntil,
          });
        return clone(l.draw);
      },
    );
  }
}
