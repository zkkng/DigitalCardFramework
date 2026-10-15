# Executable customization recipes

The reference UI uses the same exports as adopters. examples/alternate.js demonstrates a different page order, theme, card back, metadata panel, horizontal album and a fully replaced modal opener. Run the demo, buy a pack, and visit /alternate.

## Appearance, labels and assets

mountFramework(root,{theme,css,...}) installs scoped defaults. Supported tokens: --dc-bg, --dc-panel, --dc-text, --dc-muted, --dc-accent, --dc-border, --dc-radius, --dc-card-ratio, --dc-font. css is trusted host CSS, applied after defaults. Host selectors should stay within the supplied root's class. No global body reset or key handler is installed.

Catalog card names, line names, rarity names, product names and currency names supply default display labels. To replace navigation/control labels and markup, replace the relevant view or compose your own client/controller UI. The collector wallet, pack purchase, opening, collection, inspector, album, trade, marketplace, account reward, code history/reveal, trading-control, administration and Studio workflows accept portable localization bundles as described below. Other default surfaces currently use English.

Default precedence is default CSS < host theme/CSS < explicit card/variant asset references. Variant back overrides definition back, which overrides the CSS back. A supplied backRenderer replaces asset/default back markup. There is no automatic deep merge of arrays: sections explicitly replaces the default order.

## Pack artwork renderer

`mountFramework(root,{packRenderer})` replaces the individual pack artwork surface in Discover and My packs. The function receives `(product,{small,lineName,previewCards})` and returns a DOM node or `{node,dispose}`. Each mount receives the product appropriate to that surface: current catalog products in Discover, immutable allocated product snapshots in My packs. Cleanup runs on refresh, navigation and unmount. Keep renderer state local to each returned instance.

The exported `renderPack(product,options)` returns `{node,setSide,dispose}` and supports independent front/back controls, a load-error fallback and terminal disposal. `examples/alternate.js` demonstrates a targeted replacement that composes this renderer with a different border and label. Supply trusted host code for a completely different component. `mountOpener` accepts `packArtwork(packId)` for reveal artwork; use the owned pack snapshot rather than a later catalog product.

## Reorder, insert or remove features

sections:['collection','albums','wallet','shop'] hides pack/trade sections and rearranges the remaining sections. A sections entry may be a callback (model,{client,inspect,refresh}) returning a host DOM node. This inserts or replaces any whole section. The host can instead mount only mountOpener inside a sidebar, modal or existing page.

### Guided playground navigation

The default `navigation:'sections'` keeps the composed sections on one page, including host callbacks. `navigation:'tabs'` shows one named built-in section at a time, a persistent wallet summary, and a sealed-pack count. The `sections` array controls navigation order. Named tabs are `shop`, `packs`, `collection`, `albums`, `trades`, and `wallet`; custom callback sections should use section mode or a host-owned shell. Purchasing from the default shop switches to `packs`; opening and visual reveal remain separate commands.

```js
mountFramework(root, {
  client,
  navigation: 'tabs',
  sections: ['shop', 'packs', 'collection', 'albums', 'trades', 'wallet'],
  participants: [{id: rowanId, name: 'Rowan'}, {id: morganId, name: 'Morgan'}],
  theme: {'--dc-accent': '#baa1ff'}
});
```

`participants` is an optional host-supplied array of `{id,name}`. It supplies account display names and recipient choices; it grants no access to another inventory. Without it, trading accepts a recipient ID. Offered cards and trade-up inputs use owned-copy checkboxes; requested cards still accept IDs from the inspector. Currency choices use published, tradable catalog entries. The server remains authoritative for all eligibility, balances, and ownership.

The built-in inspector opens a native dialog with focus containment, Escape dismissal and an explicit Close button. `renderInspector(copy,{labels:{line,rarity},...})` optionally accepts human-readable catalog labels; timestamps display in the browser's local timezone. Renderer/theme/layout replacement contracts remain available. The geometric fallback card face and pack illustrations use CSS, with no art files required. Finite supply availability is validated by the server at purchase; displayed odds are base rates, not a live stock promise.

## Replace one part

cardRenderer(copy,options), backRenderer(copy), metadataRenderer(copy), albumRenderer(model,options) and openerView(state,controller) are single explicit host selections. Choose one implementation at composition time; there is no import-order registry. A wrapper can call renderCard or renderAlbum then add trusted controls. Copy models and receipts are detached objects.

examples/alternate.js provides backRenderer and metadataRenderer using textContent through element(). Replacements must preserve usable focus, keyboard/touch access, labels and reduced motion.

## Replace the whole opener

createRevealController({open,key}) provides getState, subscribe, load, reveal, skip, replay and dispose. States are idle/loading/ready/revealing/complete/error. ready arrives only after the authoritative opening result. revealed is presentation progress. Complete/skip/replay never changes the allocation.

mountOpener(root,{controller,view}) subscribes to that controller. view returns a DOM node, or {node,dispose} for a custom view with external resources. Dispose runs before replacement and unmount. Subscribe returns an unsubscribe function; disposal is terminal and suppresses outstanding loads. Later load, reveal, replay or subscription calls cannot restart that instance. examples/alternate.js renders all results instantly in a host-owned dialog. This does not grant new cards.

## Default collection controls

These controls filter the native view; they do not authorize a transfer or reserve a card. **My copies** lists owned-copy identities; **Card catalog & wishlist** lists definitions. Favorites refer to copy IDs, while wishlist entries refer to card IDs. **Include code cards and inserts** changes visibility, not entitlement access.

| Control | Default and interpretation |
| --- | --- |
| Search, Line, Rarity, Finish | Empty search/all choices; search matches card names/tags, definition stats and card/variant metadata without case distinction |
| Sort | Newest first by creation time; name uses browser locale ordering, rarity uses descending rank |
| Show | All cards; duplicates compare variant IDs, favorites use copy IDs, available-for-trade also requires the trading feature and the copy's tradable status |
| Compare / Inspect together | At most 24 owned copies; selection and shared inspection do not merge ownership |
| Show more | Extends the visible list from the supplied model; it does not create copies or change the server's query limits |

