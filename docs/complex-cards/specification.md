# Portable complex card specification

**Status: proposed v0.1.0 design, 1 October 2026.** Requirements below describe what must be built; they are not claims about the current runtime. `MUST`, `SHOULD` and `MAY` distinguish required behavior, recommended defaults and optional features within this proposal. [Research](research.md) explains the external evidence. [Implementation plan](implementation-plan.md) maps the proposal to this repository.

## 1. Product contract

A creator must be able to combine layered art, responsive materials, character animation, video, sound, vector animation and optional 3D into one portable presentation. A website imports it once and displays it through the same player in an opener, collection, album, inspector or independent embed. A card must not require its own host route or custom edits to inventory code.

The reference creator workflow is: **import assets → arrange layers → attach effects → preview interaction and device quality → export → upload → publish**. Most creators should never edit JSON or shaders. Advanced authors can use the same public contracts through scripts and plugins.

The system is art-style independent. It must support pixel art, painterly scenes, photography, abstract effects and high fantasy without changing its identity or ownership model. A subject may be small or off-center if it remains readable. Templates provide behaviors and production conveniences; they must not prescribe one composition.

### 1.1 Supported ambition

| Presentation | First supporting mechanism |
| --- | --- |
| Layered parallax and selective foil/glitter | 2.5D scene, masks, material recipes |
| Fireworks blooming as the card turns | Seekable reveal track with a feathered material mask |
| Shimmer crossing a lake | Surface-local highlight field clipped to the lake |
| Petals suspended across a scene | Seeded instances with independent depth, displacement and reflectance |
| Painted pose changes and tail wagging | Registered frame atlas or rig driven by an input track |
| Cinematic or holographic back | Video or scene on the back face |
| A rotating sculpture or room inside a card | Optional glTF scene adapter |
| A vector character responding to interaction | Optional Rive/dotLottie adapter |
| Day/night, damage, achievements or seasonal variants | Explicit public host inputs and versioned state rules |
| A playable miniature scene | Optional trusted adapter or isolated program profile |
| Two or more cards forming a larger artwork | Display assembly with seam anchors and shared inputs |

The format must be extensible beyond this table. Every executable feature still needs a declared capability, a resource budget and an understandable fallback.

## 2. Separate the things people call a card

| Object | Responsibility | Authority |
| --- | --- | --- |
| Authoring project | Editable layers, masks, source animation, presets and tool history | Creator's tools/storage |
| Presentation package | Immutable assets and behavior needed to show a card | Content publisher |
| Card definition | Name, line, rules and reference to a presentation | Catalog service |
| Variant | Foil edition, palette, back or other approved presentation choice | Catalog service |
| Owned copy | Copy ID, owner, serial, issue event, state and provenance | Ownership service |
| View instance | Temporary player resources and interaction state | Browser/app |
| Display assembly | Arrangement of several cards, shared camera and seams | Album/host configuration |
| External binding | Optional token, game ID, code or other integration data | Named provider |

A presentation package MUST NOT contain a private redemption code, access token, wallet secret, pack allocation or trusted ownership assertion. Anyone who receives rendered assets can copy those bytes. Scarcity and transfers are enforced by the ownership service, independently of file copying.

Card definitions and issued-copy snapshots pin a presentation digest. An art revision creates a new digest. Existing copies retain their pinned version unless a separately documented migration policy is deliberately applied and recorded. A security quarantine may prevent execution of a version without rewriting its historical identity.

Changing resolution or renderer compilation may create another **derived build** of the same presentation. Record its compiler version, recipe versions, target profile, source digest and output digest. Never silently replace assets at an immutable URL.

Portability of presentation does not imply federation of inventory. Another site can display the same package; recognizing or transferring a particular owned copy between sites needs a separate ownership-provider protocol.

## 3. File and publication model

### 3.1 Portable container

Use `.dcard` as a proposed filename extension for a standard ZIP archive. Serve downloads as `application/zip` until a media type is registered. Browser support comes from our importer/player; the extension itself has no native behavior.

```text
thinking-of-you.dcard
  card.json                    package manifest and capability declarations
  scenes/front.json            declarative scene
  scenes/back.json             scene or video surface
  assets/...                   images, atlases, video, audio, GLB, .riv, .lottie
  previews/front.webp          mandatory static front
  previews/back.webp           mandatory static back
  licenses.json                optional credits and redistribution declarations
  integrity.json              computed payload index and logical digest
  signatures/...               optional detached signatures
```

The v0.1 transport profile permits ZIP store/deflate, regular files and no encrypted entries. Entry names MUST use ASCII relative POSIX paths, without absolute paths, backslashes, empty segments, dot segments, control characters or encoded traversal. Unicode titles remain supported in metadata; a later path profile may define broader normalization. Reject duplicate and case-colliding names, links, device entries and entries not listed by integrity metadata. The archive index treats `integrity.json` and declared detached signatures as explicit exceptions to payload hashing. Package references use literal canonical paths, not URL decoding. The importer must validate before extraction and enforce quotas while inflating.

