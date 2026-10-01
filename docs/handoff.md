# Collector release handoff — 0.2.0

1 October 2026. The collector overhaul is implemented and its release documentation is ready. Public replacement boundaries remain intact. This handoff supersedes the earlier percentage estimate; it does not reclassify separate portable-player work as complete.

## Shipped implementation

Bulk JSON/YAML/schema imports with reviewed publication; private/social inventory services; immutable visual offers and counters; collection/wishlist/favorite tools; custom album editor/layout import/export; layered card orbit and shared combination inspection; beautiful Card Atelier defaults; separate verified OIDC host; encrypted sessions/state; bounded requests/rates/capacity; audit, backup/restore and new-path key migration.

Evidence: **73/73 committed framework tests passed**. Browser workflows include purchase/open, native tray drag/drop, atomic acceptance with currency, private CSS album saving, real YAML preview, shared scene assembly/rotation/flip, narrow layout and alternate host composition. Production dependency audit found no known advisories. The Linux Docker image built successfully in GitHub Actions.

## History and current environment

- `ca98e22`: bulk catalogs, private inventories and reviewed counters.
- `409fc6d`: Card Atelier, visual trading, replaceable views and authenticated production host; GitHub Actions passed tests/audit/image build.
- `5d45206`: atomic authentication session capacity guard and regression.
- Release documentation follows as a separate commit in this same task. Final push/remote verification is reported with delivery.

Repository: https://github.com/zkkng/DigitalCardFramework (private), main. Local demo: http://127.0.0.1:4317; preserved ignored fictional progress. QA screenshots are outside Git in outputs/FrameworkQA. No live production issuer/TLS deployment or game-wallet/reward bridge was created. Production configuration and supported SQLite limits are in docs/production.md.

## Concurrent portable presentation work

Another task owns src/presentation, its test/presentation* files, docs/complex-cards/implementation-status.md and any related integration edits such as the catalog presentation reference. They were preserved and excluded from collector commits. Do not overwrite or stage those changes as cleanup. Consult that task's independent status/conformance report before claiming advanced media/package features are complete.

The collector's cardRenderer/inspectorRenderer/comparisonRenderer/view contracts are the integration points for that player. Generic source, tests and docs belong here; artwork/game data and MapleStory host wiring stay external.
