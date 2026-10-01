import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, admin, code } from "./helpers.js";
import { CardFramework, createCurrencyGateway } from "../src/index.js";
import { SQLiteStore } from "../src/sqlite.js";
import { MemoryStore } from "../src/store.js";
import { createApiHandler } from "../src/http.js";
import { createServer } from "node:http";

function gateway(x, { receipt = {}, lookup, mapping, timeoutMs } = {}) {
  return createCurrencyGateway({
    framework: x.core,
    timeoutMs,
    providers: {
      points: {
        resolveAccount: ({ userId }) => "external:" + userId,
        currencies: { POINTS: mapping ?? { currencyId: "credits" } },
        lookup:
          lookup ??
          (async ({ transactionId, account }) => ({
            transactionId,
            account,
            status: "settled",
            currency: "POINTS",
            amountUnits: "150",
            ...receipt,
          })),
      },
    },
  });
}
const request = { providerId: "points", transactionId: "settled-123" };
test("forty concurrent deliveries credit once and cannot buy free duplicate packs", async () => {
  const x = fixture(),
    api = gateway(x);
  const results = await Promise.all(
    Array.from({ length: 40 }, () => api.reconcile(x.alice, request)),
  );
  assert.ok(
    results.every((r) => JSON.stringify(r) === JSON.stringify(results[0])),
  );
  assert.equal(x.core.wallet(x.alice).credits, 10150);
  const q = x.core.quote(x.alice, { productId: "common" });
  for (let i = 0; i < 10; i++)
    x.core.purchase(x.alice, { ...q, key: "stable-purchase" });
  assert.equal(x.core.wallet(x.alice).credits, 10140);
  assert.equal(x.core.packs(x.alice).length, 1);
  assert.equal(
    x.core.history(x.alice).filter((l) => l.type === "external-credit").length,
    1,
  );
  assert.equal(x.core.audit(admin).ok, true);
});
for (const [name, receipt, expected] of [
  ["another account", { account: "attacker" }, "SETTLEMENT_MISMATCH"],
  ["different transaction", { transactionId: "other" }, "SETTLEMENT_MISMATCH"],
  ["pending funds", { status: "pending" }, "SETTLEMENT_PENDING"],
  ["refunded funds", { status: "refunded" }, "SETTLEMENT_PENDING"],
  ["unknown currency", { currency: "__proto__" }, "UNKNOWN_CURRENCY"],
  ["negative amount", { amountUnits: "-100" }, "INVALID_PROVIDER"],
  ["decimal amount", { amountUnits: "0.1" }, "INVALID_PROVIDER"],
  ["unsafe integer", { amountUnits: "9007199254740992" }, "INVALID_INPUT"],
])
  test("settlement rejects " + name + " without minting funds", async () => {
    const x = fixture();
    await assert.rejects(
      gateway(x, { receipt }).reconcile(x.alice, request),
      code(expected),
    );
    assert.equal(x.core.wallet(x.alice).credits, 10000);
  });
