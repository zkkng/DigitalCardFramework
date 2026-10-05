# Core API and configuration

API version 0.2. All core methods are synchronous, detached-result methods. Browser/HTTP methods are asynchronous. Hosts pass verified server contexts: {userId} for players and {role:'admin'} for operator-only methods. Never derive authority from request body fields. A provider + immutable subject identifies one registered user; display name changes retain inventory. See [content authoring](content-authoring.md), [production operations](production.md) and [generated HTTP contract](openapi.json) for the 0.2 additions.

## Catalog

publishCatalog(operator, manifest) validates and persists a complete JSON catalog. version increases for each publication. Variants, products and recipes can be disabled through enabled:false; published IDs are retained. Card line identity and variant card/rarity/supplyLimit are immutable. Use a new variant ID for another edition. Modified pack products increment revision. Each acquired copy retains its definition/variant snapshot.

| Field | Meaning |
| --- | --- |
| currencies | id, name, value:{numerator,denominator}; tradable explicitly true to permit transfers; convertible:false blocks conversions |
| lines | id, name and host presentation metadata |
| rarities | id, name, rank; rank defines recipe progression, not a fixed pack chance |
| cards | id, lineId, name, JSON metadata, layers, optional appearance and back URL |
| variants | id, cardId, rarityId, finish, optional supplyLimit/back/effectMask, metadata and namespaced bindings |
| products | id, lineId, name, revision, price:{currencyId,amount}, slots, maxQuantity and duplicatePolicy |
| slots | count and pool:[{variantId,weight}]; positive integer weights, one entry per variant |
| duplicatePolicy | scope:none/pack/inventory; fallback:allow/reject; exclusion tracks card definitions |
| recipes | id, name, lineId, inputRarityId, inputCount, duplicatesOnly, outputPool |
| features | cardTrading, currencyTrading, conversion, tradeUps, publicAlbums; all default false |

A product may have common slots plus a guaranteed rare slot. There is no fixed pack size, number of products per line, rarity taxonomy or mandatory currency name. Price amounts and wallet units are safe positive integers; use smallest units for fractional display. Weight sums are limited to 2^31-1. Finite supply is variant-scoped across the installation and all products. Base odds are weights divided by their slot's total; conditional exclusions change effective odds and must be disclosed.

Bindings use names like publisher.code. Each declares visibility:public/owner, transfer:follow/retain/block, JSON data and an optional factory registry name. factories are trusted synchronous functions configured through CardFramework({bindings:{name:factory}}). Factory output is per-copy private data. public exposes data to album viewers; owner exposes it only to its holder. retain keeps entitlement with the original holder even when the card moves. block disallows card transfer. follow moves the holder; old recipients may have already copied any revealed data, so external credentials require a rotation/revocation bridge.

## Commands

Each player mutation requires a nonempty key. A given principal/key has exactly one command type and input. Repeating that input returns its original detached receipt; changing it returns IDEMPOTENCY_CONFLICT. Preserve the key through timeouts. Errors roll back balances, copies, supply, escrow and receipts together.

| Method | Input and behavior |
| --- | --- |
| registerUser(operator,input) | provider, subject, displayName; returns stable framework identity |
| grantCurrency(operator,input) | userId,currencyId,amount,reason,key; records one operator grant |
| quote(actor,input) | productId,quantity; returns authoritative price, productRevision,catalogVersion |
| purchase(actor,input) | key plus quoted productId,quantity,productRevision,catalogVersion; creates sealed allocations and debits atomically |
| openPack(actor,input) | key,packId; reveals existing copies, records opener/time and historical isNew labels |
| convert(actor,input) | key,from,to,amount,catalogVersion,rounding:exact/floor; exact is default |
| tradeUp(actor,input) | key,recipeId,copyIds; exact distinct input count, correct line/rarity, optional identical-variant requirement |
| proposeTrade(actor,input) | key,toUserId,give,receive,expiresInSeconds; offers are {copyIds:[],currencies:[{currencyId,amount}]} |
| acceptTrade(actor,input) | key,tradeId; only recipient, current ownership/policies checked, both directions exchange atomically |
| cancelTrade(actor,input) | key,tradeId; initiator cancels or recipient declines; returns escrow |
| sweepExpiredTrades(operator) | releases elapsed offers; trades(actor) also sweeps |
| saveAlbum(actor,input) | key,name,visibility,layout,placements, optional albumId/expectedVersion |
| consumeBinding(actor,input) | key,copyId,namespace; current holder only, exactly one local use, blocked during pending trade |

Conversions compute amount * from.value / to.value using BigInt intermediates. exact rejects a remainder; floor explicitly discards it and records its rational fraction. Currency values share one common unit, avoiding directional exchange-rate inconsistencies. No conversion occurs while creating a trade.

