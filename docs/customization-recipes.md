# Executable customization recipes

The reference UI uses the same exports as adopters. examples/alternate.js demonstrates a different page order, theme, card back, metadata panel, horizontal album and a fully replaced modal opener. Run the demo, buy a pack, and visit /alternate.

## Appearance, labels and assets

mountFramework(root,{theme,css,...}) installs scoped defaults. Supported tokens: --dc-bg, --dc-panel, --dc-text, --dc-muted, --dc-accent, --dc-border, --dc-radius, --dc-card-ratio, --dc-font. css is trusted host CSS, applied after defaults. Host selectors should stay within the supplied root's class. No global body reset or key handler is installed.

Catalog card names, line names, rarity names, product names and currency names supply default display labels. To replace navigation/control labels and markup, replace the relevant view or compose your own client/controller UI. The current default controls use English; a translation registry is future work.

Default precedence is default CSS < host theme/CSS < explicit card/variant asset references. Variant back overrides definition back, which overrides the CSS back. A supplied backRenderer replaces asset/default back markup. There is no automatic deep merge of arrays: sections explicitly replaces the default order.

## Reorder, insert or remove features

sections:['collection','albums','wallet','shop'] hides pack/trade sections and rearranges the remaining sections. A sections entry may be a callback (model,{client,inspect,refresh}) returning a host DOM node. This inserts or replaces any whole section. The host can instead mount only mountOpener inside a sidebar, modal or existing page.

## Replace one part

cardRenderer(copy,options), backRenderer(copy), metadataRenderer(copy), albumRenderer(model,options) and openerView(state,controller) are single explicit host selections. Choose one implementation at composition time; there is no import-order registry. A wrapper can call renderCard or renderAlbum then add trusted controls. Copy models and receipts are detached objects.

examples/alternate.js provides backRenderer and metadataRenderer using textContent through element(). Replacements must preserve usable focus, keyboard/touch access, labels and reduced motion.

## Replace the whole opener

createRevealController({open,key}) provides getState, subscribe, load, reveal, skip, replay and dispose. States are idle/loading/ready/revealing/complete/error. ready arrives only after the authoritative opening result. revealed is presentation progress. Complete/skip/replay never changes the allocation.

mountOpener(root,{controller,view}) subscribes to that controller. view returns a DOM node, or {node,dispose} for a custom view with external resources. Dispose runs before replacement and unmount. Subscribe returns an unsubscribe function; dispose invalidates outstanding loads. examples/alternate.js renders all results instantly in a host-owned dialog. This does not grant new cards.

## Replace the album and all CSS

saveAlbum stores layout:{id,columns,gap,...customData} plus ordered placements with per-placement data. The default renderer recognizes columns/gap only. renderAlbum(model,{layouts:{journal:renderer}}) selects a trusted registered layout when layout.id is journal. Alternatively supply albumRenderer to replace the entire album, as the alternate example does.

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
