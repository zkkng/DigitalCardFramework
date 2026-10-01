import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { hasPermission, authorizePresentation } from "../src/access.js";
import { SessionStore, createAuthHost } from "../src/auth.js";
import { createFrameworkServer } from "../src/http.js";
import { fixture } from "./helpers.js";

test("collector and creator grants cannot mutate catalog, currency or another import job", () => {
  const x = fixture(),
    creator = {
      ...x.alice,
      permissions: ["catalog.read", "catalog.preview", "art.import"],
    };
  assert.equal(x.core.operatorCatalog(creator).version, 1);
  assert.throws(
    () => x.core.publishCatalog(creator, x.c),
    (e) => e.code === "FORBIDDEN",
  );
  assert.throws(
    () =>
      x.core.grantCurrency(creator, {
        userId: x.a.id,
        currencyId: "credits",
        amount: 100,
        reason: "No",
        key: "no",
      }),
    (e) => e.code === "FORBIDDEN",
  );
  assert.throws(
    () => x.core.operatorCatalog(x.alice),
    (e) => e.code === "FORBIDDEN",
  );
  assert(
    authorizePresentation({ ...creator, id: "artist" }, "read-import", {
      actor: "artist",
    }),
  );
  assert(
    !authorizePresentation({ ...creator, id: "artist" }, "read-import", {
      actor: "someone-else",
    }),
  );
  assert(
    !authorizePresentation({ ...creator, id: "artist" }, "publish", {
      actor: "artist",
    }),
  );
  assert(!hasPermission({ role: "admin", disabled: true }, "catalog.publish"));
  assert(!hasPermission({ role: "admin" }, "unknown.permission"));
  x.core.close();
});
test("server reevaluates issuer-bound permissions and disablement for an existing session", () => {
  const sessions = new SessionStore(":memory:", {
      encryptionKey: randomBytes(32),
    }),
    identity = { userId: "u", issuer: "https://issuer.test", subject: "s" },
    secret = sessions.create("session", identity, 60000);
  let permissions = ["art.import"],
    disabled = false;
  const host = createAuthHost({
      sessions,
      origin: "https://cards.test",
      resolveAccess: (verified) => {
        assert.deepEqual(verified, identity);
        return { permissions, disabled };
      },
    }),
    request = { headers: { cookie: "__Host-dc_session=" + secret } };
  assert.deepEqual(host.resolveIdentity(request).permissions, ["art.import"]);
  permissions = [];
  assert.deepEqual(host.resolveIdentity(request).permissions, []);
  disabled = true;
  assert.equal(host.resolveIdentity(request), null);
  sessions.close();
});
test("HTTP direct requests cannot elevate permissions through JSON or bypass a read-only grant", async () => {
  const x = fixture();
  let actor = { ...x.alice, permissions: ["catalog.read"] };
  const server = createFrameworkServer({
    framework: x.core,
    resolveIdentity: () => actor,
    allowedOrigin: "https://cards.test",
    exposeOperators: true,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/api/operator/catalog")).status, 200);
    const response = await fetch(base + "/api/operator/import/commit", {
      method: "POST",
      headers: {
        origin: "https://cards.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        role: "admin",
        permissions: ["catalog.publish"],
        manifest: x.c,
      }),
    });
    assert.equal(response.status, 403);
    actor = x.alice;
    assert.equal((await fetch(base + "/api/operator/catalog")).status, 403);
    assert.equal(x.core.catalog().version, 1);
  } finally {
    await new Promise((r) => server.close(r));
    x.core.close();
  }
});
