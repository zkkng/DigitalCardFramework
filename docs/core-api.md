# Core API and configuration

API version 0.2. Core command and query methods return detached results; most are synchronous. The opt-in [incremental acquisition method](record-transactions.md), `purchaseAsync`, returns a Promise while its SQLite operations still run on the calling thread. Browser/HTTP methods and action dispatch are asynchronous. Hosts pass verified server contexts: {userId} for players and {role:'admin'} for operator-only methods. Never derive authority from request body fields. A provider + immutable subject identifies one registered user; display name changes retain inventory. See [content authoring](content-authoring.md), [production operations](production.md) and [generated HTTP contract](openapi.json) for the 0.2 additions.

For a balance owned by another service, use the [external purchase workflow](external-purchases.md). It binds a reviewed quote to one external payment and records either complete delivery or required compensation.

## Catalog

New catalogs omit optional workflows by default. Configure independent packs, direct sales, trading and resale through the versioned [capability profile](capabilities.md). `capabilities(actor)` and `client.capabilities()` expose effective availability and accepted work that must drain. Existing persisted catalogs require explicit profile migration before new workflow admission.

publishCatalog(operator, manifest) validates and persists a complete JSON catalog. version increases for each publication. Variants, products and recipes can be disabled through enabled:false; published IDs are retained. Card line identity and variant card/rarity/supplyLimit are immutable. Use a new variant ID for another edition. Modified pack products increment revision. Each acquired copy retains its definition/variant snapshot.

| Field | Meaning |
| --- | --- |
| capabilities | version:1, optional named preset, workflow flags and explicit primitive flags; omission selects the minimal collection profile |
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

For bounded reads, use `inventoryPage(actor,options)`, `packsPage(actor,options)` and `collectionSummary(actor,options)`. The `packPage` alias is retained. Pages accept `limit` and an exclusive `after` cursor; normal record pages default to 50 and allow at most 200. Results contain `items`, `total` and `next`. A changed or missing cursor returns `INVALID_CURSOR`; restart the view. Ownership comes from the verified actor.

`collectionSummary` groups revealed copies by variant and returns `items:[{variantId,count,card}]`, `totalCards`, `uniqueCards`, `total` and `next`. Its cursor is a variant ID; `card` is an owner-safe representative copy. Optional `excludeTypes` omits specified card types. Sealed cards do not contribute to these counts. Default collection pages use indexed reads. Legacy free-text inventory search and locale name sorting load that account's matching copies to preserve their existing semantics.

Trusted account services may use `userByIdentity(operator,{provider,subject})` and `providerIdentity(operator,userId)` with `accounts.register`. They return a detached record or `null`; keep immutable provider subjects server-side. Re-registering an unchanged identity performs no state write. `catalogVersion()` returns the active version, or zero before initialization.

## HTTP adapter

