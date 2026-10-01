import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture, build } from "./presentation-fixtures.mjs";
import {
  composeExtensions,
  resolveConfiguration,
} from "../src/presentation/extensions.js";
import {
  connectedInputs,
  publicInputs,
  validatePresentationReference,
} from "../src/presentation/integration.js";
import {
  createPresentationStore,
  presentationRoutes,
} from "../src/presentation/service.js";
import {
  signPackage,
  verifySignatures,
} from "../src/presentation/signatures.js";
import { importPackage } from "../src/presentation/package.js";
import { createProject } from "../src/presentation/project.js";
import {
  walletSessions,
  resolveExternalOwnership,
  externalOwnershipState,
} from "../src/presentation/identity.js";
import { Wallet } from "../src/presentation/node_modules/ethers/lib.esm/index.js";
import { SiweMessage } from "../src/presentation/node_modules/siwe/dist/siwe.js";

test("extension conflicts, ordering, versions and override scopes are explicit", () => {
  const module = (id) => ({
    id,
    version: "1.0.0",
    apiVersion: "0.1.0",
    trust: "host-installed",
    provides: ["effect"],
    fallback: "poster",
    create() {},
    estimate: () => 1,
  });
  const a = module("alpha"),
    b = { ...module("beta"), after: ["alpha"] };
  assert.throws(() => composeExtensions([a, b]), /Select/);
  const resolved = composeExtensions([b, a], { select: { effect: "beta" } });
  assert.deepEqual(resolved.explainComposition().order, ["alpha", "beta"]);
  assert.equal(resolved.get("effect"), b);
  assert.throws(
    () =>
      composeExtensions([{ ...a, after: ["beta"] }, b], {
        select: { effect: "beta" },
      }),
    /cycle/,
  );
  assert.throws(
    () => composeExtensions([{ ...a, apiVersion: "2.0.0" }]),
    /Incompatible/,
  );
  const schema = {
    density: {
      default: 0.5,
      type: "number",
      min: 0,
      max: 1,
      scopes: ["host", "author"],
    },
    budget: {
      default: 100,
      type: "number",
      min: 1,
      max: 1000,
      scopes: ["host"],
    },
  };
  assert.deepEqual(
    resolveConfiguration(
      schema,
      [
        { scope: "host", values: { budget: 200 } },
        { scope: "author", values: { density: 0.7 } },
      ],
      { ceilings: { budget: 150 } },
    ),
    { density: 0.7, budget: 150 },
  );
  assert.throws(
    () =>
      resolveConfiguration(schema, [
        { scope: "author", values: { budget: 1000 } },
      ]),
    /not permitted/,
  );
});
test("public values are schema filtered; offline snapshots cannot leak private attributes", () => {
  let now = 100;
  const manifest = {
    inputs: { "host.level": { type: "number", default: 1, min: 1, max: 99 } },
  };
  assert.deepEqual(
    publicInputs(manifest, { "host.level": 999, secret: "code" }),
    { "host.level": 99 },
  );
  const inputs = connectedInputs(manifest, { clock: () => now, maxAgeMs: 10 });
  inputs.update({ "host.level": 5 });
  const snapshot = inputs.snapshot();
  now = 111;
  assert.equal(inputs.read().state, "stale");
  assert.equal(inputs.read().values["host.level"], 1);
  assert.equal(snapshot.values["host.level"], 5);
  assert.throws(() =>
    validatePresentationReference({
      contract: "digital-card@0.1",
      digest: "sha256:" + "a".repeat(64),
      baseURL: "javascript:alert(1)",
    }),
  );
});
test("detached signature proves exact digest using host keys and survives archive import", async () => {
  const pkg = await build(fixture()),
    keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const bytes = await signPackage(pkg.archive, {
      keyId: "publisher",
      privateKey: keys.privateKey,
    }),
    signed = await importPackage(bytes);
  assert.equal(signed.digest, pkg.digest);
  assert.deepEqual(
    await verifySignatures(signed, {
      keys: new Map([["publisher", keys.publicKey]]),
      requireTrusted: true,
    }),
    [{ keyId: "publisher", trusted: true }],
  );
  await assert.rejects(
    verifySignatures(signed, { requireTrusted: true }),
    /No trusted/,
  );
});
test("creator export prunes unused sources and undo restores the selected art", async () => {
  const pkg = await build(fixture()),
    project = createProject(pkg);
  project.edit((p) => {
    for (const s of p.scenes.values()) s.nodes[0].asset = "front";
  });
  const exported = await project.export();
  assert.equal(exported.manifest.assets.length, 2);
  assert.equal(
    (await project.export({ retainSources: true })).manifest.assets.length,
    3,
  );
  project.undoEdit();
  assert.equal((await project.export()).manifest.assets.length, 3);
  project.edit((p) => (p.manifest.title = "Version 2"));
  assert.notEqual((await project.export()).digest, pkg.digest);
});
test("durable importer authorizes, validates in worker, deduplicates and atomically publishes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dcard-service-")),
    actor = { id: "creator" },
    pkg = await build(fixture());
  const authorize = (a, action, job) =>
    a?.id === actor.id && (!job?.actor || job.actor === a.id);
  let store;
  try {
    store = await createPresentationStore({ root, authorize });
    await assert.rejects(
      createPresentationStore({ root, authorize }),
      /already open/,
    );
    await assert.rejects(
      store.import({ id: "intruder" }, pkg.archive, {
        idempotencyKey: "request-1",
      }),
      /authorized/,
    );
    const job = await store.import(actor, pkg.archive, {
      idempotencyKey: "request-1",
    });
    assert.equal(
      (await store.import(actor, pkg.archive, { idempotencyKey: "request-1" }))
        .id,
      job.id,
    );
    await assert.rejects(
      store.import(actor, new Uint8Array([1]), { idempotencyKey: "request-1" }),
      /different bytes/,
    );
    let status;
    for (let i = 0; i < 100; i++) {
      status = await store.get(actor, job.id);
      if (["ready", "rejected"].includes(status.state)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(status.state, "ready", status.error);
    const [one, two] = await Promise.all([
      store.publish(actor, job.id),
      store.publish(actor, job.id),
    ]);
    assert.equal(one.digest, two.digest);
    assert.equal(one.state, "published");
    assert.equal(
      (
        await importPackage(
          new Uint8Array(
            await readFile(
              path.join(root, "content", one.digest.slice(7), "download.dcard"),
            ),
          ),
        )
      ).digest,
      pkg.digest,
    );
    const route = presentationRoutes(store, {
      authenticate: async () => actor,
      maxUploadBytes: 10,
    });
    const response = await route(
      new Request("https://host.test/presentations/imports", {
        method: "POST",
        body: pkg.archive,
        headers: { "idempotency-key": "too-large" },
      }),
    );
    assert.equal(response.status, 413);
    await store.availability(actor, pkg.digest, {
      state: "quarantined",
      reason: "Host review",
    });
    await assert.rejects(store.descriptor(pkg.digest), /unavailable/);
    await store.close();
    store = await createPresentationStore({ root, authorize });
    assert.equal((await store.get(actor, job.id)).state, "published");
    const plan = await store.retentionPlan({
      references: [pkg.digest],
      graceMs: 0,
    });
    assert.deepEqual(plan.candidates, []);
  } finally {
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("wallet proof is single use; external ownership handles reorg and staleness", async () => {
  const wallet = Wallet.createRandom(),
    now = Date.now(),
    session = walletSessions({
      domain: "cards.test",
      uri: "https://cards.test",
      chainIds: [1],
      clock: () => now,
    });
  const challenge = session.challenge("session");
  const message = new SiweMessage({
      ...challenge,
      address: wallet.address,
      chainId: 1,
      statement: "Sign in to cards",
    }).prepareMessage(),
    signature = await wallet.signMessage(message);
  assert.equal(
    (await session.verify("session", { message, signature })).address,
    wallet.address,
  );
  await assert.rejects(
    session.verify("session", { message, signature }),
    /expired/,
  );
  let calls = 0;
  const binding = {
      chainId: 1,
      standard: "erc721",
      contract: "0x0000000000000000000000000000000000000001",
      tokenId: "9007199254740993123",
    },
    provider = {
      getNetwork: async () => ({ chainId: 1n }),
      getBlockNumber: async () => 100,
      getBlock: async () => ({ hash: ++calls === 1 ? "a" : "b" }),
      readToken: async () => ({ owner: wallet.address }),
    };
  assert.equal(
    (
      await resolveExternalOwnership(binding, {
        provider,
        account: wallet.address,
      })
    ).state,
    "reorg",
  );
  provider.getBlock = async () => ({ hash: "a" });
  const result = await resolveExternalOwnership(binding, {
    provider,
    account: wallet.address,
    clock: () => 100,
  });
  assert.equal(result.quantity, "1");
  assert.equal(result.identity.tokenId, binding.tokenId);
  assert.equal(
    externalOwnershipState(result, { clock: () => 999999 }).state,
    "stale",
  );
  assert.equal(externalOwnershipState(result).localTransferAllowed, false);
});