Connected-card layouts and missing-piece behavior use the existing [combination contract](content-authoring.md#combinable-cards). A host can replace this renderer; these defaults do not impose controls on a custom view.

## Replace the album and all CSS

saveAlbum stores layout:{id,columns,gap,...customData} plus ordered placements with per-placement data. The default renderer recognizes columns, gap and the bounded appearance fields described below. renderAlbum(model,{layouts:{journal:renderer}}) selects a trusted registered layout when layout.id is journal. Alternatively supply albumRenderer to replace the entire album, as the alternate example does.

A renderer can implement grid, binder pages, horizontal rails, freely positioned cards or another layout using placements/data. CSS belongs to the host; album JSON is data, never executable code. Multiple albums may reference the same owned copy, while one album has one placement per copy.

## Layered cards

cards[].layers is ordered back to front. Each layer has id,src,depth and optional blend:normal/screen/multiply/overlay, opacity in [0,1], effect:emissive. depth controls pointer/keyboard parallax amplitude. Use prepared transparent PNG/WebP assets with crop padding. Default front/back are rendered in a CSS perspective container; the inspector can flip and tilt without hover-only actions.

variants[].finish supports standard/gloss/holo/foil presentation. effectMask selects a mask restricting the overlay to parts of the card. Missing images leave textual card identification and do not affect ownership. Metadata remains real text above the layers. For animated assets, advanced shaders or your own renderer pipeline, replace cardRenderer. No assets are generated or committed by the framework.

Depth layers do not automatically create hidden scenery. The art author prepares depth/crop/masks. Reduced motion disables tilt/parallax/pulsing in defaults while preserving front/back switching.

## Providers and policies

CardFramework({store,bindings,policies,clock,random}) is the server composition root. Provide a different storage implementation with the documented atomic contract. Binding factories use explicit names and fail before commit when missing. policies.canTransfer(copy,userId) must synchronously return true to permit a transfer; it can only tighten the ownership/feature/binding invariants. Random and clock injection support repeatable tests; production defaults use cryptographic randomness and UTC time.

Identity is replaced at the HTTP resolver and registerUser linkage, independently of presentation. Currency definitions and grant issuance are configured through the catalog/operator boundary. examples/catalog.js contains unrelated Sky Atlas and Pocket Garden sets with distinct metadata and price structures.

## Verification

Core and HTTP tests verify optional switches, ownership, private binding filtering, custom policies, per-line products and recipe settings. Client tests exercise alternate reveal control, disposal, retries and durable keys. Storage tests race separate worker-thread SQLite connections for last-copy issuance and duplicate requests. Browser QA exercises both actual compositions; it complements the transaction tests.

## Version 0.2 extension contracts

`mountFramework` accepts `views:{id:(model,context)=>nodeOrDisposable}` and `viewLabels`. Use `sections` to choose order/visibility and `navigation:'tabs'` for navigation. A view returns a DOM node or `{node,dispose}`; cleanup runs on navigation, refresh and unmount. The model contains catalog, me, wallet, packs, inventory, albums, trades, availability and pity. Context exposes client, cardRenderer, albumRenderer, layouts, inspect, inspectTogether, action, mutate, refresh, navigate and a mount-local `state` object for namespaced presentation state. Never place authority or private credentials in presentation state. Existing section-function composition remains available.

```js
import {mountFramework,element} from '../src/ui.js';
import {renderCollection} from '../src/collection-ui.js';
mountFramework(container,{
  client,sections:['welcome','collection'],navigation:'tabs',
  viewLabels:{welcome:'My collection world'},
  views:{
    welcome:(model,context)=>{
      const node=element('section');
      node.append(element('h2','',model.me.displayName));
      return {node,dispose(){ /* release your own observers/media here */ }};
    },
    collection:renderCollection
  }
});
```

The bundled `examples/app.js` is an executable public-API composition with collection, albums, trading, studio and account views. `examples/alternate.js` changes page order, theme, backs, metadata, album layout and the complete opener. No core edits are needed. `test/ui.test.js` verifies real complete-view disposal and renderer contracts.

| Customization | Public input/entrypoint | Executable example/evidence |
| --- | --- | --- |
| Collection, favorites, wishlist | `renderCollection(model,context)` or complete `views.collection` replacement | Reference app; collection selection/stat-search tests |
| Visual offers | `renderTrading` and `createTradeDraft({client,userId,catalog,storage,initial,parentTradeId,expectedDigest})` | Reference trade desk; controller/privacy/review/counter tests |
| Album editor/layout | `renderAlbums`, `albumRenderer`, `layouts[id](model,options)`, arbitrary layout/placement data | Alternate journal layout; private album/round-trip tests |
| Individual camera | `inspectorRenderer(copy,options)`, public `renderInspector`/`render3DInspector`; `renderTiltInspector` preserves compact legacy interaction | Reference inspector and orbit tests |
| Shared/card combinations | `comparisonRenderer(copies,options)`; `inspectTogether(copies)` | Horizon pair in `examples/catalog.js`, default shared stage |
| Metadata/stats/layers | Catalog fields/schemas/displayFields; `metadataRenderer`, `cardRenderer`, `backRenderer` | JSON/YAML Moonbridge patches and alternate renderer |
| Pack front/back/reveal | `products[].artwork`, visual pack destination, `packRenderer`, exported `renderPack`, `mountOpener({packArtwork})` | Sky Discovery product and alternate pack renderer; artist publication and lifecycle tests |
| Creator experience | `renderStudio` or own preview/publish view calling client previewImport/commitImport | Reference studio, real preview/stale-generation tests |
| Administration | `renderAdminPanel`, standalone `mountAdminPanel`, headless `createAdminController`, or complete `views.admin` replacement | [Administration guide](admin-panel.md); `examples/admin-headless.mjs`; reviewed settings and inventory workflows |
| Account/social | `renderActivity` or own preferences/notification view | Reference app and authorization tests |
| Odds/pity/windows/recipes | Validated product/recipe data, independent feature switches | Nightfall/sample products; pity/exhaustion/rollback tests |
| Host deployment | Trusted `HOST_MODULE` exports; `createApiHandler({resolveIdentity,...})`, auth/provider/session/store contracts | Production entrypoint and real-entrypoint integration test |

`createTradeDraft` exposes subscribe/getState/load/more/add/remove/setCurrency/setMessage/review/reviewAsync/buildOffer/clear/dispose. With the framework client, call `await draft.reviewAsync()` after the user confirms the offer contents, then check `draft.getState().reviewed` before enabling submission. Review failures are reported through state: `reviewPhase` becomes `error` and `error` contains the message. `buildOffer()` rejects an unreviewed or expired offer. Synchronous `review()` remains available for custom clients without `reviewTransfer` when no selected copy requires remote review.

Edits and recipient changes invalidate review and cancel an outstanding check. Late responses cannot approve a changed or disposed draft. Subscribe to `reviewPhase` and `reviewExpiresAt` to show pending checks and request another review when approval expires. Cards marked `remoteReviewRequired` can be selected for review; selection does not authorize their transfer. Currency-only offers also require asynchronous review when the client supports it.

For a counteroffer, pass both `parentTradeId` and the current original offer's `expectedDigest` to `createTradeDraft`. Submit the built offer's selected `versions` with the counter command. The server checks the original escrow and reevaluates policy before replacing it. An advisory review never releases escrow or guarantees that a later submission will succeed.

Loads ignore obsolete recipients and late completion after disposal. A disposed draft cannot start reads, clear saved drafts, attach listeners or build an offer. Built offers include copy versions. Saved drafts contain IDs/intentions, not card snapshots or binding codes. The authoritative server still validates every transfer.

`action(fn,{refreshAfter,message})` serializes UI actions, reports errors and refreshes committed models by default. `mutate(command,input)` uses a persisted idempotency key and coalesces identical in-flight intentions. Mutations fail before dispatch when Web Storage is missing, blocked or corrupt. Recover the original result before beginning a new identical intention; use `mutate.beginNew` for that deliberate new operation. Account change and unmount dispose the runner. Never reroll committed results based on presentation completion.

`CardFramework({limits})` accepts users/copies/packs/requests/albums/trades/copiesPerUser/packsPerUser positive integer caps. `policies.canTransfer` is a synchronous eligibility veto. Named `bindings` factories synchronously generate copy data before commit. A custom store implements synchronous detached `read(fn)`, atomic `transact(fn)` and `close()`. Async/network work inside a transaction is unsupported.

A production `HOST_MODULE` exports any of bindings, policies, limits, sessionOptions, rateLimits, rateLimiter, identityProvider or handleStatic. `sessionOptions.maxSessions` controls the bounded active session/challenge capacity. `identityProvider.begin()` returns `{url,data}` for the login challenge; `finish(callbackUrl,data)` returns a verified `{issuer,subject,displayName}`. This module is trusted server code. The default OIDC provider and public imports remain separate. `test/host.test.js` supplies an executable fixture module and exercises the real host.

Portable card artwork uses the `.dcard` package contract described below.

## Generate editable card artwork with Python or Go

These standard-library examples write a `.dcard` archive directly, without a JavaScript authoring adapter:

```sh
python examples/plugins/python-card-art.py celestial-python.dcard
go run examples/plugins/go-card-art/main.go celestial-go.dcard
```

Both examples describe the same layered front and back, a masked foil material, and bounded tilt motion. They include posters, asset hashes and a package integrity descriptor. Each generator is deterministic; archives from different generators need not have identical bytes.

In Creator studio, select the card and optional variant you want to update and open the visual card editor. Use **Open card** to load the archive, edit a layer, then select **Capture posters**. Select **Publish**, review the proposed change, and confirm with **Publish reviewed card**. Publication requires the host's normal authoring permission. Opening or editing the package alone does not update the catalog. Newly issued cards use the published presentation; existing copies retain their pinned presentation.

Use this route for portable artwork built from supported scene, material and motion primitives. It does not install custom executable renderers, editor tools or live-effect adapters. A developer can also load the archive through `importPackage` from `@digital-card/framework/presentation`.

## Run an external editor transform

An offline transform lets a Python or Go tool compute new scene content without executing uploaded code in Studio. Install a tool and its grants in trusted host configuration:

```js
import { mountStudio } from '@digital-card/framework/presentation/studio';
import { createEditorTransforms } from '@digital-card/framework/presentation/editor-transforms';

const editorTransforms = createEditorTransforms({tools: [{
  id: 'example.grid-decoration', version: '1.0.0', title: 'Grid and decorate',
  parameters: {
    columns: {label: 'Columns', type: 'number', default: 2, minimum: 1, maximum: 8, step: 1},
    gap: {label: 'Gap', type: 'number', default: 12, minimum: 0, maximum: 100, step: 1},
    padding: {label: 'Padding', type: 'number', default: 20, minimum: 0, maximum: 200, step: 1},
  },
  grants: {faces: ['front'], newRasterAssets: true, capabilities: []},
}]});
const studio = mountStudio(root, {initialPackage, editorTransforms});
// On host component removal:
studio.dispose();
editorTransforms.dispose();
```

In Studio, export a transform request, then run either example:

```sh
python examples/plugins/python-editor-transform.py request.job result.result
go run examples/plugins/go-editor-transform/main.go request.job result.result
```

Import the result into the same Studio session and inspect the transformed preview and change summary before applying it. Studio enables Apply once the preview is ready. Apply creates one undoable edit; Undo and Redo use the ordinary project history. The examples compute an aspect-preserving grid for top-level unlocked images and add a new transparent border raster. They retain existing order and skip groups and locked layers.

Requests contain `request.json` and `source.dcard`; results contain `result.json` and `result.dcard`. The source package omits private authoring context and copy-scoped stat values; public card/variant stat definitions and values needed by the scenes remain available. The [header schema](editor-transform.schema.json) describes the versioned envelope. Tools echo the request identity and source digest, but only the retained host session authorizes application. Editing or replacing the project invalidates an older result. Disabling a tool or disposing its session also prevents application. Studio discards its own pending requests when removed; the host owns an externally supplied controller.

A grant permits scene changes on named faces, subject to locked-content and ancestry protection. Existing asset bytes and descriptors, card identity, canvas, posters, and authoring metadata remain protected. New PNG/JPEG/WebP assets require an explicit grant and pass ordinary package validation. Added required capabilities must also be explicitly granted. Neither the tool nor its result can broaden these permissions.

The session defaults to four outstanding jobs and accepts one through eight. Source archives are limited to 64 MiB, result archives to 80 MiB, and retained archive bytes to 128 MiB. Headers allow 64 KiB and parameters 16 KiB. New raster assets are limited to 32, 4 MiB and 4,194,304 pixels each, with 16 MiB and 16,777,216 pixels in aggregate; tighter package limits still apply. The API provides `prepare`, `review`, `apply`, `discard`, `setEnabled`, and `dispose` for custom hosts.

Custom hosts can call `mountReview(project, review, {root, side})` to display the validated proposal without receiving a mutable proposal object. It returns `ready` and `dispose`; each job retains at most one preview. Discarding or disabling the job also closes its preview. Only one result review runs at a time, and an accepted replacement review invalidates the earlier proposal before processing begins.

This is an offline computation and reviewed-application route. It does not install arbitrary live editor-panel callbacks or launch external processes from the browser. Final publication still uses the normal validation and authorization workflow.

## Author a live vector effect with Python or Go

Generate a card package containing a passive dotLottie animation with either standard-library example:

```sh
python examples/plugins/python-lottie-card.py stars.dcard
go run examples/plugins/go-lottie-card/main.go stars.dcard
```

The default animation responds to the player's normalized angle input. Add `--clock` before the output path for autonomous playback. These examples generate vector/keyframe animation data, not executable browser code or pre-rendered animation frames.

Import and publish the archive through the normal card-package workflow. The host must enable the existing optional dotLottie adapter and self-host its matching WASM runtime. Install and bundle the pinned optional dependencies as described in [the runtime guide](complex-cards/runtime.md#install-and-entry-points), then register the adapter:

```js
import { createPlayerStage } from '@digital-card/framework/presentation';
import { dotLottieAdapter } from '@digital-card/framework/presentation/adapters';

const stage = createPlayerStage({
  root: region,
  adapters: [dotLottieAdapter({ wasmURL: '/runtime/dotlottie-player.wasm' })],
});
// Mount a published package with its pinned resolver as in the runtime guide.
// Release the stage when its host component is removed:
stage.dispose();
```

The adapter renders a layer inside the card's normal composition. The player supplies angle/time inputs, surface budgets and lifecycle management; reduced motion stops autonomous playback. Without the required adapter, the card displays its poster. Uploaded assets cannot install the adapter or enable executable code.

This route supports passive vector/keyframe effects accepted by the dotLottie validator. It does not provide arbitrary custom shaders, Lottie expressions or state machines, or a general-purpose WASM compute interface. Python and Go author the portable assets; the installed browser runtime renders them.

## Add a procedural pixel effect

Use the optional [WASM pixel adapter](complex-cards/wasm-pixels.md) when an effect needs custom CPU computation inside a card layer. The host approves an exact program version and module hash; the card supplies bounded numeric parameters. The guide covers the module interface, limits, snapshot capture and revocation. This route is separate from passive vector animation and does not expose arbitrary GPU shader callbacks.

## Install a reviewed browser card renderer

Use `createProgramCardRenderer` to replace a card's visual structure with a host-approved browser program. The Python and Go examples generate custom HTML/CSS and use the framework's bootstrap; the browser does not execute native Python or Go.

```sh
python examples/plugins/python-program-card.py program-output
go run examples/plugins/go-program-card/main.go program-output
```

Review the generated `index.html` and `card.css`, then serve them from a separate, credential-free origin. Serve the framework's `program-bootstrap.js`, `program.js`, `album-display.js`, `opener-display.js`, `editor-display.js`, `collection-display.js`, `media.js` and `data.js` together at that origin's root. Apply the response headers returned by `programHeaders(assetOrigin)` from `@digital-card/framework/presentation/program`, and permit credential-free module requests from the sandbox using `Access-Control-Allow-Origin: *`. Keep the program origin separate from the application and any authenticated services. Uploaded card artwork cannot register a program.

Register the reviewed URL in trusted host configuration and supply the standard renderer adapter:

```js
import { mountFramework } from '@digital-card/framework/ui';
import { createProgramCardRenderer } from '@digital-card/framework/presentation/program-card-view';

const renderer = createProgramCardRenderer({
  registry: new Map([['celestial', {
    approved: true,
    version: '1',
    url: 'https://programs.example/index.html',
    title: 'Celestial card',
    intents: ['select'],
  }]]),
  cards: { dawn: 'celestial' },
  maxActivePrograms: 4,
});
const view = mountFramework(root, { client, cardRenderer: renderer });
// Disable programs while retaining ordinary card display:
renderer.setEnabled(false);
// When removing this host view:
view.dispose();
renderer.dispose();
```

`variants` supplies optional variant-ID overrides for the `cards` map. Only the host chooses and approves programs. The frame receives bounded tilt, reveal and flip inputs; it receives no copy record, private bindings or credentials. The bootstrap exposes those inputs as `--dc-tilt-x`, `--dc-tilt-y`, `--dc-reveal-progress`, `--dc-flip-progress` and `data-dc-side`. A native `button[data-dc-intent="select"]` requests the host's existing selection action when the registry grants `select`.

Programs load within the active-frame limit, which defaults to four and accepts 1–32 per renderer. Each selection map accepts up to 256 entries. Program IDs are 2–100 lowercase letters, digits, dots or hyphens, beginning with a letter. Handshake timeout defaults to 5,000 ms (1–60,000); incoming messages default to 30 per second (1–1,000). `onDiagnostic` receives a fixed error code and the host-selected program ID.

Disabled, unavailable or failed programs use the native renderer. Custom web-compatible logic may use the existing `connectProgram` bridge directly; this generated-asset example does not establish a WebAssembly runtime or replace pack, album or editor-tool contracts.

## Install a reviewed browser pack renderer

Generate custom pack HTML/CSS using either example's pack mode:

```sh
python examples/plugins/python-program-card.py --pack pack-output
go run examples/plugins/go-program-card/main.go --pack pack-output
```

Serve the reviewed output and framework bootstrap on a separate origin with the same headers and module setup described above. Use a distinct registry entry for its URL, then map product IDs through the pack adapter:

```js
import { createProgramPackRenderer } from '@digital-card/framework/presentation/program-pack-view';

const packRenderer = createProgramPackRenderer({
  registry: new Map([['celestial-pack', {
    approved: true,
    version: '1',
    url: 'https://programs.example/packs/index.html',
    title: 'Celestial pack',
    intents: ['select'],
  }]]),
  products: { starter: 'celestial-pack' },
});
const view = mountFramework(root, { client, packRenderer });
// When removing this host view:
view.dispose();
packRenderer.dispose();
```

The adapter replaces pack artwork in the shop and owned-pack list. Host controls switch front/back; selecting the program artwork focuses the normal review or open/replay control without activating it. Purchase review, payment, opening and replay retain their existing host behavior. Reveal progress is cosmetic and follows the authoritative opening result; the frame receives no product, price, ownership or reward records.

Direct calls return `{node, setSide, setPresentationInputs, dispose}` for mapped programs. Native fallback views may omit `setPresentationInputs`. The renderer also provides `setEnabled(boolean)` and `dispose()`, with the same frame, timeout, message and mapping bounds as the card adapter. Disabled, unapproved, failed or unmapped programs retain native pack artwork and preview cards. This replaces pack appearance, not the complete opener view or its command authority.

## Replace the opening view with a reviewed program

Generate a complete opening view with either language:

```sh
python examples/plugins/python-program-card.py --opener opener-output
go run examples/plugins/go-program-card/main.go --opener opener-output
```

Use the separate-origin setup above and also serve `program-opener-bootstrap.js` at the program origin's root. Register the opener display profile and permitted actions:

```js
import { createProgramOpenerView } from '@digital-card/framework/presentation/program-opener-view';

const fields = ['cardName', 'rarity', 'isNew', 'preview'];
const openerView = createProgramOpenerView({
  registry: new Map([['celestial-opener', {
    approved: true, version: '1',
    url: 'https://programs.example/opener/index.html',
    intents: ['opener-reveal', 'opener-skip', 'opener-replay', 'opener-inspect'],
    openerDisplay: {profile: 'dc.opener-display@1', fields},
  }]]),
  programId: 'celestial-opener', displayFields: fields,
});
const view = mountFramework(root, {client, openerView});
// When removing the host component:
view.dispose();
openerView.dispose();
```

The custom region covers opening status, unrevealed slots, revealed cards and reveal/replay controls. The host retains purchasing, pack Open commands and error recovery. Program actions can reveal the next card, reveal all, replay the existing receipt or inspect a revealed card; they cannot request another purchase or opening. Actions identify the current display snapshot, and obsolete actions cannot affect a replacement snapshot.

Only already-revealed cards receive temporary inspection handles and explicitly granted name, rarity, new/duplicate status or raster previews. Unrevealed slots contain only their position and a generic localized label. Receipt, pack, copy and owner identifiers, bindings, codes, purchase terms and raw error bodies are absent. Labels and phase/progress come from the host's localization. Missing or unsupported previews retain text identification.

The [opener display schema](opener-display.schema.json) describes the snapshot. It supports up to 1,000 slots, 100-character card fields, 500-character labels and 2 MiB of encoded metadata. Native `Uint8Array` previews use the same raster limits as album displays: PNG/JPEG/WebP, 256 KiB and 1,048,576 pixels each, 4 MiB and 8,388,608 pixels total. The parent resolves pinned image bytes; it never sends their source URLs or credentials.

The opener retains its frame across reveal updates. The supplied bootstrap preserves control focus when updating its contents. The viewport defaults to 640 pixels and the active-frame limit to one. `setEnabled(false)`, unavailable grants or program failures retain native opening controls; `dispose()` releases the adapter. Existing host-written opener callbacks remain supported. This profile replaces the opening view, not arbitrary application views or server command authority.

## Install a reviewed album layout

The album program profile supplies current album contents to a reviewed custom HTML/CSS layout. Generate the example with either language:

```sh
python examples/plugins/python-program-card.py --album album-output
go run examples/plugins/go-program-card/main.go --album album-output
```

Use the separate-origin setup above and also serve `program-album-bootstrap.js` at the program origin's root. Grant the `dc.album-display@1` profile and each display field explicitly. For example:

```js
import { createProgramAlbumRenderer } from '@digital-card/framework/presentation/program-album-view';

const fields = ['albumName', 'cardName', 'rarity', 'pageName', 'preview'];
const journal = createProgramAlbumRenderer({
  registry: new Map([['celestial-album', {
    approved: true,
    version: '1',
    url: 'https://programs.example/albums/index.html',
    title: 'Celestial album',
    intents: ['select-item'],
    albumDisplay: { profile: 'dc.album-display@1', fields },
  }]]),
  programId: 'celestial-album',
  displayFields: fields,
});
const view = mountFramework(root, { client, layouts: { journal } });
// Choose journal in the album editor's layout selector.
// When removing the host view:
view.dispose();
journal.dispose();
```

Use `albumRenderer: journal` instead to replace the album renderer directly. The program receives a full snapshot of up to 1,000 placements, so it can arrange or paginate them itself. Fields requested by `displayFields` must be granted by the registry. Album and card names, rarity, page labels and image previews are independently optional. The host never sends copy/owner identifiers, bindings, codes, provenance, arbitrary metadata or raw placement data. Temporary handles resolve selection back to the current host copy for ordinary inspection; they are not mutation credentials.

The [display schema](album-display.schema.json) describes the content shape. Runtime validation additionally checks grants, unique handles and positions, page associations, well-formed text and raster limits. Labels allow 100 UTF-16 code units; encoded metadata is limited to 2 MiB. Preview data uses native `Uint8Array` values, not JSON/base64: PNG, JPEG or WebP, at most 256 KiB and 1,048,576 pixels each, and 4 MiB/8,388,608 pixels in aggregate. The parent resolves a validated pinned poster and sends only granted raster bytes; source URLs and credentials never enter the snapshot. Missing, unsupported or over-budget previews retain text identification. Native CSS-only or live card rendering is not automatically converted to a faithful bitmap.

The adapter uses native album fallback for denied grants or invalid content. Its viewport defaults to 640 pixels high and accepts 200–4,096; its active-frame limit defaults to two and accepts 1–32. `setEnabled(false)` disables the program; `dispose()` releases its resources. The standard bootstrap inserts labels as text and manages image object URLs. Custom web-compatible programs can use `connectProgram({onAlbumDisplay})` and `selectItem(snapshotId, handle)` with the same profile, grants and session checks.

## Album appearance

A new native album editor starts with **Private** visibility, **Card gallery**, three columns, an 18-pixel gap and **Cards per album page** 12. Existing albums load their saved values. Columns accept integers from 1 to 12; gap accepts 0 to 100 pixels. **Panorama** forces zero gap. The Public option requires the host's public-album feature. **Additional layout JSON** retains custom data, but artwork and page size must use their dedicated controls.

The default album renderer accepts `layout.appearance` with solid `background`, text `color`, `borderColor`, `padding`, `radius` and `borderWidth`. Colors accept hexadecimal RGB/RGBA, comma-separated integer `rgb()`/`rgba()`, or transparent/black/white/red/green/blue/gray/grey/yellow/orange/purple/pink/brown/navy/teal. RGB channels range from 0 to 255 and alpha from 0 to 1. Padding and radius range from 0 to 100 pixels; border width ranges from 0 to 12 pixels. Omitted properties use the reference styles. Appearance applies to the album grid, without changing ownership or placements.

In the album editor, open **Album appearance & layout JSON**, enter these fields in **Appearance JSON**, then choose **Preview album** and **Save album**. Invalid fields or values prevent saving through this editor. `validateAlbumAppearance` from `@digital-card/framework/ui` supplies the same checks to custom editors.

```json
{"appearance":{"background":"#142321","color":"white","padding":24,"radius":8,"borderWidth":1,"borderColor":"#477766"}}
```

Historical `layout.css` is retained as data. The default renderer migrates supported solid colors and bounded pixel declarations from exact `.dc-album` rules; explicit appearance fields override those values. It never inserts historical CSS as a stylesheet. Other selectors, positioning, transforms, URLs, imports and unbounded dimensions are ignored. Saving from the editor writes the normalized appearance and preserves additional layout/placement data. Invalid historical appearance falls back to reference styling.

Each default album uses its own shadow root and a clipped paint boundary. Trusted host `layouts[id]` or `albumRenderer` replacements are privileged application code and are responsible for their own containment and resource cleanup. Imported album data cannot register those replacements.

The default book renderer also recognizes `layout.pageSize` (1–100) and `layout.artwork`. Cover and spine accept `{src,alt?,design?}`; pages accept `{id,title?,src?,alt?,design?}`. Pages are ordered, have unique stable IDs, and are limited to 100. Descriptions allow 200 UTF-16 code units and titles 100. Image URLs allow HTTP(S) or relative paths without credentials; `design` is a pinned `PresentationReference`.

```js
const book = renderAlbum({
  name: 'Field guide',
  layout: {
    pageSize: 9,
    artwork: {
      cover: {src: '/art/cover.png', alt: 'Field guide cover'},
      spine: {src: '/art/spine.png'},
      pages: [{id: 'forest', title: 'Forest', src: '/art/forest.png'}]
    }
  },
  cards: [{copy: ownedCopy, placement: {data: {pageId: 'forest'}}}]
});
container.append(book);
book.setPage(0);
// When replacing or unmounting this instance:
book.dispose();
```

In book mode, a placement's string `data.pageId` must name an existing page. Omitted or null values use the card's ordinal position and page size. Legacy gallery albums preserve arbitrary placement extensions. The server validates page references on save. The artist editor materializes stable assignments when pages are reordered and blocks deletion of an occupied page.

Default books support independent page controls, keyboard navigation and image failure captions. `renderAlbum` returns a DOM node with `dispose()` and, in book mode, `setPage(index)`. Custom `albumRenderer` implementations may return a DOM node or `{node,dispose}`; the album editor disposes both draft and public previews when replaced or unmounted. Trusted `layouts` replacements retain responsibility for implementing book features they need.

## Install a live Studio panel

A reviewed browser panel can propose selected-layer content and style changes while the artist stays in Studio. Generate the example assets with either language:

```sh
python examples/plugins/python-live-editor-panel.py panel-assets
go run examples/plugins/go-live-editor-panel/main.go panel-assets
```

Serve the generated assets and the framework browser modules from a dedicated HTTP origin, separate from Studio. Apply the headers returned by `programHeaders(assetOrigin)` to the program responses. Review the assets before marking a registry entry approved.

```js
import {mountStudio} from '@digital-card/framework/presentation/studio';
import {createProgramEditorPanels} from '@digital-card/framework/presentation/program-editor-panel';

const fields = ['text', 'color', 'typography.size', 'typography.lineHeight',
  'typography.letterSpacing', 'typography.align', 'opacity'];
const registry = new Map([['type-workshop', {
  approved: true,
  url: 'https://panels.example.test/index.html',
  version: '1.0.0',
  title: 'Type workshop',
  intents: ['editor-propose'],
  editorDisplay: {profile: 'dc.editor-selection@1', fields},
}]]);
const editorProgramPanels = createProgramEditorPanels({
  registry,
  panels: [{id: 'type-workshop', programId: 'type-workshop', fields}],
});
const studio = mountStudio(root, {initialPackage, editorProgramPanels});
```

Select a text layer, adjust its content or appearance, and submit the proposal. Review the proposed values in Studio's own controls before choosing **Apply layer changes**. Apply uses native project validation and creates an undoable edit. Save and reopen through the ordinary Studio workflow. The frame cannot apply or publish changes itself.

The [selection schema](editor-display.schema.json) and [proposal schema](editor-proposal.schema.json) describe the messages. Runtime validation also enforces the selection identity, grants and a 32 KiB encoded bound. Grants control both the selected-layer fields disclosed to a panel and the fields it may propose. Layer identifiers, private metadata, material configuration and asset contents are not part of this projection. Locked selections cannot be edited. A proposal becomes stale when the project revision, selection or panel session changes. Disabling a panel invalidates its pending work; unavailable programs leave the ordinary layer editor usable.

```js
editorProgramPanels.setEnabled('type-workshop', false);
// When the host no longer needs the panel controller:
editorProgramPanels.dispose();
```

The example uses the standard browser bootstrap with `data-editor-field` controls and a `data-editor-propose` button. Custom web-compatible panel code can use the versioned program bridge directly. Python and Go generate the browser assets; this route does not run server-language functions inside the browser. Rich panel layout and client logic remain subject to the reviewed program's origin and content policy.

## Install a declarative Studio panel

A host can install a data-only panel that edits the selected layer's horizontal position, vertical position and rotation. Panel authors can generate the same JSON from Python or Go; they do not need to write a JavaScript panel callback.

Generate a manifest with either example:

```sh
python examples/plugins/python-editor-panel.py > print-layout.json
go run examples/plugins/go-editor-panel/main.go > print-layout.json
```

Load the JSON as host configuration and pass it when mounting Studio. For example, a host that imports JSON through its bundler can use:

```js
import { mountStudio } from '@digital-card/framework/presentation/studio';
import printLayout from './print-layout.json';

const studio = mountStudio(root, {
  initialPackage,
  editorContributions: [printLayout],
  editorContributionGrants: {
    x: { minimum: -1000, maximum: 1000 },
    y: { minimum: -1000, maximum: 1000 },
    rotation: { minimum: -180, maximum: 180 },
  },
});
```

This is the standard host registration; the generated manifest supplies the controls. Select a layer, use the labelled numeric fields, preview the change, then use the editor's undo and save controls. Reopening the saved project preserves the edited layer values. The host must reinstall its panel configuration when mounting a new Studio instance; the card project does not install extensions itself.

The [panel schema](editor-contribution.schema.json) describes the manifest structure; the runtime validator also enforces unique control identifiers and fields, ordered ranges and the encoded-size limit. Each manifest declares `protocol: 'digital-card-editor-contribution@1'`, an `id`, semantic `version`, `title`, and up to eight numeric `controls`. Each control has an `id`, `label`, `field`, `minimum`, `maximum` and positive `step`. Supported fields are `x`, `y` and `rotation`; arbitrary property paths, scripts, styles and asset URLs are not supported. A manifest is limited to 16 KiB, with at most sixteen panels per Studio instance.

Host grants narrow the requested ranges. An explicit grants map enables only its listed fields; omitting the map allows x/y from -1,000,000 to 1,000,000 and rotation from -360 to 360. Existing layer locks and project policy still apply. Labels render as text, and contributions receive no live project object or credentials. Existing JavaScript `panels` callbacks remain a separate trusted host extension mechanism.

## Localize collector workflows

Generate a Spanish bundle with either `python examples/plugins/python-localization.py > collector-es.json` or `go run examples/plugins/go-localization/main.go > collector-es.json`. Each program emits the same data-only contract. Load that JSON as host configuration and validate it before mounting:

```js
import { validateLocalizationBundle } from '@digital-card/framework/localization';
import { mountFramework } from '@digital-card/framework/ui';
import spanish from './collector-es.json';

const bundle = validateLocalizationBundle(spanish);
const view = mountFramework(root, {
  client,
  locale: bundle.locale,
  messages: bundle.messages,
});
```

The host uses its normal JSON loading or bundling mechanism. Locale and messages belong to that mounted instance; different collectors on the same page can use different locales. `renderPack` and `mountOpener` also accept `locale` and `messages` when used independently. Existing explicit `viewLabels` overrides take precedence over translated navigation labels. Custom framework views receive `localization` in their context; pack/card renderer options and the opener view’s third argument also expose the instance formatter. Use it for contributed controls without changing another instance’s locale.

Covered controls include wallet balances and conversion, pack browsing and allocation explanations, quote review, payment and deferred-activation notices, purchase recovery, pack lists, opening and reveal actions, collection filters and selection, favorites and wishlists, trade-up controls, card inspection and comparison, album editing and browsing, trade composition and review, marketplace purchases and raffles, shop and stock controls, account reward history and delivery retries, code history and private reveal controls, trading-policy settings, administration overview, line/pricing controls, people, website settings, activity, review/save and recovery, Studio editing and authoring tools, artwork publishing and card-policy controls, and related status/accessibility text. Catalog names, artwork descriptions, custom metadata and opaque server/controller-provided error messages remain authored content. Artwork text, asset filenames, extension-supplied labels and policy field data remain authored content. Raw redemption codes, provider instructions and policy JSON remain unchanged.

Standalone `renderCollection` from `@digital-card/framework/collection-ui` and `render3DInspector` and `renderComparison` from `@digital-card/framework/inspector-ui` accept `locale` and `messages`, or an existing `localization` formatter. The `renderInspector` and `renderTiltInspector` helpers from `@digital-card/framework/ui` accept the same options. Inspector metadata renderers receive that formatter in their second argument, `{localization}`. Card renderer options also carry it so contributed controls can use the same locale.

The same localization options are available on `renderAlbums` from `@digital-card/framework/collection-ui`, `renderTrading` from `@digital-card/framework/trading-ui`, `renderMarketplace` from `@digital-card/framework/marketplace-ui`, the paginated `renderAlbum` helper from `@digital-card/framework/ui`, `renderFulfillments` and `renderTradingControls` from `@digital-card/framework/marketplace-ui`, and `renderCodeReveal` and `renderCodeHistory` from `@digital-card/framework/code-ui`. Custom code reveal renderers receive `localization` in their options. Standalone `mountAdminPanel` and `renderAdminPanel` from `@digital-card/framework/admin-ui` accept the same localization options. Admin display formatting preserves entered values and reviewed command terms. Hosts that supply their own admin controller can pass `localization` to `createAdminController`; supplied controller messages and previously stored review text are displayed as provided. `renderStudio` from `@digital-card/framework/studio-ui` and `mountStudio` from `@digital-card/framework/presentation/studio` accept the same localization options and pass the formatter to their built-in tools.

A bundle contains `protocol: 'digital-card-localization@1'`, a locale, and a `messages` object. Use the keys and placeholders in the [contract reference](localization.contract.json). Plain messages contain named placeholders such as `{amount}`; plural messages contain an `other` form and optional `zero`, `one`, `two`, `few` and `many` forms. Preserve each key's exact placeholder names. Missing keys use built-in English; English fallback selects English plural forms while displaying numbers in the requested locale. A translated plural key uses that locale's plural rules and falls back to its own `other` form.

Structured server, controller and import diagnostics use the existing message catalog at display time. Custom views can call `localizeDiagnostic(localization, error)` from `@digital-card/framework/localization`; `diagnosticKeys` lists the explicit code-to-message mapping. Known codes select a translated remedy, unknown codes select `diagnostic.unknown`, and missing translations use English. The original error code, message, status and retry identity remain unchanged. Follow the controller's existing recovery action; translated text does not authorize a new command.

Code reveal and trade controllers retain their existing string `error` field and expose an additive `diagnostic` record for presentation. Native and portable views display localized summaries without sending raw diagnostic records to portable programs. Uncoded local validation messages remain as supplied for compatibility. Studio font diagnostics retain their original detailed message beside the localized summary where structured glyph/axis parameters are unavailable. Authored names, code values, trade messages and reviewed command values are not translated.

Bundles are limited to 128 KiB of encoded JSON, 2,048 known keys and 2,048 characters per message form. Validation rejects unknown keys, malformed placeholders and executable values. Translated text is inserted as text, never HTML. Numeric values use locale-aware formatting; timestamps use UTC. Translation does not change stored amounts, purchase commands or permissions.

## Replace the complete collection view with a portable program

Generate a collection layout using either example:

```sh
python examples/plugins/python-collection-view.py collection-output
go run examples/plugins/go-collection-view/main.go collection-output
```

Serve the generated `index.html` and `collection.css` from a reviewed, credential-free program origin using the separate-origin headers described above. Serve `program-collection-bootstrap.js` and its framework module dependencies from that origin as well. Register one explicit host-selected replacement:

```js
import {createProgramCollectionView} from '@digital-card/framework/presentation/program-collection-view';
import {collectionIntents} from '@digital-card/framework/presentation/collection-display';
import {mountFramework} from '@digital-card/framework/ui';

const fields = ['cardName', 'line', 'rarity', 'finish', 'preview'];
const collection = createProgramCollectionView({
  registry: new Map([['collection.example', {
    approved: true,
    version: '1.0.0',
    url: 'https://programs.example/collection/index.html',
    intents: [...collectionIntents],
    collectionDisplay: {profile: 'dc.collection-display@1', fields},
  }]]),
  programId: 'collection.example',
  displayFields: fields,
});
const app = mountFramework(root, {client, views: {collection}});
// When removing the application:
app.dispose();
collection.dispose();
```

The replacement owns the collection layout and controls. It supports owned-card and catalog browsing, search, line/rarity/finish filters, sorting, favorites, duplicates, availability, inserts, discovery counts, paging, selection, comparison, wishlist changes and enabled trade-up recipes. Pages contain at most 48 items; selection can retain up to 24 owned copies across pages. Line, rarity and recipe options have independent search and paging, so large catalogs do not require an oversized snapshot. The selected line and rarity remain available when browsing another option page. The parent performs filtering over the current collection and retains authoritative item identities. Search uses the same card fields as the native collection view; it does not send the underlying metadata unless the host grants that field.

Inspection and comparison use the host's configured renderers. Favorite and wishlist requests use the existing authenticated command path. A trade-up request opens native review; only confirmation of the selected recipe and copies submits the command. The program receives opaque handles and current snapshots, never the client, account credentials, private bindings or arbitrary mutation access. The host rejects stale or busy actions and clears collection state when the account changes.

The [collection display schema](collection-display.schema.json) defines the versioned projection. Display fields are explicit grants; `tags`, `stats` and `metadata` are optional additional disclosures. Previews use bounded raster bytes resolved by the parent. `setEnabled(false)` restores the native collection, and `dispose()` releases the adapter. Invalid or unavailable programs retain native fallback. This adapter replaces the collection section; other application sections and shell navigation retain their existing contracts.

## Replace the complete shop view with a portable program

A portable shop controls product browsing and layout while the parent application owns purchase review and recovery. Generate either complete example layout:

```sh
python examples/plugins/python-shop-view.py shop-output
go run examples/plugins/go-shop-view/main.go shop-output
```

Each generator writes `index.html` and `shop.css`. Serve those files from the program origin, with the public bootstrap at `/program-shop-bootstrap.js` and its module dependencies available at the corresponding relative paths. Install the view through `views.shop`:

```js
import {createProgramShopView} from '@digital-card/framework/presentation/program-shop-view';
import {shopIntents} from '@digital-card/framework/presentation/shop-display';
import {mountFramework} from '@digital-card/framework/ui';

const fields = ['productName', 'line', 'price', 'availability', 'pity', 'allocation', 'rates', 'preview'];
const shop = createProgramShopView({
  registry: new Map([['shop.example', {
    approved: true,
    version: '1.0.0',
    url: 'https://programs.example/shop/index.html',
    intents: [...shopIntents],
    shopDisplay: {profile: 'dc.shop-display@1', fields},
  }]]),
  programId: 'shop.example',
  displayFields: fields,
});
const app = mountFramework(root, {client, views: {shop}});
// When removing the application:
app.dispose();
shop.dispose();
```

Use a reviewed, credential-free program origin with the separate-origin headers described above. Serve the public shop bootstrap and its module dependencies from that origin. The registry grant and requested display fields determine which product details the program receives. Product pages and selected-product rate pages each contain at most 48 entries. Quantities respect each product's maximum, up to 100.

The program can request search, paging, product selection, quantity changes and native review. Opening review does not obtain a quote or prepare an allocation. The first explicit native review action obtains the quote; the next purchase confirmation submits that retained quote through the existing command runner. Recovery, allocation status and acknowledgement remain native controls. Pending commands keep their original identity when retried.

The [shop display schema](shop-display.schema.json) defines the versioned projection. Snapshots expose opaque product handles and approved display data. They do not expose catalog identifiers, wallet balances, quote tokens, command keys, receipts or credentials. Rate disclosures distinguish independent base rates from finite-ticket draws and retain the applicable conditional, code-supply and feasibility explanations. A preview grant permits bounded raster artwork.

The host rejects stale or busy actions and invalidates review when its account, model or program session changes. Disabling the view with `shop.setEnabled(false)` restores the native shop. Program failure retains native fallback, and application recovery controls remain available for pending purchases. Dispose both the application and adapter when removing them.

## Replace the complete trading view with a portable program

A portable trading view presents partner search, permitted inventories, offer trays, currencies, messages and existing offers. The parent retains the trade draft, policy review and authenticated commands. Generate either example interface:

```sh
python examples/plugins/python-trading-view.py trading-output
go run examples/plugins/go-trading-view/main.go trading-output
```

Each generator writes `index.html` and `trading.css`. Serve the generated files from a reviewed, credential-free program origin. The generated HTML loads `/program-trading-bootstrap.js`; serve the public bootstrap at that path and its relative module dependencies alongside it. Apply the separate-origin headers described above.

Register the view with an explicit display grant:

```js
import {createProgramTradingView} from '@digital-card/framework/presentation/program-trading-view';
import {tradingIntents} from '@digital-card/framework/presentation/trading-display';
import {mountFramework} from '@digital-card/framework/ui';

const fields = ['participantName', 'cardName', 'line', 'rarity', 'eligibility',
  'currency', 'message', 'offerStatus', 'dates', 'preview'];
const trades = createProgramTradingView({
  registry: new Map([['trading.example', {
    approved: true,
    version: '1.0.0',
    url: 'https://programs.example/trading/index.html',
    intents: [...tradingIntents],
    tradingDisplay: {profile: 'dc.trading-display@1', fields},
  }]]),
  programId: 'trading.example',
  displayFields: fields,
});
const app = mountFramework(root, {client, views: {trades}});
// When removing the application:
app.dispose();
trades.dispose();
```

The [trading display schema](trading-display.schema.json) defines the projection. Inventory, directory and currency windows contain at most 48 entries; offer windows contain at most 24. Each tray retains up to 100 selected cards, including cards outside the visible inventory window. A snapshot admits at most 48 raster previews within the shared byte and pixel budgets.
Display grants control participant names, card names, line, rarity, eligibility explanations, currencies, messages, offer status, dates and raster previews. The program receives opaque handles and bounded windows. It does not receive account/copy/trade identifiers, inventory versions, offer digests, command keys, credentials or private card bindings. A private partner inventory can still support currency-only offers when the host permits currency trading.

The program edits a parent-owned draft and requests native review. Only native confirmation can authorize sending an offer or counteroffer, accepting, declining or cancelling. Counteroffers preserve the original offer digest and swap the existing offer sides. Changes to the draft invalidate prior review; policy review must remain valid when the command is built. Existing application recovery controls retain the original command after an uncertain response.

Disabling trading prevents new composition, acceptance and counteroffers while retaining outstanding offers and permitted cancellation/decline. Disabling the portable adapter restores native controls. Account, model and program-session changes invalidate stale actions and confirmations; disposing the adapter releases its sessions and rendering resources.

## Replace the marketplace with a portable program

The marketplace adapter shares the host's seller draft, purchase review and recovery path with the native view. A program presents listing and order pages, seller options and ordinary listing fields. Shop creation, listing creation, purchases, raffle entry and cancellation require native review. Action parameters and commerce settings use native editors.

Generate a Python or Go interface, then serve its output from a reviewed, credential-free program origin using the separate-origin headers described above:

```sh
python examples/plugins/python-marketplace-view.py marketplace-output
go run examples/plugins/go-marketplace-view/main.go marketplace-output
```

Each generator writes `index.html` and `marketplace.css`. The generated HTML loads `/program-marketplace-bootstrap.js`; serve the public bootstrap at that path and its relative module dependencies alongside it.

Register the program with an explicit display grant:

```js
import {createProgramMarketplaceView} from '@digital-card/framework/presentation/program-marketplace-view';
import {marketplaceIntents} from '@digital-card/framework/presentation/marketplace-display';
import {mountFramework} from '@digital-card/framework/ui';

const fields = ['listingName', 'description', 'shopName', 'price', 'schedule',
  'availability', 'raffleState', 'sellerFields', 'allocation', 'orderStatus',
  'itemName', 'preview'];
const marketplace = createProgramMarketplaceView({
  registry: new Map([['marketplace.example', {
    approved: true,
    version: '1.0.0',
    url: 'https://programs.example/marketplace/index.html',
    intents: [...marketplaceIntents],
    marketplaceDisplay: {profile: 'dc.marketplace-display@1', fields},
  }]]),
  programId: 'marketplace.example',
  displayFields: fields,
});
const app = mountFramework(root, {client, views: {marketplace}});
// When removing the application:
app.dispose();
marketplace.dispose();
```

The [marketplace display schema](marketplace-display.schema.json) describes listing and order windows of up to 24 entries and seller-option windows of up to 48. Display grants control authored labels, prices, schedules, availability, raffle state, seller fields, allocation disclosures, order status and previews. Snapshots use opaque handles; command keys, quote digests, credentials and authoritative identifiers remain with the host.

Editing a seller draft invalidates its stock review. Ticket-based mint-pack stock retains the existing allocation quote, status and reconciliation controls. An uncertain purchase or listing creation must recover its original command before a new attempt. The portable interface cannot acknowledge an allocation failure or submit a financial command directly.

Disabling the adapter restores native controls. Dispose the application and adapter together to release sessions and rendering resources. Fulfillment administration and trading-policy controls are separate views.

## Compose the application shell

An application shell places native account information, navigation, status, recovery and feature content inside an authored layout. Generate a rail or header layout with either example:

```sh
python examples/application-shell/generate.py rail > shell.json
go run examples/application-shell/generate.go header > shell.json
```

Serve the generated JSON as a static asset, then load it when mounting the application:

```js
import {loadApplicationShell} from '@digital-card/framework/application-shell';
import {mountFramework} from '@digital-card/framework/ui';

const app = mountFramework(root, {
  client,
  navigation: 'tabs',
  shell: loadApplicationShell('/shell.json'),
});
await app.shellReady;
// Restore the default layout:
await app.setShell(null);
// When removing the application:
app.dispose();
```

The [application shell schema](application-shell.schema.json) defines nested rows, columns and grids, literal headings and text, native regions and responsive layout properties. A manifest contains at most 64 nodes, reaches at most eight levels and occupies at most 32 KiB of JSON. Static strings are limited to 500 characters. Colors use approved theme tokens; arbitrary HTML, executable code and asset URLs are not accepted.

Content, status, recovery and overlays are required regions. Account, balances and statistics can be placed separately or omitted. Native navigation remains filtered by the authenticated account's available sections. Navigation still observes administrator leave checks, and recovery still uses the original host-owned command. The layout cannot authorize a transaction or suppress its native confirmation.

Include navigation when using tabs with two or more available sections; otherwise the framework restores the default layout. Navigation groups may reorder and label available sections. Available sections omitted from the groups are appended automatically.

Use `layout` for base properties, `narrow` for viewport widths up to 760 pixels, and `wide` for widths from 761 pixels. Gap and padding accept integers from 0 to 64 pixels; grids accept one to twelve columns. Responsive properties can also change a container's flow between row, column and grid.

Keep the overlays region as the final direct child of the root container. The framework places native overlays outside authored layout containers so dialogs are not clipped by the layout. Invalid or failed shell loads restore the default layout. Replacing the shell preserves the application's active section and native regions; disposing the application prevents late loads from installing a layout.
