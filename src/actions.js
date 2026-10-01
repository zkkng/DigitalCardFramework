import { randomUUID } from "node:crypto";
import { check, integer, text, jsonObject } from "./catalog.js";
import { hasPermission } from "./access.js";
import { contentDigest } from "./importer.js";
import { page } from "./data.js";

export function enqueueAction(
  s,
  { handler, params = {}, userId = null, source },
  at,
) {
  text(handler, "action handler", 100);
  jsonObject(params);
  jsonObject(source);
  s.actionJobs ??= {};
  const job = {
    id: randomUUID(),
    handler,
    params: structuredClone(params),
    userId,
    source: structuredClone(source),
    status: "pending",
    attempts: 0,
    totalAttempts: 0,
    history: [{ type: "queued", at }],
    createdAt: at,
    nextAt: at,
    leaseToken: null,
    leaseUntil: null,
    error: null,
    completedAt: null,
  };
  s.actionJobs[job.id] = job;
  return job;
}
export function openingActions(s, copy, userId, at) {
  copy.actionJobIds ??= [];
  for (const action of copy.variant.onOpen ?? [])
    copy.actionJobIds.push(
      enqueueAction(
        s,
        {
          handler: action.handler,
          params: action.params,
          userId,
          source: {
            type: "card.opened",
            copyId: copy.id,
            actionId: action.id,
            packId: copy.source?.packId ?? null,
          },
        },
        at,
      ).id,
    );
}
const operator = (actor, permission) =>
  check(
    hasPermission(actor, permission),
    "FORBIDDEN",
    "Action operator permission required",
    403,
  );
