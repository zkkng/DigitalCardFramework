# Incremental acquisition storage

`await core.purchaseAsync(actor, request)` provides an acquisition path using record transactions. Its request and receipt are the same as `core.purchase`; both methods share the same idempotency namespace. The production API uses it for direct and durable-intent purchases. Accepted replay returns the original receipt. Wallet adjustment, supply and pity updates, sealed copies and packs, receipt, ledger entries, events and delivery reservations commit atomically.

This method returns a Promise, but SQLite operations still run synchronously on the calling thread. It does not provide a worker thread, concurrent writer execution or a general asynchronous application API. Other production commands continue to use their established storage paths.

`executeCommandIntentAsync(actor, {id}, options)` awaits the underlying command before finalizing its server-owned recovery head. It preserves the same authorization, immutable input, receipt replay and explicit acknowledgement rules as synchronous `executeCommandIntent`. An interruption after the purchase commit leaves the original key available for recovery.

Once accounting is prepared, intent registration, finalization and acknowledgement also use bounded record transactions. Each finalization charges actual record and accounting growth to that intent's own reservation. Registering recovery for an already accepted pack or other supported obligation can use its newly allocated intent reservation at full ordinary capacity. New purchases still require ordinary admission capacity. Missing or stale accounting retains the compatibility recovery path so accepted work does not depend on allocating migration metadata first. The first browser purchase can therefore include compatibility registration and preparation.

Pack quotes read the requesting account, catalog and administrator controls in one query snapshot. They do not materialize inventory, receipts or installation history, and do not prepare accounting or write records. Quote rules are unchanged: they bind effective pricing and catalog/admin revisions; actual stock and allocation are checked during purchase. Selected catalog and administrator configuration size still affects quote cost. This does not make every read model incremental.

`setPreferences` uses record transactions for the account, explicitly referenced favorites and blocked accounts, the receipt and event deliveries. Wishlist validation reads the catalog. It preserves account identity fields and uses ordinary admission capacity; it cannot spend completion reservations. Replay returns the original result without changing preferences or enqueueing another event. The first new preferences command prepares accounting when needed, while existing receipt replay does not require preparation.

## Supported products

The incremental purchase path supports products whose variants do not allocate codes or invoke binding factories, and whose duplicate policy does not inspect the owner's whole inventory. Other products and installations with legacy externally managed purchase keys use the established acquisition path. That fallback materializes installation state and can block for substantial time on larger databases. Trade, commerce and action delivery transactions retain their existing storage paths.

`openPack` incrementally completes code-free unopened packs with prepared accounting and a pending pack reservation. It retains issued card definitions and the pack's product snapshot, determines new-card status through the owner/state/variant index, and commits the opening receipt, events, notifications and queued actions together. Exact-key replay returns the stored receipt. Actual record and accounting growth consumes only that pack's own reservation, so ordinary capacity exhaustion does not strand admitted opening.

Opening uses the compatibility completion path for code attachments, missing accounting/reservations, an already opened pack under a new key, or a notification journal containing at least 2,000 entries. The journal threshold conservatively preserves existing per-account history trimming; it is not an indexed trim implementation. Record/byte budget exhaustion also falls back for opening, because an admitted completion must remain recoverable. These completion fallbacks may still block the calling thread.

SQLite reads the selected catalog/configuration, account, balance, receipt, supply, validation and pity records plus indexed owner counts. It writes changed records only. Default read/write budgets are 4,096 records and 16 MiB per transaction; oversized operations reject with `TRANSACTION_BUDGET` before committing. This bound includes selected configuration payloads, so a sufficiently large catalog can exceed it even for a small purchase.

## Preparation and mixed writers

Call `store.prepareRecordTransactions()` during planned writable maintenance to establish revision-bound capacity accounting. The first incremental purchase or new preferences command also prepares it when absent or stale. Preparation scans installation state and consumes ordinary storage capacity; insufficient capacity fails atomically. Read-only inspection does not prepare or modify a database. Preparation is a separate metadata migration; it can remain committed even if subsequent command validation fails, without committing that command's domain changes.

Once activated, compatibility transactions refresh accounting in their own transaction. They still scan state; accounting stabilization updates only its scalar and reservation payload sizes after the initial measurement. An older writer that changes the revision without refreshing accounting causes the next incremental admission to prepare again. Existing receipt recovery can use the compatibility path without allocating this metadata first.

## Storage extension interface

`store.transactRecords(callback, {maxRecords, maxBytes})` runs a synchronous callback in one atomic transaction. Its scope exposes `get(collection, key)`, `value(field)`, `count(collection)`, `ownerCounts(userId)`, `put(collection, key, value)` and `append(collection, value)`. Reads include staged changes and return detached values. The scope expires when the transaction ends. Awaiting inside it and nested storage operations are rejected; run external effects through the committed outbox.

The default acquisition mutation scope is deliberately narrow: balances, supply and pity may change; copies, packs, receipts, ledger entries, events, jobs and completion obligations may be inserted. New obligations require their reservations. Existing accepted records cannot be replaced in this default scope. This is a storage extension API for trusted application code, not an authorization boundary or general database editor.

The internal intent service uses the separate `{intent:true}` transaction scope for intent rows, per-account recovery heads and intent reservations. It may increment `commandIntentCount` with `setScalar`, and identify one intent reservation with `reserveIntentCompletion`. Identity, reviewed input and reservation terms cannot be rewritten through that scope. These operations do not authorize other commands or permit general scalar mutation.

The opening implementation uses `{packCompletion:true}` with `reservePackCompletion` to settle one existing pack reservation. It allows sealed-to-owned copy transitions and the pack's opening receipt while preserving issued snapshots. `ownedVariantCount` reads the existing owner/state/variant index and includes staged ownership changes. Notification entries and completion-tagged receipts, events and jobs are append-only in this scope.

MemoryStore implements the same transaction behavior using its existing in-memory snapshot model. Only SQLite provides incremental persisted record writes. These interfaces do not establish performance acceptance for every workflow or deployment size.
