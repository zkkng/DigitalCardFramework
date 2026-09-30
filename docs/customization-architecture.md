# Customization architecture

Confirmed product requirement and researched design direction, 30 September 2026. Apply during every development phase, including the first website integration. This is a design contract; the mechanisms below are not yet implemented. Concrete API names, stack and packaging remain to be decided through working slices.

## What adopters must be able to do

Adopters and mod authors must be able to rearrange, remove, insert, wrap and replace features through documented configuration or extension code. This includes page layout, navigation, pack presentation, card rendering, collection views, album layouts, trading presentation, labels, custom fields, policies and host providers. A host can use one pack-opening widget in its existing website or supply an entirely different frontend.

Customization is a deliverable for each feature, not a phase after the default application is finished. Provide a useful default experience and a supported path away from it. Do not require a fork, edits to installed packages, deep internal imports, DOM patching or brittle CSS selectors for ordinary customization.

## Architecture direction

Separate the authoritative domain service, a headless client/controller layer, optional UI components, and the host composition root. Headless means callers can use state and commands without inheriting markup, layout, navigation, styling or animation. The composition root selects implementations and wires dependencies. Core modules depend on narrow contracts rather than importing the host application.

Provide a modular reference application built from the same public APIs used by adopters. Its existence proves defaults are convenient; a second substantially different composition proves the contracts are useful. Do not claim support for every UI framework or runtime before verifying an adapter for it.

Choose module boundaries around decisions that hosts are likely to change: identity, currencies, reward delivery, catalog import, presentation and distribution policy. Keep storage representation and implementation details behind contracts. The research basis and limits of these recommendations are recorded in [customization research](customization-research.md).

## Levels of customization

| Need | Supported mechanism | Example |
| --- | --- | --- |
| Change common appearance or defaults | Validated configuration, theme tokens, localization | Spacing, labels, motion intensity, default collection sorting |
| Rearrange an existing view | Named slots and an explicit layout composition | Move odds above purchase, put results beside the opener, hide optional tabs |
| Change one part | Component/renderer replacement or wrapper | New card back, custom rarity badge, a different album cell |
| Change a whole experience | Replacement controller/view using headless commands | A modal opener, instant reveal list, alternate album editor |
| Change domain choices | Registered policy strategy with a documented contract | Transfer eligibility, distribution rules, reward binding behavior |
| Connect another host | Provider/adapter implementation | New identity, currency or reward service |
| Add future functionality | Namespaced module with declared contributions | Achievements, deck tools, custom card attributes |

Configuration handles common changes. Slots and replacement contracts handle structural changes. Full replacement remains available when composition is insufficient. Extensibility does not mean a boolean for every imaginable variation or a global hook around every internal function.

## Website and pack-opening contract

The opener accepts an already committed allocation/presentation model and a controller contract. It does not own the host router, page shell, login screen, wallet layout or album placement. The host chooses its mount location, dimensions, assets and renderer, and can place controls and results independently.

Distinguish acquisition/opening commands from visual reveal. An animation can be skipped, replaced, interrupted or replayed while the same persisted result remains authoritative. State includes loading, committed result, reveal progress, completion and recoverable failure through a documented controller. The host can read/control presentation state without writing ownership records directly.

Document render inputs, stable commands, events and cleanup. Never make a plugin infer completion by reading a CSS class or waiting for a hard-coded animation duration. Specify whether an event occurs before a command, after authoritative commit, or only during presentation. Moving UI steps must not silently reorder the transaction protocol.

Support theme tokens/CSS variables and deliberate class/style entry points. Scope default styles to the widget; avoid global resets, forced body dimensions, document-wide keyboard handlers and assumed z-index ownership. Register listeners at the smallest useful boundary and release them on unmount. Layout changes must preserve keyboard, touch, focus and reduced-motion behavior; document these obligations for replacement components.

## Extension contracts and conflict resolution

Each public extension point declares a stable identifier, purpose, input/output schema, lifecycle, default implementation and supported operations: configure, contribute, reorder, wrap or replace. State its compatibility/version and examples. Do not expose mutable internal services as a convenience shortcut.

Distinguish a single implementation slot from a list of contributions. For a single slot, two replacements require an explicit host selection; unresolved conflicts fail with an actionable diagnostic. Contribution ordering uses documented priorities or before/after constraints, with cycle detection. Import order must not decide behavior accidentally. The host can disable modules and inspect the resolved composition, including the source of each override.

Define configuration precedence explicitly. Proposed precedence for supported fields: framework defaults, installed preset, host configuration, then an allowed line/product/view override. Individual schemas declare which scopes may override which fields. Arrays have an explicit replace/append/order policy; no magical recursive merge. Unknown fields, missing providers, incompatible versions and conflicting bindings are reported before affected features run.

Modules declare identity, version, required framework/API versions, dependencies, contributions, configuration schema, capabilities and migration needs. UI and server modules have distinct capabilities. An installed module can be selectively enabled; uninstall/disable behavior must explain retained data and unavailable bindings. Extension code runs in a documented trust environment, not an implied universal sandbox.

Operators can replace domain policies through server-side contracts. Required platform invariants remain explicit: commands verify authority, committed outcomes do not reroll on presentation replay, transfers do not create duplicate ownership, and retries do not charge or award twice. Alternative policy implementations must satisfy the same contract tests. An intentionally different transaction model requires a separately specified provider/engine contract, not a UI override that bypasses checks.

## Stable customization over time

Version schemas, extension contracts and provider interfaces. Document compatibility ranges, deprecations and migration examples. Public extension-point removal or an incompatible behavior change is a compatibility change even if the default screen looks identical. Publish release notes and retain a supported upgrade path.

Every recipe records the changed public contract, where code/config belongs, an executable example and its expected effect. Recipes should cover layout reordering, one-component replacement, complete opener replacement, custom metadata display, a host provider and a domain policy. The framework repository owns generic recipes; MapleStory-specific wiring stays in the integration repository. Artwork stays outside both code repositories.

## Acceptance scenarios to implement

These are required future checks, not passed tests today.

1. Embed the opener into two different host shells: a full page and a modal/sidebar arrangement. Neither edits core source nor adopts the reference app's routing.
2. Rearrange odds, purchase controls, opener and results; replace one card renderer and hide an optional feature through public contracts.
3. Replace the complete reveal with an instant list. Replay/skip/interruption retain the same cards and result identity, with no extra debit or award.
4. Build a different collection and album layout against the headless layer. Add a namespaced card attribute and custom display without changing the generic card schema.
5. Replace identity/currency providers and one server policy, with conformance tests still passing.
6. Install two competing replacements and contradictory contribution ordering. Diagnostics identify the conflict; explicit host resolution is deterministic.
7. Disable a module, mount/unmount the opener repeatedly, and upgrade a compatible framework version. No retained listeners, inaccessible orphaned controls or silent override loss.
8. Verify keyboard, touch, reduced motion and ownership/privacy behavior in customized layouts as well as the reference application.

An example only counts when it uses documented public APIs, is committed as code/config and has a repeatable check. A README claim that anything can be overridden is not acceptance evidence.

## Incremental implementation gate

Start with a narrow vertical slice: one persisted pack result, a headless reveal controller, a default opener and a host-owned alternate composition. Ship the slice only after the layout and replacement recipes work. Add concrete extension points when a use case needs them; record rejected abstractions and tradeoffs in architecture decision records.

Do not build a universal plugin runtime, visual layout editor, dynamic code marketplace, distributed microfrontend platform or every provider up front merely to claim openness. Those are separate scope decisions. The minimum architecture must nevertheless preserve the separation and public replacement boundaries from the beginning.
