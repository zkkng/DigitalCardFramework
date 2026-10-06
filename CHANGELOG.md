# Changelog

## Unreleased

### Added

- Added opt-in incremental acquisition storage with bounded record transactions and revision-bound capacity accounting. Supported acquisitions avoid materializing unrelated installation records; other workflows retain their existing storage paths.
- Added embedded-font asset diagnostics, editable declared usage terms and sample glyph-coverage checks. Font uploads preserve locked text-layer assignments.
- Added versioned capability profiles with independent pack acquisition, direct sales, trading and resale controls, plus account-specific availability and recovery hints.
- Added Studio controls for polygon and image clipping masks, inversion, vertex editing and immutable saved-mask reuse.
- Added TypeScript declarations for the trade draft component, with validated inventory responses and persisted draft inputs.
- Added server-owned command recovery with account-scoped discovery, immutable reviewed inputs and explicit acknowledgement. A fresh browser or admin panel can recover an unconfirmed action after local storage is erased without repeating its debit or issuance.
- Added typed existing client/admin-controller APIs and checked inventory, trade, administration and command-recovery responses.
- Added a checked browser HTTP transport with generated TypeScript declarations, request/response validation and strict consumer checks. Acquisition contracts include reviewed revisions, public pack views and consistent error envelopes.
- Added editable stat binding controls, including explicit card/variant scope, labels, units, number formatting and bar ranges. Empty, false and null field values remain distinct.
- Added Studio policy diagnostics that focus the relevant field or select the correct card face, with embedded-font overflow checks and visible rule references.
- Added a styled-text row editor for text, emphasis, colors and embedded icons, with reordering, inherited formatting and undoable conversion to plain text. Rejected edits restore working controls for correction.
- Added custom field controls for scope, help text, units, visibility, nullability, ranges, precision, length bounds and primitive choices.
- Added proof-bound external pack purchases with atomic delivery, original-source refund confirmation, cancellation fences, and attributed recovery of proven legacy purchases.
- Added strict external-purchase schemas, a headless wallet example, and backup/encryption tools that preserve legacy source and rollback artifacts.
- Added synchronous host code generators for atomic pack allocation, with encrypted storage, provider-wide collision checks and retry preservation.
- Added a trusted server registration-material method for connecting issued codes to external reward services before player reveal.

### Changed

- Converted the admin controller to strict TypeScript and generated declarations. Saved admin commands must match their reviewed inputs before recovery.
- Converted the browser client, code-reveal controller and durable command runner to strict TypeScript with generated declarations and checked build parity.
- New catalogs default to collection-only. The reference frontend loads optional views and data according to enabled workflows and retained recovery needs; the example catalog explicitly selects the demo profile.
- Resale no longer requires enabling user-to-user trade offers. Disabling admission preserves accepted work and original receipt replay.
- Encrypted storage schema 3 adds indexed current/former code-holder history alongside identity and collection queries. Migration preserves existing encrypted records and authentication sessions.
- Trade, listing, pack and action delivery workflows reserve completion capacity separately from new admissions. Legacy pending work receives an atomic reservation backfill before the production host admits traffic.
- Strengthened wallet, receipt, delivery and code audits, and routed code lifecycle events through durable subscriptions. Unchanged command replay does not rewrite state.

### Fixed

- Keep the visual editor inactive until its card and policy finish loading, preventing early edits from racing initialization.
- Validate recovered command results and their original intent before confirming success. Malformed recovery replies preserve the original key for safe retry.
- Serialized Studio authoring and undo actions, and prevented queued edits from running after disposal. Mask inversion now requires a boolean value.
- Preserved original purchase inputs and retry keys across remounts and later authentication/rate-limit failures. Admin saves stop before dispatch when their recovery journal cannot be stored safely.
- Reserved refundable balance headroom so later credits cannot prevent escrow refunds, and fenced disposed controllers against obsolete requests and callbacks.
- Fixed concurrent SQLite startup snapshot copying and pending purchase pagination after terminal transitions.
- Contained album appearance rules and prevented style edits from changing locked text layers. Ambiguous stat keys now require an explicit scope.

### Upgrade notes

- Existing catalogs without a capability profile require an explicit profile publication before new pack, trade or commerce operations. Follow the [capability migration guide](docs/capabilities.md), retaining primitives needed by pending work.
- Commands registered after upgrade use the server recovery journal. Older commands whose browser identity was already lost still require host reconciliation. Plan the retained-intent limit; unresolved records are not automatically discarded.
- Back up the database and required keys before upgrading. Follow [production operations](docs/production.md) for schema migration and completion limits. Custom hosts must backfill legacy completion reservations before accepting new commands.
- New completion budgets are separate from the ordinary payload budget; configure the framework and SQLite limits consistently. Existing receipts and unresolved recovery records are retained.
- The checked transport does not manage retry identities. Preserve reviewed commands and their original keys as described in the [SDK guide](docs/wire-sdk.md).

## 0.2.0 — 1 October 2026

- Added editable text, embedded custom fonts, styled spans/icons, stat bindings and CSV metadata controls; reusable personal/shared masks, styles, templates and reviewed migrations.
- Added versioned administrator card policies, inherited requirements, template sets, impact previews, retirement/restore, source permissions and publication enforcement with pinned copy schemas.

- Rebuilt the default collector website with clear navigation, illustrated pack previews, collection tools, album editor, import studio and account activity.
- Added two-inventory visual trading, drag/drop and accessible Add/Remove controls, review-bound snapshots, counters, privacy/blocking and notifications.
- Added JSON/YAML catalogs/patches, schema-validated stats/metadata, reviewed atomic publication, CLI export/import and creator examples.
- Added card orbit/flip/zoom/reset, layered crop/depth/effects, shared comparison and composable panoramic pieces.
- Added optional pity, availability windows, finite-stock display, favorites, wishlists and discovery completion.
- Added complete-view replacement/lifecycle and inspector/comparison contracts; maintained the alternate host example and compact tilt inspector.
- Added a separate OIDC production host, encrypted state/sessions, account-bound writes, limits/quotas, audit, backup/restore, encryption migration and Docker/TLS deployment template.
- Added meaningful core, host, UI and operational tests, dependency audit/CI image build, white paper, public customization examples and measured capacity documentation.

Existing catalog IDs, edition caps and acquired snapshots remain stable. The logical state schema remains 1; the storage adapter's current schema is described above and in the operations guide. Browser/client usage requires installing pinned dependencies for the server/importer. The public `renderInspector` defaults to orbit; `renderTiltInspector` preserves the prior compact interaction. External payment and reward services remain host responsibilities.

## 0.1.0 — 30 September 2026

Initial transactional core, durable SQLite, HTTP/client, optional UI, currencies, pack allocation/opening, finite copies, bindings, albums, escrow trades, trade-ups and public replacement callbacks.
