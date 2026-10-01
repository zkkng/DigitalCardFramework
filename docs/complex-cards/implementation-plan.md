# Complex cards implementation plan

**Planning baseline: 1 October 2026.** This is a new presentation workstream. It does not mark any renderer, importer or studio capability as delivered. Other framework work was already changing the working tree during this research; the observations below are limited to files inspected, not a release audit.

## Existing code and the missing boundary

| Inspected surface | Current behavior | Required change |
| --- | --- | --- |
| `src/catalog.js` | Layer URLs, depth, opacity, crop, limited blend/effect fields, appearance/back, variants | Add a validated presentation reference without putting large scenes in the catalog |
| `src/core.js` and persistence | Copies and definition/variant snapshots | Pin presentation identity in new snapshots; keep old copies valid |
| `src/ui.js: renderCard` | Returns a DOM element with image layers and CSS effects | Keep as legacy/simple adapter; introduce explicit CardView handles |
| `renderInspector`, `renderAlbum`, `mountOpener`, `mountFramework` | Callback composition and DOM replacement | Own and dispose renderer resources on every replacement/close/unmount |
| New inspector/comparison work in the working tree | Additional UI composition is being developed | Integrate through its public renderer slot; do not assume it supplies GPU cleanup |
| `src/importer.js` in the working tree | Catalog/configuration import work | Add a separate bounded media-package importer, then connect verified digests to catalog import |
| host-specific demo outside this repo | Bespoke page scripts and external artwork | Convert scene/effect data; keep all artwork outside framework Git |

Raising the catalog's 24-layer limit is not a sufficient complex-card implementation. The missing functionality includes media packaging, a renderer lifecycle, compilation, resource ownership, feature negotiation and authoring tools.

## Proposed code organization

Start with logical modules in the existing repository. Split into published packages when release/build needs justify it; do not force a monorepo migration before the first vertical slice.

```text
src/presentation/       schemas, references, public DTOs, compatibility
src/package/            archive validation, integrity, package metadata
src/compiler/           build targets, recipes, atlases, reports
src/player/             CardView, stage, inputs, scheduler, resolver, budgets
src/renderers/          simple DOM, first 2.5D adapter, later media/3D adapters
src/studio/             optional editor using the same compiler and player
test/presentation/     contract, malformed data, lifecycle and rendering fixtures
examples/presentation/ inspector, opener and alternate host wiring
docs/complex-cards/     this specification, extension cookbook, conformance records
```

Generic source and synthetic fixtures belong here. Game-specific import mapping and host identity/economy wiring belong in the integration repository. Real artwork, generated frames, video and game data belong in external content storage. Tests can generate simple geometric assets at runtime; do not commit host-specific art as a convenient fixture.

## Milestone 0: contracts and a measured rendering decision

**Deliverables:** versioned manifest and scene schemas, semantic validation rules, lifecycle API, input semantics, profile definitions and a small renderer comparison harness.

Use a faithful complexity sample of the existing companion scene and synthetic public test assets. Compare the current DOM approach with one shared 2.5D stage. Measure frame pacing during interaction, steady idle, decoded-resource estimates, repeated mount/dispose and visibility transitions. Test one card and the pair. Capture actual device/browser versions. The engine choice must consider mask fidelity and build size as well as speed.

Implement the input-driven default before independent time playback. Fix numeric semantics, color/alpha boundaries, pivot/trim rules and blend reference images. Finalize JSON schemas and semantic limits for the initially supported profile; the illustrative files in this design are not a finished interchange standard.

**Exit gate:** two independent host shells mount/dispose a synthetic scene using the proposed lifecycle contract. Automated lifecycle and input tests pass. Publish the benchmark evidence available; physical-device verification can be performed by the developer without requiring a user playthrough. If no physical device is accessible, clearly leave that performance claim unverified while continuing implementation.

## Milestone 1: portable layered cards end to end

**Deliverables:** deterministic exporter, quarantine importer, immutable storage/resolver, front/back posters, image/group/atlas nodes, masks, parallax, basic tracks and the initial 2.5D player.

Tasks:

1. Implement ZIP entry validation, streaming size limits, strict JSON parsing, hash verification and dependency closure checks.
2. Build package/content tables and idempotent import/publish jobs. Persist media outside the core database.
3. Add `presentation` references to catalog validation and copy snapshots. Preserve legacy definitions with a compatibility adapter.
4. Compile image resolutions/atlases, retain logical placement and generate both posters.
5. Implement stage scheduling, sanitized inputs, visibility, disposal, abort-on-unmount and asset refcounts.
6. Add material-local shimmer, feathered bloom and foil recipes with portable fallbacks.
7. Wire the same imported presentation into inspector, opener and a separate host-owned layout.

**Exit gate:** export → clean import → display works without the original project's relative paths. A re-export with identical payload produces the same logical digest. Closing/loading/rerendering releases resources. Replaying a reveal changes neither inventory nor allocation. Malformed import fixtures reject before publication.

## Milestone 2: the complete companion-card proof

This is the first real integration deliverable, implemented in the separate integration project with externally stored art.

| Existing element | Portable representation | Visual invariant |
| --- | --- | --- |
| Night sky and distant scenery | Image groups with distinct parallax | Correct landscape order; no exposed layer edges |
| Fireworks | Local bloom/emission recipes or a compact atlas | Feathered irregular reveal, no hard expanding disc |
| Larger stars | Separate masks/points and offset tilt tracks | Different response phases |
| Lake | Art layer plus local shimmer mask/material | Strong readable highlight contained to water |
| Player, short grass, dog | Registered foreground groups | Feet/body remain grounded; no lake clipping |
| Dog's tail | Separate pivoted component or pose sequence | Connected anatomy and angle-driven motion |
| Day sky, sun and clouds | Separate groups and local glint | Clouds move from input, without an unwanted timer |
| Single giant pink tree | Image layer with isolated canopy/trunk | One identifiable tree and matching scene scale |
| Ambient petals | Seeded/baked irregular instances, depth and foil masks | Broad irregular dispersion, faster displacement than clouds |
| Lady and Kino | Foreground layers; registered painted pose atlas | Correct relative scale, smooth cap silhouette and stable ground anchor |
| Joined terrain | Assembly seam anchors and shared input | Night left/day right; coherent terrain and independent cards |

Port the visible behavior, not the incidental implementation. The bespoke page's numerous prebaked frames and DOM images are not requirements. Preserve the existing visual reference before replacing it; compare fixed tilt values and transitions. Keep the original demo available until the imported version is verified.

**Exit gate:** both cards and their assembly load from package descriptors. No special case named after a host-specific character enters generic core. Frame poses retain the approved art style. The same package displays in the standalone example and the host integration.

## Milestone 3: video backs and sustained performance

**Deliverables:** media source negotiation, muted inline playback, poster fallback, audio consent, face visibility/decoder control, quality governor and diagnostic overlays.

Start with ordinary time-playing video. Add angle-scrubbed video only after defining a supported encode/decoder profile; use atlases for short pose animation meanwhile. Handle rejected autoplay, unsupported codecs, slow network and quick repeated flips.

Add counters for stage/view count, active schedulers, texture references/estimated bytes, render targets, media elements/decoders requested, pending jobs and fallback reasons. Counters are debugging evidence, not a claim to see all browser GPU memory. Remove private identifiers from telemetry.

**Exit gate:** automated long interaction, idle, 100 mount/dispose cycles, 1,000-card poster grid and context-loss recovery pass. Run available browser/device profiling. A real iPhone sustained run is required before advertising iPhone smoothness; lack of a human playthrough does not block completion of code/tests or require waiting for the user.

## Milestone 4: practical creator studio

**Deliverables:** scene tree, drag/drop layers, transform/anchor tools, mask paint/import, recipe controls, input scrubber, front/back editing, quality preview, save/undo and export/publish report.

Provide three reusable starting points: a layered illustration, a frame-animated character and a video-backed card. Each must be fully rearrangeable. Add a CLI/batch interface using the same compiler, with error locations useful to art bots.

Start with layer folders; add layered-document adapters incrementally. Clearly report unsupported import operations. Make a card from fresh assets without editing a source file and then inspect its generated manifest. If the UI hides a capability available in JSON, record that authoring gap instead of claiming no-code support for it.

**Exit gate:** a scripted editor workflow creates, saves, reloads and exports all three examples. The exports import into a clean host. Editor preview and published player match at fixed inputs. Undo/reopen preserve IDs, masks and anchors. Review the workflow for unnecessary code or jargon.

