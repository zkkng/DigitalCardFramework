import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createPresentationStore } from "../src/presentation/service.js";
import {
  authorizePresentation,
  PERMISSIONS,
  hasPermission,
} from "../src/access.js";
import { fixture, build } from "./presentation-fixtures.mjs";
async function directory(t, close = async () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dcard-audit-"));
  t.after(async () => {
    await close();
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
const admin = { id: "operator", role: "admin" };
const wait = async (store, id) => {
  for (let i = 0; i < 200; i++) {
    const job = await store.get(admin, id);
    if (["ready", "rejected", "cancelled"].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Job did not settle");
};

for (const mode of ["warn", "reject"])
  test(
    "upload performance policy " +
      mode +
      " persists actionable layer diagnostics",
    async (t) => {
      let store;
      const root = await directory(t, () => store?.close());
      store = await createPresentationStore({
        root,
        authorize: authorizePresentation,
        performance: { mode, layerDownloadBytes: 1 },
      });
      const pkg = await build(fixture());
      const job = await store.import(admin, pkg.archive, {
        idempotencyKey: "performance-test",
      });
      const result = await wait(store, job.id);
      assert.equal(result.state, mode === "warn" ? "ready" : "rejected");
      assert.ok(
        result.report.performance.issues.every(
          (i) => i.layerId && i.path && i.remedy,
        ),
      );
      assert.ok(result.report.performance.issues.length > 0);
      if (mode === "warn")
        assert.equal((await store.publish(admin, job.id)).state, "published");
      else
        await assert.rejects(store.publish(admin, job.id), { code: "STATE" });
    },
  );
test("all grants are exact, disabled admins are denied, ownership protects import jobs", () => {
  for (const granted of PERMISSIONS)
    for (const requested of [...PERMISSIONS, "*", "unknown"])
      assert.equal(
        hasPermission({ permissions: [granted] }, requested),
        granted === requested,
      );
  for (const p of PERMISSIONS)
    assert.equal(hasPermission({ ...admin, disabled: true }, p), false);
  for (const action of [
    "import",
    "read-import",
    "cancel-import",
    "publish",
    "moderate",
  ])
    assert.equal(
      authorizePresentation({ id: "collector", role: "player" }, action, {
        actor: "collector",
      }),
      false,
    );
  for (const action of ["read-import", "cancel-import"]) {
    assert(
      authorizePresentation({ id: "a", permissions: ["art.import"] }, action, {
        actor: "a",
      }),
    );
    assert(
      !authorizePresentation({ id: "a", permissions: ["art.import"] }, action, {
        actor: "b",
      }),
    );
  }
});
test("failed startup releases writer lock so repaired storage can reopen", async (t) => {
  const root = await directory(t);
  await mkdir(path.join(root, "jobs"));
  const corrupt = path.join(root, "jobs", "broken.json");
  await writeFile(corrupt, "{broken");
  await assert.rejects(
    createPresentationStore({ root, authorize: authorizePresentation }),
  );
  await assert.rejects(access(path.join(root, "writer.lock")));
  await rm(corrupt);
  const store = await createPresentationStore({
    root,
    authorize: authorizePresentation,
  });
  await store.close();
  await store.close();
});
test("cancel ready import prevents publication and retention preserves referenced packages", async (t) => {
  let store;
  const root = await directory(t, () => store?.close());
  store = await createPresentationStore({
    root,
    authorize: authorizePresentation,
  });
  const pkg = await build(fixture());
  let job = await store.import(admin, pkg.archive, {
    idempotencyKey: "cancel-ready",
  });
  assert.equal((await wait(store, job.id)).state, "ready");
  assert.equal((await store.cancel(admin, job.id)).state, "cancelled");
  await assert.rejects(store.publish(admin, job.id), /not ready/);
  job = await store.import(admin, pkg.archive, {
    idempotencyKey: "publish-new",
  });
  await wait(store, job.id);
  await store.publish(admin, job.id);
  assert.deepEqual(
    (await store.retentionPlan({ references: [pkg.digest], graceMs: 0 }))
      .candidates,
    [],
  );
  const restored = await store.file(pkg.digest, "download.dcard");
  assert.deepEqual(restored.bytes, pkg.archive);
});
test("a scanner that ignores cancellation cannot hang close or publish an import", async (t) => {
  const root = await directory(t),
    store = await createPresentationStore({
      root,
      authorize: authorizePresentation,
      scan: () => new Promise(() => {}),
      scanTimeoutMs: 25,
    });
  const pkg = await build(fixture());
  const job = await store.import(admin, pkg.archive, {
    idempotencyKey: "hung-scanner",
  });
  const settled = await wait(store, job.id);
  assert.equal(settled.state, "cancelled");
  assert.match(settled.error, /time limit/);
  await store.close();
});

test("compiler cancellation during media processing produces no output descriptor", async (t) => {
  const { compileDirectory, writeCompiled } =
    await import("../src/presentation/compiler.js");
  const root = await directory(t),
    source = path.join(root, "source"),
    out = path.join(root, "compiled"),
    pkg = await build(fixture());
  await writeCompiled(pkg, { out: source });
  const controller = new AbortController();
  await assert.rejects(
    compileDirectory({
      root: source,
      out,
      signal: controller.signal,
      imageProcessor: async (bytes) => {
        controller.abort();
        return { bytes, width: 2, height: 2, mediaType: "image/png" };
      },
    }),
    /abort/i,
  );
  await assert.rejects(access(path.join(out, "card.json")));
});
