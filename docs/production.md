# Production host and operations

Version 0.2.0 supports one small installation with local framework currencies, encrypted SQLite, verified OIDC identity and a replaceable browser application. The loopback playground uses fictional login and funding. Run `host/server.js` for real accounts.

## Configure and start

Use Node 24.14+ (verified with 24.19) and pnpm 11.19.0. Install with `pnpm install --frozen-lockfile`. Copy `.env.example` to an ignored `.env` and supply:

| Setting | Meaning |
| --- | --- |
| `SITE_ORIGIN` | Exact HTTPS origin, without a trailing slash |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | Registered OIDC application; redirect URI is `SITE_ORIGIN/auth/callback` |
| `OIDC_CLIENT_SECRET_FILE` | UTF-8 file containing the confidential client secret |
| `STATE_ENCRYPTION_KEY_FILE` | UTF-8 file containing exactly 64 hex characters: a random 32-byte AES key |
| `OPERATOR_SUBJECTS` | JSON array of immutable subjects authorized to operate the catalog; default empty |
| `CATALOG_FILE` | Complete JSON/YAML catalog for first initialization |
| `DATABASE_PATH` | Protected persistent storage path; default `data/production.sqlite` |
| `ASSET_ORIGINS` | Comma-separated exact HTTPS origins permitted for artwork |
| `HOST_MODULE` | Optional trusted server extension module |

Secrets can also be supplied by environment variables without the `_FILE` suffix. Keep files and backups out of Git. Generate the state key directly into a protected file, rather than printing it to logs:

```sh
node -e "require('node:fs').mkdirSync('secrets',{recursive:true});require('node:fs').writeFileSync('secrets/state-key.txt',require('node:crypto').randomBytes(32).toString('hex'),{mode:0o600})"
```

On Windows, restrict the directory ACL to the service/operator account. Preserve the key in separate protected recovery storage. Losing it makes encrypted state and sessions unreadable.

Create your licensed catalog and assets. Starter content in `examples/catalog.js` is a generic demo, including a named demo binding factory. Production startup refuses missing factories; provide your real factories or remove unused bindings from a new catalog before its first publication. Optional operator imports are server-authorized; a browser cannot grant itself an operator role.

Run `node --env-file=.env host/server.js` behind your HTTPS reverse proxy. Native Node binds loopback by default. The Docker image binds port 8080 on its container network. `compose.yaml` includes Caddy TLS ingress, a non-root app, read-only application filesystem, a persistent data volume, secret mounts and health checks. Set `SITE_HOST` to the hostname matching `SITE_ORIGIN`, point DNS to the host and run `docker compose up --build -d`. No application port is published directly.

## Identity and HTTP boundary

The default maintained OIDC client verifies authorization-code flow with PKCE, state, nonce and issuer. Stable issuer/subject pairs identify collectors. Sessions use opaque random tokens, hashed lookup keys and encrypted payloads in SQLite. Production cookies are `__Host-`, Secure, HttpOnly and SameSite=Lax. Logout revokes the durable session. Login challenges expire and are consumed once. At most 20,000 active sessions/challenges are retained by default; allocation cleans expired rows and enforces capacity atomically. Trusted `sessionOptions.maxSessions` can adjust the cap through `HOST_MODULE`.

Every write requires exact `Origin`, JSON content type and `X-DC-Principal` matching the verified session. The browser client learns the principal through `me()`. This also stops a stale tab from sending another account's saved commands after account switching. Accept/counter commands require the reviewed immutable trade digest. Snapshot versions, ownership, feature flags, funds and transfer policies are checked again at execution.

Normal request bodies are capped at 1 MiB; operator import requests at 8 MiB. Default rate limits are 240 reads and 40 writes per minute with at most 20,000 buckets. Both direct peer and authenticated principal are limited. Forwarded IP headers are ignored. A proxy makes many users share a peer bucket: configure a trusted proxy-aware limiter through `HOST_MODULE` for your topology; never trust arbitrary forwarded headers.

The reference app serves an explicit file allowlist with restrictive CSP, no framing, no embedded executable card code and no database/secret paths. Album CSS is contained in a Shadow DOM; authorized content authors still control their album's appearance and external asset references. List permitted content origins deliberately. Imported metadata is rendered as text.

## Supported capacity

