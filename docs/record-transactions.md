# Incremental acquisition storage

`await core.purchaseAsync(actor, request)` provides an acquisition path using record transactions. Its request and receipt are the same as `core.purchase`; both methods share the same idempotency namespace. The production API uses it for direct and durable-intent purchases. Accepted replay returns the original receipt. Wallet adjustment, supply and pity updates, sealed copies and packs, receipt, ledger entries, events and delivery reservations commit atomically.

This method returns a Promise, but SQLite operations still run synchronously on the calling thread. It does not provide a worker thread, concurrent writer execution or a general asynchronous application API. Other production commands continue to use their established storage paths.

`executeCommandIntentAsync(actor, {id}, options)` awaits the underlying command before finalizing its server-owned recovery head. It preserves the same authorization, immutable input, receipt replay and explicit acknowledgement rules as synchronous `executeCommandIntent`. An interruption after the purchase commit leaves the original key available for recovery.

Once accounting is prepared, intent registration, finalization and acknowledgement also use bounded record transactions. Each finalization charges actual record and accounting growth to that intent's own reservation. Registering recovery for an already accepted pack or other supported obligation can use its newly allocated intent reservation at full ordinary capacity. New purchases still require ordinary admission capacity. Missing or stale accounting retains the compatibility recovery path so accepted work does not depend on allocating migration metadata first. The first browser purchase can therefore include compatibility registration and preparation.

Pack quotes read the requesting account, catalog and administrator controls in one query snapshot. They do not materialize inventory, receipts or installation history, and do not prepare accounting or write records. Quote rules are unchanged: they bind effective pricing and catalog/admin revisions; actual stock and allocation are checked during purchase. Selected catalog and administrator configuration size still affects quote cost. This does not make every read model incremental.

`setPreferences` uses record transactions for the account, explicitly referenced favorites and blocked accounts, the receipt and event deliveries. Wishlist validation reads the catalog. It preserves account identity fields and uses ordinary admission capacity; it cannot spend completion reservations. Replay returns the original result without changing preferences or enqueueing another event. The first new preferences command prepares accounting when needed, while existing receipt replay does not require preparation.

`workerPlan` reads revision-bound pending job, trade and listing counts from accounting. Record and compatibility transactions update these counts atomically. Plans continue to include accepted work after admission is disabled, and are cached only for the current storage revision. Production prepares accounting after startup verification so the worker refresh after each POST does not reload installation state. If capacity prevents preparation, startup retains recovery service and reports deferred migration; planning then reads only the job, trade and listing collections once per revision. That legacy fallback can still be expensive and requires sufficient capacity for preparation to become fully bounded.

## Supported products

The incremental purchase path supports products whose variants do not allocate codes or invoke binding factories, and whose duplicate policy does not inspect the owner's whole inventory. Other products and installations with legacy externally managed purchase keys use the established acquisition path. That fallback materializes installation state and can block for substantial time on larger databases. See the sections below on [Action delivery](#action-delivery), [Automatic expiration](#automatic-expiration) and [listing operations](#listing-purchases) for their prepared paths, compatibility fallbacks and remaining synchronous execution costs.

`openPack` incrementally completes code-free unopened packs with prepared accounting and a pending pack reservation. It retains issued card definitions and the pack's product snapshot, determines new-card status through the owner/state/variant index, and commits the opening receipt, events, notifications and queued actions together. Exact-key replay returns the stored receipt. Actual record and accounting growth consumes only that pack's own reservation, so ordinary capacity exhaustion does not strand admitted opening.

Opening uses the compatibility completion path for code attachments, missing accounting/reservations, an already opened pack under a new key. Record/byte budget exhaustion also falls back for opening, because an admitted completion must remain recoverable. These completion fallbacks may still block the calling thread.

