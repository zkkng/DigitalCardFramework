# Portable-card runtime 0.1

This is the implemented contract. The larger specification records direction; features not listed as implemented in [coverage](implementation-status.md) must not be inferred from that design.

## Install and entry points

Install the root package dependencies and optional presentation dependencies with `pnpm --dir src/presentation install --frozen-lockfile`. Core scene rendering and archive authoring use platform APIs. PSD/ORA parsing, Rive, dotLottie, Three.js and SIWE use the pinned optional package dependencies. Bundle `adapters.js` for browsers and self-host the matching Rive/dotLottie WASM. Do not import server identity/compiler/service modules into browser bundles.

Public entry points are root `/presentation`, `/presentation/authoring`, `/presentation/compiler`, `/presentation/studio`, `/presentation/service`, `/presentation/layered-source`, and `/presentation/layered-package`. The nested package additionally exposes adapters, extensions, signatures, integration, program and identity modules. The runtime JSON schemas are generated from `schema.js`; `validateManifest` and `validateScene` add semantic checks.

## Save, publish, display

`.dcard` is a ZIP containing `card.json`, scene JSON, declared media, and `integrity.json`. Logical content identity is SHA-256 over canonical indexed content; ZIP compression changes do not change logical identity. Ed25519 signatures are optional, tied to that digest and a host trust store. No art is stored in the framework repository.

```js
import {createPlayerStage, directoryResolver} from '@digital-card/framework/presentation';
const resolver = await directoryResolver(baseURL, {digest});
const stage = createPlayerStage({root: region});
const view = stage.mount(slot, {resolver}, {quality:'lite', inputMode:'drag'});
await view.ready;
view.setInputs({tilt:{x:0.4,y:-0.2},angle:0.7});
await view.setSide('back');
// Component cleanup:
view.dispose(); stage.dispose(); resolver.dispose();
```

`mountPresentation` owns resolver cleanup for a pinned catalog definition. `createCardRenderer` integrates a custom element with the framework UI. Grids default to posters; the inspector requests an interactive view. `mountAssembly` places independently owned cards into a shared composition. Assemblies do not merge copy identity.

A catalog presentation reference is `{contract:'digital-card@0.1', digest:'sha256:…', baseURL:'https://…/'}`. Issued copies pin it in their definition snapshot. Updating the catalog changes future copies, not already issued cards. Private codes and ownership credentials never enter presentation inputs. Only declared `host.*` numeric/boolean inputs pass the filter.

## Rendering and performance

The WebGL2 stage shares textures, schedules only needed frames, stops idle angle-driven cards, supports quality/DPR budgets and releases resources on disposal. Hidden/offscreen views pause video/audio/time work. Context loss shows posters and restoration rebuilds views. Video backs require explicit playback policy, muted video and a poster. Audio is opt-in through the view API. Reduced motion selects a static pose and stops autonomous effects.

Materials are local to each layer and its masks. Firework bloom, lake reflection, foil and glitter are surface effects rather than a universal sheet over all art. Angle-based motion can seek frames, move petals and change shine without a looping GIF. Textures and video buffers are estimates; browser/driver memory overhead is not exactly observable.

Adapter contract: host registration with ID/capabilities, `estimate`, async `create` honoring its signal, and an instance with canvas, `update`, `render`, `dispose`. See `adapters.js` and browser conformance fixtures. Adapter surfaces render in scene order. Required unavailable capabilities select a poster. Whole renderer replacement is also supported.

Supported advanced subsets: embedded GLB with bounded geometry; passive dotLottie without expressions/external sources/state machines; host-approved Rive assets with matching local runtime. These are not claims of all glTF extensions, all Lottie features or every Rive scripting feature. KHR_interactivity and Live2D are not implemented. Separately approved interactive programs run in a different-origin iframe with a constrained message bridge; portable uploads cannot silently become programs.

## Import and hosting boundary

`createPresentationStore` persists import jobs, validates in a bounded worker, calls the injected media scanner, publishes immutable content atomically, enforces import quotas and exposes quarantine/retention review. It is a single-writer filesystem reference service. Supply a real sandboxed decoder/scanner for untrusted public uploads; structural sniffing is not full media sanitization. Authentication, CSRF/origin checks, rate limits, serving headers, durability/backups and storage permissions are host responsibilities.

No package paths may escape the archive, undeclared dependencies fail, redirecting network asset loads fail, and all loaded bytes are checked against declared hashes. Keep published content immutable; use a new digest for edits. Retention only proposes candidates and must include catalog, issued-copy, assembly, export and pending-job references.

The optional identity adapter verifies SIWE nonces and reads ERC-721/1155 ownership at confirmed blocks, retaining stale/offline states. It does not mint, bridge or convert external ownership into unrestricted internal transfers.

## Known limits

- Display-RGB artistic compositing; no physically calibrated linear-light/HDR pipeline.
- Groups inherit transform/opacity. Isolated group blend/mask surfaces are not implemented; layered import reports mismatches.
- One built-in material per node; stack nodes or install an adapter for combinations.
- Custom flakes use alpha shapes. Their texture RGB does not define per-flake artwork.
- Studio exports retain source imagery as fallback unless the host replaces posters with a renderer capture. A changed effect does not automatically regenerate a baked preview.
- `.dcproject` preserves editable scenes and unused imported assets, not the undo history or original Photoshop feature model.
- Physical iPhone testing remains necessary before claiming device-level performance. Desktop touch/DPR emulation is useful but not equivalent.

See [creator API](creator-api.md) for batch imports, effect controls, external commands, publication hooks and extension examples.
