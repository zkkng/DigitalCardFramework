import { el, button, field, select, section } from "./ui-kit.js";

function commands(client) {
  const keys = new Map();
  return async (name, input) => {
    const token = name + JSON.stringify(input);
    if (!keys.has(token)) keys.set(token, client.requestKey());
    try {
      const result = await client[name]({ ...input, key: keys.get(token) });
      keys.delete(token);
      return result;
    } catch (error) {
      if (error.status && error.status < 500) keys.delete(token);
      throw error;
    }
  };
}
export function renderMarketplace(
  model,
  { client, cardRenderer, listingRenderer, refresh } = {},
) {
  const node = section(
      "Marketplace",
      "Browse upcoming releases, buy reserved stock, or visit player shops.",
    ),
    status = el("p", "dc-muted"),
    list = el("div", "dc-market-list"),
    review = el("div", "dc-form-panel");
  status.setAttribute("role", "status");
  node.append(status, review, list);
  review.style.display = "none";
  let disposed = false,
    busy = false,
    cursor = null,
    generation = 0;
  const cleanups = [],
    reviewCleanups = [],
    run = commands(client);
  function clearReview() {
    reviewCleanups.splice(0).forEach((fn) => fn());
    review.replaceChildren();
    review.style.display = "none";
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      busy = false;
    }
  }
  async function purchase(listing) {
    await action(async () => {
      const quote = await client.quoteListing({ listingId: listing.id });
      if (disposed) return;
      clearReview();
      review.style.display = "";
      review.replaceChildren(
        el("h3", "", "Review purchase"),
        el("p", "", quote.price.amount + " " + quote.price.currencyId),
      );
      for (const item of quote.items) {
        if (item.copy && cardRenderer) {
          const rendered = cardRenderer(item.copy, { interactive: false });
          review.append(rendered.node ?? rendered);
          if (rendered.dispose) reviewCleanups.push(() => rendered.dispose());
        } else
          review.append(el("p", "", item.pack?.product.name ?? "Custom item"));
      }
      review.append(
        button("Confirm purchase", () =>
          action(async () => {
            const order = await run("buyListing", quote);
            if (disposed) return;
            clearReview();
            review.style.display = "";
            review.replaceChildren(
              el("p", "", "Purchase complete · " + order.id),
            );
            if (refresh) await refresh();
            else await load(true);
          }),
        ),
        button("Close review", clearReview, "dc-quiet"),
      );
    });
  }
  function defaultListing(l) {
    const card = el("article", "dc-form-panel");
    card.append(
      el("h3", "", l.title),
      el("p", "", l.description),
      el(
        "p",
        "dc-muted",
        l.shopName + " · " + l.phase + " · " + l.remaining + " available",
      ),
      el("p", "", l.price.amount + " " + l.price.currencyId),
      el("p", "dc-muted", "Release: " + new Date(l.startsAt).toLocaleString()),
    );
    if (l.preview?.preallocated)
      card.append(
        el(
          "p",
          "dc-muted",
          "Sealed, preallocated pack. Personal pity does not apply.",
        ),
      );
    if (l.mine && l.status === "active")
      card.append(
        button(
          "Cancel remaining stock",
          () =>
            action(async () => {
              await run("cancelListing", { listingId: l.id });
              if (refresh) await refresh();
              else await load(true);
            }),
          "dc-quiet",
        ),
      );
    else if (l.raffle) {
      const own = el("p", "dc-muted");
      card.append(
        el(
          "p",
          "",
          "Free entry for a chance to purchase. Payment is due only when a winner claims.",
        ),
        own,
        button(
          "Check entry / claim",
          () =>
            action(async () => {
              const r = await client.raffleStatus({ listingId: l.id });
              if (disposed) return;
              own.textContent = r.orderId
                ? "Claimed"
                : r.winner
                  ? "You won. Claim before " +
                    new Date(r.claimUntil).toLocaleString()
                  : r.drawnAt
                    ? "Not selected"
                    : r.entered
                      ? "Entered; awaiting draw"
                      : "Not entered";
              if (r.winner && !r.orderId)
                own.append(button("Review winner purchase", () => purchase(l)));
            }),
          "dc-quiet",
        ),
      );
      if (l.phase === "entries-open")
        card.append(
          button("Enter raffle", () =>
            action(async () => {
              await run("enterRaffle", { listingId: l.id });
              if (!disposed) own.textContent = "Entered. No charge.";
            }),
          ),
        );
    } else if (l.phase === "live")
      card.append(button("Review purchase", () => purchase(l)));
    return card;
  }
  const more = button("Load more listings", () => load(false), "dc-quiet");
  async function load(reset) {
    const current = ++generation;
    if (reset) {
      cursor = null;
      cleanups.splice(0).forEach((fn) => fn());
      list.replaceChildren();
      clearReview();
    }
    more.disabled = true;
    try {
      const result = await client.listings({ limit: 24, after: cursor });
      if (disposed || current !== generation) return;
      for (const l of result.items) {
        const rendered = listingRenderer
          ? listingRenderer(l, {
              purchase,
              defaultRenderer: defaultListing,
              client,
            })
          : defaultListing(l);
        list.append(rendered.node ?? rendered);
        if (rendered.dispose) cleanups.push(() => rendered.dispose());
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = result.total + " listings";
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      more.disabled = false;
    }
  }
  node.prepend(button("Refresh marketplace", () => load(true), "dc-quiet"));
  node.append(more);
  async function compose() {
    try {
      const [shops, settings] = await Promise.all([
        client.shops({ limit: 200 }),
        client.commerceSettings(),
      ]);
      if (disposed) return;
      const admin =
          model.me.role === "admin" ||
          model.me.permissions?.includes("commerce.manage"),
        own = shops.items.filter((s) => s.mine);
      if (settings.settings.playerShops || admin) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", "Create a shop"));
        const name = field(box, "Shop name"),
          kind = select(
            box,
            "Shop type",
            admin
              ? [
                  { id: "admin", name: "Admin shop" },
                  { id: "player", name: "Player shop" },
                ]
              : [{ id: "player", name: "Player shop" }],
          );
        box.append(
          button("Create shop", () =>
            action(async () => {
              await run("createShop", { name: name.value, kind: kind.value });
              if (refresh) await refresh();
              else if (!disposed)
                status.textContent =
                  "Shop created. Reload this view to add its stock.";
            }),
          ),
        );
        node.append(box);
      }
      if (own.length) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", "List stock for sale"));
        const shop = select(
            box,
            "Shop",
            own.map((s) => ({ id: s.id, name: s.name })),
          ),
          title = field(box, "Listing title"),
          currency = select(box, "Currency", model.catalog.currencies),
          amount = field(box, "Unit price", { type: "number", value: "1" }),
          kind = select(box, "Stock source", [
            { id: "copies", name: "Owned card" },
            ...(settings.settings.packResale
              ? [{ id: "packs", name: "Owned sealed pack" }]
              : []),
            ...(admin
              ? [
                  { id: "mint-card", name: "Issue card stock" },
                  { id: "mint-pack", name: "Issue sealed packs" },
                  { id: "action", name: "Custom action item" },
                ]
              : []),
          ]),
          target = select(box, "Stock item", []),
          quantity = field(box, "Stock quantity (new stock)", {
            type: "number",
            value: "1",
          }),
          handler = field(box, "Custom handler (server installed)"),
          params = field(box, "Custom item parameters", {
            type: "textarea",
            value: "{}",
          }),
          preview = field(box, "Preview time (ISO, optional)"),
          starts = field(box, "Release time (ISO, optional)"),
          ends = field(box, "End time (ISO, optional)"),
          raffle = field(box, "Raffle terms JSON (optional)", {
            type: "textarea",
            value: "",
          });
        function choices() {
          target.replaceChildren();
          const rows =
            kind.value === "copies"
              ? model.inventory
                  .filter((c) => !c.lockedBy)
                  .map((c) => ({
                    id: c.id,
                    name: c.definition.name + " · " + c.id.slice(0, 8),
                  }))
              : kind.value === "packs"
                ? model.packs
                    .filter((p) => !p.openedAt && !p.lockedBy)
                    .map((p) => ({ id: p.id, name: p.product.name }))
                : kind.value === "mint-card"
                  ? model.catalog.variants.map((v) => ({
                      id: v.id,
                      name:
                        model.catalog.cards.find((c) => c.id === v.cardId)
                          .name +
                        " · " +
                        v.id,
                    }))
                  : model.catalog.products;
          for (const item of rows) {
            const option = el("option", "", item.name);
            option.value = item.id;
            target.append(option);
          }
        }
        kind.addEventListener("change", choices);
        choices();
        box.append(
          button("Reserve stock and publish listing", () =>
            action(async () => {
              const items =
                kind.value === "copies" || kind.value === "packs"
                  ? { kind: kind.value, ids: [target.value] }
                  : kind.value === "action"
                    ? {
                        kind: "action",
                        handler: handler.value,
                        params: JSON.parse(params.value),
                        quantity: Number(quantity.value),
                      }
                    : {
                        kind: kind.value,
                        [kind.value === "mint-card"
                          ? "variantId"
                          : "productId"]: target.value,
                        quantity: Number(quantity.value),
                      };
              await run("createListing", {
                shopId: shop.value,
                title: title.value,
                price: {
                  currencyId: currency.value,
                  amount: Number(amount.value),
                },
                items,
                ...(preview.value ? { previewAt: preview.value } : {}),
                ...(starts.value ? { startsAt: starts.value } : {}),
                ...(ends.value ? { endsAt: ends.value } : {}),
                ...(raffle.value ? { raffle: JSON.parse(raffle.value) } : {}),
              });
              if (refresh) await refresh();
              else await load(true);
            }),
          ),
        );
        node.append(box);
      }
      if (admin) {
        const box = el("details", "dc-form-panel");
        box.append(el("summary", "", "Commerce settings"));
        const json = field(box, "Settings JSON", {
          type: "textarea",
          value: JSON.stringify(settings.settings, null, 2),
        });
        json.rows = 10;
        box.append(
          button("Apply commerce settings", () =>
            action(async () => {
              await client.configureCommerce({
                key: client.requestKey(),
                expectedRevision: settings.revision,
                settings: JSON.parse(json.value),
              });
              if (refresh) await refresh();
              else if (!disposed)
                status.textContent =
                  "Settings saved. Reload this view to load the current controls.";
            }),
          ),
        );
        node.append(box);
      }
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    }
  }
  const history = el("details", "dc-form-panel");
  history.append(el("summary", "", "Purchase and sale history"));
  const orders = el("div");
  let orderCursor = null;
  const orderMore = button(
    "Load orders",
    () =>
      action(async () => {
        const result = await client.orders({ limit: 24, after: orderCursor });
        if (disposed) return;
        for (const o of result.items)
          orders.append(
            el(
              "p",
              "",
              o.id +
                " · " +
                o.quantity +
                " items · " +
                o.paid.amount +
                " " +
                o.paid.currencyId +
                " · " +
                o.fulfillment,
            ),
          );
        orderCursor = result.next;
        orderMore.hidden = !orderCursor;
      }),
    "dc-quiet",
  );
  history.append(orderMore, orders);
  node.append(history);
  const ready = Promise.all([load(true), compose()]);
  return {
    node,
    ready,
    dispose() {
      disposed = true;
      generation++;
      cleanups.splice(0).forEach((fn) => fn());
      clearReview();
      node.replaceChildren();
    },
  };
}
export function renderFulfillments(model, { client } = {}) {
  const node = section(
      "Account rewards",
      "Opening actions are delivered to your account. Pending deliveries retry without opening another pack.",
    ),
    list = el("div"),
    status = el("p", "dc-muted");
  let disposed = false,
    cursor = null,
    generation = 0;
  const operator =
      model.me.role === "admin" ||
      model.me.permissions?.includes("actions.manage"),
    scope = select(
      node,
      "Reward history",
      operator
        ? [
            { id: "own", name: "My rewards" },
            { id: "all", name: "Operator delivery queue" },
          ]
        : [{ id: "own", name: "My rewards" }],
    ),
    more = button("Load more rewards", () => load(false), "dc-quiet");
  node.append(
    button("Refresh rewards", () => load(true), "dc-quiet"),
    status,
    list,
    more,
  );
  async function load(reset) {
    const current = ++generation;
    if (reset) {
      cursor = null;
      list.replaceChildren();
    }
    more.disabled = true;
    try {
      const result = await client[
        scope.value === "all" ? "actionJobs" : "fulfillments"
      ]({ limit: 24, after: cursor });
      if (disposed || current !== generation) return;
      for (const job of result.items) {
        const item = el("article", "dc-form-panel");
        item.append(
          el("h3", "", job.handler),
          el("p", "", job.status),
          el("p", "dc-muted", job.error ?? ""),
          el("p", "dc-muted", "Reference: " + job.id),
        );
        if (operator && scope.value === "all" && job.status === "dead")
          item.append(
            button("Retry delivery", async () => {
              try {
                await client.retryAction({
                  key: client.requestKey(),
                  jobId: job.id,
                });
                await load(true);
              } catch (error) {
                if (!disposed) status.textContent = error.message;
              }
            }),
          );
        list.append(item);
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = result.total + " rewards";
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      more.disabled = false;
    }
  }
  scope.addEventListener("change", () => load(true));
  const ready = load(true);
  return {
    node,
    ready,
    dispose() {
      disposed = true;
      generation++;
      node.replaceChildren();
    },
  };
}

export function renderTradingControls(model, { client } = {}) {
  const node = section(
      "Trading controls",
      "Deployment policy applies again at completion. Ownership and code restrictions always remain in force.",
    ),
    status = el("p", "dc-muted");
  node.append(status);
  let disposed = false;
  async function load() {
    try {
      const current = await client.tradingPolicy();
      if (disposed) return;
      const json = field(node, "Trading policy JSON", {
        type: "textarea",
        value: JSON.stringify(current.policy, null, 2),
      });
      json.rows = 18;
      node.append(
        button("Apply trading policy", async () => {
          try {
            const result = await client.configureTrading({
              key: client.requestKey(),
              expectedRevision: current.revision,
              policy: JSON.parse(json.value),
            });
            current.revision = result.revision;
            status.textContent = "Trading policy saved.";
          } catch (error) {
            status.textContent = error.message;
          }
        }),
      );
      const copyId = field(node, "Individual copy ID"),
        reason = field(node, "Lock reason", {
          value: "This card cannot be transferred",
        }),
        until = field(node, "Lock expiry (ISO, optional)");
      for (const locked of [true, false])
        node.append(
          button(locked ? "Lock this card" : "Remove lock", async () => {
            try {
              await client.setCardTransferLock({
                key: client.requestKey(),
                copyId: copyId.value,
                locked,
                reason: reason.value,
                until: until.value || null,
              });
              status.textContent = locked
                ? "Card locked."
                : "Card lock removed.";
            } catch (error) {
              status.textContent = error.message;
            }
          }),
        );
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    }
  }
  const ready = load();
  return {
    node,
    ready,
    dispose() {
      disposed = true;
      node.replaceChildren();
    },
  };
}