SQLite reads the selected catalog/configuration, account, balance, receipt, supply, validation and pity records plus indexed owner counts. It writes changed records only. Default read/write budgets are 4,096 records and 16 MiB per transaction; oversized operations reject with `TRANSACTION_BUDGET` before committing. This bound includes selected configuration payloads, so a sufficiently large catalog can exceed it even for a small purchase.

`proposeTrade` uses bounded participant, offered-card, balance, policy and catalog reads including attached codes. It atomically locks offered cards, debits offered currency, reserves completion capacity and commits the reviewed snapshots, receipt, notifications and outbox. `cancelTrade` and recipient decline read the selected trade and offered copies, refund escrow, release locks and settle the original reservation. Exact-key replay does not require accounting preparation. Operations exceeding transaction budgets retain compatibility execution.

Encrypted `_tradeEscrow` records contain each sender's refundable currency totals. Cancellation reads one sender record rather than scanning trade history, preserving the safe-integer balance-plus-escrow check. Accounting version 3 gates escrow and copy-reference projections: preparation rebuilds it, compatibility writers refresh it, and bounded trade commands update escrow in the same transaction as escrow. Negative or incomplete refund totals reject before mutation. An older writer invalidates this versioned accounting; an accepted completion can discard the stale cache and use compatibility recovery without allocating projection metadata at exhausted capacity. New admission prepares again with the existing legacy-obligation fence.

`acceptTrade` also uses bounded reads: it loads both participants, offered copies and codes, their currency escrow totals, and referenced favorite/album owners. Ownership, following bindings and code holders, transfer history, balances, favorites, album placements, completion accounting, receipt and outbox commit together. Issued card definitions and encrypted code material remain unchanged. Existing transfer policies and reviewed trade digests still apply.

Encrypted `_copyReferences` rows identify each copy's favorite-account and album references. Every allocated copy has a row, including copies with no references. Bounded preferences and allocation maintain those rows; compatibility operations such as album saving, administrator removal and other transfers rebuild them atomically. Acceptance refuses missing reference metadata instead of assuming there are no placements. During planned writable maintenance, `store.prepareRecordTransactions({force:true})` rebuilds both projections from authoritative state; it requires migration capacity.

`counterTrade` refunds and unlocks the original offer, then admits and reserves the new offer in one transaction. Its new receipt, escrow and ordinary event require ordinary capacity; it cannot spend the old trade's reservation to admit new work. The original offer remains unchanged if review, policy, funding or capacity checks fail. An expired acceptance still releases its existing obligation. Exact-key replay remains available without rebuilding projections.

## Action delivery

Prepared SQLite stores claim, settle and retry actions through addressed record transactions. Schema 5 introduced an index of due pending jobs and expired running leases. Each claim examines at most 32 candidates, ordered by due time and stable insertion order, and rechecks status and lease under the write transaction. Exhausted candidates become dead; later worker cycles continue through the remaining queue. Empty selection performs no write.

Handlers still execute outside the database transaction with the original job ID as their downstream idempotency key. Settlement rejects expired or replaced leases. Shared completion capacity remains reserved while sibling jobs are active or a parent intent awaits acknowledgment. A manual retry admits new reserved capacity and retains its original keyed result for replay.

Run preparation during planned maintenance to enable this path. Unprepared stores and legacy reservations use compatibility recovery, which may scan installation state. MemoryStore retains its snapshot implementation. SQLite database calls remain synchronous; these changes do not establish off-thread execution. Automatic expiration is described separately below.

