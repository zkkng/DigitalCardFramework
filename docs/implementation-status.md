# Implementation coverage — 0.2.0

1 October 2026. This describes executable collector behavior and the supported standalone production profile. The original proposal remains design guidance.

| User requirement | Implementation/evidence |
| --- | --- |
| User inventory | Immutable issuer/subject linkage, persisted copies and ownership; identity/HTTP/restart tests |
| Multiple definable currencies | Integer balances, exact rational conversions, ledgers, independent trade flags; overflow/retry/rollback tests |
| Pack types/prices/rates by line | Weighted slots, quote revisions, release windows, availability and optional pity; allocation/revision/exhaustion tests |
| Rarity/finite editions/1 of 1 | Lifetime supply includes sealed allocations, serials never reused; two-process last-copy tests |
| Duplicate systems/trade-ups | Optional pack/inventory protection, explicit fallback, configured counts/outputs and rollback |
| Beautiful replaceable defaults | Card Atelier, runtime sample imagery, full view/renderer/layout replacement, alternate composition and cleanup tests |
| Custom albums | Private/public, ordered placements, layout JSON, isolated CSS, export/import, optimistic edits and transfer cleanup |
| Special data/codes | Owner/public bindings, factories and follow/retain/block rules; privacy/local-use tests |
| Stats/metadata/opener/time/X of Y | Structured data, local schemas, display labels, snapshots and provenance |
| Visual player trading | Two inventories, drag/drop or Add/Remove, card/currency trays, immutable review, counters and atomic escrow/acceptance |
| Optional trading | Independent flags, currency policies, cancel when disabled, inventory privacy/blocking and expiry |
| View other albums | Optional public browsing with protected binding filtering |
| Layered/3D card inspection | Crop/depth/blend/opacity, parallax/effects, backs, orbit/flip/zoom/reset, keyboard and reduced motion |
| Multiple/combinable inspection | Select up to 24 copies; shared stage, creator grid, missing pieces and seamless demo panorama |
| Bulk JSON/YAML | Full manifests/ID patches, stats/metadata/layers/combinations, digest/version review, atomic publication and CLI |
| Production profile | OIDC entrypoint, encrypted state/sessions, origin/principal controls, limits/quotas, audit, health, logs, backup/restore and key migration |

## Supported boundaries

The standalone profile uses local framework currencies and binding state, with an optional verified external-settlement gateway for funding. See [complex-card customization and safety](complex-cards/customization-and-safety.md). SQLite is a bounded whole-state adapter; limits and measurements are in [operations](production.md). Real OIDC verification fixtures and a trusted provider integration fixture test the executable host. Live credentials, DNS/TLS and an actual deployment are operational requirements.

CSS 3D inspection renders front/back surfaces and layered parallax. It does not reconstruct unseen artwork, merge ownership or execute imported code. Portable `.dcard` packaging and its advanced player are implemented in the presentation module; consult the [audited coverage and remaining gaps](complex-cards/audit-2026-10-01.md).

Public view/renderer/layout overrides, reveal/trade controllers, imports, policies, binding factories, identity and store contracts are implemented. An automatic plugin marketplace/registry, compatibility negotiator and React-specific adapter are separate work.

## Optional suggestions

| Extension | Boundary |
| --- | --- |
| High-volume Postgres | Normalized store, migration and recovery gates |
| External withdrawals/cross-service escrow | Verified incoming settlement is implemented; withdrawal/refund/hold policies remain provider-specific |
| External code/reward redemption | Host delivery adapter, rotation/revocation and receipts |
| Signed webhooks/email | Durable outbox worker and delivery policy |
| Achievements/decks/combat | Namespaced module using generic definitions/stats |
| Auctions/marketplace | Separate market service and settlement/moderation rules |
| Wishlist matching | Optional read-only suggestions with explicit offer review |
| Complete localization | Host view/label replacement, then localization catalog |
| Broader video/shader/3D support | Current portable runtime implements supported media subsets; additional codecs/backends require conformance |
| Production upload operations | Reference host supports PRESENTATION_ROOT with permission/origin/rate checks; deploy with constrained scanning and host review policy |
| Distributed deployment | Shared sessions, database locking, distributed limits and failover |

Suggestions are extension work, not silently enabled or described as complete. The requested collector, pack, inventory, opening, import, trade and album behavior above is implemented.
