# Security boundaries

- Request JSON, uploaded art/archive metadata, names, descriptions, public card attributes and browser storage are untrusted data. Render text through text nodes; validate any URL/style-specific context separately. Do not strip legitimate punctuation or art descriptions merely to avoid contextual encoding.
- Authentication adapters create principals. Bodies, query strings, cookies containing an unsigned role and uploaded packages cannot grant permission. Resolve access per request. Default collector access excludes import, publish, mint and funding authority.
- Server-installed providers/mods are trusted code. Uploaded `.dcard` manifests cannot install JavaScript. Optional programs use the separate-origin allowlisted runtime contract; host-installed modules are not sandboxed by the framework.
- Purchases, supply, wallet debits, trades and attached rewards are authoritative transactions. Reveals and renderer inputs are presentation only.
- External funds require verified provider evidence, intended destination and purpose, recipient mapping, accepted finality, exact amounts, and durable deduplication. Receipt verification is a provider obligation; clients provide only identifiers.

## Deployment responsibilities

Configure trusted identity, TLS, credentials, upload scanning and resource limits before accepting untrusted content. See [production setup](docs/production.md) and [identity and access](docs/access-and-identity.md).

The supplied external-currency example uses a synthetic provider. A live integration must verify provider evidence and define refund, withdrawal and reconciliation behavior.

## Code entitlements

Use encrypted code pools for unique secret rewards. Never place codes in public card data or rely on a visual scratch cover to protect plaintext. Current-holder checks and trade locks apply at the reveal endpoint on every request, including retries. Player used markers are not verified redemption. Provider adapters must authenticate upstream evidence, redact secrets from diagnostics, and validate webhooks before submitting scoped confirmations.

Keep vault encryption keys and the stable HMAC index key separate from database backups. Repeat permission, disclosure, duplicate allocation, replay, transfer-race, expiry and restore checks before major releases. The automated code tests cover these boundaries with synthetic codes; live provider security remains an integration responsibility.


## Storefronts and opening actions

Listing stock, reviewed unit IDs, integer prices, ownership, current transfer rules and buyer limits are checked in the authoritative transaction. Player listings cannot mint stock or select server handlers. Raffle entries are free, account-scoped and unique; draws persist once and claims recheck authorization and funds. Server operators and installed randomness providers remain trusted.

Opening actions and custom goods commit an outbox job with their originating transaction. Worker claims require `actions.dispatch`; HTTP exposes no execution or acknowledgment route. Lease fencing protects local state, but arbitrary external delivery is at least once. Providers must authenticate requests, validate requested operations and recipient mapping, and durably deduplicate job IDs. Catalog parameters are public data and must never carry credentials. Timeouts cannot prove that a remote effect did not happen.

Before each major release, repeat policy-change, locked-stock, stale-quote, oversell, duplicate-charge, foreign-account, lease-race, crash/retry, secret-preview and raffle-claim checks. The automated tests exercise these boundaries with synthetic providers; they do not certify a live provider or constitute an independent security assessment.
