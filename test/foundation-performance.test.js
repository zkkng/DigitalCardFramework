import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/store.js";
import { SQLiteStore } from "../src/sqlite.js";
import { fixture, admin } from "./helpers.js";

for (const kind of ["memory", "sqlite"]) {
  test(
    kind + " rejects uncloneable transaction results before committing",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "dc-store-result-"));
      const store =
        kind === "memory"
          ? new MemoryStore()
          : new SQLiteStore(path.join(root, "state.sqlite"));
      try {
        const before = store.read((s) => s);
        assert.throws(
          () =>
            store.transact((s) => {
              s.users.invalid = {};
              return () => {};
            }),
          /clone/i,
        );
        assert.deepEqual(
          store.read((s) => s),
          before,
        );
        assert.throws(
          () =>
            store.transact((s) => {
              s.users.invalid = {};
              return Promise.resolve();
            }),
          /Async/,
        );
        assert.deepEqual(
          store.read((s) => s),
          before,
        );
        assert.equal(
          store.transact((s) => {
            s.users.valid = {};
            return 7;
          }),
          7,
        );
        assert.equal(
          store.read((s) => s.revision),
          before.revision + 1,
        );
      } finally {
        store.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  test(
    kind + " idle action and maintenance cycles preserve state revision",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "dc-idle-"));
      const store =
        kind === "memory"
          ? new MemoryStore()
          : new SQLiteStore(path.join(root, "state.sqlite"));
      const x = fixture({ store });
      try {
        const before = store.read((s) => s);
        for (let i = 0; i < 3; i++) {
          assert.deepEqual(await x.core.dispatchActions(admin), []);
          assert.deepEqual(x.core.expireListings(admin), { count: 0 });
          x.core.sweepExpiredTrades(admin);
          assert.deepEqual(x.core.drawDueRaffles(admin), []);
        }
        assert.deepEqual(
          store.read((s) => s),
          before,
        );
      } finally {
        x.core.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
test("future action work waits without writes and becomes claimable when due", async () => {
  const store = new MemoryStore();
  let now = Date.parse("2026-09-30T12:00:00Z"),
    delivered = 0;
  const x = fixture({
    store,
    clock: () => new Date(now).toISOString(),
    change(c) {
      c.variants.find((v) => v.id === "dawn.standard").onOpen = [
        { id: "test", handler: "test.delivery", params: {} },
      ];
    },
    actionHandlers: {
      "test.delivery": async () => {
        delivered++;
      },
    },
  });
  try {
    x.open();
    store.transact((s) => {
      for (const job of Object.values(s.actionJobs))
        job.nextAt = new Date(now + 1000).toISOString();
    });
    const revision = store.read((s) => s.revision);
    assert.deepEqual(await x.core.dispatchActions(admin), []);
    assert.equal(
      store.read((s) => s.revision),
      revision,
    );
    now += 1000;
    await x.core.dispatchActions(admin);
    assert.equal(delivered, 1);
    assert.equal(x.core.audit(admin).ok, true);
  } finally {
    x.core.close();
  }
});

test("SQLite rollback cleanup cannot mask a transaction callback failure", () => {
  const store = new SQLiteStore();
  const failure = new Error("Callback rejected");
  assert.throws(
    () =>
      store.transact(() => {
        store.close();
        throw failure;
      }),
    (error) => error === failure,
  );
});