Recipes currently reject all bound input cards to avoid silently destroying an entitlement. Consumption preserves edition counters and provenance. Host extensions can add more recipe policies only with an explicit lifecycle contract.

Read methods: catalog(), wallet(actor), history(actor), inventory(actor), packs(actor), inspectCard(actor,copyId), albums(actor), viewAlbum(actorOrNull,albumId), publicAlbums(), bindings(actor), events(operator,{after,limit}). Sealed pack lists hide copy IDs and outcomes. Owner inventories contain revealed copies only. Public album views omit owner-only binding data. Serial numbers are per finite variant edition; uncapped copies have null serialNumber/editionTotal.

## HTTP adapter

createApiHandler({framework,resolveIdentity,allowedOrigin}) returns an async Node request handler that handles /api/* and returns true, or false for another route. createFrameworkServer wraps it in an HTTP server. resolveIdentity(request) must return a verified {userId} or null, never an unverified client account ID. Public GET catalog/public albums/individual public album can run anonymously. Other routes require identity. POST requires JSON and the exact configured Origin.

No operator endpoints are exposed. Host administrative code owns publication, identity linkage and grants. HTTP responses use stable code,message errors with status 400/401/403/404/409/413/415; unknown internal exceptions are redacted as INTERNAL_ERROR. See openapi.json for command schemas.

The browser client exposes corresponding commands, read methods, `principal()` and `requestKey()`. `createCommandRunner({client,storage,namespace})` requires a namespace identifying the authenticated account. It verifies persistence before dispatch, coalesces repeated clicks and retains the original key and input after an ambiguous failure. Missing, blocked or corrupt storage returns `COMMAND_STORAGE_UNAVAILABLE` before mutation. The reference app uses session storage; a standalone marketplace uses its element's owner-window storage unless a host supplies storage or `mutate`.

`run(command,input)` reuses unresolved input and recovers a confirmed intention after runner recreation. Once this runner has received success, another deliberate call starts a fresh operation, including repeated conversion or edits returning to an earlier value. `run.recover(command,input)` always retrieves the original identity. `run.pending(command)` prioritizes unresolved work over confirmed history; otherwise it returns the latest stored intention and its `_confirmed` marker. `run.beginNew(command,input)` explicitly starts a new reviewed operation with identical terms. It refuses unresolved work and creates a new key only after persistence succeeds. A changed purchase intention cannot replace an unresolved one. Dispose a runner on account change or unmount; the built-in client also fences dispatch against its current principal. A custom client must stay bound to its original principal or implement `principal()`.

Purchase retry storage contains reviewed terms and identifiers, without listing item/card snapshots. Storage is limited to 1 MiB and 1,000 records. The most recent 256 confirmed identities are retained; older confirmed records may be removed during admission to stay within these limits. Unresolved identities are never removed by this cleanup. Original server receipts remain authoritative. If pending work alone fills the budget, new commands fail before dispatch; definitive HTTP rejection removes the corresponding pending identity. Do not delete retry storage to resolve an unknown purchase. If stored identity is lost, reconcile server receipts through the host before initiating a replacement. The runner cannot reconstruct erased storage by itself. The reveal controller separately retains its opening key within its instance; disposal is terminal.

The event journal is committed with commands, accessible only to operators, and supports a sequence cursor. Configured subscriptions enqueue durable action deliveries; see [opening actions and delivery](card-actions.md) for acknowledgment, retries and provider requirements.

## Host contract example

Map your existing verified session to registerUser(operator,{provider:'host',subject:session.immutableSubject,...}). Cache its framework user ID in your host account mapping. Supply that ID from resolveIdentity after verifying the session on every request. Currency issuance uses grants with durable host event IDs. This supports host-controlled issuance into framework wallets; direct spending of an externally authoritative live wallet requires additional integration work.


## Transfer policy, account actions and commerce

- [Trading controls](trading-controls.md): `tradingPolicy`, `configureTrading`, `setCardTransferLock`, contextual transfer/trade hooks.
- [Opening actions](card-actions.md): `openCard`, `fulfillments`, `actionJobs`, `retryAction`, `claimAction`, `settleAction`, `dispatchActions` and server event subscriptions.
- [Shops and releases](shops-and-releases.md): `commerceSettings`, `configureCommerce`, `createShop`, `setShopEnabled`, `shops`, `createListing`, `listings`, `quoteListing`, `buyListing`, `cancelListing`, `expireListings` and `orders`.
- [Raffles](raffles.md): `enterRaffle`, `raffleStatus`, `drawRaffle`, `drawDueRaffles` and ordinary quote/purchase for winner claims.

These features are optional compositions of the same transactional core and authenticated client. Their guides specify defaults, permissions, retries, extension points and runnable examples.
