# Implementation coverage — 0.1.0

30 September 2026. This file describes the executable core added after the planning scaffold.

| User requirement | Current implementation |
| --- | --- |
| User-linked inventory | Stable provider/subject linkage, persisted owned copies and account authorization |
| Definable/multiple currencies | Integer balances, rational relative values, operator grants, conversion receipts and ledger |
| Variable pack prices by line/type | Product prices, currency, independent weighted slots, quote revision checks |
| Lines/rarity/1-of-1 limits | Open taxonomy, rarity ranks, finite per-variant lifetime supply and edition serials |
| Fully customizable albums | Private/public albums, placements/layout data, default grid, complete renderer/CSS replacement |
| Optional duplicates/trade-ups | Pack/inventory protection with explicit fallback; configurable input counts and output pools |
| Default appearances/back | Scoped default theme, CSS card back, host callbacks and asset overrides |
| Special data/codes | Namespaced public/private per-copy bindings, factories and local single-use state |
| Who opened/time/X of Y | Snapshot provenance, original opener and UTC time, finite edition serial/total |
| Optional player card/currency trades | Independent flags; mixed escrow offers, atomic acceptance, cancellation/expiry |
| View others' albums | Optional public browsing with private binding filtering |
| Album card inspector/3D | Click/touch inspection, tilt via pointer/keyboard, front/back, metadata |
| Layers/parallax/effects | Ordered image layers, depth/blend/opacity, gloss/holo/masks/emissive, replaceable renderer |

The broad earlier proposal also describes capabilities beyond this core: PostgreSQL, a React kit, external NX/wallet holds and reconciliation, rewards delivery, pity, release/checklist completion, a plugin package registry, multilingual default controls, operator dashboards, simulator tooling, operational monitoring, signed webhooks and backup restore reconciliation. These remain unimplemented. Trading and trade-ups are implemented now because the latest user request brought them into the core.

The standalone wallet has a complete local atomic boundary; it cannot safely coordinate unrelated writes to an external live game balance without a new adapter and recovery protocol. The local demo login is not production authentication. Valuable external codes require a protected store and issuer/redeemer lifecycle integration. The first storage adapter is a small-installation state document, with the scaling limits described in ADR 001.

All framework source and generic docs are tracked here. Production artwork and MapleStory integration remain outside this repository.