Stop all writers and retain a database/key backup before upgrading. Writable opens migrate supported indexed schemas atomically to the current schema 8; see [the schema upgrade procedure](production.md#upgrade-the-state-schema) for compatibility and rollback requirements. Restore the pre-upgrade backup with its matching application and keys if rollback is required.

## Automatic expiration

SQLite schema 6 indexes pending trade deadlines and active listing deadlines, including raffle claim deadlines. Each sweep selects at most 32 candidates per family, rechecks their current status and deadline inside the write transaction, and reports failures per item. Selection rotates across due records so repeated failures do not prevent later healthy records from being processed. The cursor is local to the store instance and resets on restart.

Prepared stores refund trade escrow, release offered copies, and append expiration events and notifications through the existing completion reservation. Listing expiration releases only available stock and matching listing locks, including cards inside sealed packs, and appends its expiration event and outbox jobs atomically. These are expiration outcomes, not user cancellations. Empty or stale selections do not write state.

Unprepared and legacy stores retain compatibility recovery. Oversized completion scopes may use that fallback rather than lose an admitted obligation. MemoryStore and custom snapshot stores retain snapshot costs. Raffle drawing is described below. Other commerce commands and synchronous database execution retain their own costs; this does not make all maintenance bounded. A sweep may leave additional due records for the next cycle.

Schema 6 upgrades require the same stopped-writer, database/key backup and rollback precautions described above. Older applications cannot open the upgraded database.

## Listing purchases

Prepared listing quotes read selected records in a read-only snapshot. Purchases recheck eligibility, quoted stock and terms, payment, inventory limits and ownership inside one transaction. Supported card, sealed-pack, custom-action and raffle-claim flows retain their existing rules. Payment, stock, ownership, code entitlements, favorite/album cleanup, order, receipt and delivery jobs commit together. Exact-key replay returns the retained result after restart.

Preparation builds encrypted per-listing/per-buyer purchase totals from existing orders. A separate revision marker prevents an older writer from making stale totals appear current. Current compatibility writers rebuild the projection; bounded writers keep its revision synchronized and purchases update the selected total. Run `store.prepareRecordTransactions()` during writable maintenance to initialize or repair it. Preparation consumes ordinary capacity and is separate from a purchase.

Missing or stale projections and oversized input scopes can use compatibility recovery before invoking host purchase policy. Once that policy is invoked, a failed bounded attempt rolls back without automatically calling it again through fallback. Quotes remain read-only; new purchases require ordinary admission capacity and cannot spend listing expiration reserves. Selling the final available unit releases the listing's unused reservation. Snapshot fallback and synchronous database costs remain; raffle behavior is described below.

## Listing cancellation

Prepared listing cancellation loads the actor, retained receipt, listing, seller/shop display data and available stock. Seller or commerce-manager authorization, matching stock-lock release, cancellation events and receipt commit atomically. Sealed packs and their cards retain issued snapshots. Exact-key replay returns the original public listing result after restart; a conflicting input for the same key is rejected.

An active listing completes through its existing reservation, including an active listing whose stock has sold out. A fresh request for an already-closed listing uses ordinary receipt/event admission; replay does not create additional records. Unprepared, legacy and oversized scopes retain compatibility recovery. Database execution remains synchronous.

## Listing creation

Prepared listing creation reuses the existing authorization, shop, feature, stock and authoring rules for owned cards, owned packs, minted cards, minted packs and custom actions. Stock locks, minted snapshots, code assignments, finite supply, pity, listing, receipt, events and completion reservations commit together. Exact-key replay returns the original result without allocating again. A delegated manager's stock and capacity are accounted to the shop owner.

Preparation builds active-listing counts, code identities and available-code projections. Creation checks its own revision marker; an older writer cannot make these projections current by refreshing unrelated accounting. Current snapshot writers rebuild projections, and record writers update affected entries atomically. Run `store.prepareRecordTransactions()` during writable maintenance to initialize or repair them; preparation requires ordinary capacity.

Generated codes retain capacity and exact identity-collision checks against existing and newly generated records. A collision fails without regenerating. Compatibility fallback is selected before allocation or host policy invocation; a later failure rolls back without automatically invoking those callbacks again. Imported-code selection preserves eligible allocation order. Code payload reads are limited to the selected allocation scope; SQL index traversal is not a constant-time guarantee.

Legacy, unprepared and oversized scopes retain snapshot fallback. Database execution remains synchronous. Shop configuration remains a separate path.

## Raffles

Prepared raffle entry and drawing load the selected listing and required account/shop settings. Entry limits, permissions, eligibility, deadlines and stock-to-winner assignment keep their existing rules. Status reads use a read-only snapshot. Entries remain embedded in the listing, so work scales with that raffle's entrant count, not only its number of winners.

Draws commit winners, claim deadline, notifications, operator receipt and event/outbox outputs atomically under ordinary admission. Exact-key replay returns the retained result. A later request for an already-drawn raffle preserves its winners. Invalid or throwing random providers roll back; the implementation does not retry them automatically through a fallback path.

An independently revision-fenced due projection supports automatic selection up to the requested candidate batch limit. Expired candidates count toward that limit, so a sweep may draw fewer raffles or none; the local cursor advances to let later sweeps continue. Current writers maintain it; preparation repairs it, and stale projections use a compatibility read. Each sweep attempts selected raffles once using stable automatic command keys. If any attempt fails, it reports the first error after trying the remaining selected items; some draws may already have committed. Repeating the sweep does not redraw committed raffles.

Legacy, unprepared and oversized transaction scopes retain compatibility paths chosen before host policies or randomness. Database calls remain synchronous. Snapshot fallback and embedded-entry costs remain part of deployment capacity planning.

## Preparation and mixed writers

Call `store.prepareRecordTransactions()` during planned writable maintenance to establish revision-bound capacity accounting. The first incremental purchase, new preferences command or trade admission also prepares it when absent or stale. Preparation scans installation state and consumes ordinary storage capacity; insufficient capacity fails atomically. Read-only inspection does not prepare or modify a database. Preparation is a separate metadata migration; it can remain committed even if subsequent command validation fails, without committing that command's domain changes.

Once activated, compatibility transactions refresh accounting in their own transaction. They still scan state; accounting stabilization updates only its scalar and reservation payload sizes after the initial measurement. An older writer that changes the revision without refreshing accounting causes the next incremental admission to prepare again. Existing receipt recovery can use the compatibility path without allocating this metadata first.

## Storage extension interface

`store.transactRecords(callback, {maxRecords, maxBytes})` runs a synchronous callback in one atomic transaction. Its scope exposes `get(collection, key)`, `value(field)`, `count(collection)`, `ownerCounts(userId)`, `put(collection, key, value)` and `append(collection, value)`. Reads include staged changes and return detached values. The scope expires when the transaction ends. Awaiting inside it and nested storage operations are rejected; run external effects through the committed outbox.

The default acquisition mutation scope is deliberately narrow: balances, supply and pity may change; copies, packs, receipts, ledger entries, events, jobs and completion obligations may be inserted. New obligations require their reservations. Existing accepted records cannot be replaced in this default scope. This is a storage extension API for trusted application code, not an authorization boundary or general database editor.

The internal intent service uses the separate `{intent:true}` transaction scope for intent rows, per-account recovery heads and intent reservations. It may increment `commandIntentCount` with `setScalar`, and identify one intent reservation with `reserveIntentCompletion`. Identity, reviewed input and reservation terms cannot be rewritten through that scope. These operations do not authorize other commands or permit general scalar mutation.

The opening implementation uses `{packCompletion:true}` with `reservePackCompletion` to settle one existing pack reservation. It allows sealed-to-owned copy transitions and the pack's opening receipt while preserving issued snapshots. `ownedVariantCount` reads the existing owner/state/variant index and includes staged ownership changes. Completion-tagged receipts, events and jobs are append-only in this scope. Notification entries use stable encrypted identities; opening appends its notification and removes only its owner's oldest excess entries through the owner/order index, retaining 2,000 per account. Deletions reduce actual stored-byte and record totals without restoring already spent reservation credit. Notification reads select only the requesting account's retained journal before applying existing paging semantics. Marking notifications read still uses the compatibility command path.

MemoryStore implements the same transaction behavior using its existing in-memory snapshot model. Only SQLite provides incremental persisted record writes. These interfaces do not establish performance acceptance for every workflow or deployment size.
