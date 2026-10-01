# Open framework overhaul

User direction: 1 October 2026. Implement a beautiful reference website while keeping card, pack, inventory, album, import, trading and presentation contracts independently replaceable. Keep content and external host/game integration separate.

## Delivery sequence and acceptance

1. Research and white paper: inspect primary references for collector interfaces, visual trading, bulk card data, YAML, authorization and operational recovery. Record adopted decisions and deferred suggestions with reasons.
2. Creator tooling: JSON/YAML full catalogs and bulk card patches, structured metadata/stats, asset references, combination manifests, validation diagnostics, preview and atomic revision-aware publication. Tests cover duplicate keys/IDs, malicious structures, invalid references, bounds, stale previews and preserved snapshots.
3. Player services: inventory privacy and public trade browsing, named profiles, trade eligibility/snapshots, immutable offers, counters, blocking, favorites, wishlists, paginated browsing, per-user notifications/history and independent feature switches. Tests protect ownership, secrets, escrow, concurrent acceptance and expiry.
4. Presentation: polished default application, both inventories and offer trays with drag/drop and keyboard/touch alternatives, review confirmation, visible offer details, collection search/filter/sort/select, album editing, structured stat panels, full rotation/zoom/reset inspector and multi-card scene assembly. A second composition proves overrides.
5. Production profile: verified OIDC identity integration, protected durable sessions, startup validation, HTTPS origin, encrypted state, bounded requests/rate limiting, security headers, operator-only imports, audit/health endpoints, graceful shutdown, durable backup/restore checks, dependency lockfile/CI and deployment documentation.
6. Verification: test and review critical invariants, restart/concurrency/recovery, keyboard/narrow screen and browser workflows. Commit logical stages and push the finished release. Report actual deployment requirements and remaining limitations accurately.

## Boundaries

- Framework currencies are local integer units. External game wallets and valuable external rewards require a host transaction/delivery adapter; no network-side reward is claimed by a local binding update.
- Production readiness has a declared supported deployment profile and measured limits. A configured external identity provider, TLS ingress and real operational credentials cannot be invented. Live deployment and external credentials are distinct from shipping an executable profile.
- No universal game combat rules, blockchain/NFT requirement or marketplace speculation. Optional pity, notifications, set completion and creator tools operate on existing public contracts.
- Art stays outside Git. Default visuals are code-native CSS/DOM or generated local reference visuals; imports reference host-owned content URLs.
- Feature lists are acceptance work, not evidence of completion. Final coverage records what was tested and what still requires host configuration.
