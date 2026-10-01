# Complex cards: customization, mobile warnings and external currencies

This guide describes custom effects, performance controls and external service integration. Game integration and artwork remain separate.

## Defaults and extension contracts

| Concern | Default | Host customization |
| --- | --- | --- |
| Upload performance | Warn, accept structurally valid content | `performance` policy in authoring, compiler, import store and Studio; `mode: reject` or `off`; numeric thresholds |
| Static image | One ordinary image node | Every portable material, mask and motion binding also works here |
| Glitter | Built-in material | Star/circle/hexagon/shard, size/density/roughness/variation/seed/tint, arbitrary alpha flake art, optional original RGB coloring, effect-area mask |
| Entirely new effect | No uploaded code execution | Host-installed compile-time recipes or runtime adapters with lifecycle/budget/fallback contracts |
| GIF animation | Transparent PNG frames controlled by angle, no idle loop | Edit `animation.progress` and `loop`; time, reveal or host-input control |
| Album interaction | Independent members; normalized tilt bounded to [-1,1]; no CSS rotation unless enabled | Named sync groups, per-member limits, scale/inversion, disabled motion, degree limits, host-only input and replacement layout |
| External currency | Disabled until a provider is installed | Verified settlement bridge; server account mapping, exact rational conversion and durable receipt deduplication |

## Layer-specific upload warnings

`analyzePerformance({manifest, scenes}, policy)` is browser/Node compatible and decodes no media. It returns `issues`, `layers`, `faces`, `policy`, `accepted`, and a limitations statement. Every issue names a face, exact layer ID, nested path, contributing asset IDs, code, measured quantity, threshold and remedy. Aggregate overloads identify **all contributing layers**, rather than blaming one arbitrary layer. Shared textures are counted once per face, while repeated draws still count toward draw/overdraw thresholds.

Default mobile heuristics: standard quality (matching interactive mounts, with lite fallback when absent); 8 MiB texture data per layer; 48 MiB per face; 4 MiB download per layer; 40 drawn layers; 12 full-canvas-equivalent passes; 48 animation frames; 16 million decoded animation pixels; one active decoder. Programmable and media layers additionally flag their unknown runtime cost. These are authoring thresholds, not an Apple hardware specification or a guarantee that a given iPhone will lag. Driver allocations, compositing, codec buffers, shader complexity, thermal throttling and other visible cards require device measurement.

```js
const performance = {mode: 'warn', quality: 'lite', drawLayers: 60};
const author = createAuthoring({performance});
const pkg = await author.build({source: {format: 'image', bytes, mediaType: 'image/jpeg'}});
console.log(pkg.performance.issues);

// Server enforcement is authoritative; a creator cannot bypass it with UI settings.
const uploads = await createPresentationStore({root, authorize, performance: {
  mode: 'reject', faceTextureBytes: 64 * 1024 * 1024
}});
```

`compileDirectory` and `publishPackage` enforce before writing published content. The reference Node host enables authenticated upload routes with `PRESENTATION_ROOT` and accepts `HOST_MODULE.presentationOptions` for policy/scanning. Import jobs persist diagnostics even when rejected; APIs return them through the existing job-read permission. `createAuthoring` includes the report on the package and completion event. Studio shows a collapsible report; click a warning to select its face and layer. It checks policy again on export/publication. CLI `report` includes diagnostics, and batch jobs accept their own `performance` object. A trusted deployment must configure its own final policy, rather than accepting an uploader's requested policy.

Structural/security limits remain independent of performance warnings. Turning off advice does not disable archive, frame, media, input or authorization validation.

## Design glitter, or write a new effect

```js
node.material = {
  kind: 'glitter', size: 24, density: .35, roughness: .18,
  variation: .65, seed: 127, shape: 'star', intensity: 2.4,
  maskAsset: 'petal-area', flakeAsset: 'my-flake-design', flakeColor: 'texture'
};
node.bindings = {'material.angle': ['input', 'angle']};
```

`flakeAsset` can be a transparent PNG/WebP of any silhouette. Alpha controls the flake boundary. `flakeColor: 'holo'` (default) uses the generated reflection/tint; `'texture'` keeps the supplied design's RGB colors under the glint. The effect mask confines it to petals, metal, water or any painted area. Studio exposes size and advanced controls, custom flake upload/coloring, and mask painting.

For a portable preset or composition, register `createAuthoring({effects})`. A synchronous recipe receives a cloned node, parameters, and public manifest/face context and returns one or more nodes. The finished scene is validated and exported; consumers need no custom code to render it.

For a new shader, particles, procedural art or arbitrary rendering, install a runtime adapter in the host's `createPlayerStage({adapters})`. It implements `estimate`, async `create`, `update`, `render`, `canvas`, and idempotent `dispose`. `create` gets an AbortSignal, bounded dimensions, resolver asset access, invalidation, and the versioned backend port. Declare a capability and a fallback in the card. `composeExtensions` provides explicit provider selection and dependency ordering. Hosts can replace the complete player when a different renderer is required.

Executable example: [custom-card-effects.js](../../examples/custom-card-effects.js) supplies a portable star-glitter recipe and an independently rendered, angle-driven star field. Browser conformance loads it without editing the player and checks cleanup. Uploaded packages contain data; installing trusted extension code is an operator decision. There is no promise that third-party JavaScript itself is sandboxed.

## Transparent GIFs and other animation sources

Studio accepts GIF through **Import layered artwork**, or **Add animated GIF layer** to an existing card. PSD, OpenRaster, layer ZIP and loose raster workflows still work. Programmatic import uses the same public functions:

```js
const doc = await parseLayeredSource(gifBytes, {format: 'gif', encodeRGBA});
const pkg = await layeredPackage(doc, {poster: doc.poster});
```

`encodeRGBA({width,height,data})` returns PNG bytes. `encodePNG` is the supplied canvas-independent implementation. `importLayeredFile(file)` runs decode in a bounded browser worker and returns the same review/build interface as other layered imports. Server ingestion should run native or JS media conversion in a constrained worker/process; the `.dcard` import store already uses a worker with timeout and memory limits.

GIF conversion preserves transparent pixels, frame positions, palettes/interlace via the decoder, and disposal modes 0/1, 2 (clear), and 3 (restore previous). Frames are fully composited before export. Durations are relative millisecond weights; delays shorter than 20ms are clamped. Limits are checked **before** decoder allocation: 64 MiB input, 4096 edge, 100 frames, and 32 million aggregate full-canvas pixels. Plain-text GIF extensions and malformed/truncated structures are rejected with a specific error. Source loop metadata is deliberately replaced by explicit card motion configuration.

Angle animation is `progress: ['input','angle'], loop: false`. For explicit continuous playback use `progress: ['div',['input','time.active'],durationSeconds], loop: true`; the player handles visibility, static/reduced motion and disposal. The angle-driven default remains motionless at rest. APNG/animated WebP are not silently treated as a static texture: convert to the same frame format with a host importer, or use a supported video/animation adapter. Codec/alpha support still depends on the selected media adapter and browser.

## Multi-card albums

`mountAssembly` retains independent presentation references, hit targets and ownership. Layout is arbitrary percentage bounds; it does not mint or merge cards. The headless `createAlbumMotion` also works with a completely different view.

```js
const album = await mountAssembly({stage, root, interaction: {
  rotate: true,
  defaults: {maxRotation: [6, 10]}, // degrees: pitch, yaw
  // inputMode: 'host' disables built-in pointer/keyboard input
}, descriptor: {version: 1, members: [
  {id: 'night', presentation: nightRef, bounds: [0,0,49,100],
   motion: {syncGroup: 'panorama'}},
  {id: 'day', presentation: dayRef, bounds: [51,0,49,100],
   motion: {syncGroup: 'panorama', limits: {x:[-.6,.6],y:[-.3,.3]}}}
]}});
album.setMemberInputs('night', {tilt:{x:.5,y:.1}});
album.dispose();
```

Omitting `syncGroup` gives independent movement; only named peers synchronize. A member can use `enabled:false`, zero rotation, mirrored scale, or tighter input limits. `setInputs` explicitly broadcasts to all members; `setMemberInputs` respects groups. `snapshot` is detached data. The built-in interaction has arrow-key/Home access, pointer reset, and reduced-motion CSS rotation suppression. Outer rotation is opt-in; renderers still honor their own reduced-motion policy.

The existing collection's `albumRenderer` and `layouts` replacements can mount this public assembly using persisted `album.layout`/placement data, or use `createAlbumMotion` with DOM/WebGL/native controls. Default gallery posters remain lightweight. Hosts choose which cards become interactive and can supply a global stage budget. A different album view never needs to fork the domain service.

## Currency integration and its boundary

The local ledger remains authoritative for purchases, trades, escrow, conversions and finite-supply allocation. It uses safe integers in smallest units. The new `createCurrencyGateway` adds external funding through `dc.currency-settlement@1`; it does not pretend an HTTP payment and a local database transaction can commit atomically.

Each server-installed provider supplies:

- `resolveAccount({userId,signal})`: map a verified framework identity to the external account using trusted host records.
- `lookup({transactionId,account,signal})`: retrieve authoritative evidence and verify the intended merchant/destination/purpose, signature where applicable, finality, currency and external amount. Return `{transactionId,account,status:'settled',currency,amountUnits:'150'}` only when the host accepts that settlement as spendable.
- `currencies`: explicit external-code mapping to `{currencyId,numerator,denominator}`. Defaults to 1:1; no floating-point conversion, implicit rounding or arbitrary client currency mapping.

The framework rejects unrecognized providers/currencies, mismatched transactions/accounts, pending/reversed statuses, non-integer units, overflow and inexact conversion. The durable ledger deduplicates globally by provider plus external transaction ID; concurrent requests, new client retry keys, restarts or changing the recipient cannot credit twice. Changing conversion terms for an already recorded receipt fails visibly. The audit checks one matching ledger entry per settlement.

Production `HOST_MODULE` can export `currencyProviders`. The optional authenticated, same-origin `POST /api/currency/reconcile` accepts **only transaction identifiers as authority-free lookup inputs**. `client.reconcileCurrency` exposes it. There is no HTTP endpoint that accepts a claimed settlement amount. A webhook/queue handler can call the same gateway using a server-resolved principal after verifying the provider notification; repeated delivery is safe. Bounded lookup/cancellation prevents a late timed-out request from committing funds.

Direct `settleExternalCredit` requires the separate trusted `currency.settle` permission; ordinary users and grant-only operators cannot call it. As with `currency.grant`, never deserialize trusted principals from JSON. Reference [external-currency-provider.mjs](../../examples/external-currency-provider.mjs) is an executable fake-service composition demonstrating the API, not a live financial service.

This is sufficient to integrate settled game points, rewards or externally purchased credit into all existing pack/trade systems. External balance display, withdrawals, reversible card payments/chargebacks, cross-service trade escrow and chain reorganizations require provider-specific policies and orchestration. Their state belongs to the external integration; do not credit merely because a transaction exists or a browser says payment succeeded. Live providers require real credentials and end-to-end provider tests before enabling.
