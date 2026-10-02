import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteActionHandler } from "@digital-card/framework/remote-actions";
import { fixture, admin } from "./helpers.js";

const token = "example-plugin-fixture-token";
const job = {
  idempotencyKey: "job-fixture",
  userId: "collector",
  source: { type: "card.opened" },
  params: { label: "雪" },
};
const ack = (data) => ({
  protocol: data.protocol,
  pluginId: data.pluginId,
  jobId: data.jobId,
  status: "completed",
});
const options = (url) => ({
  url,
  pluginId: "example.receiver",
  handlerId: "example.record",
  token,
});
async function withReceiver(fn, body) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks));
    await fn(request, response, data);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await body("http://127.0.0.1:" + server.address().port + "/actions");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test("external receiver gets stable committed identity and only a matching acknowledgment settles delivery", async () => {
  const receipts = new Map();
  await withReceiver(
    (request, response, data) => {
      assert.equal(request.headers.authorization, "Bearer " + token);
      assert.equal(request.headers["idempotency-key"], data.jobId);
      assert.equal(data.handlerId, "example.record");
      receipts.set(data.jobId, data);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(ack(data)));
    },
    async (url) => {
      const handler = createRemoteActionHandler(options(url));
      await handler(job);
      await handler(job);
      assert.equal(receipts.size, 1);
      assert.equal(receipts.get(job.idempotencyKey).params.label, "雪");
      const x = fixture({
        actionHandlers: { "example.record": handler },
        change(c) {
          c.variants.find((v) => v.id === "dawn.standard").onOpen = [
            {
              id: "deliver",
              handler: "example.record",
              params: { label: "雪" },
            },
          ];
        },
      });
      try {
        const copy = x.open()[0];
        assert.equal(x.core.fulfillments(x.alice).items[0].status, "pending");
        await x.core.dispatchActions(admin);
        const fulfillment = x.core.fulfillments(x.alice).items[0];
        assert.equal(fulfillment.status, "succeeded");
        assert.equal(
          receipts.get(fulfillment.id).beneficiaryId,
          x.alice.userId,
        );
        assert.equal(receipts.get(fulfillment.id).source.copyId, copy.id);
        assert.equal(x.core.audit(admin).ok, true);
      } finally {
        x.core.close();
      }
    },
  );
});
test("a lost acknowledgment retries the same committed job without another receiver effect", async () => {
  const receipts = new Map();
  let lose = true;
  await withReceiver(
    (_request, response, data) => {
      if (!receipts.has(data.jobId)) receipts.set(data.jobId, data);
      if (lose) {
        lose = false;
        response.destroy();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(ack(data)));
    },
    async (url) => {
      const handler = createRemoteActionHandler(options(url));
      await assert.rejects(handler(job));
      assert.deepEqual(await handler(job), {
        jobId: job.idempotencyKey,
        status: "completed",
      });
      assert.equal(receipts.size, 1);
    },
  );
});

test("wrong plugin/job/version and unknown response fields cannot acknowledge a delivery", async () => {
  for (const patch of [
    { jobId: "other" },
    { pluginId: "other" },
    { protocol: "other" },
    { role: "admin" },
    { status: "pending" },
  ])
    await withReceiver(
      (_request, response, data) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...ack(data), ...patch }));
      },
      async (url) => {
        await assert.rejects(
          createRemoteActionHandler(options(url))(job),
          (error) => error.code === "PLUGIN_RESPONSE",
        );
      },
    );
});
test("response and request byte ceilings, deadlines, cancellation and redirects are enforced", async () => {
  await withReceiver(
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(" ".repeat(500));
    },
    async (url) => {
      await assert.rejects(
        createRemoteActionHandler({ ...options(url), maxResponseBytes: 64 })(
          job,
        ),
        (error) => error.code === "PLUGIN_LIMIT",
      );
    },
  );
  let requests = 0;
  await withReceiver(
    (_request, response) => {
      requests++;
      response.end("{}");
    },
    async (url) => {
      const handler = createRemoteActionHandler({
        ...options(url),
        maxRequestBytes: 10,
      });
      await assert.rejects(
        handler(job),
        (error) => error.code === "PLUGIN_LIMIT",
      );
      const cancelled = new AbortController();
      cancelled.abort();
      await assert.rejects(
        createRemoteActionHandler(options(url))({
          ...job,
          signal: cancelled.signal,
        }),
      );
      assert.equal(requests, 0);
    },
  );
  await withReceiver(
    () => {},
    async (url) => {
      await assert.rejects(
        createRemoteActionHandler({ ...options(url), timeoutMs: 30 })(job),
        (error) => error.code === "PLUGIN_UNAVAILABLE",
      );
      const abort = new AbortController();
      const promise = createRemoteActionHandler(options(url))({
        ...job,
        signal: abort.signal,
      });
      setTimeout(() => abort.abort(), 20);
      await assert.rejects(promise);
    },
  );
  let destinationCalls = 0;
  await withReceiver(
    (_request, response) => {
      destinationCalls++;
      response.end("{}");
    },
    async (destination) =>
      withReceiver(
        (_request, response) => {
          response.writeHead(307, { location: destination });
          response.end();
        },
        async (url) => {
          await assert.rejects(createRemoteActionHandler(options(url))(job));
          assert.equal(destinationCalls, 0);
        },
      ),
  );
  assert.throws(
    () => createRemoteActionHandler(options("http://remote.invalid/actions")),
    (error) => error.code === "PLUGIN_CONFIG",
  );
});

test(
  "Python receiver persists Unicode deliveries and deduplication across restart",
  {
    skip: !process.env.DC_TEST_PYTHON_PLUGIN,
    timeout: 20000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dc-python-plugin-"));
    const database = path.join(root, "deliveries.sqlite");
    let child;
    const stop = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const ended = once(child, "exit");
        child.kill();
        await ended;
      }
      child = null;
    };
    const start = async () => {
      child = spawn(
        process.env.PYTHON ??
          (process.platform === "win32" ? "python" : "python3"),
        [
          fileURLToPath(
            new URL(
              "../examples/plugins/python-action-receiver.py",
              import.meta.url,
            ),
          ),
          database,
        ],
        {
          env: {
            ...process.env,
            PLUGIN_TOKEN: token,
            PYTHONDONTWRITEBYTECODE: "1",
          },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const port = await new Promise((resolve, reject) => {
        let output = "";
        child.once("error", reject);
        child.once("exit", () =>
          reject(Error("Python receiver exited before readiness")),
        );
        child.stdout.on("data", (data) => {
          output += data;
          if (output.includes("\n")) resolve(Number(output.split("\n")[0]));
        });
      });
      assert(Number.isInteger(port) && port > 0);
      return "http://127.0.0.1:" + port + "/actions";
    };
    try {
      let url = await start();
      await createRemoteActionHandler(options(url))(job);
      await createRemoteActionHandler(options(url))(job);
      await assert.rejects(
        createRemoteActionHandler(options(url))({
          ...job,
          params: { label: "different" },
        }),
      );
      await assert.rejects(
        createRemoteActionHandler({
          ...options(url),
          token: "incorrect-credential",
        })(job),
      );
      await stop();
      url = await start();
      await createRemoteActionHandler(options(url))(job);
      const result = spawn(
        process.env.PYTHON ??
          (process.platform === "win32" ? "python" : "python3"),
        [
          "-c",
          "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('SELECT count(*) FROM deliveries').fetchone()[0])",
          database,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      result.stdout.on("data", (data) => {
        output += data;
      });
      assert.equal((await once(result, "exit"))[0], 0);
      assert.equal(output.trim(), "1");
    } finally {
      await stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);
