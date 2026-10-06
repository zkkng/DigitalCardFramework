# Executable customization recipes

The reference UI uses the same exports as adopters. examples/alternate.js demonstrates a different page order, theme, card back, metadata panel, horizontal album and a fully replaced modal opener. Run the demo, buy a pack, and visit /alternate.

## Appearance, labels and assets

mountFramework(root,{theme,css,...}) installs scoped defaults. Supported tokens: --dc-bg, --dc-panel, --dc-text, --dc-muted, --dc-accent, --dc-border, --dc-radius, --dc-card-ratio, --dc-font. css is trusted host CSS, applied after defaults. Host selectors should stay within the supplied root's class. No global body reset or key handler is installed.

Catalog card names, line names, rarity names, product names and currency names supply default display labels. To replace navigation/control labels and markup, replace the relevant view or compose your own client/controller UI. The current default controls use English; a translation registry is future work.

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
| Visual offers | `renderTrading` and `createTradeDraft({client,userId,catalog,storage,initial,parentTradeId})` | Reference trade desk; controller/privacy/review/counter tests |
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

`createTradeDraft` exposes subscribe/getState/load/more/add/remove/setCurrency/setMessage/review/buildOffer/clear/dispose. Edits clear review. Loads ignore obsolete recipients and late completion after disposal. A disposed draft cannot start reads, clear saved drafts, attach listeners or build an offer. Built offers include copy versions. Saved drafts contain IDs/intentions, not card snapshots or binding codes. The authoritative server still validates every transfer.

`action(fn,{refreshAfter,message})` serializes UI actions, reports errors and refreshes committed models by default. `mutate(command,input)` uses a persisted idempotency key and coalesces identical in-flight intentions. Mutations fail before dispatch when Web Storage is missing, blocked or corrupt. Recover the original result before beginning a new identical intention; use `mutate.beginNew` for that deliberate new operation. Account change and unmount dispose the runner. Never reroll committed results based on presentation completion.

`CardFramework({limits})` accepts users/copies/packs/requests/albums/trades/copiesPerUser/packsPerUser positive integer caps. `policies.canTransfer` is a synchronous eligibility veto. Named `bindings` factories synchronously generate copy data before commit. A custom store implements synchronous detached `read(fn)`, atomic `transact(fn)` and `close()`. Async/network work inside a transaction is unsupported.

A production `HOST_MODULE` exports any of bindings, policies, limits, sessionOptions, rateLimits, rateLimiter, identityProvider or handleStatic. `sessionOptions.maxSessions` controls the bounded active session/challenge capacity. `identityProvider.begin()` returns `{url,data}` for the login challenge; `finish(callbackUrl,data)` returns a verified `{issuer,subject,displayName}`. This module is trusted server code. The default OIDC provider and public imports remain separate. `test/host.test.js` supplies an executable fixture module and exercises the real host.

Portable presentation packaging has its own public contract/status. It can be integrated through the card/inspector replacement boundaries after its independent conformance gates pass.

## Album appearance

The default album renderer accepts `layout.appearance` with solid `background`, text `color`, `borderColor`, `padding`, `radius` and `borderWidth`. Colors accept hexadecimal RGB/RGBA, comma-separated integer `rgb()`/`rgba()`, or transparent/black/white/red/green/blue/gray/grey/yellow/orange/purple/pink/brown/navy/teal. RGB channels range from 0 to 255 and alpha from 0 to 1. Padding and radius range from 0 to 100 pixels; border width ranges from 0 to 12 pixels. Omitted properties use the reference styles. Appearance applies to the album grid, without changing ownership or placements.

In the album editor, open **Album appearance & layout JSON**, enter these fields in **Appearance JSON**, then choose **Preview album** and **Save album**. Invalid fields or values prevent saving through this editor. `validateAlbumAppearance` from `@digital-card/framework/ui` supplies the same checks to custom editors.

```json
{"appearance":{"background":"#142321","color":"white","padding":24,"radius":8,"borderWidth":1,"borderColor":"#477766"}}
```

Historical `layout.css` is retained as data. The default renderer migrates supported solid colors and bounded pixel declarations from exact `.dc-album` rules; explicit appearance fields override those values. It never inserts historical CSS as a stylesheet. Other selectors, positioning, transforms, URLs, imports and unbounded dimensions are ignored. Saving from the editor writes the normalized appearance and preserves additional layout/placement data. Invalid historical appearance falls back to reference styling.

Each default album uses its own shadow root and a clipped paint boundary. Trusted host `layouts[id]` or `albumRenderer` replacements are privileged application code and are responsible for their own containment and resource cleanup. Imported album data cannot register those replacements.
