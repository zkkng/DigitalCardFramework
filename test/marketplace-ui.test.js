import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Window } from "happy-dom";
import { fixture } from "./helpers.js";
import { renderMarketplace } from "../src/marketplace-ui.js";
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
const click = (node, label) => {
  const b = [...node.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  assert(b, label);
  b.click();
};
const field = (node, label) => {
  const l = [...node.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent === label,
  );
  assert(l, label);
  return l.querySelector("input,select,textarea");
};

test("default admin listing form reserves stock through public commands and renderer cleanup occurs on review close and dispose", async () => {
  const window = new Window({ url: "http://localhost/" });
  globalThis.document = window.document;
  const x = fixture(),
    actor = { ...x.alice, role: "admin" };
  let view;
  try {
    x.core.createShop(actor, { key: "shop", name: "Store", kind: "admin" });
    const client = { requestKey: randomUUID };
    for (const name of [
      "shops",
      "listings",
      "createListing",
      "quoteListing",
      "buyListing",
      "orders",
    ])
      client[name] = async (input) => x.core[name](actor, input);
    client.commerceSettings = async () => x.core.commerceSettings();
    const model = {
      me: { ...x.core.me(actor), role: "admin" },
      catalog: x.core.catalog(),
      inventory: [],
      packs: [],
    };
    view = renderMarketplace(model, { client });
    document.body.append(view.node);
    await view.ready;
    field(view.node, "Listing title").value = "Release";
    field(view.node, "Stock source").value = "mint-card";
    field(view.node, "Stock source").dispatchEvent(new window.Event("change"));
    field(view.node, "Stock item").value = "dawn.standard";
    field(view.node, "Stock quantity (new stock)").value = "2";
    field(view.node, "Unit price").value = "17";
    click(view.node, "Reserve stock and publish listing");
    await settle();
    const listing = x.core.listings(x.bob).items[0];
    assert.equal(listing.remaining, 2);
    assert.equal(listing.price.amount, 17);
    view.dispose();
    let listDisposed = 0,
      cardDisposed = 0;
    for (const name of ["shops", "listings", "quoteListing", "orders"])
      client[name] = async (input) => x.core[name](x.bob, input);
    view = renderMarketplace(
      { ...model, me: x.core.me(x.bob) },
      {
        client,
        listingRenderer: (l, { purchase }) => {
          const node = document.createElement("button");
          node.textContent = "Custom buy";
          node.onclick = () => purchase(l);
          return {
            node,
            dispose() {
              listDisposed++;
            },
          };
        },
        cardRenderer: () => ({
          node: document.createElement("div"),
          dispose() {
            cardDisposed++;
          },
        }),
      },
    );
    document.body.append(view.node);
    await view.ready;
    click(view.node, "Custom buy");
    await settle();
    click(view.node, "Close review");
    assert.equal(cardDisposed, 1);
    click(view.node, "Custom buy");
    await settle();
    view.dispose();
    assert.equal(cardDisposed, 2);
    assert.equal(listDisposed, 1);
    view = null;
  } finally {
    view?.dispose();
    x.core.close();
    await window.happyDOM.abort();
    delete globalThis.document;
  }
});
