import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin, code } from "./helpers.js";
import { MemoryStore, CardFramework } from "../src/index.js";
const reward = (c) => {
  c.variants.find((v) => v.id === "dawn.standard").onOpen = [
    { id: "unlock", handler: "external.unlock", params: { item: "badge" } },
  ];
};
const gift = (x, copy, key = "trade") =>
  x.core.proposeTrade(x.alice, {
    key,
    toUserId: x.bob.userId,
    give: { copyIds: [copy.id], currencies: [] },
    receive: { copyIds: [], currencies: [] },
  });

test("opening actions enqueue once, execute after commit, retain beneficiary and support code-free rewards", async () => {
  const calls = [];
  const x = fixture({
    change(c) {
      reward(c);
      c.cards.find((c) => c.id === "dawn").type = "code";
    },
    actionHandlers: { "external.unlock": async (job) => calls.push(job) },
  });
  const p = x.buy(),
    first = x.core.openPack(x.alice, { key: "open", packId: p.packs[0].id });
  x.core.openPack(x.alice, { key: "replay", packId: p.packs[0].id });
  assert.equal(first.cards[0].codes.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(x.core.fulfillments(x.alice).total, 1);
  assert.equal(x.core.fulfillments(x.bob).total, 0);
  await x.core.dispatchActions(admin);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, x.alice.userId);
  assert.equal(calls[0].params.item, "badge");
  assert.equal(x.core.fulfillments(x.alice).items[0].status, "succeeded");
  assert.equal(x.core.audit(admin).ok, true);
  x.core.close();
});
test("failed transactions create no jobs, and global subscriptions are explicit durable callbacks", () => {
  const store = new MemoryStore(),
    x = fixture({
      store,
      change: reward,
      eventSubscriptions: [
        { id: "watch", handler: "external.event", events: ["card.opened"] },
      ],
    });
  const before = store.read((s) => s);
  assert.throws(
    () => x.core.openPack(x.bob, { key: "bad", packId: "not-owned" }),
    code("NOT_FOUND"),
  );
  assert.deepEqual(
    store.read((s) => s),
    before,
  );
  x.open();
  const jobs = x.core.actionJobs(admin).items;
  assert.equal(jobs.length, 2);
  assert(jobs.some((j) => j.source.type === "event"));
  x.core.close();
});
test("worker failure is sanitized, backoff retries use a stable downstream ID, and dead retry is idempotent", async () => {
  let now = "2026-10-01T00:00:00Z";
  const calls = [];
  const x = fixture({
    clock: () => now,
    change: reward,
    actionOptions: { maxAttempts: 1 },
    actionHandlers: {
      "external.unlock": async (job) => {
        calls.push(job.idempotencyKey);
        throw Error("PRIVATE-UPSTREAM-TOKEN");
      },
    },
  });
  x.open();
  await x.core.dispatchActions(admin);
  const job = x.core.fulfillments(x.alice).items[0];
  assert.equal(job.status, "dead");
  assert(!JSON.stringify(job).includes("PRIVATE-UPSTREAM"));
  assert.throws(
    () => x.core.retryAction(x.alice, { key: "r", jobId: job.id }),
    code("FORBIDDEN"),
  );
  const retry = x.core.retryAction(admin, { key: "r", jobId: job.id });
  assert.deepEqual(
    x.core.retryAction(admin, { key: "r", jobId: job.id }),
    retry,
  );
  await x.core.dispatchActions(admin);
  assert.deepEqual(calls, [job.id, job.id]);
  x.core.close();
});
test("delivery leases prevent duplicate claims and fence expired worker acknowledgments", () => {
  let now = "2026-10-01T00:00:00Z";
  const store = new MemoryStore(),
    x = fixture({
      store,
      clock: () => now,
      change: reward,
      actionOptions: { leaseMs: 100, timeoutMs: 10 },
    });
  x.open();
  const first = x.core.claimAction(admin);
  assert.equal(x.core.claimAction(admin), null);
  now = "2026-10-01T00:00:01Z";
  const second = x.core.claimAction(admin);
  assert.equal(first.id, second.id);
  assert.notEqual(first.leaseToken, second.leaseToken);
  assert.throws(
    () =>
      x.core.settleAction(admin, {
        jobId: first.id,
        leaseToken: first.leaseToken,
        succeeded: true,
      }),
    code("ACTION_LEASE"),
  );
  x.core.settleAction(admin, {
    jobId: second.id,
    leaseToken: second.leaseToken,
    succeeded: true,
  });
  const restarted = new CardFramework({ store });
  assert.equal(restarted.fulfillments(x.alice).items[0].status, "succeeded");
  x.core.close();
});
test("timed-out providers cannot later mark jobs successful", async () => {
  const x = fixture({
    change: reward,
    actionOptions: { timeoutMs: 5, leaseMs: 100, maxAttempts: 1 },
    actionHandlers: {
      "external.unlock": async () => {
        await new Promise((r) => setTimeout(r, 30));
      },
    },
  });
  x.open();
  await x.core.dispatchActions(admin);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(x.core.fulfillments(x.alice).items[0].status, "dead");
  x.core.close();
});
test("live category rules, individual locks and expiry govern both offer sides and completion", () => {
  let now = "2026-10-01T00:00:00Z";
  const x = fixture({ clock: () => now }),
    copy = x.open()[0],
    trade = gift(x, copy);
  x.core.configureTrading(admin, {
    key: "policy",
    expectedRevision: 0,
    policy: {
      rules: [
        {
          id: "deny-sky",
          decision: "deny",
          reason: "Line locked",
          match: { lineIds: ["sky"] },
        },
      ],
    },
  });
  assert.throws(
    () => x.core.acceptTrade(x.bob, { key: "accept", tradeId: trade.id }),
    code("TRANSFER_BLOCKED"),
  );
  x.core.cancelTrade(x.alice, { key: "cancel", tradeId: trade.id });
  x.core.configureTrading(admin, {
    key: "clear",
    expectedRevision: 1,
    policy: {},
  });
  x.core.setCardTransferLock(admin, {
    key: "lock",
    copyId: copy.id,
    reason: "Timed lock",
    until: "2026-10-01T01:00:00Z",
  });
  assert.throws(() => gift(x, copy, "locked"), code("TRANSFER_BLOCKED"));
  now = "2026-10-01T01:00:00Z";
  const next = gift(x, copy, "ready");
  x.core.acceptTrade(x.bob, { key: "accept-ready", tradeId: next.id });
  assert.equal(x.core.inspectCard(x.bob, copy.id).ownerId, x.bob.userId);
  x.core.close();
});
test("gift and currency restrictions cannot be bypassed; host contextual veto composes without core edits", () => {
  const seen = [];
  const x = fixture({
      policies: {
        canTransfer: (copy, userId, context) => {
          seen.push(context);
          return true;
        },
        canTrade: (offer) => offer.toUserId !== undefined,
      },
    }),
    copy = x.open()[0];
  x.core.configureTrading(admin, {
    key: "policy",
    expectedRevision: 0,
    policy: { allowGifts: false, allowedCurrencyIds: ["gems"] },
  });
  assert.throws(() => gift(x, copy), code("TRANSFER_BLOCKED"));
  assert.throws(
    () =>
      x.core.proposeTrade(x.alice, {
        key: "money",
        toUserId: x.bob.userId,
        give: {
          copyIds: [],
          currencies: [{ currencyId: "credits", amount: 1 }],
        },
        receive: {
          copyIds: [],
          currencies: [{ currencyId: "credits", amount: 1 }],
        },
      }),
    code("TRANSFER_BLOCKED"),
  );
  assert(seen.some((c) => c?.toUserId === x.bob.userId));
  assert.throws(
    () =>
      x.core.configureTrading(x.alice, {
        key: "fake",
        expectedRevision: 1,
        policy: {},
      }),
    code("FORBIDDEN"),
  );
  x.core.close();
});