test("settlement permission is separate from grants and unavailable to ordinary or disabled users", async () => {
  const x = fixture();
  for (const actor of [
    x.alice,
    { permissions: ["currency.grant"] },
    { role: "admin", disabled: true },
  ])
    assert.throws(
      () => x.core.settleExternalCredit(actor, {}),
      code("FORBIDDEN"),
    );
  await assert.rejects(
    gateway(x).reconcile({ ...x.alice, disabled: true }, request),
    code("UNAUTHENTICATED"),
  );
  await assert.rejects(
    gateway(x).reconcile(x.alice, { ...request, providerId: "constructor" }),
    code("UNKNOWN_PROVIDER"),
  );
});
test("global provider receipt deduplication prevents reuse by a second account or changed conversion", async () => {
  const x = fixture();
  await gateway(x).reconcile(x.alice, request);
  await assert.rejects(
    gateway(x).reconcile(x.bob, request),
    code("SETTLEMENT_CONFLICT"),
  );
  await assert.rejects(
    gateway(x, { mapping: { currencyId: "credits", numerator: 2 } }).reconcile(
      x.alice,
      request,
    ),
    code("SETTLEMENT_CONFLICT"),
  );
  assert.equal(x.core.wallet(x.bob).credits, 10000);
});
test("external integer unit conversions are exact and never silently round", async () => {
  const x = fixture();
  const api = gateway(x, {
    mapping: { currencyId: "gems", numerator: 2, denominator: 3 },
  });
  const r = await api.reconcile(x.alice, request);
  assert.equal(r.amount, 100);
  await assert.rejects(
    gateway(x, { mapping: { currencyId: "gems", denominator: 7 } }).reconcile(
      x.alice,
      { ...request, transactionId: "different" },
    ),
    code("INEXACT_CONVERSION"),
  );
});
test("timeout and cancellation prevent a late provider response from crediting funds", async () => {
  const x = fixture();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const api = gateway(x, { timeoutMs: 5, lookup: () => pending });
  // Keep the test process alive while AbortSignal.timeout uses an unref timer.
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(api.reconcile(x.alice, request), {
      name: "TimeoutError",
    });
  } finally {
    clearInterval(keepAlive);
  }
  release({
    transactionId: request.transactionId,
    account: "external:" + x.alice.userId,
    status: "settled",
    currency: "POINTS",
    amountUnits: "500",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(x.core.wallet(x.alice).credits, 10000);
});
test("settlement survives SQLite reopen without duplicate credit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dc-settlement-")),
    db = join(dir, "state.sqlite");
  let core;
  try {
    const x = fixture({ store: new SQLiteStore(db) });
    core = x.core;
    await gateway(x).reconcile(x.alice, request);
    core.close();
    core = null;
    core = new CardFramework({ store: new SQLiteStore(db) });
    await gateway({ core }).reconcile(x.alice, request);
    assert.equal(core.wallet(x.alice).credits, 10150);
    assert.equal(core.audit(admin).ok, true);
  } finally {
    core?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("HTTP bridge ignores forged user, role and amount; same-origin and identity protections remain", async () => {
  const x = fixture(),
    handler = createApiHandler({
      framework: x.core,
      currencyGateway: gateway(x),
      resolveIdentity: () => x.alice,
      allowedOrigin: "https://cards.test",
      requirePrincipal: true,
    });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/currency/reconcile`;
    const headers = {
      origin: "https://cards.test",
      "content-type": "application/json",
      "x-dc-principal": x.alice.userId,
    };
    const result = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...request,
        userId: x.bob.userId,
        amount: 999999,
        role: "admin",
      }),
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).amount, 150);
    assert.equal(x.core.wallet(x.bob).credits, 10000);
    const bad = await fetch(url, {
      method: "POST",
      headers: { ...headers, origin: "https://evil.test" },
      body: JSON.stringify(request),
    });
    assert.equal(bad.status, 403);
    const pollution = await fetch(url, {
      method: "POST",
      headers,
      body: '{"__proto__":{"role":"admin"}}',
    });
    assert.equal(pollution.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("unregistered inherited binding factories cannot create attached rewards", () => {
  const x = fixture({
    change: (c) => {
      c.variants.find((v) => v.id === "dawn.standard").bindings = {
        "test.bad": {
          visibility: "owner",
          transfer: "follow",
          factory: "toString",
          data: {},
        },
      };
    },
  });
  assert.throws(() => x.buy(), code("MISSING_PROVIDER"));
  assert.equal(x.core.wallet(x.alice).credits, 10000);
  assert.equal(x.core.packs(x.alice).length, 0);
});

test("mixed purchase/open retries preserve ownership, edition counts and ledger conservation", async () => {
  const x = fixture();
  await gateway(x).reconcile(x.alice, request);
  const q = x.core.quote(x.alice, { productId: "common" }),
    purchases = new Map();
  let seed = 31;
  for (let i = 0; i < 300; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const key = "attempt-" + (seed % 37),
      result = x.core.purchase(x.alice, { ...q, key });
    if (purchases.has(key)) assert.deepEqual(result, purchases.get(key));
    else purchases.set(key, result);
    const pack = result.packs[0];
    x.core.openPack(x.alice, { key: "reveal-" + i, packId: pack.id });
  }
  assert.equal(x.core.wallet(x.alice).credits, 10150 - purchases.size * 10);
  assert.equal(x.core.inventory(x.alice).length, purchases.size);
  assert.equal(x.core.audit(admin).ok, true);
});

test("release audit detects orphaned and duplicated settlement ledger entries", async () => {
  const store = new MemoryStore(),
    x = fixture({ store });
  await gateway(x).reconcile(x.alice, request);
  store.transact((s) => {
    const credit = s.ledger.find((e) => e.type === "external-credit");
    s.ledger.push({ ...credit, id: "tampered" });
  });
  assert.ok(
    x.core
      .audit(admin)
      .issues.some((i) => i.code === "SETTLEMENT_LEDGER_MISMATCH"),
  );
  store.transact((s) => {
    s.ledger.pop();
    s.externalSettlements = {};
  });
  assert.ok(
    x.core
      .audit(admin)
      .issues.some((i) => i.code === "SETTLEMENT_RECEIPT_MISSING"),
  );
});
