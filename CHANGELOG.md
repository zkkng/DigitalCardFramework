# Changelog

## Unreleased

- Added proof-bound external pack purchases with atomic delivery, original-source refund confirmation, cancellation fences, and attributed recovery of proven legacy purchases.
- Added encrypted storage schema 2 with indexed identity and collection queries, blind private lookup keys, atomic legacy migration, and preserved authentication sessions.
- Reserved request and storage capacity for admitted payment recovery; unchanged commands no longer rewrite state.
- Strengthened wallet, receipt, delivery and code audits, and routed code lifecycle events through durable subscriptions.
- Added strict external-purchase schemas, a headless wallet example, and backup/encryption tools that preserve legacy source and rollback artifacts.
- Added synchronous host code generators for atomic pack allocation, with encrypted storage, provider-wide collision checks and retry preservation.
- Added a trusted server registration-material method for connecting issued codes to external reward services before player reveal.

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
