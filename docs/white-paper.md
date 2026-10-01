# Open card infrastructure and the default collector experience

1 October 2026. Engineering white paper and implementation decisions. This is a conventional application framework: card definitions, individually owned copies, server-committed pack allocations and atomic exchanges. It imposes no game rules, blockchain, artwork service or external wallet.

## Research basis

**Trading.** Steam documents a process that brings both participants' inventories into one offer editor, moves chosen items into separate trade areas and asks for a confirmation of contents before submission. We adopt the two-inventory composer, visible offer summaries and immutable review state. Clicking and keyboard controls supplement dragging for touch and accessibility. We add privacy and block settings and keep the final eligibility check on the server. [Steam Trading](https://help.steampowered.com/en/faqs/view/46A2-2B3C-95CC-8878).

**Collection browsing.** Pokémon's official database exposes card text, rarity, type and expansion filters. This suggests searchable cards with creator-defined fields rather than one hard-coded combat taxonomy. Our default collection uses names, lines, rarity, finish, tags, favorites and ownership while structured stats remain optional. [Pokémon card database](https://www.pokemon.com/us/pokemon-tcg/pokemon-cards).

**Products and variants.** Wizards' collecting guides distinguish booster contents, variant frames, finishes and limited serialized editions. Our model keeps a reusable definition separate from a variant and an owned copy. Products define weighted slots and creator policies; an edition counter advances at allocation, including sealed cards. Reveal animation never rerolls. [Project Booster Fun](https://magic.wizards.com/en/news/making-magic/project-booster-fun-2019-07-20), [Collecting March of the Machine](https://magic.wizards.com/en/news/feature/collecting-march-of-the-machine).

**Bulk content.** Scryfall recommends bulk downloads when importing large volumes, and its own type library separates objects and structured fields. The framework imports local JSON/YAML catalogs or section patches instead of fetching artwork or crawling another service automatically. It preserves supplied asset references, metadata, stats and IDs. Creators are responsible for licensed assets and adapting external identifiers. Scryfall's documentation pages could not be retrieved during this pass; the supporting accessible sources are [Scryfall API access guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17) and its [published type repository](https://github.com/scryfall/api-types).

**Data format.** YAML is a serialization format, not executable extension code. We use the maintained parser with its core schema, duplicate-key checks and aliases disabled. Bounded JSON-compatible structures and local schema validation apply after parsing both formats. Unknown tags, reserved object keys and excessive nesting fail before publication. [YAML specification](https://yaml.org/spec/1.2.2/), [parser documentation](https://eemeli.org/yaml/).

**Authorization research.** The formal OAuth analysis identifies the importance of following protocol security recommendations, while RFC 9700 incorporates current security practice. The production reference host uses a maintained OIDC client for authorization-code flow with PKCE, state and nonce checks; account linkage uses issuer plus immutable subject. No display name or JSON request grants authority. [A Comprehensive Formal Security Analysis of OAuth 2.0](https://arxiv.org/abs/1601.01229), [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700), [openid-client](https://github.com/panva/openid-client).

**Transaction controls.** OWASP emphasizes identifying significant transaction contents, enforcing authorization on the server and validating at execution time. Trade snapshots and a review digest prevent the interface from approving a different offer; server checks still reject changed ownership, versions, policies or currency eligibility. Idempotency records and escrow live in the same transaction as results. [OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

**Recovery.** SQLite describes its online backup facilities and why ordinary copying of a live database needs care. The supported standalone profile uses a consistent database backup, retained encryption keys and a restore/invariant check. Operational credentials and a provider deployment are configured by the host. [SQLite Backup API](https://www.sqlite.org/backup.html).

## Domain boundaries

1. A definition describes a subject and optional structured stats. It is public catalog data.
2. A variant defines rarity, finish, edition and binding policies. Private binding payloads are filtered from public views.
3. A copy has exactly one current owner, source provenance and an immutable presentation snapshot. Trade reservation does not duplicate ownership.
4. A purchase debits one defined currency and commits its allocations atomically. Supply, duplicate protection and optional pity share this boundary.
5. An offer has two fixed sides, expiry, snapshots, review digest and sender escrow. A counteroffer closes/refunds the previous offer and creates the reverse proposal atomically.
6. An album references copies and stores layout data. An assembly references definitions and positions; it does not merge, consume or mint cards.
7. A host owns identity, deployment and external currency/reward bridges. Local code-consumption state is not an external redemption.

## Import protocol

Preview → inspect diagnostics and additions/updates → verify catalog version and digest → publish once. Merge replaces each supplied record by ID, retains omitted records and increments the catalog version. Replacement requires a complete catalog. Published identities, finite caps and product revision rules remain enforced. Retire a published entity with its supported enabled flag rather than deleting it. Old copies retain their original snapshots.

Schema validation never downloads remote schemas, executes YAML tags or interprets metadata as HTML. Optional stat and metadata schemas use a bounded, documented keyword subset. Asset references must be relative or HTTP(S); the production host's content policy determines which external asset origins load.

## Presentation contracts

The default app should make the product understandable before exposing advanced features. It provides a deliberate visual identity, collection tools, opener, album editor, trade composer, full card rotation and multi-card inspection. Themes, layout data, renderers, view slots and headless controllers are public replacement boundaries. Data contracts remain stable when every visual is replaced.

Pointer parallax changes image layers; orbit controls rotate a front/back card surface in CSS 3D with a visible edge. These are distinct controls. Comparison can show arbitrary cards together; combination manifests align compatible pieces on a shared stage. Reduced motion, keyboard adjustments, reset and touch controls remain usable.

## Suggested extensions and scope discipline

- External wallet adapters need a holds/recovery protocol and conformance tests before being called supported.
- External reward delivery needs encrypted credential storage, issuer-specific rotation and idempotent dispatch/reconciliation.
- Auction houses, cash markets, lending, staking and NFT contracts are separate economic systems, not default card infrastructure.
- Game deck construction, combat engines, matchmaking and tournaments can consume card stats through an optional package.
- PostgreSQL and tenant partitioning should be implemented against the transaction contract when measured standalone limits are exceeded.
- Signed event delivery can build on an outbox and replay cursor; a naive synchronous webhook must never decide whether an ownership transaction committed.
- A plugin marketplace requires a trust and compatibility model. Public replacement functions provide customization without loading untrusted code.
- Moderation tooling, localization catalogs, line completion, wishlists, accessibility, operator diagnostics and recovery tools are useful generic features. Each shipped feature needs a public example and verification evidence.

The release coverage and operational profile, rather than this design paper, establish which capabilities have actually passed tests.
