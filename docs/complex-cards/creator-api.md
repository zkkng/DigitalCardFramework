# Creation without a webpage

Runtime contract 0.1.0. Import `createAuthoring` and `imagePackage` from `@digital-card/framework/presentation/authoring`. Node 24.14+ and modern browsers are supported. No DOM is needed for the core authoring pipeline.

## One image, every material

```js
import {createAuthoring} from '@digital-card/framework/presentation/authoring';

const creator = createAuthoring();
const card = await creator.build({
  id: 'my-line.sunset', title: 'Sunset',
  source: {format: 'image', mediaType: 'image/jpeg', bytes},
  effects: [{
    id: 'preset', node: 'art', side: 'front',
    parameters: {name: 'Chunky holo', size: 24, density: 0.25, seed: 47}
  }]
});
// card.archive is a Uint8Array .dcard ZIP; card.digest pins its logical content.
```

Omit `effects` to create an ordinary image card. PNG and WebP work identically. The original image determines the canvas dimensions. A supplied `source.back = {bytes, mediaType}` replaces the default duplicated back. No generated art, automatic crop or forced portrait composition is imposed. The studio's **Make card from image** button uses this public API.

Use stable IDs for reproducible batch builds. Unspecified IDs are generated for interactive one-off creation. `buildBatch(requests, {signal})` processes 1–1000 cards sequentially and fails at the first invalid card, before publication. Supply an `AbortSignal` to stop between operations; importers and publishers must honor the signal during their own expensive work.

## Exact finishes and motion

The `material` recipe assigns the scene material verbatim. `preset` copies a named preset, applies explicit shallow overrides, and connects its shine/sweep/bloom to the card angle. Arrays are replaced, never implicitly merged. Preset definitions live in `materialPresets` and are ordinary data. Example:

```js
{id:'material', node:'art', parameters:{
  kind:'glitter', size:3, density:0.7, intensity:1.6,
  roughness:0.4, variation:0.6, seed:99,
  shape:'hexagon', color:'#f5d5ff', mode:'surface',
  flakeAsset:'my-flake', maskAsset:'foil-regions'
}}
```

`size` is the material's flake spacing/scale in local card units, not a count of flakes. Density is 0–1; intensity controls highlight strength; roughness changes the angle response; variation and seed control deterministic irregularity. Built-in shapes: circle, hexagon, shard, star. `flakeAsset` samples an imported image's alpha silhouette; its RGB is not a multicolor flake print. `maskAsset` controls where the finish applies. Layer transparency also clips the finish. Use a transparent PNG to design the flake and another mask to select regions of a single JPG.

Built-in materials: glitter, foil, water, bloom and spot. Supported motion targets and numeric ranges are checked by `validateScene`. Example binding: `{'material.angle':['input','angle']}`. Motion expressions are bounded data graphs; uploaded JavaScript is never evaluated. To combine finishes, return multiple overlapping nodes with unique IDs, sharing the same image and their own masks. This uses the texture cache rather than duplicating image bytes.

## Installed custom effects

```js
const creator = createAuthoring({
  effects: {
    'studio.petal-holo'(node, parameters) {
      return {...node, material:{kind:'glitter', ...parameters},
        bindings:{'material.angle':['input','angle']}};
    }
  },
  async transform(project, {request, signal}) {
    // Optional host processing: add mask/flake assets, metadata, or generated nodes.
    // project.addImage(blob, {id:'my-flake'}); project.edit(...)
  }
});
```

A recipe receives a detached node, parameters, and `{manifest, side}`; it synchronously returns a node or node array. All output is validated. A missing target/effect fails explicitly. Host registration can replace built-in recipes by the same key; `describe()` exposes the installed names. Effects that require an entirely different renderer use an `adapter` node and a host-installed player adapter, or replace the card renderer. Recipes are authoring conveniences; portable files contain the expanded scene and declared adapter requirements.

Host code is trusted and has the host's privileges. A card bundle cannot install a plugin, import a module URL or grant itself permissions. Missing required adapter capabilities fall back to the face poster. New shader engines belong behind the adapter/renderer contract, not a universal untrusted shader execution switch.

## Layered sources

The editor supports one-file PSD, OpenRaster `.ora`, and a ZIP containing `layers.json` plus PNGs. It preserves source positions, order, names, opacity, supported blending and groups. It reports unsupported features before replacing the current card. A flattened source preview can be chosen when available. PSD support is bounded **8-bit RGB PSD**, not PSB, arbitrary Photoshop effects or editable smart objects. Text/vector layers use stored raster pixels. OpenRaster is an existing layered interchange format; it is not a proprietary invention for this framework.

For headless import, register an importer using `parseLayeredSource(bytes, {format, encodeRGBA, limits})` from `/presentation/layered-source` and `layeredPackage(doc, {poster, flatten})` from `/presentation/layered-package`. PSD needs an injected RGBA-to-PNG encoder; all imports need a PNG poster, either the source's `merged` preview or one rendered by your own compositor. Check `doc.report.issues` against an explicit policy; do not silently accept unsupported source effects. The browser wrapper `/presentation/layered-import` performs decoding in a worker and renders supported layers. Server hosts should isolate native decoders in resource-limited jobs.

