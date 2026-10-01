# Run shops and scheduled releases

Applies to framework 0.2. Run `node examples/shops.mjs`. All examples and operations work without the reference webpage.

## Enable the storefront you want

```js
const {revision}=framework.commerceSettings();
framework.configureCommerce(operator,{key:'shops-config',expectedRevision:revision,settings:{
  enabled:true,playerShops:true,packResale:false,
  allowedCurrencyIds:['credits','gems']
}});
const shop=framework.createShop(operator,{
  key:'create-shop',name:'Official store',kind:'admin'
});
```

`commerce.manage` permits admin shops, primary stock issuance, settings and shop status changes. A registered collector can create a `player` shop only when `playerShops` is enabled. Shops belong to verified framework accounts. An operator may specify another registered `ownerId`; that account receives proceeds.

Defaults are `enabled:true`, `playerShops:false`, `packResale:false`, `allowedCurrencyIds:null`, `maxListingsPerShop:200`, `maxStockPerListing:100`, and `maxRaffleEntries:10000`. Null accepts configured eligible currencies. Configuration replaces the full settings object using `expectedRevision`; omitted fields reset to defaults. Maximum configured stock is 1,000 units per listing, active listings 10,000 per shop, and entrants 100,000 per raffle. Installation limits additionally default to 1,000 shops, 10,000 total listings, and 50,000 orders.

## Reserve stock and advertise a release

```js
const listing=framework.createListing(operator,{
  key:'summer-stock',shopId:shop.id,title:'Summer release',
  description:'A limited collector release.',
  price:{currencyId:'credits',amount:25},
  items:{kind:'mint-card',variantId:'summer.holo',quantity:50},
  previewAt:'2027-06-01T00:00:00Z',startsAt:'2027-06-15T18:00:00Z',
  endsAt:'2027-07-01T00:00:00Z',perBuyerLimit:2,
  metadata:{campaign:'summer'}
});
```

| Stock kind | Required fields | Who may list it |
| --- | --- | --- |
| `copies` | `ids` of owned card copies | Enabled player shop or admin shop |
| `packs` | `ids` of owned sealed packs | As above, with `packResale:true` |
| `mint-card` | `variantId`, `quantity` | Admin shop with `commerce.manage` |
| `mint-pack` | `productId`, `quantity` | Admin shop with `commerce.manage` |
| `action` | Installed `handler`, `quantity`, optional `params` | Admin shop with `commerce.manage` |

One listing holds copies of one variant, or packs of one product revision. Stock is finite and reserved at listing creation. Existing stock gets an escrow lock. Primary stock is issued immediately, reserving edition supply and code inventory; a failed listing rolls all of it back. A canceled primary listing returns already-issued stock to its owner without deleting serials or replenishing issuance caps.

Stocked packs are preallocated using pack-level draw rules. They **do not apply the future buyer's pity or inventory duplicate protection**; direct catalog purchases retain personalized behavior. Code entitlements inside a sealed pack move to its buyer atomically, and its opening/contents remain inaccessible while listed. Do not use recipient-specific legacy binding factories when preallocating unknown-recipient stock; use [opening actions](card-actions.md) for account unlocks.

`previewAt` controls listing visibility to buyers; omitted preview defaults to release time. `startsAt` gates purchases on server time, and `endsAt` closes the sale. Public card catalog entries and existing media are separate: hiding a listing is not a content embargo. Titles, descriptions and metadata are public. Completed listing terms are immutable; cancel remaining stock and create a new listing to change them.

## Review and purchase exact stock

```js
const quote=framework.quoteListing(player,{listingId:listing.id,quantity:1});
// Show quote.price and quote.items, then send the same quoted units/digest.
const order=framework.buyListing(player,{...quote,key:'purchase-123'});
```

A quote binds exact unit IDs and a digest of immutable terms. Another buyer taking that unit invalidates the quote; the server never substitutes a different serial silently. A quote does not hold a unit for an ordinary sale. Purchase rechecks stock, time, buyer quota, blocks, current permissions and policy in one transaction. The buyer is debited, seller credited, stock transferred and order recorded together. Repeating a successful request key returns the original result and cannot charge twice. A changed request with the same key fails.

Amounts use configured integer currency units, with no floating point or implicit conversions. Primary shops may charge any configured accepted currency. Secondary sales require tradable currency and applicable currency-trading controls. External wallets fund the existing ledger through verified reconciliation; this module does not synchronously debit an arbitrary remote wallet. See [production operations](production.md) for integration boundaries.

## Resale restrictions and hooks

Existing cards and every card inside a resale pack obey [trading controls](trading-controls.md), including individual locks and code/binding transfer rules. Code cards default nontradable; do not assume enabling pack resale bypasses restrictions on its contents. Primary issuance may deliver nontradable reward cards, but an individual administrative lock still stops delivery.

Server `policies.canList({actor,shop,listing})` and `policies.canPurchase({user,shop,listing})` provide additional synchronous decisions. Return true to permit; `canPurchase` may return a safe public refusal string. Use the existing transfer/trade hooks for resale details. No host override can duplicate ownership, bypass a reservation, change a reviewed price or invent a player balance.

## Sell custom items

An admin action listing uses the same payment and stock transaction and queues a durable fulfillment job containing immutable order, listing, unit and buyer references. The handler is installed in the server; a player shop cannot choose executable handlers. `orders()` reports `pending`, `complete`, or `attention-required` from live job state.

An external timeout may have occurred after delivery. There is no automatic refund on that ambiguous signal. The host must verify provider outcome and apply its explicit refund/compensation policy. Fixed-price stock, card/pack resale and action goods are implemented; auctions, fees, taxes, withdrawals and general automated refund workflows are separate integrations.

## Operate and customize

`cancelListing({key,listingId})` is available to the seller or a `commerce.manage` operator and releases only unsold stock. `setShopEnabled({key,shopId,enabled})` is operator-only. Disabling prevents further purchases; it does not reverse orders. `expireListings(maintenancePrincipal)` releases timed-out reservations. Production maintenance runs it every minute; checks at purchase prevent early/late buying even if maintenance is delayed.

Private `orders(player,{limit,after})` includes both purchases and sales. Copy origin is immutable; the copy's acquisition metadata and order record add the sale trail. `audit()` checks stock reservations, order links, ownership and settlement balances.

The reference **Marketplace** includes scheduled previews, quote/confirm purchase, order history, shop creation and listing forms. Operators have stock issuance and complete commerce-settings JSON. All APIs are usable programmatically. Replace `views.marketplace`, or pass `listingRenderer(listing,{purchase,defaultRenderer,client})` to `mountFramework`. A custom renderer returns a node or `{node,dispose}`. Standalone `renderMarketplace` accepts a `refresh` callback so a host can reload wallet/inventory after mutations; dispose it on navigation/account changes.

HTTP: `/api/shops`, `/api/listings`, `/api/listings/quote`, `/api/listings/buy`, `/api/listings/cancel`, `/api/orders`, `/api/commerce-settings`, `/api/operator/commerce`, and `/api/operator/shop-status`. See [OpenAPI](openapi.json) for methods and schemas and [raffles](raffles.md) for purchase-right allocation.
