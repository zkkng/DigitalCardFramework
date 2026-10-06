# Content authoring and bulk imports

Version 0.2.0. All definitions are generic. A line groups subjects; a card defines a subject; a variant defines rarity/finish/edition; an owned copy contains identity, source, opener, time, serial, snapshot, bindings and current ownership.

## Import workflow

Creator studio accepts JSON/YAML files or pasted content. Select merge or complete replacement, validate/preview, inspect changes/warnings/card previews, then explicitly review and publish. The server requires operator authority, a current base version and SHA-256 digest of the exact validated manifest. Edits invalidate review. No asset files are uploaded by this importer.

For the CLI:

```sh
node tools/content.js preview --database data/demo.sqlite --file examples/imports/moonbridge.yaml --mode merge
node tools/content.js apply --database data/demo.sqlite --file examples/imports/moonbridge.yaml --mode merge --digest DIGEST_FROM_PREVIEW
node tools/content.js export --database data/demo.sqlite --file exported-catalog.yaml --format yaml
```

For encrypted databases, supply the same key environment/file configuration as the host, for example `node --env-file=.env tools/content.js ...`. Operator exports may contain private binding definitions; keep them protected.

Merge accepts arrays for currencies, lines, rarities, cards, variants, products, recipes, combinations and displayFields. Each supplied row replaces the whole existing row with that ID; omitted rows remain. Features and metadataSchemas merge by key. The version defaults to base+1. Replacement supplies the complete catalog with a higher version. Use replace for initial publication.

Published currency/line/rarity/card/variant/product/recipe IDs are retained. Card line identity and variant card/rarity/finite cap cannot change. Changed products must increase their product revision. Retire products/variants with `enabled:false`; existing copies remain inspectable from their original snapshots. Asset URLs can change for future definitions, but stable versioned URLs are recommended so existing copies keep their intended artwork.

JSON duplicate keys are rejected. YAML uses the core schema with duplicate checks and aliases disabled; warnings/unknown tags fail. Input is bounded plain JSON-compatible data: no prototype keys, cycles, excessive nesting, nonfinite numbers or executable code. Import source/HTTP operator bodies are capped at 8 MiB; JSON escaping contributes to request size. Each section has at most 20,000 rows and the complete validated manifest also has structured data limits.

## Pack front, back and reveal artwork

In Creator studio, choose **Pack artwork** under **Design destination**, select a pack, and open the visual pack editor. Build the front with the existing image, text, mask and material tools; use **Front / back** to edit the reverse. Add an optional **Pack reveal artwork URL** and description, capture posters, then publish the reviewed pack artwork revision. The editor retains the editable `.dcard` design reference and publishes both captured posters. Reopening that pack retrieves the saved design.

For an existing asset workflow, import `products[].artwork` with `front`, `back`, `reveal` and `alt`. Image references accept relative or HTTP(S) URLs without embedded credentials. An optional `design` uses the existing pinned digital-card reference contract. Artwork changes require an increased product revision. Already allocated packs retain their product and artwork snapshot; keep those asset URLs stable and retain referenced design digests when cleaning presentation storage.

```json
{"artwork":{"front":"/demo/art/dawn.svg","back":"/demo/art/cloud.svg","reveal":"/demo/art/aurora.svg","alt":"Sky Atlas illustrated pack"}}
```

The runnable Sky Discovery product in `examples/catalog.js` uses these three image surfaces. Discover shows the front and offers a back view. My packs and its reveal use the owned pack's snapshot. Missing or invalid images fall back to the default pack artwork or omit the optional reveal image; purchasing and revealing remain available.

## Creator-defined fields

`cards[].stats` and card/variant/copy metadata are plain objects. Namespaced fields avoid collisions. Card definitions and their metadata are public. Sensitive codes belong in owner-only bindings, not stats/metadata.

Optional `metadataSchemas.card`, `.variant` and `.stats` validate corresponding metadata/stats across the catalog. The local subset supports type, properties, additionalProperties, required, items, enum, minimum/maximum, minLength/maxLength, minItems/maxItems, description and title. External references, regular expressions and executable tags are unsupported. Schema documents have a 16 KiB cap and bounded depth/nodes. Unknown keywords fail.

```json
{
  "metadataSchemas": {
    "stats": {
      "type": "object",
      "properties": {"attack": {"type": "integer", "minimum": 0, "maximum": 999}},
      "additionalProperties": true
    }
  },
  "displayFields": [{"id":"combat.attack","path":"stats.attack","label":"Attack","type":"number"}]
}
```

