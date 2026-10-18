import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPresentationStore,
  presentationRoutes,
  validateInWorker,
} from "../src/presentation/service.js";
import { createPresentationHandler } from "../src/presentation/node-http.js";
import { authorizePresentation } from "../src/access.js";
import { build, fixture } from "./presentation-fixtures.mjs";

test("unauthorized uploads are refused before consuming their stream", async () => {
  let consumed = 0;
  const body = new ReadableStream(
    {
      pull() {
        consumed++;
      },
    },
    { highWaterMark: 0 },
  );
  const route = presentationRoutes(
    {
      checkAccess: async () => {
        throw Object.assign(new Error("Not authorized"), { code: "FORBIDDEN" });
      },
    },
    { authenticate: () => ({ id: "collector" }) },
  );
  const response = await route(
    new Request("https://cards.test/presentations/imports", {
      method: "POST",
      body,
      duplex: "half",
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(consumed, 0);
  await body.cancel();
});

test("production upload bridge applies identity, origin, ownership and publication permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "dc-http-"));
  const store = await createPresentationStore({
    root,
    authorize: authorizePresentation,
    performance: { layerDownloadBytes: 1 },
  });
  let actor = { userId: "collector" };
  const handler = createPresentationHandler({
    store,
    resolveIdentity: () => actor,
    allowedOrigin: "https://cards.test",
  });
  const server = createServer(async (req, res) => {
    if (!(await handler(req, res))) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/presentations`;
  const pkg = await build(fixture());
  const upload = (origin = "https://cards.test") =>
    fetch(base + "/imports", {
      method: "POST",
      headers: {
        origin,
        "x-dc-principal": actor.userId,
        "idempotency-key": "real-upload-1",
        "content-type": "application/octet-stream",
      },
      body: pkg.archive,
    });
  try {
    assert.equal((await upload()).status, 403);
    actor = { userId: "creator", permissions: ["art.import"] };
    assert.equal((await upload("https://evil.test")).status, 403);
    const response = await upload();
    assert.equal(response.status, 200);
    const initial = await response.json();
    let job;
    for (let i = 0; i < 200; i++) {
      job = await (await fetch(base + "/imports/" + initial.id)).json();
      if (["ready", "rejected"].includes(job.state)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(job.state, "ready");
    assert.ok(job.report.performance.issues.length);
    const publish = () =>
      fetch(base + "/imports/" + job.id + "/publish", {
        method: "POST",
        headers: {
          origin: "https://cards.test",
          "x-dc-principal": actor.userId,
        },
      });
    assert.equal((await publish()).status, 403);
    actor = { userId: "other", permissions: ["art.import"] };
    assert.equal((await fetch(base + "/imports/" + job.id)).status, 403);
    actor = { userId: "publisher", permissions: ["art.publish"] };
    assert.equal((await publish()).status, 200);
    actor = { userId: "collector" };
    const file = await fetch(base + "/" + job.digest + "/files/card.json");
    assert.equal(file.status, 200);
    assert.equal((await file.json()).id, pkg.manifest.id);
    actor = { userId: "publisher", role: "admin", disabled: true };
    assert.equal((await publish()).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("presentation routes hide storage paths and unexpected provider errors while preserving validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "dc-private-presentation-"));
  const store = await createPresentationStore({ root, authorize: () => true });
  const route = presentationRoutes(store, { authenticate: () => ({ id: "collector" }) });
  const digest = "sha256:" + "a".repeat(64);
  try {
    for (const suffix of ["descriptor", "download", "files/card.json"]) {
      const response = await route(new Request(`https://cards.test/presentations/${digest}/${suffix}`));
      const body = await response.text();
      assert(!JSON.parse(body).message.includes(root) && !body.includes("ENOENT"), "Missing content disclosed storage details");
      assert.equal(response.status, 404);
      assert.equal(JSON.parse(body).error, "NOT_FOUND");
    }
    const invalid = await route(new Request("https://cards.test/presentations/invalid/descriptor"));
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "DIGEST", message: "Invalid digest" });
    const missingJob = await route(new Request("https://cards.test/presentations/imports/unknown"));
    assert.equal(missingJob.status, 404);
    assert.deepEqual(await missingJob.json(), { error: "NOT_FOUND", message: "Unknown import" });
    const limited = presentationRoutes(store, { authenticate: () => ({ id: "collector" }), maxUploadBytes: 1 });
    const limit = await limited(new Request("https://cards.test/presentations/imports", { method: "POST", body: new Uint8Array([1, 2]), headers: { "idempotency-key": "bounded-import" } }));
    assert.equal(limit.status, 413);
    assert.deepEqual(await limit.json(), { error: "LIMIT", message: "Upload too large" });
    const privateDetail = join(root, "synthetic-private-scanner") + " SYNTHETIC_PROVIDER_SECRET";
    const failing = presentationRoutes({ descriptor: async () => { throw new Error(privateDetail); } }, { authenticate: () => ({ id: "collector" }) });
    const unexpected = await failing(new Request(`https://cards.test/presentations/${digest}/descriptor`));
    const safe = await unexpected.text();
    assert(!safe.includes(root) && !safe.includes("SYNTHETIC_PROVIDER_SECRET"));
    assert.equal(JSON.parse(safe).error, "IMPORT");
    const pkg = await build(fixture()), actor = { id: "creator" };
    const imported = await store.import(actor, pkg.archive, { idempotencyKey: "published-missing-file" });
    let job;
    for (let n = 0; n < 200; n++) { job = await store.get(actor, imported.id); if (["ready", "rejected"].includes(job.state)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(job.state, "ready", job.error);
    await store.publish(actor, job.id);
    await unlink(join(root, "content", pkg.digest.slice(7), "download.dcard"));
    const absentFile = await route(new Request(`https://cards.test/presentations/${pkg.digest}/download`));
    assert.equal(absentFile.status, 404);
    assert(!JSON.stringify(await absentFile.json()).includes(root));
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("failed validation and scanner jobs never persist or return private exception details", async () => {
  const pkg = await build(fixture());
  for (const phase of ["validation", "scan"]) {
    const root = await mkdtemp(join(tmpdir(), "dc-private-job-"));
    const failure = () => { throw Object.assign(new Error(join(root, "synthetic-private-provider") + " SYNTHETIC_PROVIDER_SECRET"), { code: "IMPORT" }); };
    const options = { root, authorize: () => true, ...(phase === "validation" ? { validate: failure } : { scan: failure }) };
    let store = await createPresentationStore(options);
    const actor = { id: "creator" };
    try {
      const imported = await store.import(actor, pkg.archive, { idempotencyKey: "private-failure-" + phase });
      let job;
      for (let n = 0; n < 200; n++) { job = await store.get(actor, imported.id); if (job.state === "rejected") break; await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.equal(job.state, "rejected");
      assert(!Object.hasOwn(job, "errorSafe"));
      assert(!job.error.includes(root) && !job.error.includes("SYNTHETIC_PROVIDER_SECRET"), "Import outcome disclosed private exception details");
      const persisted = await readFile(join(root, "jobs", imported.id + ".json"), "utf8");
      assert(!persisted.includes("SYNTHETIC_PROVIDER_SECRET"));
      await store.close();
      store = await createPresentationStore(options);
      const route = presentationRoutes(store, { authenticate: () => actor });
      const response = await route(new Request("https://cards.test/presentations/imports/" + imported.id));
      assert.equal(response.status, 200);
      const body = await response.text();
      assert(!body.includes(root) && !body.includes("SYNTHETIC_PROVIDER_SECRET"));
      assert.equal(JSON.parse(body).error, job.error);
      assert(!Object.hasOwn(JSON.parse(body), "errorSafe"));
      await store.close();
      const legacy = JSON.parse(persisted);
      if (phase === "validation") legacy.errorSafe = "true";
      else delete legacy.errorSafe;
      legacy.error = join(root, "legacy-private-provider") + " SYNTHETIC_LEGACY_SECRET";
      await writeFile(join(root, "jobs", imported.id + ".json"), JSON.stringify(legacy));
      store = await createPresentationStore(options);
      const historical = await store.get(actor, imported.id);
      assert.equal(historical.state, "rejected");
      assert.equal(historical.actor, legacy.actor);
      assert.equal(historical.createdAt, legacy.createdAt);
      assert.equal(historical.id, legacy.id);
      assert.equal(historical.key, legacy.key);
      assert(!historical.error.includes(root) && !historical.error.includes("SYNTHETIC_LEGACY_SECRET"));
      assert(!Object.hasOwn(historical, "errorSafe"));
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("actual import worker preserves safe package diagnostics and masks private filesystem failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "dc-worker-error-"));
  const store = await createPresentationStore({ root, authorize: () => true });
  const actor = { id: "creator" };
  try {
    const imported = await store.import(actor, new Uint8Array([1, 2, 3]), { idempotencyKey: "invalid-archive" });
    let job;
    for (let n = 0; n < 200; n++) { job = await store.get(actor, imported.id); if (job.state === "rejected") break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(job.state, "rejected");
    assert.equal(job.error, "Archive size limit");
    assert(!Object.hasOwn(job, "errorSafe"));
    await assert.rejects(validateInWorker(join(root, "SYNTHETIC_PRIVATE_PROVIDER")), error => {
      assert.equal(error.message, "Import worker failed");
      assert.equal(error.code, "IMPORT");
      assert(!error.message.includes(root));
      return true;
    });
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
