# Complex-card options and security follow-up

This implementation follows the eight requested areas. Public contracts, configuration examples and research sources are in [customization and safety](customization-and-safety.md). Reproducible counts and a source-tree hash are in [verification evidence](options-verification-2026-10-01.json).

| Requested area | Implemented and verified |
| --- | --- |
| Warnings for expensive uploads | Browser/Node analysis with exact face, layer/path, asset references, estimates and remedies. Warn by default; configurable rejection/off. Shared by automatic authoring, compiler, upload worker, publication, CLI report/batches and clickable Studio diagnostics. |
| Highly customizable effects | Existing arbitrary alpha flake designs now optionally preserve their RGB colors; all star/shape/size/tint/mask controls remain. Public host recipes and runtime adapter example demonstrate portable and custom-code effects without core edits. GPU pixel test verifies custom flake coloring. |
| Transparent animated layers | GIF source import, bounded preflight/worker decode, disposal-aware compositing, PNG frames, preserved timing and transparency, Studio add-layer/import/drop paths. Angle-driven by default. Safari worker compatibility uses canvas-independent PNG encoding. |
| Recreate the companion cards | Separate integration conformance checks verify both unchanged content digests, titles, layers, feathered fireworks, stars, lake shimmer, cloud parallax, irregular shiny petals, pet animation frames and secondary character motion bindings. Both remain ordinary portable packages. |
| Configurable multi-card albums | Headless interaction controller and mountAssembly support independent movement, named sync groups, per-member tilt/degree limits, inversion, disabling, host input, keyboard access and optional CSS rotation. Existing album view/layout replacement contracts remain available. |
| Implementation quality and tests | 170 Node tests pass, none skipped. 26 browser checks pass in each of Edge 154, Firefox 153 and WebKit 26.5. Schema/example and adversarial checks pass. Existing Studio and layered-source regressions pass. Public examples execute without a core fork. |
| Security review and release cadence | Dedicated settlement permission; verified external recipient/units; durable duplicate protection; origin/principal/rate checks for reference-host upload routes; unauthorized uploads denied before body consumption; inherited reward-factory lookup removed. SECURITY.md requires a fresh review for major releases and sensitive changes. Both production dependency audits report zero known advisories. |
| External currencies | Optional server-installed settlement providers, trusted account mapping, exact integer conversion, HTTP/client API, durable provider-transaction deduplication, timeout/cancellation and ledger audit. No client amount or client role grants funds. Synthetic provider example and concurrency/restart tests pass. |

## Gaps found and fixed during verification

- WebKit lacked worker OffscreenCanvas: introduced a portable PNG encoder and DOM-canvas poster fallback.
- New custom-flake color mode needed the generated JSON schema as well as runtime validation: added it and a test that validates the example against both.
- Production uploads had a service API but lacked reference Node-host wiring: added optional PRESENTATION_ROOT integration with the existing authenticated principal and permission model.
- External settlement records now participate in installation capacity limits and ledger integrity checks.
- Creator import permission is checked before buffering an upload, then checked again inside the store.

## Performance evidence and limits

The actual companion cards passed a 60-second movement / 5-second idle run with a 390×844 viewport, DPR 3 and touch emulation. All samples retained 31 textures and 40,744,924 estimated GPU bytes. Idle rendering added zero frames. Context-loss recovery, reduced motion and early adapter disposal passed. Other UI tests overlapped the beginning, so this is resource/lifecycle evidence, not an isolated device benchmark.

Warnings are conservative heuristics. The two detailed cards legitimately trigger face-complexity warnings and remain allowed under defaults. This is intentional: creator choice is preserved, with runtime budgets and lighter-quality fallbacks still active.

No physical iPhone or live currency service was available for this run. Provider-specific destination/signature/finality verification must be implemented and tested with the real provider before enabling it. Refunds, external withdrawals and distributed cross-service escrow remain provider-specific systems; this release supplies verified inbound funding, not an invented universal payment protocol.

The earlier audit's unrelated future items—such as a plugin marketplace, normalized high-volume storage and distributed deployment—remain future work. This report does not relabel those as implemented or claim a security certification.

## Repeat the checks

```text
node --test test/*.test.js
node docs/complex-cards/check-examples.mjs
node examples/external-currency-provider.mjs
node test/presentation-audit-browser.mjs ./node_modules/playwright/index.mjs test-results chromium
node test/presentation-audit-browser.mjs ./node_modules/playwright/index.mjs test-results firefox
node test/presentation-audit-browser.mjs ./node_modules/playwright/index.mjs test-results webkit
pnpm audit --prod
pnpm --dir src/presentation audit --prod
```

Install root and presentation dependencies plus Playwright browser binaries first. CI runs these generic gates without game artwork. The integration repository additionally runs `node tools/verify-companions.mjs ../PortableCardAssets`; actual-art browser tests use the staged local demo and keep all generated pictures outside Git.

Documentation planning impact is recorded in [the section-inventory addendum](documentation-impact-2026-10-01.md). This implementation work does not start wiki authoring or publication.
