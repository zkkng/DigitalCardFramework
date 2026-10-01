# Wiki section plan

[Specification home](README.md)

## On this page

- [Start here](#start-here)
- [Artist learning paths](#artist-learning-paths)
- [Prepare artwork](#prepare-artwork)
- [Build faces and effects](#build-faces-and-effects)
- [Design the complete card line](#design-the-complete-card-line)
- [Integrate websites and games](#integrate-websites-and-games)
- [Develop plugins and mods](#develop-plugins-and-mods)
- [Backend implementation and operations](#backend-implementation-and-operations)
- [Reference and troubleshooting](#reference-and-troubleshooting)
- [Example progression](#example-progression)
- [Coverage inventory and review](#coverage-inventory-and-review)

This is the initial coverage inventory. Each row describes required documentation if the capability is supported in the documented release. Split rows into pages when the reader's task changes. Merge short related entries when separate pages would make the task harder to follow.

All proposed pages start as planned. Existing source documents are evidence candidates, not automatically approved wiki content.

## Start here

| Proposed page | Required scope |
| --- | --- |
| Home | One friendly introductory paragraph; task routes; current version; link to capability and limits table |
| Choose your workflow | Default editor, layered import, programmatic creation and installed extensions; outputs and prerequisites |
| What makes up a digital card | Editable project, faces, layers, masks, materials, motion, poster, presentation file, catalog definition and owned copy |
| Supported capabilities | Availability, editor/API access, import fidelity, version, environment and limits for each capability |
| Example library | Task, skill requirement, mechanism, compatible versions, source, expected result and verification |
| Glossary | Plain definitions, exact UI labels, API names and search synonyms |

## Artist learning paths

The primary path assumes image-editing experience and no programming knowledge. Teach only the terms needed for the next action. JSON and implementation details belong in linked references unless the current tool requires them.

| Path | Required result | Evidence |
| --- | --- | --- |
| First card | Import one image, set both faces, preview and export a valid card | Editable input, exported result, reload check |
| Layered card | Preserve layer placement; add depth, a masked finish and bounded motion | Layer diagram, comparison at fixed inputs, fallback |
| Complete card line | Produce related cards, backs, pack art, album pages and cover art; deliver a consistent release | Asset inventory, variants, validation report, publisher handoff |
| Custom artistic result | Select a built-in control, installed recipe or developer extension | Decision guide, required assets, supported result |
| Repair a card | Diagnose a visible defect and verify its correction | Deliberately broken fixture, fix, before/after |

The complete-line path must identify any surface that currently needs host code or has no supported authoring route. It must not disguise that gap as a working default workflow.

## Prepare artwork

| Topic family | Required questions and examples |
| --- | --- |
| Canvas and composition | What controls aspect ratio, crop, safe area and clipping? Show one marked template with actual versioned constraints. Distinguish recommendations from hard limits. |
| Color and transparency | Which color spaces, alpha conventions and blend modes survive import? Show an edge halo and its correction. Cover light and dark display backgrounds. |
| Layers and groups | What is the order? Which coordinates and pivots are used? How do groups, masks, opacity and blending interact? Show a small labeled stack. |
| Source formats | Which tool/export versions were tested? Which properties are preserved, rasterized, approximated or rejected? Explain flattening and its losses. |
| Pixel art and text | Sampling, scaling, clipping, font availability, glyphs and localization. Separate visual text from accessible names. |
| Asset organization | Stable names and IDs; allowed paths; reusable images, masks and fonts; external dependencies and source-file retention |
| Rights and credits | Where credits and licenses go; which sample assets may be redistributed; how an artist hands over permissions |

Do not promise Photoshop fidelity, native editing-tool support, print dimensions, HDR or font embedding without specific implementation evidence.

## Build faces and effects

| Topic family | Required coverage | Best initial example |
| --- | --- | --- |
| Fronts and backs | Independent art and motion, orientation during flipping, poster selection, missing-face behavior | Same front with a distinct back |
| Layered depth | Placement, overlap, pivots, parallax, crop margins and occlusion | Three-layer scene at neutral and extreme tilt |
| Masks | Supported alpha/channel semantics, inversion, coordinate alignment and resolution | Finish confined to a leaf |
| Built-in finishes | Every exposed material/preset and parameter, units, defaults, interactions and costs | Fixed artwork with one parameter changed |
| Custom finishes | Preset adjustments, reusable recipes, imported flake shapes, multiple masked effects, installed renderers | One input with two documented finish variants |
| Motion | Time versus input control, angle/tilt mapping, bounds, easing if supported, loops, pause and reset | A pose or detail responding to tilt |
| Character frames | Registration, pivots/contact points, frame order, transitions and unsupported rig features | A short pose set with alignment guides |
| Advanced media | Actual video/audio/animation/3D adapter profiles, required assets, permissions and fallback | Optional adapter beside its poster fallback |
| Connected cards | Assembly coordinates, seams, missing pieces, mixed versions and shared interaction | Two cards forming one scene |
| Performance | Decoded size, layers, textures, active motion, simultaneous cards, quality changes and measured limits | Same composition at two supported profiles |
| Accessibility | Reduced motion, static meaning, text alternatives, touch/keyboard behavior and audio control | Active and reduced-motion presentation |

Every supported control receives a reference entry. Artist task pages group controls by the visual result. A generated parameter list alone is insufficient.

## Design the complete card line

| Surface or workflow | Required documentation |
| --- | --- |
| Card fronts | Shared visual system, names and labels, reusable framing, content variants and readable small previews |
| Card backs | Shared versus per-card designs; orientation, visual identity, fallback and spoiler-sensitive details |
| Card packs | Wrapper/front/back surfaces actually supported, thumbnail, reveal assets, states and host placement; distinguish art from pricing, odds and allocation |
| Album pages | Backgrounds, slots, spacing, labels, ordering, responsive layouts, empty slots and missing/removed cards |
| Album covers | Supported cover/spine/interior surfaces, crop behavior, thumbnail and unavailable surfaces |
| Album interaction | Per-card motion, synchronized groups, independent limits, reduced motion and shared resource budgets, when available |
| Rarity and editions | Visual variants, naming and reusable templates; distinguish appearance from authoritative rarity, supply and serials |
| Reuse and batch production | Template/version behavior, stable IDs, variant inheritance if supported, validation and reproducibility |
| Preview and review | Front/back, small/large, touch/keyboard, extreme inputs, quality fallback, reduced motion and missing assets |
| Export and delivery | Editable originals, bundle/manifest versions, dependencies, posters, checksums, credits, validation and handoff responsibilities |
| Revise a published line | Draft versus published content, immutable references, existing-copy behavior, replacement, deprecation and rollback limits |

"Pack art" and "album cover art" need their own findable destinations. Hiding them under a generic theming page fails coverage.

## Integrate websites and games

| Topic family | Required coverage |
| --- | --- |
| Integration choices | Standalone player, widget, headless client, complete application and server integration; what each includes |
| Embed and lifecycle | Setup, mounting, sizing, input, events, loading, cancellation, unmount, cleanup and repeated mounting |
| Replace the interface | Host routing, layout, theme tokens, labels, component replacement, full renderer replacement and accessibility obligations |
| Load and serve art | Immutable references, asset URLs, MIME types, CORS, caches, selective loading, offline behavior and missing dependencies |
| Identity and permissions | Trusted session mapping, account linkage, artist/reviewer/publisher boundaries, ownership and revocation |
| Import and publish | Validation, preview, approval if implemented, content storage, catalog commit, partial failure, retries and concurrency |
| Pack opening | Purchase/allocation versus reveal; interruption, replay and skip without changing committed results |
| Game data and rewards | Namespaced public data, private bindings, external currencies, delivery receipts and reconciliation; exact host responsibilities |
| Upgrade and migrate | Package/runtime/schema compatibility, pinned examples, breaking changes, migration and rollback |

Each integration guide states which code runs in the browser, framework server, external service and host. Configuration must not imply authority.

## Develop plugins and mods

Every extension family must have a discoverable decision path and a complete contract. Initial families:

- Content importers, authoring transforms, material recipes and reusable presets.
- Player adapters, custom effects, renderer replacements and advanced-media integrations.
- Themes, slots, layouts, complete views, localization and namespaced metadata displays.
- Host identity, access policies, currency/reward providers, storage and publication adapters.
- Optional editor contributions or module registries only when implemented.

Required topics: configure versus wrap versus replace; installation and registration; dependency/version requirements; inputs and outputs; lifecycle; event timing; order and conflicts; trust/capabilities; errors; cancellation; resource limits; cleanup; disabling; uninstalling; retained data; testing; migration.

Document the actual installation mechanism. Do not imply a marketplace, hot reload, sandbox or automatic discovery because plugins are supported in another form.

## Backend implementation and operations

| Topic family | Required coverage and evidence |
| --- | --- |
| Architecture | Domain service, stores, headless layer, default UI, host composition and trust boundaries; one readable responsibility diagram |
| Domain model | Users, subjects, presentations, catalog definitions, copies, editions, packs, inventories, albums, trades, currencies and bindings |
| Transactions | Atomic boundaries, invariants, locking/version checks, idempotency scope, ordering and partial failures; successful and failed sequence |
| Persistence | Store contract, schema/version changes, snapshot semantics, indexes if used, concurrency limits and durability |
| API and events | Public entry points, request/response schema, auth, error catalog, event order, retries, pagination/limits and lifecycle |
| Content pipeline | Parse, validate, scan, quarantine, compile, publish, retain and recover; untrusted files and native-decoder boundaries |
| Security and privacy | Permissions, secret/public fields, origin policy, isolation guarantees and gaps, signatures, audit records and revocation |
| Deployment | Supported topology, dependencies, configuration, secrets, identity service, TLS, assets, health and readiness |
| Operations | Logs/metrics, common incidents, capacity tests, backup/restore, key rotation, retention, cache invalidation and shutdown |
| Recovery and migration | Interrupted publication, incompatible schemas, revoked assets, deleted originals, failed upgrades and recovery rehearsal |
| Contributor guide | Code map, local setup, contract tests, fixtures, architecture decisions and documentation obligations |

No blanket claims of production readiness, sandbox safety, exactly-once behavior or device support. Each needs a bounded statement and evidence.

## Reference and troubleshooting

Provide canonical references for formats, scene/node types, materials, motion inputs, coordinate systems, supported source formats, APIs, events, CLI commands, configuration, extension points, permissions, errors, compatibility and resource limits.

Troubleshooting starts with a symptom or exact error. Cover misplaced layers, wrong masks, color/alpha halos, unsupported source features, motion clipping, blur, seams, stale posters, missing adapters/assets, CORS, audio/video restrictions, poor performance, publication conflicts, lost access and version mismatch. Each entry provides a diagnostic check, correction, expected result and next escalation step.

## Example progression

These are fixture briefs, not examples already written or tested.

| Example | Teaches | Required proof |
| --- | --- | --- |
| Single image | Smallest successful artist workflow | Export and reload |
| Layered scene | Order, masks, finish and depth | Fixed-input comparisons and editable layers |
| Custom finish | Built-in adjustment versus host-installed recipe | Same source, different mechanism, same fallback contract |
| Complete line | Fronts, backs, pack, pages and cover | Consistent asset inventory and handoff |
| Alternate host | Different routing/layout/renderer through public APIs | No core edits or private DOM selectors |
| Plugin failure | Missing dependency, competing replacement or disposal | Predictable diagnostic and cleanup |
| Publication retry | Failure between asset publication and catalog commit | Defined recovery, no duplicate authoritative operation |
| Host-specific case study | Real art migration, companion assembly and game-specific composition | Pinned integration commit, generic counterpart, asset access terms |

The host-specific example series should grow to cover the large integration as it is built. Identity, currencies, rewards and live server wiring receive examples only after verification. Readers must be able to complete the generic tutorial without host-specific assets or accounts.

## Coverage inventory and review

Before authoring, expand these families into a register of stable feature IDs and page IDs. For each feature record: user task, audience, implementation state, availability, UI/API route, owning repository, version, canonical page, tutorial/recipe, limitations, evidence and owner.

Review the inventory whenever a feature is added, changed, renamed, removed or newly exposed to artists. Also review it at each release planning boundary. Add pages because a reader has a distinct task, not because a module exists.

Current inspection seeds include the framework's [customization architecture](../customization-architecture.md), [creator API](../complex-cards/creator-api.md), [runtime coverage](../complex-cards/implementation-status.md), [access model](../access-and-identity.md) and [audit](../complex-cards/audit-2026-10-01.md). Revalidate them against the target release. Work in progress on custom effects, album motion and performance rules must enter the register when its contracts settle.
