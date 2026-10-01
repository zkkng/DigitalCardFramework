# ADR 001: standalone core runtime and transaction boundary

Accepted 30 September 2026 for the first implementation slice.

Use dependency-free ESM JavaScript on Node.js 24.14+, with Node's built-in synchronous SQLite adapter. The runtime is immediately runnable without installing a toolchain. Public configuration and OpenAPI schemas describe the boundary. This refines the earlier proposed TypeScript/React/PostgreSQL baseline for a smaller executable core; those earlier choices were recommendations.

Storage exposes read(callback), transact(callback) and close(). transact must serialize writers, load a consistent draft, atomically persist all state and the command result, roll back on throw, and return a detached result. Callbacks are synchronous and must not perform external effects. MemoryStore is for tests. SQLiteStore uses BEGIN IMMEDIATE, WAL and synchronous=FULL with a five-second busy timeout. The authoritative document has an explicit schema version.

The first store favors clarity and durability over high throughput: users, balances, packs, supply counters, copies, albums, escrow, ledgers, idempotency receipts and committed events occupy one serialized state document. Every mutation is O(total state) and reads currently load that document. It is suitable for proving the domain contract and small installations. A normalized PostgreSQL implementation and asynchronous service boundary are necessary before high-volume use. Raw database files contain private binding data; restrict filesystem access and design an encrypted binding store before delivering valuable secrets.

Funds originate in operator grants and remain in the framework ledger. A purchase debits, selects cards, consumes supply, creates sealed copies and stores its idempotent receipt in one local transaction. It never calls an external wallet. Binding factories run synchronously inside that transaction: they must be pure, bounded and side-effect free. External code inventories and delivery require a separate reservation/outbox/reconciliation protocol.

Cryptographic randomInt chooses from positive integer weights. Filtering applies finite supply, enabled variants and the product's explicit duplicate policy. Edition counters are monotonically issued, including sealed copies; consumed copies do not recycle serials. Definition/variant art and product rules are snapshotted into acquired results. Catalog IDs cannot silently change card identity or edition caps; changed products require new revisions. Quotes reference both catalog and product revision.

A trade reserves the initiator's cards and removes offered currency from spendable balance into recorded escrow. The recipient's side is checked again during acceptance; it is never reserved merely because someone requests it. Both directions transfer in one transaction. Cancellation, decline and expiry return escrow once. Present feature switches and trusted transfer policies are enforced at acceptance. Transferred/consumed cards are removed from old albums so a former owner cannot display stale ownership.

Albums store JSON layout data and ordered placements, never executable CSS or scripts. Trusted host composition provides CSS and arbitrary render callbacks. Players may pick host-supported layouts and parameters. The default UI ignores unknown layout instructions. Metadata and asset references are rendered as text and validated URLs, never innerHTML.

UI depends on view models and a headless reveal controller. A complete replacement opener receives committed receipts and presentation commands; it has no access to internal mutable state. The host owns routing, shell, login, placement and cleanup. The alternate demo uses only public APIs.

The local demo identity selector is intentionally loopback-only and for fictional accounts. Production must replace the resolver and session/login logic. HTTP writes require an exact configured Origin, JSON content and a verified host principal.

Sources: [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html). Runtime APIs were also checked against the installed Node 24.19.0.
