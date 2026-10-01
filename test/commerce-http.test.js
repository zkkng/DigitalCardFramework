import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApiHandler } from "../src/http.js";
import { fixture, admin } from "./helpers.js";

test("commerce HTTP rejects authority forgery, foreign stock, hostile origins and action acknowledgments", async (t) => {
  const x = fixture(),
    seller = { ...x.alice, role: "admin" };
  const shop = x.core.createShop(seller, {
      key: "shop",
      kind: "admin",
      name: "Shop",
    }),
    l = x.core.createListing(seller, {
      key: "stock",
      shopId: shop.id,
      title: "Card",
      price: { currencyId: "credits", amount: 10 },
      items: { kind: "mint-card", variantId: "dawn.standard", quantity: 1 },
    });
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  handler = createApiHandler({
    framework: x.core,
    allowedOrigin: origin,
    exposeOperators: true,
    resolveIdentity: (r) =>
      r.headers.authorization === "admin"
        ? seller
        : r.headers.authorization === "buyer"
          ? x.bob
          : null,
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
    x.core.close();
  });
  const call = (path, body, auth = "buyer", requestOrigin = origin) =>
    fetch(origin + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: auth,
        Origin: requestOrigin,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal(
    (
      await call("/operator/trading", {
        key: "p",
        expectedRevision: 0,
        policy: {},
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/operator/commerce", {
        key: "p",
        expectedRevision: 0,
        settings: { playerShops: true },
        permissions: ["commerce.manage"],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/shops", {
        key: "s",
        name: "Stolen",
        kind: "admin",
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/listings", {
        key: "l",
        shopId: shop.id,
        title: "Stolen",
        price: { currencyId: "credits", amount: 0 },
        items: { kind: "mint-card", quantity: 1, variantId: "dawn.standard" },
      })
    ).status,
    404,
  );
  assert.equal((await call("/listings", undefined, "missing")).status, 401);
  assert.equal((await call("/operator/actions")).status, 403);
  assert.equal(
    (
      await call("/actions/settle", {
        jobId: "fake",
        succeeded: true,
        role: "admin",
      })
    ).status,
    404,
  );
  const q = await (await call("/listings/quote", { listingId: l.id })).json();
  assert.equal(
    (
      await call(
        "/listings/buy",
        { ...q, key: "buy" },
        "buyer",
        "https://evil.example",
      )
    ).status,
    403,
  );
  const bought = await call("/listings/buy", {
    ...q,
    key: "buy",
    price: { currencyId: "credits", amount: 0 },
  });
  assert.equal(bought.status, 200);
  assert.equal(bought.headers.get("cache-control"), "no-store");
  assert.equal(x.core.wallet(x.bob).credits, 9990);
  assert.equal(x.core.audit(admin).ok, true);
});