test("trade-up outputs open once and configured expiry is the default for new offers", () => {
  const x = fixture({
      change(c) {
        c.variants.find((v) => v.id === "aurora.holo").onOpen = [
          { id: "unlock", handler: "external.unlock" },
        ];
      },
    }),
    cards = x.open("common", x.alice, 3);
  const output = x.core.tradeUp(x.alice, {
    key: "upgrade",
    recipeId: "sky.upgrade",
    copyIds: cards.map((c) => c.id),
  });
  assert.equal(x.core.fulfillments(x.alice).total, 1);
  x.core.openCard(x.alice, { key: "reopen", copyId: output.id });
  assert.equal(x.core.fulfillments(x.alice).total, 1);
  x.core.configureTrading(admin, {
    key: "expiry",
    expectedRevision: 0,
    policy: { maxExpirySeconds: 30 },
  });
  const trade = gift(x, output);
  assert.equal(
    Date.parse(trade.expiresAt) - Date.parse(trade.createdAt),
    30000,
  );
  x.core.close();
});

test("configured offer limits can expand beyond the safe default", () => {
  const x = fixture(),
    cards = Array.from({ length: 11 }, () =>
      x.open("common", x.alice, 10),
    ).flat();
  const input = {
    key: "large",
    toUserId: x.bob.userId,
    give: { copyIds: cards.map((c) => c.id), currencies: [] },
    receive: { copyIds: [], currencies: [] },
  };
  assert.throws(
    () => x.core.proposeTrade(x.alice, input),
    code("TRANSFER_BLOCKED"),
  );
  x.core.configureTrading(admin, {
    key: "limits",
    expectedRevision: 0,
    policy: { maxCardsPerSide: 200 },
  });
  const trade = x.core.proposeTrade(x.alice, input);
  assert.equal(trade.give.copyIds.length, 110);
  x.core.close();
});

test("exhausted delivery history stops retries without blocking later jobs", () => {
  const store = new MemoryStore(),
    x = fixture({ store, change: reward });
  x.open("common", x.alice, 2);
  const jobs = store.read((s) => Object.values(s.actionJobs));
  store.transact((s) => {
    s.actionJobs[jobs[0].id].history = Array.from({ length: 1999 }, () => ({
      type: "unconfirmed",
      at: "2026-10-01T00:00:00Z",
    }));
  });
  assert.equal(x.core.claimAction(admin).id, jobs[1].id);
  assert.throws(
    () => x.core.retryAction(admin, { key: "full", jobId: jobs[0].id }),
    code("INSTALLATION_CAPACITY"),
  );
  assert.equal(
    store.read((s) => s.actionJobs[jobs[0].id].history.length),
    1999,
  );
  x.core.close();
});
