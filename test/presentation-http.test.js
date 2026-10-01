import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPresentationStore,
  presentationRoutes,
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
