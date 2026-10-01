# Portable-card runtime 0.1

See [supported capabilities and limits](implementation-status.md) before choosing a runtime or media profile.

## Install and entry points

Install the root package dependencies and optional presentation dependencies with `pnpm --dir src/presentation install --frozen-lockfile`. Core scene rendering and archive authoring use platform APIs. PSD/ORA parsing, Rive, dotLottie, Three.js and SIWE use the pinned optional package dependencies. Bundle `adapters.js` for browsers and self-host the matching Rive/dotLottie WASM. Do not import server identity/compiler/service modules into browser bundles.

Public entry points are root `/presentation`, `/presentation/authoring`, `/presentation/compiler`, `/presentation/studio`, `/presentation/service`, `/presentation/layered-source`, and `/presentation/layered-package`. The root package also exposes `/presentation/adapters`, `/presentation/extensions`, `/presentation/signatures`, `/presentation/integration`, `/presentation/program`, `/presentation/identity`, `/presentation/package`, `/presentation/schema`, `/presentation/project`, `/presentation/motion`, and `/presentation/layered-import`; consumers need no deep internal imports. The runtime JSON schemas are generated from `schema.js`; `validateManifest` and `validateScene` add semantic checks.

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

`mountPresentation` owns resolver cleanup for a pinned catalog definition. `createCardRenderer` integrates a custom element with the framework UI. Grids default to viewport-loaded posters (configurable `preloadMargin`, default `300px`); offscreen resolvers release their URLs. the inspector requests an interactive view. `mountAssembly` places independently owned cards into a shared composition. Assemblies do not merge copy identity.

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
- Studio **Capture posters** renders both faces at neutral input and updates their previews. Headless callers use `project.setPosters({front, back})` with renderer-produced Blobs. Capture remains explicit so a chosen hero pose is not silently overwritten on export.
- `.dcproject` preserves editable scenes and unused imported assets, not the undo history or original Photoshop feature model.
- Physical iPhone testing remains necessary before claiming device-level performance. Desktop touch/DPR emulation is useful but not equivalent.

See [creator API](creator-api.md) for batch imports, effect controls, external commands, publication hooks and extension examples.


## Audited lifecycle and surface controls

`await stage.setBudget({estimatedGpuBytes: 32 * 1024 * 1024, maxDpr: 1})` releases and readmits live resources under the new ceiling. Invalid, nonfinite and unknown budget fields fail. Text, raster and adapter allocations share the ceiling; the framebuffer can shrink below the previous DPR floor. These remain estimates, not driver-memory accounting. A sustained-cost downgrade has a 10-second cooldown.

`await view.setSide('back')` and `await view.setQuality('standard')` wait for a changed face/rendition to finish admission. No change returns `undefined`. Disposed view setters cannot resurrect resources. `snapshot()` requires an interactive face; it cannot silently return a blank poster fallback. Directory resolver disposal aborts pending network reads and revokes object URLs.

Each image node accepts `sampling: 'nearest' | 'linear'`. This controls GPU sampling per draw, even when nodes share a texture. Quality-tier image resizing still happens before sampling; choose a maxEdge large enough to retain every authored pixel when exact source pixels matter. `scene.background` accepts `transparent`, `#RRGGBB`, or `#RRGGBBAA`. A node mask uses one local alpha image or one local polygon; `invert` applies to either. Cropped atlas coordinates do not move its polygon mask.

Groups support inherited transforms/opacity/brightness/saturation, not isolated compositing surfaces. Group masks, materials and non-normal blends now fail explicitly rather than being ignored. Prebake such groups or install a host adapter. An unavailable optional adapter with `omit-decorative` is removed by its adapter ID; `poster` and `static-pose` use the authored face poster. Required missing capabilities always select the poster.

The import scanner receives an AbortSignal and has a configurable `scanTimeoutMs` (default 30 seconds). Cancellation/timeout settles the job even if a faulty callback never resolves. The host must still terminate its underlying decoder process; Promise cancellation cannot stop arbitrary native code. Failed store initialization releases its writer lock. After a process crash, operators must confirm no writer remains before removing a stale lock; automatic cross-process crash recovery is not implemented.
