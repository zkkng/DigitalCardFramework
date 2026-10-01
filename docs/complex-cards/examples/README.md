# Reading the example

These files illustrate the **proposed** manifest and a deliberately small scene dialect. They are not a working `.dcard`: image/video files are absent, byte lengths and SHA-256 values are placeholders, and there is no integrity index. No art is stored in this repository.

`lakeside.card.json` references `scenes/front.json` and `scenes/back.json`. The front demonstrates ordinary layers, a feathered firework recipe, a lake material, one glittery petal and three registered companion poses. The back demonstrates a muted video with its own poster. A production petal field uses baked irregular instances or the later particle-field capability; a single petal keeps this structural example readable.

The schemas in `../schemas` cover this example subset only. They do not yet define the full plugin, mesh, text, particle-field, program, connected-content or assembly dialects discussed in the specification. Those require versioned schemas and conformance fixtures in their implementation milestones.

## Example semantics

- Node transform x/y locates its pivot in parent coordinates. With an omitted pivot, local origin is top-left. Width/height define its untrimmed logical size. Rotation applies about the pivot. Atlas frame pivots override the node's default source pivot; every frame here uses the same contact point.
- `sequence.progress` is normalized [0,1]. Select the pose by the cumulative frame-duration intervals; 0 selects the first and 1 selects the last. No timer advances this example. A separate vertical-position track or painted pose can supply visible lift.
- A material's `source-alpha` mask samples the node's own source alpha. Water uses a cutout lake asset. Recipe parameters are illustrative API design; final shader equations and golden images are a milestone deliverable.
- Removing an optional material recipe leaves its base image intact. A static-pose fallback chooses frame 0. A video fallback displays its declared poster. Unknown required capabilities prevent interactive activation and select the face poster.
- Tracks use piecewise linear interpolation and clamp outside their key domain. Each target property has one writer. Parameters such as `angle` are dimensionless recipe inputs; they are not automatically physical degrees.
- The example's front has no active clock. Its video back explicitly requests time playback. Pausing or hiding the back suspends that work.

## Check the documents

From the repository root, after installing the existing package dependencies:

```sh
node docs/complex-cards/check-examples.mjs
```

The checker runs JSON Schema validation, reference/capability/track checks and deliberate invalid-example cases. It is documentation tooling, **not the production archive importer**. It does not validate real media, perform duplicate-key-aware parsing, verify the placeholder hashes, prove resource budgets or render images.

## Proposed host integration

The following code demonstrates the intended API. `createPlayerStage` is not currently exported by the framework. The complete lifecycle types are in [contracts.d.ts](../contracts.d.ts).

```js
// FUTURE API. The host supplies these dependencies and sanitized public models.
const stage = createPlayerStage({
  root: myCardRegion, // Contains both mounting targets in this example.
  resolver: myContentResolver,
  adapters: [my2DAdapter, myVideoAdapter],
  budget: {
    estimatedGpuBytes: 96 * 1024 * 1024,
    renderTargetBytes: 24 * 1024 * 1024,
    activeVideoDecoders: 1,
    maxDpr: 1.5,
    maxGraphOperationsPerUpdate: 4096
  },
  motion: 'respect-preference',
  allowAudio: false,
  allowConnectedContent: false
});

// Layout A: an inspector in a host-owned drawer.
const view = stage.mount(drawerBody, publicCardModel, {
  quality: 'lite',
  inputMode: 'drag',
  onEvent(event) {
    if (event.type === 'intent' && event.name === 'openDetails') {
      openHostDetails(publicCardModel.copyId);
    }
  }
});
await view.ready; // A usable poster fallback also resolves.

// Layout B can mount the same model beside a host-owned pack result list.
// It supplies the already committed reveal progress; it never rolls a card.
const resultView = stage.mount(packSidePanel, publicCardModel, {
  quality: 'lite', inputMode: 'host'
});
resultView.setInputs({ revealProgress: 0.5, tilt: { x: 0.2, y: -0.1 } });

// Explicitly release both views before route teardown or DOM replacement.
view.dispose();
resultView.dispose();
stage.dispose();
```

Both layouts use public lifecycle methods and no core edits. Here the drawer is an ordinary panel inside the common region. A modal in the browser's top layer needs a stage in that modal; separate stages still participate in a page-level resource governor. In an actual implementation, the budget may leave one view on its poster while another is active. A stage must not silently multiply its memory/decoder allowance by mount count. Host wrappers should implement `try/finally` or framework effect cleanup so rejected loading also releases resources.

## Proposed custom effect registration

An operator installs a plugin such as `studio.prism-petal@1.0.0`. It contributes a parameter schema, input ports, compiler implementation, resource estimate, fallback and editor controls through the host registry. A card references its recipe ID and parameters; it cannot supply an executable URL.

The first mod SDK must include a runnable plugin fixture with this lifecycle: register → resolve → compile → mount → disable → fallback → dispose. The current `EffectRecipeDescriptor` is a design sketch, not a finished render-pass ABI or a runnable plugin. The shader/adapter interfaces must be completed and tested before claiming third-party effect compatibility.
