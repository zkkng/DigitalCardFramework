# Complex card research

Researched 1 October 2026. This document separates established formats from our proposed architecture. Sources are primary specifications or vendor documentation. Compatibility still requires testing the exact runtime and browser versions we ship.

## What already exists

| Option | What it already solves | What our card system must add | Decision |
| --- | --- | --- | --- |
| ZIP and a JSON manifest | Portable container using widely available tooling | Card semantics, validation, player and publication | Adopt as transport |
| glTF/GLB | 3D scenes, materials, animation and extensibility | Card faces, host input mapping, collection integration, profiles | Adopt through a 3D adapter |
| `KHR_interactivity` | Portable glTF behavior graphs | Runtime support verification, bounded execution and card input bridge | Evaluate in the 3D milestone |
| Rive | Interactive authored animation and state machines | Card packaging, lifecycle integration and resource budgeting | Optional adapter |
| dotLottie | Animation archive, assets, themes and state machines | Card scene composition and restricted execution profile | Optional adapter |
| HTML/CSS/JavaScript bundle | Very broad browser expressiveness | Isolation, lifecycle, permissions, fallback and portability limits | Advanced opt-in profile |
| Video | Rich prerecorded appearance | Interaction semantics, front/back policy, fallbacks | First-class media node |
| EPUB | Packaged publications, assets and reading-system contracts | Card-specific meaning and interaction | Learn from it; do not use as our format |
| Web Bundles | Packaging web resources | Card semantics and dependable application import | Do not make browser-native support a dependency |
| OpenRaster | Layered raster interchange | Effects, animation, interaction and runtime optimization | Creator import adapter candidate |
| NFT metadata | External token metadata references | The actual interactive presentation/player | Optional export adapter |

**Research conclusion:** we did not find a reviewed standard that combines all of the required card-specific behaviors. A small application manifest around existing formats is justified. That is an engineering conclusion from the comparison, not proof that no other card format exists anywhere.

## Interactive assets

### glTF is more capable than a static 3D file

[glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines the scene and asset representation. The official [KHR_interactivity source](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc) reports **Complete, Ratified by the Khronos Group** at research time. It adds behavior graphs and explicitly targets single-user experiences. It also acknowledges that its execution model is Turing-complete and discusses execution limits.

Consequently, the specification must not claim that glTF has no interaction standard. We should test an implementation against a small card input bridge before adopting it. Ratification alone does not establish support in our chosen renderer. A bounded card motion graph can cover everyday 2.5D cards while the richer glTF profile remains an adapter with separate capability and execution checks.

### Rive can share a rendering surface

Rive's [low-level web API](https://rive.app/docs/runtimes/web/low-level-api-usage) exposes artboards, animation advancement, state machines and drawing. It supports drawing multiple artboards/files to a canvas and requires disposal of allocated instances. Its [web runtime documentation](https://rive.app/docs/runtimes/web/web-js) explains the runtime choices.

This makes Rive a useful creator tool and runtime adapter. It does not make it free to nest many independent Rive canvases inside a GPU card scene. A spike must measure the chosen compositing route and coordinate its clock and cleanup with our player.

### dotLottie is more than a single animation JSON

The [dotLottie 2.0 specification](https://dotlottie.io/spec/2.0/) packages animation data with images, fonts, themes and state machines. It is a useful component format, but its required animation structure does not match a general card that may consist only of raster layers or video. The specification also includes expression behavior. Therefore an uploaded JSON/archive is not automatically passive or safe. Our importer must define an accepted subset, disallow unexpected external resources and reject unsupported expression capabilities.

### Container precedents

[EPUB 3.3](https://www.w3.org/TR/epub-33/) and its [reading-system specification](https://www.w3.org/TR/epub-rs-33/) demonstrate that a portable file needs a reader contract and fallback behavior as well as an archive. [OpenRaster's layout](https://www.openraster.org/baseline/file-layout-spec.html) is a useful layered-image interchange precedent. [Web Packaging](https://github.com/WICG/webpackage) addresses packaged web resources; it does not define card input, ownership or album behavior.

Our recommendation is to reuse ZIP and media files while keeping the runtime manifest small. Importing a PSD, OpenRaster or tool project is an authoring concern; the exported runtime should not require that tool's entire document model.

## Rendering and mobile performance

PixiJS documents [batching, masks, filters, textures and performance](https://pixijs.com/8.x/guides/concepts/performance-tips), and [resource destruction and garbage collection](https://pixijs.com/8.x/guides/concepts/garbage-collection). These support testing PixiJS as the first 2D/2.5D renderer and giving our own player explicit resource lifetimes. They do not prove that any particular card will meet an iPhone frame budget.

WebKit's [layer inspection article](https://webkit.org/blog/8262/visualizing-layers-in-web-inspector/) explains the relevance of compositing layers and memory. Its [power usage guidance](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/) connects rendering work to power consumption. This is consistent with treating the reported sustained iPhone slowdown as a resource and workload investigation. The actual cause in the demo has not been established through a physical-device trace.

WebKit announced WebGPU in [Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/). That is a reason to keep a backend boundary, not a reason to require WebGPU on every collector's device. The first player should feature-detect its tested WebGL2 path and retain a poster fallback.

## Video is supported, with explicit playback semantics

WebKit's [iOS video policies](https://webkit.org/blog/6784/new-video-policies-for-ios/) describe muted playback and inline video behavior. A runtime must still handle a rejected `play()` promise and device/user policies. Apple's [HEVC with alpha presentation](https://developer.apple.com/videos/play/wwdc2019/506/) documents a transparent video option; it does not provide one universal alpha codec for all browsers.

The [Media Capabilities specification](https://www.w3.org/TR/media-capabilities/) allows querying support, smoothness and power-efficiency information. Those are selection signals, not promises about a hot device running many layers. [WebCodecs](https://www.w3.org/TR/webcodecs/) provides lower-level media processing and explicit resource lifetimes, which is useful for a later controlled decoder. It should not be required for the first video-back implementation.

**Recommendation:** start with an opaque SDR MP4/H.264 source plus a poster, test it on target devices, add codec variants, and keep angle-scrubbed frame animation separate from ordinary time-playing video. Arbitrary HTML video seeks are not a dependable substitute for a small pose atlas.

## Validation, trust and access

[JSON Schema 2020-12](https://json-schema.org/draft/2020-12) can express structural constraints. It cannot prove that a ZIP is safe, that reference graphs are valid, or that the GPU cost is acceptable. [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) provides canonical JSON for reproducible hashing. Use a tested implementation; property sorting alone is insufficient.

The [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) supports layered validation and limits after decompression. The [HTML iframe specification](https://html.spec.whatwg.org/multipage/iframe-embed-object.html) defines sandbox behavior. [CSP Level 3](https://www.w3.org/TR/CSP3/) defines restrictions on loading and executing resources. These mechanisms need a deliberate origin and permission design. They do not guarantee CPU/GPU isolation for arbitrary programs in the same browser.

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) supplies accessibility requirements relevant to interaction, moving content and flashes. Our proposed player adds keyboard tilt/flip, textual descriptions, a static presentation mode, explicit audio consent and authoring warnings. Automated flash checks alone do not establish accessibility conformance.

## Blockchain and provenance are separate optional systems

[ERC-721](https://eips.ethereum.org/EIPS/eip-721) models unique tokens and optional metadata. [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) models balances across token types; it does not automatically supply our per-copy serial history. [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) authenticates a wallet session. Wallet authentication does not establish current token ownership.

[CAIP-19](https://standards.chainagnostic.org/CAIPs/caip-19), currently marked **Review**, is a candidate for chain-qualified asset identifiers. [IPFS persistence documentation](https://docs.ipfs.tech/concepts/persistence/) distinguishes addressing from keeping content available. [C2PA specifications](https://spec.c2pa.org/specifications/) are relevant to signed media provenance; provenance assertions do not establish collection ownership or copyright permission.

Our framework should expose external identity and ownership-provider contracts. It should not make a blockchain, wallet, NFT marketplace, CID or provenance signature necessary to view a card. Each additional marketplace export needs its own compatibility test; a custom `.dcard` file is not automatically rendered by an NFT viewer.

## Decisions requiring implementation evidence

1. Benchmark the current night/day composition on physical iPhones using DOM, one Pixi stage and any necessary prebakes. Choose the renderer from measured frame pacing, visual fidelity and memory behavior.
2. Verify the selected glTF runtime's actual `KHR_interactivity` support, operation limits and extension coverage before advertising that capability.
3. Measure Rive/dotLottie texture composition and idle behavior before supporting either inside many simultaneous cards.
4. Inspect dependencies' pinned-version licenses, binary sizes and maintenance before distribution. This document is not a license audit.
5. Determine quality budgets from the lowest supported device. Proposed numbers in the specification are initial engineering gates, not achieved benchmarks.