The default production limits are 500 users, 5,000 lifetime allocated copies (including consumed and sealed copies), 2,000 packs, 20,000 durable commands, 2,000 albums and 2,000 trades. A collector can have at most 1,000 non-consumed copies and 500 lifetime packs. Encoded record payloads plus admitted external-purchase completion space have a 64 MiB budget. SQLite pages, indexes, sessions and WAL files need additional disk space. Large metadata, snapshots, events and receipts can hit the payload budget earlier. Capacity failures return 507 and roll back the whole transaction. Limits are trusted server configuration, validated as positive integers, and may be changed through `HOST_MODULE` after capacity planning.

Storage schema 2 persists encrypted entity records and indexed identity, collection, pack and payment queries. Compatibility command callbacks still synchronously materialize the logical state; commits write changed records. Unchanged reads and exact command replays do not rewrite framework state. Use one app instance for this deployment profile, monitor state size, latency, disk space and failures, and plan migration before reaching limits. Durable receipts and event history are preserved; there is no automatic destructive retention or hidden idempotency cutoff. Larger installations need measured asynchronous command and storage contracts before increasing this profile.

`node tools/benchmark.js` creates isolated temporary encrypted state, seeds 5 users/5,000 copies and exercises read/write/trade paths. Measure on your deployment hardware and include concurrent traffic and provider delays. Serial fixture timings do not establish a service SLA.

## Upgrade the state schema

Stop writers and take a verified backup with its matching encryption keys using the current application's tools. Opening a supported schema-1 framework database with writable `SQLiteStore` migrates it atomically to schema 2, preserving the logical records and co-located authentication sessions. The migration does not change card, pack, code or receipt identities. Read-only opens cannot migrate. An unsupported newer schema or incorrect encryption key is refused before framework schema changes.

Startup inspects a protected temporary copy of the database and its recovery files before opening the authoritative source. Provide temporary disk space for those copies. Successful SQLite readers may update shared-memory coordination files. Identity and private map lookup keys are blinded; operational card/pack/code IDs and the names and states needed by indexed collection queries remain visible in indexes. Encryption protects record contents; restrict access to the entire database directory and its sidecars.

Retain the old database and application revision for rollback. Older applications cannot open schema 2. Roll back only before the upgraded service accepts new activity; otherwise preserve its current state and repair or migrate forward. Verify integrity, an existing collector's cards, administrator access and any pending external purchases before resuming traffic. A state schema upgrade does not reconcile a host's payment journal or external wallet; follow that adapter's recovery procedure too.

## Backup, restore and encryption rotation

Take online backups using the SQLite backup API, with the same key configuration as the host:

```sh
node --env-file=.env tools/backup.js data/production.sqlite backups/cards-2026-10-01.sqlite
```

For a stopped-writer backup before an upgrade, stop the service and append `--stopped`. This preserves the source files and storage schema in the backup artifact, including a schema-1 database needed by an older application:

```sh
node --env-file=.env tools/backup.js data/production.sqlite backups/cards-before-upgrade.sqlite --stopped
```

The destination must be new. The tool captures a consistent SQLite snapshot and verifies its integrity and framework supply, ownership, escrow, album and ledger invariants in a separate validation copy. It includes durable authentication sessions. Store backups and encryption keys separately, restrict access and exercise restores on isolated paths. Avoid copying a live database file without its WAL protocol.

To restore, stop the service, preserve the damaged/current database and its SQLite sidecars, place the verified backup at a new configured `DATABASE_PATH`, provide its matching key, then start. Startup performs integrity checks. Restore the service and run a collector sign-in and a synthetic transaction before accepting normal traffic. Recovery rolls state back to the backup; reconcile any external systems separately.

`tools/migrate-encryption.js source.sqlite new.sqlite` writes a verified new encrypted database and preserves the source. Supply the new `STATE_ENCRYPTION_KEY`/file; supply `OLD_STATE_ENCRYPTION_KEY`/file when the source is already encrypted. A plaintext demo source needs no old key. Sessions are intentionally not copied during migration, so collectors sign in again. Stop writers during migration/cutover. Keep the old key with old backups until the recovery policy permits retiring them.

## Health and extensibility

`GET /healthz` confirms the process is serving. Startup does full integrity checks; `/api/operator/audit` provides authenticated read-only diagnostics. Request logs contain request ID, path, method and status, never bodies, tokens or attached codes. Monitor these logs, latency and storage externally. Trade expiration maintenance runs each minute and relevant commands also handle expiry. SIGINT/SIGTERM stop accepting new work and close stores.

