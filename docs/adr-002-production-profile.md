# ADR 002: explicit standalone production profile

Accepted, 1 October 2026. Extends ADR 001 while preserving the headless core and public replacement boundaries.

## Decisions

- Keep fictional login/funding in the loopback demo; use a separate OIDC host with maintained verification, PKCE/state/nonce and secure durable cookies.
- Encrypt framework state and auth payloads with AES-256-GCM; session tokens are opaque with hashed lookup keys. Keys are host configuration.
- Keep balances, allocations, escrow, receipts, notifications and album cleanup in one synchronous transaction. Import publication requires a current version and reviewed digest.
- Bound bodies, structured data, schemas, visibility, origin/principal, trade review, rates and installation capacity.
- Ship measured SQLite limits and preserve durable receipts/history. Larger deployments need normalized storage and tested migration/recovery.
- Serve explicit files with CSP, isolate album CSS and keep imported assets in host storage. Card data cannot install executable extensions.
- Expose whole views, renderers, camera/comparison, layouts and headless controllers. The reference site uses public contracts.
- Provide consistent backup/restore verification and new-path encryption migration preserving sources. Migration requires reauthentication.

## Consequences

One app instance is the supported profile. Whole-state serialization has CPU, latency and byte limits. Host callbacks are trusted synchronous code; public imports are data. External wallets/rewards require a transaction and recovery protocol. Operators supply OIDC registration, TLS, keys, content and storage. Tests prove wiring/invariants; live operation requires configured infrastructure. See [operations](production.md) and [verification](verification-0.2.0.md).