### 3.2 What the manifest declares

The package manifest contains:

- Format identifier `digital-card`, exact contract version and a creator-selected presentation ID/revision.
- Title, locale, accessible summary, credits and optional license metadata.
- Card width/height in logical units, trim shape and safe area; border/frame is an optional component.
- Front and back entrypoints, plus independent static posters and accessible descriptions.
- Asset records: ID, path, media type, SHA-256, byte length, dimensions/duration when relevant, color/alpha interpretation and semantic role.
- Required capabilities, optional capabilities with fallback rules, plugin contract versions and quality profiles.
- Input declarations, public binding schemas, deterministic appearance seed policy and optional assembly anchors.
- Extensions under namespaced keys. Unknown required extensions reject activation; unknown optional extensions follow their declared fallback.

The manifest does not declare shop prices, odds, supply, permissions or ownership. Those remain catalog/domain concerns. A publisher may attach them in a separate catalog import transaction referencing the verified digest.

### 3.3 Authoring versus runtime

An authoring project may include full-resolution sources, editable vector paths, unused takes and tool-specific state. A runtime export MUST include only the selected dependency closure and required fallbacks. Large source files and private local paths must not leak into the export. Preserve necessary credits. Include prompts, edit history and optional provenance only by deliberate author choice.

The studio stores its own project document with autosave and undo history. That document is not promised to be portable across every future editor. The exported `.dcard` contract is portable across conforming players. Round-trip editing preserves unrecognized optional extension data where safe, and reports anything that cannot be reconstructed.

### 3.4 Offline and connected profiles

`portable` packages are self-contained. All runtime dependencies, including nested glTF buffers, fonts and animation images, resolve inside the archive. No hidden asset downloads are permitted.

An optional `connected` profile may reference content-addressed external dependencies or explicitly declared live data. Its export report must state what stops working offline. It still includes both posters and a meaningful disconnected fallback. The server fetches approved external assets through a constrained resolver; never let an uploaded URL cause arbitrary server-side requests to internal networks.

### 3.5 Import once, serve selectively

The browser SHOULD NOT fetch and unzip the entire bundle for every album cell. The publish service validates the upload, compiles supported targets, and stores immutable assets separately. The player requests a small resolved descriptor and the dependencies for its chosen face/quality. ZIP remains the download, interchange and archival form.

Asset URLs are resolved by the host, not embedded hostnames in the portable scene. The same digest can be hosted locally, on a CDN or in another content store. Versioned cache headers and ETags follow immutable content; use a separate mutable availability/revocation record. Set correct CORS for canvas/video use and support video byte ranges. A poster should appear before large assets load.

### 3.6 Integrity and reproducibility

