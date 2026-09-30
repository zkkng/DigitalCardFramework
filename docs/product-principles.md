# Digital card framework — product and architecture principles

Confirmed user direction, 30 September 2026. This clarification takes precedence over narrower MapleStory wording in earlier planning documents. It records the intended product and future design requirements; it does not claim those features are implemented.

## Open by default, easy to integrate

Build a reusable digital card platform that can be connected to many host systems with a small, documented integration layer. MapleStory / Quiet Grove is one content package, theme and host integration. The core must work with unrelated card subjects, art styles, account systems, currencies and external applications.

The reusable experience covers pack creation and opening, persistent collecting, collection browsing, albums, trading, and future features. Trading is part of the intended platform, while its first release timing and exact policies remain undecided. Future modules must build on the same stable catalog and owned-copy model, without requiring a rewrite or a fork for each host.

Creators can make or import whatever card content they choose, including art produced with GPT, local AI, commissioned work or existing assets. Content packages define lines, releases, cards, variants, packs and presentation. Content generation is an optional authoring workflow; no particular AI provider or generation service is a runtime dependency of ordinary collecting.

## Separate the reusable system from the host

Customization is a primary requirement in every phase. Hosts and mod authors can rearrange UI, replace individual or complete views, change policies and add modules through documented public contracts. The default application is one composition. See [customization architecture](customization-architecture.md) and its [primary-source research](customization-research.md). Each feature must demonstrate its customization path; a generic extensibility claim is insufficient.

- **Core:** catalog identities, pack rules and persisted outcomes, ownership, albums, transfer state, extension contracts and transaction history.
- **Presentation:** configurable pack opening, card rendering, effects, collection and album views. Card art and effects are data-driven assets with optional presentation profiles.
- **Content packages:** any card subject, line taxonomy, tags, rarity/variant definitions, pack pools, display fields, albums and policies. No universal MapleStory mob fields, class list or combat stats.
- **Host adapters:** account identity, points/currency authorization and spending, eligibility, optional delivery/redemption and external state. Build a real adapter for each supported host rather than promising zero-work compatibility with every system.
- **Optional modules:** trading, rewards/codes, achievements, recipes and future additions using documented APIs, events and capabilities. Missing optional modules do not prevent basic collecting.

Keep domain assumptions out of the generic core. NX is the Quiet Grove adapter's currency; another host can use points, credits, tokens or its own balance. A product references a configured currency/provider rather than a hard-coded NX field. Distribution can also use grants or other configured acquisition rules. The host controls issuance and economy policy.

Make adoption practical: a standalone demo, validated sample content, a small adapter SDK, documented API/event contracts, clear capability discovery, migration/versioning rules and adapter conformance examples. Support embedding existing UI or consuming the API with another frontend. Measure ease of integration through a second unrelated demo integration, not just claims in documentation.

## Open-ended attributes and bindings

Special codes are one kind of optional card binding. The model must also accommodate future attributes such as an external reference, unlock, reward entitlement, provenance, edition data or module-defined state without making every card a coupon.

Distinguish reusable card-definition attributes from variant attributes and per-owned-copy state. Each extension declares a namespace, schema/version, validation and display behavior. Optional structured metadata gives creators flexibility; executable host behavior lives behind registered module/adapter contracts. A tag should not silently acquire redemption or trading behavior.

Bindings with behavior declare their lifecycle: when they are assigned, whether they are public or private, whether they transfer with a copy, how redemption/use changes state, expiration/revocation, and what happens when the relevant integration is unavailable. Secrets such as usable codes stay in private server-managed storage; public album and card APIs expose only approved display metadata and state.

Trading must account for these bindings. The host/module policy decides whether an entitlement travels with a card, remains with the original recipient, blocks transfer, or becomes unavailable after use. Transfer and entitlement changes need a consistent authoritative transaction; a previously revealed code must not leave both owners able to claim the same benefit.

## Example, not fixed taxonomy

A creator could import a card set, organize lines or subsets by class, define class-specific packs and use random pack opening to build a collection. Another creator could make landscape art cards with no classes, codes or gameplay data. Both use the same pack, ownership and album infrastructure. A third-party game/deck module can consume those cards through stable APIs; combat rules are not a prerequisite for the framework.

## Acceptance expectations

An adopter can install the framework, load unrelated content, configure their host account/currency adapter, and reuse opening, collecting and album behavior without editing the generic core. Optional code/reward bindings can be disabled entirely. At least one unrelated content package demonstrates different fields and taxonomy; an example namespaced attribute and module demonstrate extension without schema surgery. Trading and later modules retain these boundaries when delivered.

Exact stack, supported deployment profiles, license, trading rollout, economy settings and the first binding types still require specification choices. Openness means explicit extension points and useful defaults; it does not claim every possible integration already exists.
