# Core 0.1.0 verification

Verified 30 September 2026 on Windows with Node.js 24.19.0.

## Automated checks

Command: node --test test/*.test.js

41 tests passed, zero failures. Coverage includes account linkage/authority, published prices and quote revisions, exact currency ratios, safe retry receipts, purchase rollback, finite edition serials, sealed allocations, duplicate protection, trade-up consumption, mixed trading/escrow, cancellation/expiry/feature disable, binding transfer/use/privacy, album ownership/versioning/cleanup, custom transfer policy, HTTP origin/session boundaries, headless reveal cleanup, durable browser commands and generated OpenAPI consistency.

SQLite was closed and reopened to verify balances, inventories, albums and request receipts. Concurrent worker threads used independent SQLite connections to race the last unique copy and duplicate purchase keys: one unique copy was issued, and one purchase key charged once. Temporary stores are closed before cleanup.

The first test run exposed a Windows cleanup hook ordering error, corrected before publication. Client verification also covered synchronous provider failures and storage cleanup failure after a committed response.

## Browser checks

The local application ran at http://127.0.0.1:4317 with fictional accounts and persistent demo state.

- Buying Sky Discovery changed Credits from 2000 to 1900 and created a sealed pack.
- Opening/reveal-all returned three owned copies; the inspector displayed original opener/time and rare edition 1 of 100.
- Flipping displayed the default CSS back.
- A public album rendered its three placements.
- The alternate host rendered the same collection with a different page order, light theme, ATLAS card back, horizontal album and custom metadata.
- The alternate modal opener displayed the existing committed result as an instant list.
- After restart/catalog upgrade, a newly acquired layered Dawn loaded both runtime-generated SVG layers. Keyboard tilt left the background at identity and translated its depth-24 foreground by 19.2 pixels.
- Browser console inspection of the alternate composition reported no warning/error entries during its check.

The procedural SVG shapes are produced by demo code at runtime; artwork files are excluded from this repository.

## Delivery limits

This verifies the standalone framework wallet and core transaction boundary. Production host identity, external game wallets, external reward delivery, encrypted valuable secrets and larger-deployment storage remain integration work listed in implementation-status.md. The preserved original proposal acceptance matrix describes broader future targets.

GitHub Actions runs this same test command on Node.js 24 for pushes and pull requests. Local test evidence and remote CI outcomes are distinct.
