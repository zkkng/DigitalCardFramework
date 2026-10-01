# Security and major-release review

Security review is a required part of **every major release**, and any release changing identity, authorization, transactions, uploads or executable extensions. This is a release gate, not a calendar reminder. Automated tests supplement a fresh human/agent threat-model review; passing tests never certifies that no vulnerability exists.

## Trust boundaries

- Request JSON, uploaded art/archive metadata, names, descriptions, public card attributes and browser storage are untrusted data. Render text through text nodes; validate any URL/style-specific context separately. Do not strip legitimate punctuation or art descriptions merely to avoid contextual encoding.
- Authentication adapters create principals. Bodies, query strings, cookies containing an unsigned role and uploaded packages cannot grant permission. Resolve access per request. Default collector access excludes import, publish, mint and funding authority.
- Server-installed providers/mods are trusted code. Uploaded `.dcard` manifests cannot install JavaScript. Optional programs use the separate-origin allowlisted runtime contract; host-installed modules are not sandboxed by the framework.
- Purchases, supply, wallet debits, trades and attached rewards are authoritative transactions. Reveals and renderer inputs are presentation only.
- External funds require verified provider evidence, intended destination and purpose, recipient mapping, accepted finality, exact amounts, and durable deduplication. Receipt verification is a provider obligation; clients provide only identifiers.

## Release checklist

Create a dated report with the exact commit, reviewer, changed attack surfaces, findings, fixes, residual risks and test evidence. Block release for unresolved critical/high findings. Explicitly record lower-risk accepted findings with owner and remediation plan.

1. Run `node --test test/*.test.js`, `node docs/complex-cards/check-examples.mjs`, and compare generated OpenAPI to its checked-in source. Permission matrices, cross-user reads/mutations, disabled admins, import ownership, session/OIDC checks, CSRF origin/principal checks, free-card attempts, negative/overflow amounts, concurrent finite-supply purchases and transaction replay must pass.
2. Run `node test/presentation-audit-browser.mjs` for Chromium, Firefox and WebKit. Check real GPU output, custom effects, GIF conversion, bounded synchronized interaction, idle scheduling, repeated disposal and inaccessible/offscreen media. A real iPhone soak is required before claiming iPhone performance certification; desktop WebKit is useful but insufficient.
3. Run production dependency audits for both root and `src/presentation`. Review any decoder/runtime changes and their actual use. Keep lockfiles pinned. CI runs both audits and test suites on every push/PR.
4. Review every new HTTP route for authentication, exact permission, ownership, rate/body limits, safe errors, origin/principal checks and idempotency. Exercise forged user IDs/roles/amounts and duplicate/out-of-order provider events. Never add a client-authoritative grant or payment-success callback.
5. Review all new text, URL, CSS, HTML, archive and media paths. Test reserved JSON keys, path traversal, malformed media, decompression/frame budgets and timeouts. Test that legitimate text and all supported art/editing workflows still function.
6. Run storage integrity/audit and restore tests. External settlements require one matching credit ledger entry. Audit secrets/logs and verify artwork/private codes are absent from the generic repository.
7. Revalidate the host deployment boundary: TLS/OIDC settings, private assets, worker isolation, provider credentials, CSP, approval policy, dependency budgets and third-party extension trust. Enabling a real external currency requires provider-specific integration and failure/reconciliation tests.
8. Record the supported limits honestly. No zero-day immunity, universal codec support, distributed atomicity or physical-device performance claim follows from unit tests.

## Review performed on 1 October 2026

The prior broad audit is in `docs/complex-cards/audit-2026-10-01.md`. This follow-up adds durable external-currency receipt deduplication, explicit settlement permission, cancellation/timeout safety, external account/currency matching, exact integer conversion, and receipt-to-ledger integrity checks. It removes inherited-property lookup from reward-factory selection. Tests cover forged HTTP roles/amounts, cross-account replay, 40 simultaneous receipt deliveries, SQLite restart, pending/refunded receipts and late provider responses.

The optional reference upload HTTP adapter applies the existing principal/origin/rate controls and refuses unauthorized bodies before reading them. Presentation additions keep custom code host-installed, run GIF decoding in a bounded worker, preflight frame memory before decode, and preserve server authority over performance rejection policy. New performance warnings are advisory by default and do not suppress valid artwork or remove functionality.

The tested provider is synthetic. A live payment/game-wallet adapter, its credentials, external refunds/withdrawals and physical-iPhone measurements are separate deployment checks. See the follow-up implementation report for exact test results.
