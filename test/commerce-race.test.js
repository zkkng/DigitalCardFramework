import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixture, admin } from "./helpers.js";
import { SQLiteStore } from "../src/sqlite.js";
import { CardFramework } from "../src/index.js";

async function race(data) {
  const workers = [];
  try {
    await Promise.all(
      data.map(
        (workerData) =>
          new Promise((resolve, reject) => {
            const worker = new Worker(
              new URL("./commerce-worker.mjs", import.meta.url),
              { workerData },
            );
            workers.push(worker);
            worker.once("error", reject);
            worker.once("message", resolve);
          }),
      ),
    );
    return await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            worker.once("error", reject);
            worker.once("message", resolve);
            worker.postMessage("go");
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
test("separate database connections cannot buy the same final unit or claim the same active delivery lease", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "commerce-race-")),
    db = path.join(dir, "state.sqlite");
  try {
    const x = fixture({ store: new SQLiteStore(db) }),
      seller = { ...x.alice, role: "admin" },
      shop = x.core.createShop(seller, {
        key: "shop",
        name: "Shop",
        kind: "admin",
      }),
      l = x.core.createListing(seller, {
        key: "stock",
        shopId: shop.id,
        title: "One reward",
        price: { currencyId: "credits", amount: 10 },
        items: { kind: "action", handler: "external.unlock", quantity: 1 },
      }),
      quote = x.core.quoteListing(x.bob, { listingId: l.id }),
      buyer = x.bob;
    x.core.close();
    const bought = await race(
      [0, 1].map((i) => ({ db, actor: buyer, quote, key: "buy-" + i })),
    );
    assert.equal(bought.filter((x) => x.ok).length, 1);
    assert.equal(bought.find((x) => !x.ok).code, "OUT_OF_STOCK");
    const claims = await race([
      { db, kind: "claim" },
      { db, kind: "claim" },
    ]);
    assert.equal(claims.filter((x) => x.result).length, 1);
    const core = new CardFramework({ store: new SQLiteStore(db) });
    assert.equal(core.wallet(buyer).credits, 9990);
    assert.equal(core.orders(buyer).total, 1);
    assert.equal(core.audit(admin).ok, true);
    core.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
