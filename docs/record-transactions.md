# Incremental acquisition storage

`await core.purchaseAsync(actor, request)` provides an opt-in acquisition path using record transactions. Its request and receipt are the same as `core.purchase`; both methods share the same idempotency namespace. Accepted replay returns the original receipt. Wallet adjustment, supply and pity updates, sealed copies and packs, receipt, ledger entries, events and delivery reservations commit atomically.

This method returns a Promise, but SQLite operations still run synchronously on the calling thread. It does not provide a worker thread, concurrent writer execution or a general asynchronous application API. The production HTTP routes continue to use the established command methods.

## Supported products

The incremental path supports products whose variants do not allocate codes or invoke binding factories, and whose duplicate policy does not inspect the owner's whole inventory. Other products and installations with legacy externally managed purchase keys use the established acquisition path. That fallback materializes installation state and can block for substantial time on larger databases. Opening, trade, commerce and action delivery transactions also retain their existing storage paths.

SQLite reads the selected catalog/configuration, account, balance, receipt, supply, validation and pity records plus indexed owner counts. It writes changed records only. Default read/write budgets are 4,096 records and 16 MiB per transaction; oversized operations reject with `TRANSACTION_BUDGET` before committing. This bound includes selected configuration payloads, so a sufficiently large catalog can exceed it even for a small purchase.

## Preparation and mixed writers

Call `store.prepareRecordTransactions()` during planned writable maintenance to establish revision-bound capacity accounting. The first incremental purchase also prepares it when absent or stale. Preparation scans installation state and consumes ordinary storage capacity; insufficient capacity fails atomically. Read-only inspection does not prepare or modify a database. Existing installations that never activate this path do not pay its accounting refresh cost.

Once activated, compatibility transactions refresh accounting in their own transaction. They still scan state; accounting stabilization updates only its scalar and reservation payload sizes after the initial measurement. An older writer that changes the revision without refreshing accounting causes the next incremental admission to prepare again. Existing receipt recovery can use the compatibility path without allocating this metadata first.

## Storage extension interface

`store.transactRecords(callback, {maxRecords, maxBytes})` runs a synchronous callback in one atomic transaction. Its scope exposes `get(collection, key)`, `value(field)`, `count(collection)`, `ownerCounts(userId)`, `put(collection, key, value)` and `append(collection, value)`. Reads include staged changes and return detached values. The scope expires when the transaction ends. Awaiting inside it and nested storage operations are rejected; run external effects through the committed outbox.

The supported mutation scope is deliberately narrow: balances, supply and pity may change; copies, packs, receipts, ledger entries, events, jobs and completion obligations may be inserted. New obligations require their reservations. Existing accepted records cannot be replaced through this interface, and completion settlement uses its established reserved path. This is a storage extension API for trusted application code, not an authorization boundary or general database editor.

MemoryStore implements the same transaction behavior using its existing in-memory snapshot model. Only SQLite provides incremental persisted record writes. These interfaces do not establish performance acceptance for every workflow or deployment size.
