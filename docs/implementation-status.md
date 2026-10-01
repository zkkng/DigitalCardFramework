# Supported framework features

1 October 2026. This describes executable collector behavior and the supported standalone production profile.

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

CSS 3D inspection renders front/back surfaces and layered parallax. It does not reconstruct unseen artwork, merge ownership or execute imported code. Portable `.dcard` packaging and its advanced player are implemented in the presentation module; consult the [supported capabilities and limits](complex-cards/implementation-status.md).

Public view/renderer/layout overrides, reveal/trade controllers, imports, policies, binding factories, identity and store contracts are implemented. An automatic plugin marketplace/registry, compatibility negotiator and React-specific adapter are separate work.

## Card types and private rewards

Built-in card classifications, namespaced custom types, hybrid code attachments, guaranteed/optional insert slots, immutable origin records and evidence-based legacy backfill are implemented. Encrypted unique stock, atomic pack allocation, scratch/peel/open private reveals, historical access, transfer policies, personal used markers and provider-confirmed status have headless and HTTP contracts. The reference application includes replaceable Code history and opt-in insert discovery. See [usage and deployment](card-types-and-codes.md) and the executable `examples/code-cards.mjs`.

External game redemption, signed webhook verification, refund/reissue decisions and code-index-key migration remain host work. Type names do not add game rules or financial voucher accounting. Existing generic bindings remain available but do not provide the encrypted stock lifecycle.