## Milestone 5: advanced adapters and mod SDK

**Deliverables:** plugin registry/diagnostics, version negotiation, editor contribution API, glTF adapter, then Rive/dotLottie as measured needs justify them.

Run the capability tests for each pinned renderer. In particular, confirm `KHR_interactivity` implementation support and quotas; do not advertise all of glTF merely because a GLB renders. Add controlled material-node authoring, mesh/rigged animation, connected inputs and richer assembly tools through named extension contracts.

Ship an example third-party recipe and a renderer replacement using public APIs only. The same package must fail gracefully when those optional plugins are absent. Record dependency license review, binary size, loading cost and unsupported features.

**Exit gate:** an extension package is installed, selected, configured, disabled and upgraded without editing core. Conflicts are deterministic and diagnosable. Legacy packages still select their original recipe behavior.

## Milestone 6: optional program and external ownership profiles

These can proceed independently after the player/content boundaries exist. They are not prerequisites for beautiful complex cards.

- Program profile: isolated origin, sandbox/CSP, strict message bridge, permission policy, quotas/rate limits, poster fallback and host allowlist.
- External identity: provider interface, chain-qualified identifiers, wallet authentication, independent ownership resolution, stale/reorg handling and token metadata export.
- Bridges/minting: separately specified durable workflows and security review. Do not slip this into a renderer milestone.
- Provenance/archive: optional signature/C2PA import, public provenance display, pinning/backup policies and verified restore.

**Exit gate:** each enabled profile has its own threat model, failure fixtures and operational guide. No presentation can bypass domain authority or install executable code simply through an uploaded manifest.

## Migration and compatibility

1. Add optional `presentation: {digest, contractVersion}` to catalog DTOs. Validate a published digest or explicit offline development resolver. Include the field in serialized snapshots.
2. Keep legacy `layers`, `back` and `appearance` valid. Resolve legacy cards through the current DOM adapter, or compile a new package only through an explicit migration.
3. Add a `cardViewFactory` option alongside `cardRenderer`. Existing DOM callbacks continue to work through a wrapper; do not infer cleanup by observing DOM removal.
4. Give each mounted UI scope a resource registry. Dispose view handles before `replaceChildren`, dialog close, navigation and app teardown. Teach pack reveal updates to reuse stable copy views where appropriate.
5. Extend generic presentation DTOs and client APIs without exposing owner-only bindings. Document DTO projection tests.
6. Wire the host-specific integration using its own provider/composition configuration. Upload art packages through content storage; commit only manifests/references and integration code to its repository.
7. Version migrations and preserve rollback to posters/legacy views. A failed renderer deployment must not require rolling back domain inventory transactions.

## Open decisions and owners

| Decision | Proposed default | Evidence needed before locking |
| --- | --- | --- |
| First GPU renderer | PixiJS/WebGL2 adapter | Measured companion-scene fidelity and sustained performance |
| Lowest supported mobile tier | Declare after device testing | Available iPhone/Android traces and quality substitutions |
| glTF interactive runtime | Adapter behind feature negotiation | Actual `KHR_interactivity` coverage and bounded execution |
| Exact shader recipe ABI | Small versioned material graph | Two independent effects/plugins and cross-backend images |
| Advanced media codecs | Tested H.264 baseline, optional variants | Browser matrix, alpha needs and encode costs |
| Editor project storage | Local autosave plus optional host save | Recovery/undo tests and multi-device requirements |
| Public upload ceilings | Conservative defaults in spec | Infrastructure capacity and adversarial import tests |
| Program cards | Disabled unless host enables | Isolation tests and acceptable mobile behavior |

Implementation can start with these defaults. Open questions are bounded engineering decisions, not requests for the owner to choose unfamiliar technologies.

## Reporting completion accurately

Report each milestone as planned, implemented, automatically verified, deployed or device-verified. Include what changed and exact evidence. Do not convert a missing optional user playthrough into an implementation blocker; run available automation and code review. Equally, do not call unbuilt studio/adapter work complete because a manifest can describe it.

This research task delivers documentation, an illustrative contract/schema and reference checks. **It does not deploy or implement the new player.** Existing demo deployments and unrelated framework work retain their own status. No percentage of the full presentation platform is inferred from this specification being finished.
