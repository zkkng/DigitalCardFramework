import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPresentationStore,
  validateInWorker,
} from "../src/presentation/service.js";
import { importPackage } from "../src/presentation/package.js";
import { buildReport } from "../src/presentation/compiler.js";
import { fixture, build } from "./presentation-fixtures.mjs";

const waitFor = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw Error("Import state timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
test("import admission bounds all actors, cancellation removes queued work, slots recover", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-import-queue-"));
  const pkg = await build(fixture()),
    parsed = await importPackage(pkg.archive);
  let active = 0,
    peak = 0,
    started = 0;
  const releases = [];
  const store = await createPresentationStore({
    root,
    authorize: () => true,
    maxConcurrentImports: 1,
    maxPendingImports: 3,
    validate: async (_file, { signal }) => {
      active++;
      started++;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve, reject) => {
          releases.push(resolve);
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
          if (signal.aborted) reject(signal.reason);
        });
        return {
          ok: true,
          digest: parsed.digest,
          report: buildReport(parsed),
          capabilities: parsed.manifest.capabilities,
        };
      } finally {
        active--;
      }
    },
  });
  const a = { id: "one" },
    b = { id: "two" },
    c = { id: "three" };
  try {
    const first = await store.import(a, pkg.archive, {
      idempotencyKey: "import-one",
    });
    const second = await store.import(b, pkg.archive, {
      idempotencyKey: "import-two",
    });
    const third = await store.import(c, pkg.archive, {
      idempotencyKey: "import-three",
    });
    await waitFor(() => started === 1);
    assert.equal((await store.get(b, second.id)).state, "received");
    assert.equal(
      (await store.import(a, pkg.archive, { idempotencyKey: "import-one" })).id,
      first.id,
    );
    await assert.rejects(
      store.import({ id: "four" }, pkg.archive, {
        idempotencyKey: "import-four",
      }),
      (error) => error.code === "QUOTA",
    );
    assert.equal((await store.cancel(c, third.id)).state, "cancelled");
    releases[0]();
    await waitFor(() => started === 2);
    releases[1]();
    await waitFor(() => active === 0);
    await waitFor(
      async () => (await store.get(b, second.id)).state === "ready",
    );
    assert.equal(peak, 1);
    assert.equal(started, 2);
    assert.equal((await store.get(c, third.id)).state, "cancelled");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("closing the store cancels both active and queued imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-import-close-"));
  const pkg = await build(fixture());
  let started = 0;
  let store = await createPresentationStore({
    root,
    authorize: () => true,
    maxConcurrentImports: 1,
    validate: async (_file, { signal }) => {
      started++;
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
        if (signal.aborted) reject(signal.reason);
      });
    },
  });
  try {
    const a = { id: "creator" };
    const first = await store.import(a, pkg.archive, {
      idempotencyKey: "active-job",
    });
    const second = await store.import(a, pkg.archive, {
      idempotencyKey: "queued-job",
    });
    await waitFor(() => started === 1);
    await Promise.all([store.close(), store.close()]);
    store = await createPresentationStore({ root, authorize: () => true });
    assert.equal((await store.get(a, first.id)).state, "cancelled");
    assert.equal((await store.get(a, second.id)).state, "cancelled");
    assert.equal(started, 1);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("process validator handles valid content, failures, timeout and pre-cancellation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-import-process-"));
  try {
    const pkg = await build(fixture()),
      file = path.join(root, "valid.dcard");
    await writeFile(file, pkg.archive);
    assert.equal((await validateInWorker(file)).digest, pkg.digest);
    await assert.rejects(
      validateInWorker(file, { timeoutMs: 1 }),
      /time limit/,
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      validateInWorker(file, { signal: abort.signal }),
      (error) => error.name === "AbortError",
    );
    await assert.rejects(validateInWorker(file, { timeoutMs: 0 }), /timeout/);
    await writeFile(path.join(root, "invalid.dcard"), "invalid");
    await assert.rejects(validateInWorker(path.join(root, "invalid.dcard")));
    assert.equal((await validateInWorker(file)).digest, pkg.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an authorization request completing after shutdown cannot admit an upload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dc-import-shutdown-"));
  const pkg = await build(fixture());
  let release;
  const store = await createPresentationStore({
    root,
    authorize: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  try {
    const admission = store.import({ id: "creator" }, pkg.archive, {
      idempotencyKey: "late-import",
    });
    const rejected = assert.rejects(
      admission,
      (error) => error.code === "CLOSED",
    );
    await store.close();
    release(true);
    await rejected;
    assert.deepEqual(await readdir(path.join(root, "jobs")), []);
    assert.deepEqual(await readdir(path.join(root, "quarantine")), []);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
