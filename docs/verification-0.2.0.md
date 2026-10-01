# Collector release verification — 0.2.0

1 October 2026. Evidence applies to the generic collector framework and standalone production host. Portable complex-card packaging/player work is tracked separately and is not included in this test count or release claim.

## Automated checks

**73/73 committed framework tests pass**, with no skips or todos, on Node 24.19.0 / Windows. Run `pnpm install --frozen-lockfile` and `pnpm test`. The full local checkout additionally contained seven passing tests from concurrent portable-player work; those files were preserved and excluded from this release's commits/count.

- Core: immutable identity, exact currencies/conversions, quote revisions, finite allocation/serials, duplicate policies, trade-ups, snapshot opening and replay, rollback and idempotent commands.
- Storage: restart persistence and independent SQLite workers racing last-copy issuance and duplicate purchase keys.
- Social/trades: private inventory/blocking, protected bindings, immutable snapshots/digest/version review, counters and failure rollback, escrow/expiry, favorites cleanup, notifications and optional pity.
- Imports: JSON/YAML, duplicate keys, aliases/tags, reserved structures, stat schemas, bounds, cross-references, stale/changed previews and immutable editions.
- UI DOM regressions: restored recipient, blocked transfer, money input/review reset, wrong-side drop, actual core import response shape, stale preview generations, album custom-data round trips, isolated CSS, complete-view cleanup and camera orbit.
- Host: actual production entrypoint initializes encrypted state, serves protected UI/API, derives operator authority and excludes demo login. Maintained OIDC library fixtures check PKCE/state/nonce/issuer separately.
- Security/operations: encrypted tamper/wrong-key rejection, durable sessions/challenge replay/expiry/capacity, exact origin/principal, bounded input, private code filtering, rate limits, invariant diagnosis, capacity rollback, reviewed YAML CLI import, encryption migration and online backup/restore.
- Contract: generated OpenAPI matches its source, unique operation IDs, static browser-module closure and restrictive headers.

Production dependency advisory audit: `pnpm audit --prod` reported **No known vulnerabilities found** on this date. Dependencies and the package manager are pinned by package/lockfile. This is an advisory check, not a claim that software cannot have vulnerabilities.

[GitHub Actions run 36846703834](https://github.com/zkkng/DigitalCardFramework/actions/runs/36846703834) passed installation, framework tests, production dependency audit and Linux Docker image build for implementation commit `409fc6d`. A subsequent guard adds atomic auth-session capacity with its own passing test; final commit/remote and CI verification are reported with the release.

## Real browser checks

Chrome on the local running demo, using the actual UI:

1. Purchased Shared Horizon, opened/revealed its committed pair and inspected collection results.
2. Selected two copies, assembled Shared Horizon, confirmed a complete seamless scene, rotated with keyboard and flipped to both backs.
3. Dragged an inventory card natively into its offer tray and removed it again.
4. Sent a fictional Rowan→Morgan Dawn/Cloud Study exchange requesting 5 Credits. Switched to Morgan, reviewed immutable offer contents and accepted. Both inventories changed together, escrow cleared and Morgan's balance became 1,895; Rowan's became 1,345.
5. Created a private two-card gallery with custom isolated CSS and verified saving.
6. Previewed a YAML card/variant patch with stats; saw version/digest, added rows and procedural-art warning. No preview content was published.
7. Checked narrow responsive layout without document-level horizontal overflow; reset the temporary viewport override afterward.
8. Verified alternate light journal theme, custom back/metadata, album renderer and independent modal instant reveal. Fixed theme-token inheritance/readability and unwanted default branding on custom backs.

Browser testing found real defects in selection labels, currency input events, 3D flattening and the import change-list contract. Fixes were applied and relevant flows retested. Local proof images are saved outside Git under `outputs/FrameworkQA`, including `card-atelier-overhaul.png`; no artwork/screenshots were committed.

## Capacity evidence

`node tools/benchmark.js` uses isolated temporary encrypted SQLite, 5 synthetic users and 5,000 allocated copies. Final state was 18,009,896 plaintext bytes; audit passed. Inventory p95 95.65 ms, paged trade inventory p95 106.72 ms, trade proposal p95 253.98 ms and cancellation p95 253.97 ms on the local Ryzen 7 9800X3D machine. These serial fixture results are not a throughput SLA. [Supported limits and recovery](production.md) describe the bounded whole-state adapter and when to migrate.

## Operational boundary

The updated loopback playground is running on port 4317. The production host is executable and tested, and its Linux image builds in CI. Real identity-provider credentials, DNS/TLS, secret storage, licensed artwork, backups and deployment remain operator configuration. No live production site, external game wallet or external reward redemption was deployed or claimed. Follow the production guide for a real installation.
