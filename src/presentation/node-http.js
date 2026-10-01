import { Readable } from "node:stream";
import { presentationRoutes } from "./service.js";
import { FrameworkError, check } from "../catalog.js";

/** Optional Node host adapter. Fetch routes remain available to other server stacks. */
export function createPresentationHandler({
  store,
  resolveIdentity,
  allowedOrigin,
  rateLimit,
  prefix = "/presentations",
  maxUploadBytes,
}) {
  check(
    typeof resolveIdentity === "function" &&
      typeof allowedOrigin === "string" &&
      new URL(allowedOrigin).origin === allowedOrigin,
    "CONFIG",
    "Presentation HTTP requires identity and an exact origin",
  );
  return async (request, response) => {
    const url = new URL(request.url, allowedOrigin);
    if (!url.pathname.startsWith(prefix + "/")) return false;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    try {
      check(
        ["GET", "POST", "DELETE"].includes(request.method),
        "METHOD",
        "Unsupported method",
        405,
      );
      const actor = await resolveIdentity(request);
      check(
        actor?.userId && actor.disabled !== true,
        "UNAUTHENTICATED",
        "Sign in to continue",
        401,
      );
      if (request.method !== "GET") {
        check(
          request.headers.origin === allowedOrigin,
          "ORIGIN_REJECTED",
          "Host origin required",
          403,
        );
        check(
          request.headers["x-dc-principal"] === actor.userId,
          "PRINCIPAL_CHANGED",
          "Signed-in account changed",
          409,
        );
      }
      check(
        !rateLimit ||
          rateLimit({ actor, request, mutation: request.method !== "GET" }),
        "RATE_LIMITED",
        "Too many requests",
        429,
      );
      const handler = presentationRoutes(store, {
        authenticate: async () => ({ ...actor, id: actor.userId }),
        prefix,
        maxUploadBytes,
      });
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (value !== undefined)
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const result = await handler(
        new Request(url, {
          method: request.method,
          headers,
          ...(request.method === "GET"
            ? {}
            : { body: Readable.toWeb(request), duplex: "half" }),
        }),
      );
      response.statusCode = result.status;
      for (const [key, value] of result.headers) response.setHeader(key, value);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.statusCode =
        error instanceof FrameworkError ? error.status : 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          code: error.code ?? "UPLOAD",
          message:
            error instanceof FrameworkError
              ? error.message
              : "Upload request failed",
        }),
      );
    }
    return true;
  };
}
