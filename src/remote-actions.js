import { FrameworkError } from "./catalog.js";

const fail = (code, message, status = 503) => {
  throw new FrameworkError(code, message, status);
};
const protocol = "digital-card-action@1";
const exact = (value, fields) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((key) => Object.hasOwn(value, key));

/** Sends already committed jobs to an operator-configured external receiver. */
export function createRemoteActionHandler({
  url,
  pluginId,
  handlerId,
  token,
  timeoutMs = 10000,
  maxRequestBytes = 65536,
  maxResponseBytes = 8192,
  fetchImpl = globalThis.fetch,
}) {
  const endpoint = new URL(url);
  const local = ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    !(
      endpoint.protocol === "https:" ||
      (endpoint.protocol === "http:" && local)
    )
  )
    fail(
      "PLUGIN_CONFIG",
      "Plugin endpoint requires HTTPS or loopback HTTP",
      400,
    );
  for (const value of [pluginId, handlerId])
    if (
      typeof value !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)
    )
      fail("PLUGIN_CONFIG", "Invalid plugin or handler identifier", 400);
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 4096 ||
    /[\r\n]/.test(token)
  )
    fail("PLUGIN_CONFIG", "Plugin credential required", 400);
  for (const [value, max] of [
    [timeoutMs, 300000],
    [maxRequestBytes, 1048576],
    [maxResponseBytes, 65536],
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      fail("PLUGIN_CONFIG", "Invalid plugin resource limit", 400);
  if (typeof fetchImpl !== "function")
    fail("PLUGIN_CONFIG", "HTTP transport required", 400);

  return async ({ idempotencyKey, userId, source, params, signal }) => {
    if (
      typeof idempotencyKey !== "string" ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      fail("PLUGIN_JOB", "Committed job identity required", 400);
    signal?.throwIfAborted();
    const body = JSON.stringify({
      protocol,
      pluginId,
      handlerId,
      jobId: idempotencyKey,
      beneficiaryId: userId,
      source,
      params,
    });
    if (Buffer.byteLength(body) > maxRequestBytes)
      fail("PLUGIN_LIMIT", "Plugin request too large", 400);
    const deadline = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, deadline])
      : deadline;
    let response;
    try {
      response = await fetchImpl(endpoint.href, {
        method: "POST",
        redirect: "error",
        signal: requestSignal,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
          "idempotency-key": idempotencyKey,
        },
        body,
      });
    } catch {
      fail("PLUGIN_UNAVAILABLE", "Plugin request failed");
    }
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      await response.body?.cancel();
      fail("PLUGIN_RESPONSE", "Plugin acknowledgment rejected");
    }
    const reader = response.body?.getReader();
    if (!reader) fail("PLUGIN_RESPONSE", "Plugin acknowledgment missing");
    let total = 0,
      chunks = [],
      result;
    try {
      while (true) {
        const part = await reader.read();
        requestSignal.throwIfAborted();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxResponseBytes)
          fail("PLUGIN_LIMIT", "Plugin response too large");
        chunks.push(Buffer.from(part.value));
      }
      result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof FrameworkError) throw error;
      fail("PLUGIN_RESPONSE", "Invalid plugin acknowledgment");
    } finally {
      reader.releaseLock();
    }
    if (
      !exact(result, ["protocol", "pluginId", "jobId", "status"]) ||
      result.protocol !== protocol ||
      result.pluginId !== pluginId ||
      result.jobId !== idempotencyKey ||
      result.status !== "completed"
    )
      fail(
        "PLUGIN_RESPONSE",
        "Plugin acknowledgment does not match committed job",
      );
    return { jobId: result.jobId, status: result.status };
  };
}