An ESM `HOST_MODULE` may export `bindings`, `policies`, `limits`, `sessionOptions`, `rateLimits`, `rateLimiter`, `identityProvider`, `resolveAccess`, `currencyProviders`, `presentationOptions` and `handleStatic`. These are trusted code, not imported card data. Public contracts and examples are in [customization recipes](customization-recipes.md#version-02-extension-contracts). Replace identity, storage or presentation independently. External wallets, payment processing, game reward redemption and webhook delivery require host adapters with their own transaction and recovery protocols.

The executable production entrypoint, real OIDC verification fixtures, encrypted sessions, origin/principal controls, quotas, import CLI, migration and backup/restore are tested. The Linux container build passed CI. A live issuer, DNS/TLS, production secrets and site deployment require operational configuration; no live production deployment is claimed by this release.


## Optional card upload service

Set `PRESENTATION_ROOT` to a durable directory to enable the reference server's `/presentations` endpoints. The host uses the same verified identity and rate limiter as the domain API. Mutations require the exact configured Origin and X-DC-Principal headers. Creator, reviewer, publisher and moderation grants remain separate; unauthorized collectors are refused before their upload body is buffered. Read/publish rules are enforced again by the store.

`HOST_MODULE.presentationOptions` configures import limits, scan hooks, scan timeout, allowed capabilities and `performance` policy. Default performance policy warns and accepts; `mode: 'reject'` is opt-in. Use one import-store writer per directory. The endpoint accepts compiled `.dcard` packages; the public authoring APIs handle loose images, layered artwork and GIF conversion before upload. Uploaded content is data, never installation code. Published art is readable by signed-in collectors; do not embed private codes or personal data in presentation assets.

For externally funded wallets, export `currencyProviders` from HOST_MODULE. The authenticated `/api/currency/reconcile` endpoint verifies the provider receipt and recipient before a durable, deduplicated credit. See [provider contract and boundaries](complex-cards/customization-and-safety.md#currency-integration-and-its-boundary) and [security boundaries](../SECURITY.md).

## Code-card stock

For catalogs with code attachments, configure the separate code-vault key ring and stable index key described in [code-card operations](card-types-and-codes.md#deploy-and-operate). Startup verifies existing envelopes and reconstructs missing legacy provenance from stored evidence. `HOST_MODULE` may export `codeProviders` with authenticated read-only status lookups and `codeLimits` for bounded inventory/request capacity. A provider confirmation is distinct from a player marking a code used. Include the vault keys in isolated restore drills; state encryption keys alone cannot recover code secrets.


## Shops and durable account rewards

`HOST_MODULE` may export `actionHandlers`, `actionOptions`, `eventSubscriptions`, `actionWorker` and `raffleRandom`. These are trusted server extensions. The host runs one delivery cycle at a time when handlers are configured; set `actionWorker:false` to use an independent worker. Handlers must validate public parameters, map the immutable framework beneficiary to a verified external account, honor cancellation and deduplicate the supplied job ID at the receiver. See [delivery and recovery](card-actions.md).

Minute-based maintenance expires listings and draws due raffles, in addition to expiring trades. Time and stock checks also run inside purchase transactions. Monitor private action jobs, dead deliveries, stock reservations and `audit()`; reconcile ambiguous upstream outcomes before manual retries. Missing handlers and exhausted capacities require operator action. Preserve the state database when restarting: it contains stock, orders, draw results, leases and retry identities.

`trading.manage`, `commerce.manage`, `raffles.draw`, `actions.manage` and `actions.dispatch` are distinct permissions. Give background workers only their required permissions. Admin shop creation requires a registered framework account; proceeds go to the shop owner. Player shops and sealed-pack resale default to disabled. See [trading controls](trading-controls.md), [shops](shops-and-releases.md), and [raffles](raffles.md) for complete defaults and APIs. External currencies use verified ledger reconciliation; the shop transaction never performs an unverified remote debit.

## Idle maintenance and transaction results

When preflight finds no due work, action dispatch and listing-expiry cycles return without committing framework-state changes. A competing worker can consume work between preflight and the transaction; the serialized recheck remains safe. Due work is checked again before it is claimed or expired. The adapter suppresses unchanged record writes. Legacy command callbacks and unconverted reads still materialize their logical state; indexed queries serve the converted collection and identity paths.

Store callbacks must return a structured-cloneable synchronous value. Return-value validation occurs before commit; unsupported results and asynchronous callbacks leave state unchanged. Keep callbacks free of external effects.
