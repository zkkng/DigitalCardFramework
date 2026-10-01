import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin } from "./helpers.js";
import { validateCatalog } from "../src/index.js";
test("issued copy pins portable art through catalog revisions, replay and trade", () => {
  const presentation = {
    contract: "digital-card@0.1",
    digest: "sha256:" + "a".repeat(64),
    baseURL: "https://assets.example/cards/" + "a".repeat(64) + "/",
  };
  const x = fixture({
      change: (c) =>
        (c.cards.find((c) => c.id === "dawn").presentation = presentation),
    }),
    pack = x.buy().packs[0],
    opened = x.core.openPack(x.alice, { packId: pack.id, key: "open" });
  assert.deepEqual(opened.cards[0].definition.presentation, presentation);
  const next = structuredClone(x.c);
  next.version = 2;
  next.cards.find((c) => c.id === "dawn").presentation = {
    ...presentation,
    digest: "sha256:" + "b".repeat(64),
  };
  x.core.publishCatalog(admin, next);
  assert.deepEqual(
    x.core.openPack(x.alice, { packId: pack.id, key: "replay" }).cards[0]
      .definition.presentation,
    presentation,
  );
  assert.deepEqual(
    x.core.inventory(x.alice)[0].definition.presentation,
    presentation,
  );
  const trade = x.core.proposeTrade(x.alice, {
    key: "offer",
    toUserId: x.bob.userId,
    give: { copyIds: [opened.cards[0].id], currencies: [] },
    receive: { copyIds: [], currencies: [] },
  });
  x.core.acceptTrade(x.bob, { key: "accept", tradeId: trade.id });
  assert.deepEqual(
    x.core.inventory(x.bob)[0].definition.presentation,
    presentation,
  );
  const invalid = structuredClone(next);
  invalid.cards.find((c) => c.id === "dawn").presentation.digest = "latest";
  assert.throws(() => validateCatalog(invalid), /pinned presentation/);
});