const view = (job) => ({
  id: job.id,
  handler: job.handler,
  userId: job.userId,
  source: job.source,
  status: job.status,
  attempts: job.attempts,
  createdAt: job.createdAt,
  nextAt: job.nextAt,
  completedAt: job.completedAt,
  error: job.error,
  totalAttempts: job.totalAttempts ?? job.attempts,
  history: job.history ?? [],
});
export class ActionService {
  #store;
  #clock;
  #handlers;
  #options;
  constructor({ store, clock, handlers = {}, options = {} }) {
    this.#store = store;
    this.#clock = clock;
    this.#handlers = handlers;
    this.#options = {
      maxAttempts: 8,
      leaseMs: 60000,
      timeoutMs: 15000,
      retryMs: 1000,
      ...options,
    };
    for (const [k, max] of Object.entries({
      maxAttempts: 100,
      leaseMs: 3600000,
      timeoutMs: 300000,
      retryMs: 3600000,
    }))
      integer(this.#options[k], k, 1, max);
    check(
      this.#options.leaseMs > this.#options.timeoutMs,
      "INVALID_INPUT",
      "Action lease must exceed execution timeout",
    );
  }
  history(actor, options = {}, all = false) {
    if (all) operator(actor, "actions.manage");
    return this.#store.read((s) => {
      if (!all)
        check(
          actor?.disabled !== true &&
            actor?.userId &&
            Object.hasOwn(s.users, actor.userId),
          "UNAUTHENTICATED",
          "Verified account required",
          401,
        );
      return page(
        Object.values(s.actionJobs ?? {})
          .filter((j) => all || j.userId === actor.userId)
          .map(view),
        options,
      );
    });
  }
  retry(actor, { key, jobId }) {
    operator(actor, "actions.manage");
    text(jobId, "job ID", 100);
    text(key, "retry key", 128);
    return this.#store.transact((s) => {
      s.actionRetryRequests ??= {};
      const token = contentDigest({ actorId: actor.userId ?? "operator", key }),
        old = s.actionRetryRequests[token];
      if (old) {
        check(
          old.jobId === jobId,
          "IDEMPOTENCY_CONFLICT",
          "Retry key already used",
          409,
        );
        return old.result;
      }
      check(
        Object.keys(s.actionRetryRequests).length < 20000,
        "INSTALLATION_CAPACITY",
        "Action retry capacity reached",
        507,
      );
      const j = s.actionJobs?.[jobId];
      check(j, "NOT_FOUND", "Action not found", 404);
      check(
        j.status === "dead",
        "ACTION_STATE",
        "Only dead actions can be retried",
        409,
      );
      check(
        (j.history?.length ?? 0) <= 1997,
        "INSTALLATION_CAPACITY",
        "Action history capacity reached; operator review required",
        507,
      );
      j.status = "pending";
      j.attempts = 0;
      j.nextAt = this.#clock();
      j.error = null;
      j.retryCount = (j.retryCount ?? 0) + 1;
      (j.history ??= []).push({
        type: "retry-requested",
        at: this.#clock(),
        actorId: actor.userId ?? null,
      });
      const result = view(j);
      s.actionRetryRequests[token] = { jobId, result };
      return result;
    });
  }
  claim(actor) {
    operator(actor, "actions.dispatch");
    return this.#store.transact((s) => {
      const at = this.#clock(),
        now = Date.parse(at);
      for (const j of Object.values(s.actionJobs ?? {})) {
        if (
          !(
            (j.status === "pending" && Date.parse(j.nextAt) <= now) ||
            (j.status === "running" && Date.parse(j.leaseUntil) <= now)
          )
        )
          continue;
        if (j.attempts >= this.#options.maxAttempts) {
          j.status = "dead";
          j.error =
            "Delivery attempts exhausted; provider reconciliation required";
          j.leaseToken = null;
          j.leaseUntil = null;
          continue;
        }
        if ((j.history?.length ?? 0) > 1998) {
          j.status = "dead";
          j.error = "Action history capacity reached; operator review required";
          j.leaseToken = null;
          j.leaseUntil = null;
          continue;
        }
        j.status = "running";
        j.attempts++;
        j.totalAttempts = (j.totalAttempts ?? 0) + 1;
        (j.history ??= []).push({
          type: "attempt-started",
          at,
          attempt: j.totalAttempts,
        });
        j.leaseToken = randomUUID();
        j.leaseUntil = new Date(now + this.#options.leaseMs).toISOString();
        return structuredClone(j);
      }
      return null;
    });
  }
  settle(actor, { jobId, leaseToken, succeeded }) {
    operator(actor, "actions.dispatch");
    check(
      typeof succeeded === "boolean",
      "INVALID_INPUT",
      "Delivery result must be boolean",
    );
    return this.#store.transact((s) => {
      const j = s.actionJobs?.[jobId];
      check(
        j?.status === "running" &&
          j.leaseToken === leaseToken &&
          Date.parse(j.leaseUntil) > Date.parse(this.#clock()),
        "ACTION_LEASE",
        "Delivery lease is no longer current",
        409,
      );
      j.leaseToken = null;
      j.leaseUntil = null;
      (j.history ??= []).push({
        type: succeeded ? "succeeded" : "unconfirmed",
        at: this.#clock(),
        attempt: j.totalAttempts ?? j.attempts,
      });
      if (succeeded) {
        j.status = "succeeded";
        j.completedAt = this.#clock();
        j.error = null;
      } else {
        j.status = j.attempts >= this.#options.maxAttempts ? "dead" : "pending";
        j.error =
          "Delivery not confirmed; provider reconciliation may be required";
        j.nextAt = new Date(
          Date.parse(this.#clock()) +
            Math.min(
              3600000,
              this.#options.retryMs * 2 ** Math.min(j.attempts - 1, 20),
            ),
        ).toISOString();
      }
      return view(j);
    });
  }
  async dispatch(actor, { limit = 10, signal } = {}) {
    operator(actor, "actions.dispatch");
    integer(limit, "dispatch limit", 1, 100);
    const results = [];
    for (let i = 0; i < limit && !signal?.aborted; i++) {
      const job = this.claim(actor);
      if (!job) break;
      const controller = new AbortController();
      let timer, abort;
      let succeeded = false;
      try {
        const handler =
          Object.hasOwn(this.#handlers, job.handler) &&
          this.#handlers[job.handler];
        check(
          typeof handler === "function",
          "ACTION_HANDLER",
          "Action handler unavailable",
          503,
        );
        await Promise.race([
          Promise.resolve().then(() =>
            handler({
              idempotencyKey: job.id,
              userId: job.userId,
              source: structuredClone(job.source),
              params: structuredClone(job.params),
              signal: controller.signal,
            }),
          ),
          new Promise((_, reject) => {
            abort = () => {
              controller.abort();
              reject(new Error("Canceled"));
            };
            signal?.addEventListener("abort", abort, { once: true });
            timer = setTimeout(abort, this.#options.timeoutMs);
            if (signal?.aborted) abort();
          }),
        ]);
        succeeded = !controller.signal.aborted;
      } catch {
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.abort();
      }
      try {
        results.push(
          this.settle(actor, {
            jobId: job.id,
            leaseToken: job.leaseToken,
            succeeded,
          }),
        );
      } catch (error) {
        if (error.code !== "ACTION_LEASE") throw error;
        results.push({ id: job.id, status: "lease-lost" });
      }
    }
    return results;
  }
}