createApiHandler({framework,resolveIdentity,allowedOrigin}) returns an async Node request handler that handles /api/* and returns true, or false for another route. createFrameworkServer wraps it in an HTTP server. resolveIdentity(request) must return a verified {userId} or null, never an unverified client account ID. Public GET catalog/public albums/individual public album can run anonymously. Other routes require identity. POST requires JSON and the exact configured Origin.

Operator endpoints require a verified host principal with the permissions stated in [the HTTP contract](openapi.json). The [admin panel](admin-panel.md) uses those routes for supported administration tasks. Identity linkage and external payment evidence remain trusted host responsibilities. HTTP errors use stable code,message fields; unknown internal exceptions are redacted as INTERNAL_ERROR.

The browser client exposes corresponding commands, read methods, `principal()` and `requestKey()`. `createCommandRunner({client,storage,namespace})` requires a namespace identifying the authenticated account. It verifies browser persistence, registers an immutable server-owned intent before mutation, coalesces repeated clicks and retains the original key and input after an ambiguous failure. Missing, blocked or corrupt storage returns `COMMAND_STORAGE_UNAVAILABLE` before mutation. The reference app uses session storage; a standalone marketplace uses its element's owner-window storage unless a host supplies storage or `mutate`.

`run(command,input)` reuses unresolved input and recovers a confirmed intention after runner recreation. Once this runner has received success, another deliberate call starts a fresh operation, including repeated conversion or edits returning to an earlier value. `run.recover(command,input)` always retrieves the original identity. `run.pending(command)` prioritizes unresolved work over confirmed history; otherwise it returns the latest stored intention and its `_confirmed` marker. `run.beginNew(command,input)` explicitly starts a new reviewed operation with identical terms. It refuses unresolved work and creates a new key only after persistence succeeds. A changed purchase intention cannot replace an unresolved one. Dispose a runner on account change or unmount; the built-in client also fences dispatch against its current principal. A custom client must stay bound to its original principal or implement `principal()`.

Purchase retry storage contains reviewed terms and identifiers, without listing item/card snapshots. Browser storage is limited to 1 MiB and 1,000 records. The most recent 256 confirmed identities are retained; older confirmed records may be removed during admission to stay within these limits. Unresolved identities are never removed by this cleanup. Original server receipts remain authoritative. Throttling, authentication and other retry failures retain the original intent until its authoritative result is recovered. The reveal controller separately retains its opening key within its instance; disposal is terminal.

If browser storage is erased, `await run.recoverable()` discovers the signed-in account's server-held commands without needing the erased key. `await run.resume(intent)` recovers that original command and receipt. The reference app displays **Unconfirmed changes** after a fresh mount; administration uses the same runner and restores its pending review. Completed and failed server intents remain discoverable until acknowledged. `run.beginNew` acknowledges a locally recovered outcome before registering another deliberately reviewed operation; it refuses to acknowledge an outcome the client has not recovered. Lost registration, execution or acknowledgement responses can all be retried safely. Current identity, permissions, operator exposure and trade-review rules apply to recovery too.

Custom hosts can use `commandIntents(actor,{command})`, `registerCommandIntent(actor,{command,input})`, `executeCommandIntent(actor,{id})` and `acknowledgeCommandIntent(actor,{id})`, or the corresponding checked HTTP client methods. There is one unacknowledged intent per account and command kind. Registration returns that original intent unchanged if another tab already registered it; compare its reviewed input before proceeding. Intent inputs, finalization and acknowledgement have bounded admission and completion budgets. Acknowledgement preserves retained history and does not execute a purchase. Existing browser journals migrate using their original retry keys. Commands sent before server intent support, whose browser keys were already lost, still require host reconciliation. A custom client without the four intent methods retains the earlier browser-only recovery behavior.

The event journal is committed with commands, accessible only to operators, and supports a sequence cursor. Configured subscriptions enqueue durable action deliveries; see [opening actions and delivery](card-actions.md) for acknowledgment, retries and provider requirements.

## Host contract example

Map your existing verified session to registerUser(operator,{provider:'host',subject:session.immutableSubject,...}). Cache its framework user ID in your host account mapping. Supply that ID from resolveIdentity after verifying the session on every request. Currency issuance uses grants with durable host event IDs. Direct spending from an external wallet uses the [external purchase provider contract](external-purchases.md); the host supplies authenticated, durable debit and refund evidence.


## Transfer policy, account actions and commerce

- [Trading controls](trading-controls.md): `tradingPolicy`, `configureTrading`, `setCardTransferLock`, contextual transfer/trade hooks.
- [Opening actions](card-actions.md): `openCard`, `fulfillments`, `actionJobs`, `retryAction`, `claimAction`, `settleAction`, `dispatchActions` and server event subscriptions.
- [Shops and releases](shops-and-releases.md): `commerceSettings`, `configureCommerce`, `createShop`, `setShopEnabled`, `shops`, `createListing`, `listings`, `quoteListing`, `buyListing`, `cancelListing`, `expireListings` and `orders`.
- [Raffles](raffles.md): `enterRaffle`, `raffleStatus`, `drawRaffle`, `drawDueRaffles` and ordinary quote/purchase for winner claims.

These features are optional compositions of the same transactional core and authenticated client. Their guides specify defaults, permissions, retries, extension points and runnable examples.