Use SHA-256 and a tested [RFC 8785 canonical JSON](https://www.rfc-editor.org/rfc/rfc8785.html) implementation. Reject duplicate JSON object keys before ordinary parsing loses them. The logical digest is computed as follows:

1. Treat all regular files except `integrity.json` and `signatures/` as payload. `card.json` and all scene documents are included.
2. Hash each payload file's exact bytes and record `{path, bytes, sha256}`. Sort by canonical path using the specified code-point ordering; restrict v0.1 export paths to ASCII to remove cross-language sorting ambiguity.
3. Canonicalize `{format:"digital-card-integrity", version:1, files:[...]}` with JCS.
4. Hash UTF-8 bytes of the domain prefix `digital-card-package-v1\n` followed by the canonical descriptor. Store that digest and the file index in `integrity.json`.
5. Detached signatures sign the domain-qualified digest; they are outside the hashed payload to avoid recursion. Verify their algorithm/key against a host trust registry.

Repacking unchanged payload produces the same logical digest. Reformatting a JSON payload changes its bytes and therefore its digest; reproducible exporters canonicalize those files before building the index. Archive-byte digests are useful for upload transport checks but are a different identity. Limit, validate and archive signature files too. Signatures prove a key signed bytes, not that the content is safe or legally authorized.

## 4. Scene representation

### 4.1 Coordinate and compositing rules

Use logical card coordinates independent of device pixels; 1000 × 1500 is a convenient default, not a required aspect ratio. In 2D, origin is top-left, x increases right and y increases down. Rotation is clockwise in degrees. Scale is unitless. Nodes specify explicit pivot and transform. Pixel atlas rectangles use source pixels; trim offsets preserve the untrimmed logical origin.

Children render in array order, back to front. Local transforms compose with parents. **Layer order and parallax amount are separate properties.** Moving a petal more than a cloud must not require moving it in front of a foreground character. Each node can declare a parallax vector in logical units at full normalized tilt.

For v0.1, `offset = parallax * tilt` is evaluated in the node's parent coordinates after its authored placement and before the parent's transform. Nested parallax therefore accumulates deliberately. The outer stage's card rotation is separate. Negative coefficients are allowed; document their meaning in the editor.

Every node has a stable ID, type, optional children, transform, opacity, visibility, blend mode, optional mask, semantic tags and typed component data. IDs are unique within a scene. Reference cycles are invalid. A graph compiler resolves references and reports the exact path of errors.

The scene can contain `group`, `image`, `atlas-sequence`, `text`, `video`, `particle-field`, `mesh`, and registered adapter nodes. Early implementations advertise only the subset they actually support. Text needs deterministic font assets and layout bounds; accessible text remains available even when baked into pixels.

### 4.2 Materials and masks

An image can have a base color/alpha image and optional masks for emission, reflectance, roughness, normal direction, glitter distribution or reveal. Masks have an explicit channel, coordinate space and sampling mode. A source-alpha mask follows its node's transformation exactly. Cross-node masks require a declared coordinate mapping; no implicit full-card positioning.

Use sRGB for color imagery and linear data for masks/normals. The renderer converts to linear values for lighting and defines premultiplied-alpha boundaries. Exporters add atlas gutters to avoid fringes. Pixel art can select nearest sampling; smooth painting can select linear sampling. An effect cannot quietly change the art's sampling mode.

Blend modes are negotiated capabilities. Initial portable modes are normal, additive, multiply and screen, with documented equations and renderer reference images before release. Unsupported blends either compile to a prebake or select a declared fallback. Do not assume CSS blend behavior and GPU blending are visually identical.

### 4.3 Card shape and faces

Front and back are independent scenes with independent posters. A shared shell defines trim, thickness/edge appearance, optional border and flip axis. No artwork is forced into a decorative frame. Nonrectangular cards use an explicit trim mask and hit region, with a rectangular accessible preview.

`flip.progress` runs from 0 to 1. Back text must read normally when the back faces the viewer. Near the edge-on transition, the renderer may display the card edge while switching active faces; it must not decode two videos indefinitely. A configurable prewarm window around the transition is bounded by the stage budget.

An immutable collectible back belongs to the presentation/variant. A viewer-selected back skin is a host display preference and must be labeled as such; it does not silently rewrite the collectible's snapshot.

## 5. Interaction and animation

### 5.1 Inputs

| Input | Range/meaning | Default |
| --- | --- | --- |
| `tilt.x`, `tilt.y` | Normalized view tilt, -1 to +1 | 0 |
| `pointer.x`, `pointer.y` | Local normalized coordinates, 0 to 1 | Center |
| `pointer.active`, `pressed`, `focused` | Booleans | False |
| `reveal.progress` | Visual pack reveal, 0 to 1 | Host-selected state |
| `flip.progress` | Front-to-back transition, 0 to 1 | 0 |
| `time.active` | Seconds of permitted active playback | 0, disabled unless used |
| `host.<namespace>.<key>` | Schema-validated public host values | Declared fallback |

The host chooses pointer, touch drag, keyboard or optional device orientation as the input source. Gyroscope use is opt-in and feature/permission detected. Denial must leave drag and keyboard controls functional. Touch handling must allow normal page scrolling outside a deliberate inspect gesture.

Tilt response has a host-configurable smoothing filter, maximum angle and dead zone. Define smoothing using elapsed time, not a fixed fraction per frame, so devices refresh consistently. Programmatic scrubbing and visual tests can bypass smoothing.

### 5.2 Two explicit motion modes

**Input-driven motion:** pose, bloom, shimmer and particle displacement are functions of input. Hold the card still and they stop. Reverse the angle and the effect reverses predictably. This is the default for the current companion cards.

**Time-driven motion:** a creator explicitly enables video, a timed animation or simulation. It advances only while visible, permitted and active. It pauses in hidden tabs and inactive faces. On resume, decorative playback continues from paused active time unless an explicitly declared host clock means otherwise; there is no accidental catch-up burst.

Do not implement angle animation by starting an unrelated timer on every pointer event. A card may combine both modes, but the creator and host must see which components keep running while still.

### 5.3 Portable motion graph

The basic profile contains typed constants, input reads, clamp, remap, add, multiply, interpolation curves, smoothstep, comparisons, conditional selection and lookup tracks. It is a pure directed acyclic graph with finite numbers, bounded node count and one writer per target property. Multiple writers require an explicit mixer. Division-by-zero and nonfinite results produce a diagnostic and a declared safe default.

Tracks specify input domain, key positions, values, interpolation and behavior outside the domain. Clamp is the default; looping and ping-pong are explicit. Piecewise linear interpolation is the first required type. Later easing functions have versioned definitions. No `eval`, arbitrary JavaScript expressions or unknown function calls are allowed in the portable profile.

Stateful animation is a separate capability with explicit initialization, reset, seek and disposal semantics. The basic input graph is deliberately smaller than general interactivity runtimes. A glTF adapter may use `KHR_interactivity`, but must enforce execution quotas and bridge only allowed events; it is not automatically equivalent to the basic graph.

Random-looking layout uses a specified seeded PRNG and algorithm version at export, or baked instance data. The same package/input/appearance seed must recreate the same arrangement. Appearance seeds may be immutable per-copy public data; they must never be reused as authoritative pack-allocation randomness. Do not derive a seed from private user data.

### 5.4 Reusable effect recipes

An effect recipe declares version, parameter schema, input ports, supported targets, assets/masks, resource cost, fallback, accessible behavior and editor controls. It compiles to supported material operations or precomputed textures. Hosts install recipe implementations; uploaded files only reference approved recipe IDs.

| Recipe | Required author controls | Required behavior |
| --- | --- | --- |
| Foil/specular | Mask, roughness, normal, hue range, highlight width/intensity | Highlights stay inside the intended surface |
| Large-flake glitter | Flake distribution/size, density, seed, orientation, brightness cap | Individual facets respond at different angles; no whole-card sheet |
| Feathered bloom | Shape mask, center, radius track, feather, emission curve | Irregular soft reveal preserves the firework silhouette |
| Water shimmer | Surface mask, horizontal structure, highlight path/width, angle input | Local reflection sweeps the lake without illuminating land |
| Stars | Selected points/masks, phase offsets, thresholds | Stars appear/disappear at different angles, not all at once |
| Ambient petals | Irregular placement, individual depths/orientations, wind displacement, foil masks | Movement differs from clouds; no rows or mandatory time loop |
| Frame pose | Atlas, frame registration, input track, frame durations | Ground contact and character identity remain stable |
| Gear glint | Small material mask, direction, threshold, feather | Sun response restricted to reflective gear |

The studio must support painting or importing an effect mask and attaching several effects to different regions. A material's output is not allowed to spill over the card merely because a screen-wide filter is easier to implement.

### 5.5 Character animation

Each frame records atlas rectangle, source size, trim offset, pivot and optional ground/contact anchor. Store ordered pose IDs and durations; input tracks can map angle to discrete poses or a short sequence. Nearest-frame switching is the default for painted poses. Crossfade is optional and must be previewed for double silhouettes.

The creator can compare reference poses, align contact points and onion-skin the sequence. A two-to-four-frame animation is valid. A translated static image may be a useful effect, but must not be presented as an authored pose sequence. Skeletal/mesh animation is another optional adapter, not a requirement for every artist.

## 6. Video, audio and advanced media

Video nodes declare sources with codec hints, dimensions, duration, poster, fit, loop, playback mode and audio policy. Start with tested opaque SDR MP4/H.264 plus a still fallback; add variants based on real capability tests. Codec support and hardware decode vary. Transparent video needs per-platform variants or a frame-sequence/static fallback; no one alpha codec is assumed universal.

`autoplay-muted`, `on-activate` and `scrub` are different modes. The player handles failed autoplay and keeps a usable poster/play control. Use inline video on mobile. Audio is muted by default and requires deliberate user consent through the host audio controller. A card cannot unmute itself or steal audio focus from another card.

Ordinary video runs on media time. Angle-controlled short animations should normally use atlases. A later scrub-video profile can use keyframe-aware encodes or a bounded WebCodecs decoder; it must measure seek latency and drop stale seek requests. Calling `currentTime` on every pointer event is not a frame-accurate animation contract.

Use frame callbacks where supported to update video textures only for new decoded frames. Closing a face or view pauses decoding and releases it according to the resource policy. A page of video backs must not open a decoder for every card. Long connected videos may use adaptive streaming through an adapter; offline exports include a bounded clip or poster and disclose that distinction.

Rive, dotLottie and 3D assets declare their adapter/version and supported features. Unknown required asset extensions reject that rendition. Imported nested resources undergo the same validation as top-level assets. Any scripts, expressions or behavior graphs require their own capability checks. An adapter must publish whether it renders into the shared stage, an intermediate texture or another surface, including the resulting memory/latency cost.

## 7. Player and website integration

### 7.1 Module boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| Package reader/validator | Parse, integrity, schema and semantic validation | Inventory mutations |
| Compiler | Profiles, atlases, recipes, dependency closure and build report | Creator identity/ownership claims |
| Asset resolver/cache | Fetch, integrity, decode, reference counts and eviction | Arbitrary remote script execution |
| Player scheduler | Input updates, clocks, visibility and budgets | Pack RNG or payments |
| Renderer adapters | Draw nodes/materials and dispose resources | Host routing or user credentials |
| Host UI adapters | Layout, focus, input source, controls and intent handling | Bypassing server authority |
| Domain core | Packs, copies, trading, permissions and bindings | GPU or DOM state |

The renderer is replaceable. PixiJS/WebGL2 is the first candidate for 2D/2.5D; benchmark it before making it the default. A DOM renderer can remain a simple-card adapter. True 3D can use a separate glTF-capable engine. Avoid separate GPU contexts per card or effect. A stage should normally composite active cards into one surface, with accessible DOM controls above it.

A stage owns a contiguous host region and accepts mount targets inside that region. It caches layout rectangles, invalidating them on resize/scroll/layout changes instead of forcing DOM measurement for every effect on every frame. Clip/scissor each view to its assigned rectangle. A dialog in the browser's top layer gets its own stage; multiple stages share a page-level budget governor so this exception cannot multiply resource allowances. Do not draw an ordinary page canvas over unrelated host controls.

Adapters use a public create/update/render/visibility/dispose lifecycle, obtain assets through releasable leases and request invalidation through the scheduler. They cannot create independent frame loops. A backend-specific drawing port is versioned separately; using such a port makes the adapter dependent on that backend and requires a fallback. The portable card never receives this port. This permits powerful installed renderers without falsely promising that an arbitrary shader works across every engine.

### 7.2 Lifecycle contract

`createCardView()` returns a lifecycle handle, not just an element. See [contracts.d.ts](contracts.d.ts). It provides `element`, `ready`, `setInputs`, `setVisibility`, `setQuality`, `setSide`, `snapshot` and idempotent `dispose`.

States are `poster → loading → active ↔ suspended → disposed`, with recoverable `fallback` after errors. `ready` resolves with the selected rendition or fallback reason. A fatal inability to show either poster rejects with a typed error. Disposing during load aborts work and prevents late callbacks from resurrecting the view.

One scheduler owns frame requests per stage. Input changes mark affected scenes dirty. Pure angle-driven cards settle and stop requesting frames. Time-driven components request frames only while active. Document visibility, intersection, face visibility and host route state all participate. Offscreen prefetch is bounded and never activates a video simply because bytes are cached.

`dispose()` releases subscriptions, observers, timers, scheduler membership, pending fetches, worker jobs, render targets and asset references. It closes owned `ImageBitmap`/`VideoFrame` resources and unloads video sources. Shared textures remain only while referenced or within a bounded cache. GPU context restoration rebuilds from immutable descriptors at an appropriate quality; repeated failures select posters.

### 7.3 Integrate without coupling to a page

The host receives a sanitized presentation model derived from the issued-copy snapshot. It supplies a resolver, stage and permitted public inputs. The player never receives the whole private inventory record by convenience.

An opener supplies already committed cards and `reveal.progress`. Skipping, crashing, changing renderers or replaying the animation must not reroll results or award another copy. Ownership commands remain the existing headless service API.

Albums default to static thumbnails. Inspecting a card activates the rich player. A host may allow several active cards, but the stage enforces a shared budget. Album layout data references copy IDs and view preferences; it does not duplicate scene assets.

Events include `ready`, `qualityChanged`, `fallback`, `assetError`, `interaction`, `intent` and `disposed`. Events describe presentation state only. A card can emit a typed intent such as `openDetails` or request a host-defined action. The host validates the intent; server authorization is still required for commands. No uploaded scene can invoke a trading or reward service directly.

### 7.4 Companion assemblies

An assembly is a separate view descriptor referencing presentations or owned copies by stable ID/digest. Each member declares a transform into a shared stage, edge/seam anchors, camera/tilt mapping and optional visual-only overlap. Cards retain independent identity, hit targets and collectible borders.

For the existing pair, place night left and day right. Match shoreline/terrain anchors in a canonical panorama space; use one tilt input and each scene's local transform. Test the seam at neutral and extreme angles. Different depths at a seam can create gaps even when two flat posters align; the editor must show those failures.

The assembly may share effects such as passing petals, but it cannot write another card's permanent state. If a member is absent, render a declared standalone composition or placeholder. Downloading an assembly does not transfer its members.

## 8. Resource and quality contract

### 8.1 Budgets are part of the format/player handshake

Complexity is supported by allocating work deliberately. A thousand-card album cannot run a thousand full scenes. The compiler records estimated decoded texture bytes, render-target bytes, node/instance counts, draw calls, shader passes, graph operations, video decoders and download bytes per rendition. Runtime measurements supplement estimates.

Initial **proposed tuning targets**, to be revised against actual devices:

| Profile | Typical use | Starting targets |
| --- | --- | --- |
| `poster` | Grids, search, unsupported devices | Static image; no card animation loop or video decoder |
| `lite` | One mobile card or a budgeted pair | Up to 768px long edge, DPR capped at 1.5; stage-estimated GPU allocation ≤96 MiB; ≤2 full-size offscreen passes; one active video decoder |
| `standard` | Inspect view on capable phones/PCs | Up to 1536px long edge; stage-estimated GPU allocation ≤192 MiB; ≤4 full-size passes; at most two explicitly budgeted decoders |
| `ultra` | Opt-in large display | Up to 2048px long edge; host-selected stage budget; never automatic on a thumbnail |

These are budgets for the whole active stage, not allowances multiplied by every card. They are not browser-guaranteed memory ceilings. Runtime allocations, driver overhead, render buffers and other page content also count. Hosts can set stricter limits. The first release must publish the devices on which its chosen targets pass.

### 8.2 Memory and sustained behavior

An uncompressed RGBA texture costs approximately width × height × 4 bytes, with a complete mip chain adding about one third. Render targets, multisampling, duplicate decoded images and video buffers are additional. Render-buffer dimensions grow with DPR, so doubling DPR roughly quadruples those pixel costs. Small compressed files do not necessarily mean small GPU allocations.

Trim and atlas small sprites, share immutable textures, batch compatible materials, bake static composites and avoid repeated full-card filters. Preserve enough overlap and padding for parallax. Texture compression such as KTX2/Basis can be an optional compiled target with a tested loader; it does not remove the need for fallback assets or careful color handling.

Maintain explicit reference counts and bounded caches by estimated bytes, not only item count. Record acquire/release ownership. Decoders and scratch canvases must not accumulate on every angle change. Do not retain every firework bloom frame at full resolution if a material or a small shared atlas can reproduce it.

The quality governor uses measured frame pacing and available capability signals. Browser memory/thermal metrics are incomplete, so it must not claim accurate temperature or total GPU memory. Downgrade only after a sustained threshold; use hysteresis, a cooldown and infrequent upgrades. Log the reason. A host/user override may pin a lower quality.

### 8.3 Fallback preserves the card's meaning

Resolve the highest permitted rendition satisfying required capabilities and current budgets. Every optional feature declares one of: lower-cost material, baked layer, frame sequence, static pose, or omission of a purely decorative effect. The final fallback is the face poster and accessible description.

Never omit a subject or change an owned edition because a renderer is weak. Mark material substitutions in the creator preview. If a feature is central to the identity and no equivalent fallback exists, the author must supply a dedicated lower-quality composition. Network failure, revoked plugins and decoding errors follow the same explicit fallback chain.

## 9. Creator studio

### 9.1 Guided creation

The initial studio has four work areas: **scene**, **materials**, **motion**, and **publish**. Layers, transforms, mask painting and a visible card are available together. A single interaction scrubber drives the exact player inputs used on the website.

1. Import individual images, a layer folder, supported layered-document adapter, video or an interactive asset.
2. Assign roles such as background, subject, reflective surface and particle. Roles suggest tools; they do not enforce layout.
3. Set pivots/contact points and parallax depth visually. The editor previews travel bounds and exposed edges.
4. Paint/select a surface and attach a recipe. Adjust glitter flakes, highlight shape or bloom feather while turning the card.
5. Connect a parameter to tilt, reveal, flip or an explicitly enabled clock. Show the input graph when advanced control is needed.
6. Author the back, choose posters and accessible descriptions, then inspect lite/standard profiles and device-specific substitutions.
7. Export a reproducible package or publish through a configured host importer.

Do not require creators to paint a normal map for every card. Offer useful mask-only defaults and optional deeper material authoring. Preview examples must make clear which effect is actually applied to the art. Avoid a gallery of identical full-card rainbow overlays presented as different techniques.

### 9.2 Import adapters

PNG/WebP layer folders and video are the first imports. OpenRaster and PSD-style adapters can reconstruct supported layers, names, bounds and blend modes. Unsupported adjustment layers, smart objects or tool effects must produce an explicit report and an offered bake. Do not promise lossless import of arbitrary authoring applications.

Rive, dotLottie and Blender/glTF imports preserve their supported authored behavior inside adapters. The editor maps exposed parameters to card inputs. It must not silently flatten an interactive asset and claim interaction survived.

### 9.3 Reuse, batch generation and AI assistance

Presets contain parameterized recipes and optional scene structure. Authors can detach/override them through documented fields. Recipe upgrades are version-pinned and show a visual diff; installing a new preset must not silently alter old published cards.

A batch API accepts asset references, scene/template IDs and parameter values, then returns validation reports and exports. This enables art bots without giving them host credentials. The studio, CLI and batch API must all use the same compiler.

AI may suggest masks, depth, scene layouts or animation poses. Existing character/reference identity and frame registration are constraints. Generated output remains draft until previewed; AI does not decide collection scarcity or certify rights. Record asset provenance when supplied, but keep private prompts and source files out of public exports by default.

### 9.4 Publish report

Before publication, show missing assets, unsupported capabilities, per-profile visual substitutions, estimated download/memory cost, idle/time-driven components, audio/network requests, accessibility gaps and licensing declarations. Each warning links to the affected layer. Offer concrete repairs such as atlas creation, resolution reduction or baking a filter. A green schema check alone is not a performance or safety certificate.

## 10. Customization and extension contracts

Follow the existing [customization architecture](../customization-architecture.md). The host can replace the package resolver, renderer, effects, input provider, quality policy, editor panels, importer adapters, back renderer and page arrangement through documented public interfaces.

An extension declares ID, version, compatible API range, configuration schema, trust class, capabilities, lifecycle, resource estimator, fallback, editor contribution and conformance fixtures. Required plugin versions are resolved by host configuration. A package cannot install a plugin by naming a remote JavaScript URL.

Configuration precedence is: framework defaults → installed preset → host configuration → permitted line/view override → permitted author parameters. A field's schema explicitly grants override scopes. Host security, resource ceilings and authority restrictions always constrain the result. Unknown fields fail validation rather than accidentally becoming an override mechanism.

Collections of contributions have deterministic order with before/after constraints and cycle detection. Single implementation slots require one explicit selection. Two replacements do not resolve by import order. `explainComposition()` reports which provider supplied each renderer/effect/policy and why a fallback was selected.

An uploaded card uses declarative data by default. Host-installed plugins are trusted application code and need review, version pinning and rollback. Their power is deliberately greater than a card author's manifest. Arbitrary raw shader source is similarly a trusted-plugin feature; the public effect editor compiles bounded approved nodes. GPU drivers are not an application sandbox.

### 10.1 Optional isolated program cards

For experiences beyond the declarative graph, define a separate `program` capability. It requires explicit host enablement and may be disabled on mobile. Run untrusted content on a separate origin in a sandboxed iframe with scripts allowed but no same-origin privilege, host cookies, storage authority, forms, popups, navigation or devices by default. Apply response-header CSP with a restricted asset origin and no network connections unless a narrowly scoped broker is approved.

Use a versioned handshake with a random nonce, expected `event.source` and transferred `MessagePort`. An opaque `null` origin is not sufficient authentication. Validate message schemas, sizes and rate limits. Only public view inputs and allowlisted intents cross the bridge. Do not send an account token or give the frame a direct database/wallet client.

The host pauses/disposes the frame when hidden and can quarantine failures. A browser iframe does not provide enforceable per-frame CPU/GPU quotas against all hostile programs. Therefore this profile is reviewed/allowlisted, has posters, and is not the default for arbitrary public uploads. If stronger isolation is required, use a separate remote execution/rendering service with its own specified operational model.

## 11. Import, storage and security

### 11.1 Pipeline and API

Proposed service resources:

```text
POST /presentations/imports                 bounded authenticated upload
GET  /presentations/imports/{jobId}          validation/compile report
POST /presentations/imports/{jobId}/publish  publish verified digest, idempotent
GET  /presentations/{digest}/descriptor     public resolved presentation
GET  /presentations/{digest}/download       original portable package
GET  /presentation-builds/{buildDigest}/...  immutable compiled assets
```

These are proposed routes, not current API endpoints. Operator authorization, per-user quotas, rate limits and idempotency apply. Import jobs move through `received → validating → compiling → ready → published`, or `rejected/cancelled`. Publication atomically registers a descriptor only after its dependency closure is durable. A retry must not duplicate publication or issue copies. Publishing content and adding it to a catalog are separately authorized actions.

Stage uploads in quarantine. Validate structure, semantic references, capability policy, media contents and resource limits before publishing. Run media parsers/transcoders in constrained workers with bounded CPU, memory and wall time. Decode bombs can occur in images/video as well as ZIP archives. MIME sniffing, image dimensions, frame counts, nested asset references and font complexity all need limits.

Suggested initial upload ceilings are 250 MiB compressed, 1 GiB total inflated, 2,000 entries, 8 MiB per JSON document and a 200:1 per-entry expansion ratio. They are host-adjustable security limits, not recommended card sizes. The build report should target a much smaller first-view payload (initial target ≤8 MiB for lite after its poster). Enforce both declared and actual inflated sizes while streaming. Budget limits can reject exceptionally complex input even when its JSON is valid.

Reject path traversal, duplicate/colliding names, symlinks, bad hashes, unexpected executable files and nested undeclared archives. Sanitize or rasterize SVG; disallow external entities and embedded scripts. Validate glTF URI dependencies, animation expressions and shader capabilities recursively. Never execute import hooks from the uploaded archive.

### 11.2 Data and moderation

Suggested tables/resources: `presentation_packages`, `presentation_files`, `presentation_builds`, `presentation_import_jobs`, `presentation_availability`, `publisher_keys` and `presentation_references`. Store bytes outside the domain database. Keep digest/reference metadata transactional.

Garbage collection considers catalog versions, issued-copy snapshots, retained exports, assemblies and pending jobs. A deleted catalog entry must not orphan assets still owned by collectors. Use a retention grace period and auditable deletion plan. Back up original packages and rebuildable compiler metadata; test restore without the original author's computer.

Moderation/quarantine records are mutable policy separate from immutable package identity. If a package is blocked, show a safe platform placeholder and a reason appropriate to the viewer; an attacker-supplied poster may also need blocking. The collection record and provenance remain intact. Signed access URLs restrict distribution but cannot make already viewed art secret.

## 12. Optional identities and external systems

### 12.1 Open bindings

Keep namespaced attributes schema-versioned with explicit visibility and transfer policy. Distinguish an attribute used for visual display from a secret server-side binding. A presentation can request a public value such as `game.level`; the host maps it from an allowed source and supplies a fallback. Dynamic inputs must not fetch private data by themselves.

Live data and evolving cards declare their freshness behavior. Show last-known or offline state as specified; freeze a reproducible snapshot for historical/export views. Signed events may drive permanent evolution through the authoritative service. Client animations cannot commit permanent progress.

### 12.2 Blockchain adapter

Blockchain is optional. A binding can carry chain-qualified contract/token identity with token IDs represented as strings. CAIP-19 is a candidate identifier syntax, currently a reviewed rather than final specification. Keep provider-specific canonicalization explicit; do not lowercase every identifier blindly.

Select one authoritative ownership source per copy/type. A local framework copy uses local transactions. An externally owned token is resolved through its provider and mirrored for display; local trading must not independently transfer it. ERC-1155 quantities need a deliberate mapping to display copies because a balance does not establish a unique history for each unit.

Wallet login proves control of an account for a session. Server-side ownership resolution separately records chain, block, confirmation/finality policy, freshness and pending/reorg states. A stale cache must not authorize a trade. Browser-provided ownership claims are never authoritative.

Minting, locking a local copy for export or importing a bridged token requires a separate durable workflow with idempotency, pending state, finality checks and compensations. No database transaction can make an external chain action instantly atomic. This proposal does not require building a bridge in the first release.

Provide marketplace metadata exports only through tested adapters: poster image, descriptive metadata and an appropriate hosted viewer/media reference. An `animation_url` convention does not guarantee that another marketplace can run our package. IPFS/CIDs may identify bytes; availability still requires pinning, replication and recovery. Neither a token nor a signed media manifest guarantees copyright ownership.

## 13. Accessibility and resilient interaction

Every face has a readable title/description and static poster. The host supplies keyboard inspect/tilt/flip, visible focus, touch-safe controls and a way to stop time-driven motion. Honor reduced-motion preferences and allow an explicit static mode. Do not require device orientation to reveal essential information.

Keep collection actions and text metadata in accessible DOM, independent of canvas drawing. Avoid flashing recipes exceeding tested accessibility limits; provide authoring diagnostics and manual review guidance. Sound requires consent and independent volume/mute controls. Decorative effects may be reduced without obscuring identity or action outcomes.

The player must work when media autoplay is denied, orientation permission is denied, the network drops, a codec is missing or GPU context creation fails. The fallback should explain capability limits when useful, without exposing implementation jargon to ordinary collectors.

## 14. Versioning and conformance

Version the archive contract, scene dialect, recipes, adapters, compiler and host API independently. A package declares exact scene/recipe versions and a minimum compatible player contract. Unknown major format versions do not execute. Optional extensions may be skipped only through an explicit fallback that has been validated.

Support three labels: **structurally valid**, **profile conformant**, and **device tested**. They mean different things. A schema-valid card may still exceed budgets or use an unavailable codec. A device-tested profile includes browser/device/build versions, duration, visual references and measured frame pacing.

The conformance suite includes golden scenes for masks/blends/pivots/tilt/flip; fixed-input snapshots with tolerances; malformed package fixtures; cleanup and context-loss tests; fallback tests; and host replacement examples. Preserve old fixtures when evolving the format. Publish migrations as tools that create a new package, with a visual comparison and source link, rather than mutating an old digest.

## 15. Required outcome

The first accepted implementation must export a real layered card, import it into clean storage, and render it in two different host compositions using only public APIs. It must retain local effects and registered poses, support a video back, respect view lifetimes and recover to posters. It must preserve the existing core's pack, ownership and trading invariants.

The long-term outcome is a creator ecosystem with reusable effects and optional powerful adapters. The immediate proof is concrete: the same portable card plays correctly outside its original custom webpage, remains usable on mobile, and can be collected through the generic framework without game-specific code entering core.