Display fields label flat `stats.*`/`metadata.*` entries in the default inspector. Nested objects remain structured data and render as JSON text. Replace `metadataRenderer` or the whole inspector for a specialized stat panel. No default game combat rules are imposed.

## Layered faces and backs

[Moonbridge YAML](../examples/imports/moonbridge.yaml) and [JSON](../examples/imports/moonbridge.json) are equivalent executable patches. A card supports up to 24 ordered layers:

```json
{"id":"foreground","src":"https://content.example/card/foreground.webp","depth":22,"opacity":0.9,"blend":"screen","effect":"emissive","crop":{"x":0,"y":0,"width":0.5,"height":1}}
```

Sources are relative or HTTP(S) references without embedded credentials. Production content policy permits your configured HTTPS asset origins. Embedded data URLs and script URLs are rejected. Depth is bounded to -100..100; opacity to 0..1. Blend supports normal/screen/multiply/overlay; effect supports none/emissive. Crop uses normalized image coordinates and must remain within the source image. Prepare transparent assets, masks and padding in your content workflow.

Card `appearance.background` controls the default face background. Card or variant `back` references an image; variant back overrides card back. Host `backRenderer` overrides both. Without an asset/renderer, the framework supplies a procedural back. Variants support standard/gloss/holo/foil and `effectMask` to limit the finish overlay.

Pointer tilt/parallax changes layer offsets. The inspector's orbit rotates the front/back surface and supports flip, zoom, reset and arrow keys. Shared inspection rotates a group. CSS presentation does not reconstruct hidden art or volumetric geometry. Hosts can replace card/inspector/comparison renderers for WebGL or another player.

## Combinable cards

Combination manifests reference card definitions and grid cells. They do not consume, mint, merge or change ownership.

```json
{"id":"panorama","name":"Shared landscape","columns":2,"rows":1,"gap":0,"pieces":[{"cardId":"left","column":0,"row":0},{"cardId":"right","column":1,"row":0}]}
```

Use unique card IDs/cells, 2..36 pieces and 1..12 rows/columns. The default collection selects up to 24 copies for shared inspection. An incomplete combination displays missing cells. For a seamless image split, left/right layers can reference one source with matching normalized crops; the bundled Horizon pair demonstrates this through the public catalog and renderers.

## Packs, odds and optional policies

Products define line, revision, price/currency and weighted slots. Pool weights are integers; finite supply counts allocations, including sealed copies. Advertised weights are the base distribution. Exhausted variants and duplicate policy change eligible outcomes; there is no guarantee of an outcome with zero remaining supply. Purchase commits allocation atomically, then visual reveal can skip/replay without rerolling.

Optional product `availableFrom`/`availableUntil` are validated date strings; use ISO 8601 UTC timestamps for consistent publication. Optional `pity:{after,rarityId}` guarantees that rarity rank or better in the first slot when the threshold is reached; the first pool must contain an eligible outcome. Pity counts purchased allocations, including sealed packs, per collector/product and resets on qualifying outcomes. Retries do not advance it twice. Exhaustion still rejects atomically.

Recipes define input count, matching criteria and weighted outputs; they are optional and remain framework data. Binding factories and transfer policies are trusted host code. External redemption/delivery requires an explicit host adapter.
## Album cover, spine and pages

In **Albums**, open **Cover, spine & pages**. Enter HTTP(S) or relative image URLs and descriptions for the cover and spine. Add pages, give them titles and background images, and set **Cards per album page** from 1 to 100. Choose cards, then use each card's page selector to place it on a named page or in automatic order. Preview the book and navigate with the page controls or arrow keys while the book has focus.

Reordering pages preserves cards on their original page through stable page IDs. Removing a populated page is blocked until its cards are moved to another page or explicitly returned to automatic order. Export and import retain custom layout and placement data; unknown page assignments reject before replacing the draft. Albums without artwork or page size continue to use the original gallery.

Artists with catalog publication access can choose **Design album cover**, **Design album spine**, or **Design page** to open the portable visual editor. Canvas dimensions are editable from 200 to 4096 pixels. Capture posters, then publish the artwork to add its poster and pinned editable design reference to the album draft. **Save album** is a separate action. Opening the design again restores its editable package.

Artwork publication registers public files. A private album protects its layout and cards, but does not make image URLs or published design packages private. Use artwork suitable for public distribution; the editor starts a generic artwork canvas and does not automatically include private album names or card contents.