```json
{
  "version":1, "order":"bottom-to-top", "width":1000, "height":1500,
  "title":"Petals", "preview":"preview.png",
  "layers":[
    {"id":"background","file":"background.png","x":0,"y":0},
    {"id":"petal","file":"petal.png","x":220,"y":130,
     "parallax":[35,20],
     "material":{"kind":"glitter","size":12,"density":0.4},
     "bindings":{"rotation":["mul",["input","tilt.x"],10]}}
  ]
}
```

Import profile: 64 MiB source, 8192 pixel edge, 32 million decoded layer pixels, 512 layers and 16 nesting levels. Current archive paths use a strict ASCII safe-path subset; rename non-ASCII filenames on export. Layer display names may be Unicode. GIMP/Krita native project formats and Live2D rigs are not claimed supported. Live2D adds rig/physics/runtime semantics beyond image layers and needs its own installed adapter.

## Headless publication and packs

`publishPack({cards, catalog, key}, {signal})` builds every card, validates the complete host catalog, publishes immutable presentation content, inserts pinned references into matching catalog card IDs, revalidates, then invokes `commitCatalog`. Pack odds, prices, variants and products are ordinary existing catalog configuration. No browser click is involved.

```js
const creator = createAuthoring({
  validateCatalog,
  async publish(pkg, {key, signal}) {
    const result = await yourPresentationStorage.publish(pkg.archive, {key, signal});
    return {contract:'digital-card@0.1', digest:pkg.digest, baseURL:result.baseURL};
  },
  async commitCatalog(catalog, {key, signal}) {
    return yourCatalogPublisher.commit(catalog, {key, signal});
  },
  onEvent(event) { yourTelemetry.record(event); }
});
await creator.publishPack({cards:requests, catalog:configuredCatalog, key:'release-2026-10-01'});
```

The core already exposes `CardFramework.publishCatalog(admin, catalog)`, and its HTTP client exposes `previewImport` / `commitImport` with optimistic catalog-version checks. A host adapter can use those directly; it must authenticate and retain authority. Never replace acquisition/trade transactions with visual callbacks. Publishing art creates no owned copies.

Publication is a two-phase composition, not a distributed transaction: immutable assets first, catalog last. A later failure may leave unreferenced assets. Retain them for retry and use the storage retention review API afterward. The host publishers must implement idempotency/conflict semantics for the supplied key. Reusing a key with changed input must be rejected by the host. The authoring helper itself is stateless and does not promise exactly-once remote writes.

Events: `build.started`, `build.completed`, `build.failed`, `presentation.published`, `catalog.committed`. Events are observational, contain IDs/digests rather than bytes, and cannot veto commands. Observer failures are isolated. Use the injected importer, transform, validation or publication function to enforce policy. Wrap a function to add behavior, replace it to change behavior, and invoke the public command to trigger behavior. There is no hidden UI-only command path.

## CLI and HTTP

`node src/presentation/creator-cli.mjs release.json OUTPUT` accepts version-1 configuration with `cards:[{id,title,file,effects}]`, a complete `catalog`, `publicBaseURL` and optional `key`. It creates content-addressed card directories/downloads and `catalog.json`; this local CLI prepares publication but does not deploy files or authenticate to a remote catalog. Relative source files must stay inside the configuration directory. Use the JavaScript API above for remote CI publication or custom layered importers.

`node src/presentation/cli.mjs` supports package `validate`, `report`, directory `build`, content `publish`, and JSON `batch` jobs. `presentationRoutes` supplies Fetch-style import/status/cancel/publish/descriptor/file/download endpoints. Authentication, CSRF/origin policy, rate limits, storage and scanner choices belong to the host. The reference Site is static: it demonstrates editing/export, not a public upload server.

## Extension contract summary

| Point | Input → output | Replace/wrap | Lifecycle |
|---|---|---|---|
| Importer | source + context → validated package | `importers[format]` | awaited per build; honor abort |
| Effect recipe | detached node + parameters → nodes | `effects[id]` | synchronous; output validated |
| Project transform | project + context → edits | `transform` | awaited before final export |
| Catalog validator | complete catalog → success/error | `validateCatalog` | before storage and before commit |
| Presentation publisher | package → pinned reference | `publish` | awaited; immutable, retry-safe |
| Catalog publisher | complete catalog + key → result | `commitCatalog` | authoritative final operation |
| Observer | event → ignored | `onEvent` | no veto; host owns buffering |
| Player adapter | node + asset access → canvas lifecycle | stage `adapters` | estimate/create/update/render/dispose |
| Complete view | issued-copy public model → element | framework renderer option | attach, detach, dispose |

No extension may bypass validation, content integrity, host resource ceilings or ownership invariants through an uploaded configuration. API 0.1 is experimental: pin exact versions and review migrations before upgrading.


## Captured posters and concurrent authoring

After editing a finish, capture both faces in Studio with **Capture posters**, or call its public `await studio.capturePosters()`. This renders neutral input through the same player and preserves the current editing face. Capture is explicit so export does not overwrite an intentionally selected hero pose.

For headless or custom editors:

```js
const front = await yourRenderer.capture(project, 'front');
const back = await yourRenderer.capture(project, 'back');
await project.setPosters({front, back}); // PNG/JPEG/WebP Blobs
const pkg = await project.export();
```

`setPosters` validates media, updates face references in one undoable edit and rejects a project revision conflict while preparing bytes. `getRevision()` changes after edits/undo/redo. `export()` captures detached scenes/assets before awaiting hashes. Batch requests are likewise snapshotted before asynchronous importer work. A transform cannot rewrite a caller's requested stable card ID.
