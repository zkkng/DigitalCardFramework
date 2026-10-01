/** Node-only single-process durable import store. Mount behind the host's authentication. */
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import {
  ensure,
  sha256,
  utf8,
  canonical,
  parseJSON,
  text,
  safePath,
} from "./data.js";
import { publishPackage } from "./compiler.js";
import { DEFAULT_LIMITS } from "./package.js";

const atomic = async (file, value) => {
  const tmp = file + "." + randomUUID() + ".tmp";
  await writeFile(tmp, utf8(canonical(value)), { flag: "wx" });
  await rename(tmp, file);
};
export async function validateInWorker(
  file,
  { limits = DEFAULT_LIMITS, timeoutMs = 30000, signal } = {},
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import-worker.js", import.meta.url), {
      workerData: { path: file, limits },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () =>
      finish(new DOMException("Import cancelled", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("Import worker time limit exceeded")),
      timeoutMs,
    );
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!done) finish(new Error("Import worker exited " + code));
    });
    worker.once("message", (result) =>
      result.ok
        ? finish(null, result)
        : finish(
            Object.assign(new Error(result.message), { code: result.code }),
          ),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function createPresentationStore({
  root,
  authorize,
  limits = {},
  scan = async () => {},
  scanTimeoutMs = 30000,
  allowCapabilities = null,
  maxPendingPerActor = 3,
  maxStoredUploadBytes = 512 * 1024 * 1024,
  clock = Date.now,
}) {
  ensure(
    typeof authorize === "function",
    "AUTH",
    "Host authorization callback required",
  );
  ensure(
    Number.isSafeInteger(scanTimeoutMs) &&
      scanTimeoutMs >= 1 &&
      scanTimeoutMs <= 300000,
    "LIMIT",
    "Invalid scan timeout",
  );
  root = path.resolve(root);
  const jobsDir = path.join(root, "jobs"),
    uploads = path.join(root, "quarantine"),
    contentRoot = path.join(root, "content");
  await Promise.all(
    [jobsDir, uploads, contentRoot].map((p) => mkdir(p, { recursive: true })),
  );
  const lock = await import("node:fs/promises").then((fs) =>
    fs.open(path.join(root, "writer.lock"), "wx").catch(() => {
      throw new Error(
        "Presentation store already open; use one writer or a transactional storage adapter",
      );
    }),
  );
  const jobs = new Map(),
    controllers = new Map();
  let closed = false,
    tail = Promise.resolve();
  const ceiling = { ...DEFAULT_LIMITS, ...limits };
  try {
    for (const file of await readdir(jobsDir))
      if (file.endsWith(".json")) {
        const job = parseJSON(await readFile(path.join(jobsDir, file), "utf8"));
        if (["received", "validating", "compiling"].includes(job.state)) {
          job.state = "rejected";
          job.error = "Worker interrupted; retry with a new import key";
          await atomic(path.join(jobsDir, file), job);
        }
        jobs.set(job.id, job);
      }
  } catch (error) {
    await lock.close();
    await unlink(path.join(root, "writer.lock"));
    throw error;
  }
  const serialize = (fn) => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
  const permitted = async (actor, action, resource) => {
    ensure(!closed, "CLOSED", "Store closed");
    ensure(
      await authorize(actor, action, resource),
      "FORBIDDEN",
      "Not authorized",
    );
  };
  const save = (job) => atomic(path.join(jobsDir, job.id + ".json"), job);
  const publicJob = (job) =>
    structuredClone(
      Object.fromEntries(
        Object.entries(job).filter(([key]) => key !== "uploadPath"),
      ),
    );
  async function run(job) {
    const controller = new AbortController();
    controllers.set(job.id, controller);
    try {
      job.state = "validating";
      await save(job);
      const validation = await validateInWorker(job.uploadPath, {
        limits: ceiling,
        signal: controller.signal,
      });
      if (allowCapabilities)
        ensure(
          validation.capabilities.required.every((c) =>
            allowCapabilities.includes(c),
          ),
          "CAPABILITY",
          "Required capability is not approved by this host",
        );
      job.state = "compiling";
      await save(job);
      // Native decoders/transcoders are host jobs with OS/container limits, never archive hooks.
      let timer, abort;
      try {
        await Promise.race([
          Promise.resolve().then(() =>
            scan({
              path: job.uploadPath,
              digest: validation.digest,
              signal: controller.signal,
            }),
          ),
          new Promise((_, reject) => {
            abort = () =>
              reject(new DOMException("Import cancelled", "AbortError"));
            controller.signal.addEventListener("abort", abort, { once: true });
            timer = setTimeout(() => {
              reject(new Error("Media scan time limit exceeded"));
              controller.abort();
            }, scanTimeoutMs);
            if (controller.signal.aborted) abort();
          }),
        ]);
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abort);
      }
      controller.signal.throwIfAborted();
      job.digest = validation.digest;
      job.report = validation.report;
      job.state = "ready";
    } catch (error) {
      job.state = controller.signal.aborted ? "cancelled" : "rejected";
      job.error = String(error.message).slice(0, 1000);
    } finally {
      try {
        await save(job);
      } finally {
        controllers.delete(job.id);
      }
    }
  }
  return {
    async import(actor, bytes, { idempotencyKey } = {}) {
      await permitted(actor, "import");
      ensure(
        typeof actor.id === "string" &&
          typeof idempotencyKey === "string" &&
          idempotencyKey.length >= 8 &&
          idempotencyKey.length <= 200,
        "IDEMPOTENCY",
        "Actor and import key required",
      );
      ensure(
        bytes instanceof Uint8Array && bytes.length <= ceiling.compressed,
        "LIMIT",
        "Upload too large",
      );
      const hash = await sha256(bytes);
      return serialize(async () => {
        const prior = [...jobs.values()].find(
          (j) => j.actor === actor.id && j.key === idempotencyKey,
        );
        if (prior) {
          ensure(
            prior.uploadHash === hash,
            "IDEMPOTENCY",
            "Import key used for different bytes",
          );
          return publicJob(prior);
        }
        ensure(
          [...jobs.values()].filter(
            (j) =>
              j.actor === actor.id &&
              ["received", "validating", "compiling"].includes(j.state),
          ).length < maxPendingPerActor,
          "QUOTA",
          "Too many pending imports",
        );
        let stored = 0;
        for (const file of await readdir(uploads))
          stored += (await stat(path.join(uploads, file))).size;
        ensure(
          stored + bytes.length <= maxStoredUploadBytes,
          "QUOTA",
          "Quarantine storage quota exceeded",
        );
        const id = randomUUID(),
          uploadPath = path.join(uploads, id + ".dcard");
        await writeFile(uploadPath, bytes, { flag: "wx" });
        const job = {
          id,
          actor: actor.id,
          key: idempotencyKey,
          uploadHash: hash,
          uploadPath,
          createdAt: clock(),
          state: "received",
        };
        await save(job);
        jobs.set(id, job);
        void run(job).catch((error) => {
          job.state = "rejected";
          job.error = "Unable to persist import outcome";
        });
        return publicJob(job);
      });
    },
    async get(actor, id) {
      const job = jobs.get(id);
      ensure(job, "NOT_FOUND", "Unknown import");
      await permitted(actor, "read-import", publicJob(job));
      return publicJob(job);
    },
    async cancel(actor, id) {
      return serialize(async () => {
        const job = jobs.get(id);
        ensure(job, "NOT_FOUND", "Unknown import");
        await permitted(actor, "cancel-import", publicJob(job));
        controllers.get(id)?.abort();
        if (job.state === "ready") {
          job.state = "cancelled";
          await save(job);
        }
        return publicJob(job);
      });
    },
    async publish(actor, id) {
      return serialize(async () => {
        const job = jobs.get(id);
        ensure(job, "NOT_FOUND", "Unknown import");
        await permitted(actor, "publish", publicJob(job));
        ensure(
          ["ready", "published"].includes(job.state),
          "STATE",
          "Import is not ready",
        );
        if (job.state === "published") return publicJob(job);
        const result = await publishPackage(
          new Uint8Array(await readFile(job.uploadPath)),
          { contentRoot, limits: ceiling },
        );
        ensure(
          result.digest === job.digest,
          "INTEGRITY",
          "Staged bytes changed",
        );
        job.state = "published";
        job.publishedAt = clock();
        await save(job);
        return publicJob(job);
      });
    },
    async availability(actor, digest, policy) {
      ensure(/^sha256:[a-f0-9]{64}$/.test(digest), "DIGEST", "Invalid digest");
      await permitted(actor, "moderate", { digest });
      ensure(
        ["available", "quarantined"].includes(policy.state),
        "POLICY",
        "Invalid availability",
      );
      await atomic(
        path.join(contentRoot, digest.slice(7), "availability.json"),
        {
          state: policy.state,
          reason: String(policy.reason ?? "").slice(0, 500),
          at: clock(),
        },
      );
    },
    async descriptor(digest) {
      ensure(/^sha256:[a-f0-9]{64}$/.test(digest), "DIGEST", "Invalid digest");
      const folder = path.join(contentRoot, digest.slice(7));
      let availability;
      try {
        availability = parseJSON(
          await readFile(path.join(folder, "availability.json"), "utf8"),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      ensure(
        availability?.state !== "quarantined",
        "QUARANTINED",
        "Presentation unavailable",
      );
      return parseJSON(await readFile(path.join(folder, "card.json"), "utf8"));
    },
    async file(digest, relative) {
      safePath(relative);
      const manifest = await this.descriptor(digest),
        folder = path.join(contentRoot, digest.slice(7));
      const allowed = new Set([
        "card.json",
        "integrity.json",
        "download.dcard",
        ...Object.values(manifest.faces).map((f) => f.scene),
        ...manifest.assets.map((a) => a.path),
      ]);
      ensure(allowed.has(relative), "NOT_FOUND", "Unknown presentation file");
      return {
        bytes: new Uint8Array(await readFile(path.join(folder, relative))),
        mediaType:
          manifest.assets.find((a) => a.path === relative)?.mediaType ??
          (relative.endsWith(".json") ? "application/json" : "application/zip"),
      };
    },
    async retentionPlan({ references = [], graceMs = 30 * 86400000 } = {}) {
      const retained = new Set(references),
        candidates = [];
      for (const digest of await readdir(contentRoot)) {
        if (!/^[a-f0-9]{64}$/.test(digest)) continue;
        const full = "sha256:" + digest,
          info = await stat(path.join(contentRoot, digest));
        if (!retained.has(full) && clock() - info.mtimeMs > graceMs)
          candidates.push(full);
      }
      return {
        generatedAt: clock(),
        candidates,
        action: "review-only",
        note: "Supply catalog, issued-copy, assembly, export and pending-job references. No deletion is performed.",
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const c of controllers.values()) c.abort();
      await tail;
      while (controllers.size) await new Promise((r) => setTimeout(r, 10));
      await lock.close();
      await unlink(path.join(root, "writer.lock"));
    },
  };
}

/** Fetch-style route adapter. Authentication and origin/CSRF policy belong to the host. */
export function presentationRoutes(
  store,
  {
    authenticate,
    maxUploadBytes = DEFAULT_LIMITS.compressed,
    prefix = "/presentations",
  } = {},
) {
  ensure(
    typeof authenticate === "function",
    "AUTH",
    "Authentication callback required",
  );
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(prefix + "/")) return null;
    try {
      const actor = await authenticate(request);
      ensure(actor, "FORBIDDEN", "Authentication required");
      const route = url.pathname.slice(prefix.length),
        parts = route.split("/").filter(Boolean);
      let result;
      if (request.method === "POST" && route === "/imports") {
        ensure(
          !request.headers.get("content-encoding"),
          "UPLOAD",
          "Encoded uploads are not accepted",
        );
        const reader = request.body?.getReader();
        ensure(reader, "UPLOAD", "Upload body required");
        const chunks = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            ensure(length <= maxUploadBytes, "LIMIT", "Upload too large");
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        result = await store.import(actor, bytes, {
          idempotencyKey: request.headers.get("idempotency-key"),
        });
      } else if (
        parts[0] === "imports" &&
        parts.length === 2 &&
        request.method === "GET"
      )
        result = await store.get(actor, parts[1]);
      else if (
        parts[0] === "imports" &&
        parts[2] === "publish" &&
        parts.length === 3 &&
        request.method === "POST"
      )
        result = await store.publish(actor, parts[1]);
      else if (
        parts[0] === "imports" &&
        parts.length === 2 &&
        request.method === "DELETE"
      )
        result = await store.cancel(actor, parts[1]);
      else if (
        request.method === "GET" &&
        (parts[1] === "download" || parts[1] === "files")
      ) {
        const file = await store.file(
          parts[0],
          parts[1] === "download" ? "download.dcard" : parts.slice(2).join("/"),
        );
        return new Response(file.bytes, {
          headers: {
            "content-type": file.mediaType,
            "cache-control": "private, max-age=60",
            "x-content-type-options": "nosniff",
          },
        });
      } else if (
        parts[1] === "descriptor" &&
        parts.length === 2 &&
        request.method === "GET"
      )
        result = await store.descriptor(parts[0]);
      else return new Response("Not found", { status: 404 });
      return Response.json(result, {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return Response.json(
        { error: error.code ?? "IMPORT", message: error.message },
        {
          status:
            error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND"
                ? 404
                : error.code === "LIMIT"
                  ? 413
                  : 400,
        },
      );
    }
  };
}
