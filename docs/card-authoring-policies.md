# Text, stats, reusable templates and card policies

Available in the 0.2.0 development build. These APIs remain experimental. Policy documents use schema version 1; advanced typography advertises the required player capability `dc.text@0.2`.

## Create a card

Open **Creator studio → Open visual card editor** and select a card or variant. Existing hosted designs reopen as editable packages. **Start a new card design** uses the destination's default template when configured. The standalone `mountStudio` component also works without a catalog.

Use **Add text** for a title or body layer. Select it to change font, size, spacing, alignment, colors, outline, shadow, language, direction and overflow. Arrange either face with duplicate, group, align, snap, lock and order controls. Undo/redo includes these changes.

**Add custom font** embeds a WOFF2, WOFF, TTF or OTF face. Use files you may redistribute with the card. Upload static bold/italic faces as their actual font files; variable fonts expose their supported axes. Embedded faces render from their outlines in preview and posters. Missing glyphs and loading failures produce diagnostics; the supplied poster remains the fallback. System fonts are available for drafts, but strict overflow policies require embedded fonts for authoritative measurement.

Overflow choices are wrap, shrink down to a minimum, ellipsis, clip, or grow vertically. Truncation remains reported overflow: a policy requiring complete text rejects it. Styled spans accept JSON with text, color, weight, style and an image asset ID as an inline icon. The selected face and axes determine the actual glyph shapes. Reading order supplies the player's accessible text description.

In **Card stats**, enter policy-defined values or define a custom field. Add an individual stat or use **Add all public stats as a table**. Select a bound layer to choose text, badge or bar presentation. Zero, null and absence are distinct. CSV uses `scope,key,value` columns and JSON-encoded value cells; an empty value cell removes the field. Imports validate the whole change before applying it.

Boolean and enumeration controls start with **No value** for an absent field. Nullable fields offer **Set … to null**; clearing a field removes it. Select a bound layer to change its public card/variant source, label, unit, missing-value text, number locale and decimal places. Bar layers also expose minimum and maximum. These properties format the value without changing its authoritative source. Locked layers require unlocking before text or style edits.

Open **Card policy** to review errors and their governing rule/policy references. Activate a field error to open **Card stats** and focus its control; activate a layer error to select its face and open its typography controls. Required and invalid values have accessible error descriptions. Embedded-font layout diagnostics cover both faces, including overflow rejected by the destination policy. System-font layout still needs server validation; editor diagnostics do not approve publication.

Overflow errors identify their face. When another rule identifies a layer ID reused on both faces, choose the face in the layer-selection dialog. Layer IDs containing periods are preserved in navigation.

Save `.dcproject` for editable source and local draft data. Exported `.dcard` files omit declared private fields/values and unused source assets. Public art supports card/variant snapshots; private and per-copy data belong in an authorized host view. Capture posters after editing so the fallback depicts the same revision.

## Reuse a design

**Save card as template** records a versioned composition. **Save clipping mask** and **Save effect mask** preserve those distinct uses. Masks use normalized layer-local coordinates, including after cropping; resizing a target scales the mask. Image masks retain their pixels and inversion. **Save reusable text style** includes its embedded font dependency.

Personal items live in this browser's IndexedDB. Export/import library JSON to move them between browsers. Administrators can **Share** immutable library revisions. Shared packages pass content validation before registration.

Applying a template shows the layers that will change. Editable text, bindings and compatible artwork slots are preserved; fixed properties come from the selected revision. Application rejects a draft changed since its preview. `previewTemplateBatch` offers the same dry run for multiple projects through the public authoring API. Published cards never follow later library changes automatically.

Default templates protect layer order, nesting, transforms, masks and slot dimensions. Lock a layer before saving to protect its remaining properties. Administrators can use the resource JSON contract to define `slots[].bounds`, `slots[].fixed`, protected asset digests and an explicit structure. These are structural checks, not proof of artistic similarity or detection of private information painted into an image.

## Set administrator policy

Open **Administrator card policies**. Edit/import a document, save a draft, assign it, preview its impact, review the changes, and activate. Active contents are immutable: create another revision to change them.

The document supports:

- Typed integers, numbers, strings, booleans, arrays and objects; required/conditional fields, ranges, choices, precision, defaults and fixed values.
- Card, variant and copy scopes; public, owner and operator visibility; author, administrator, provider and calculated sources.
- Allowed templates/sets, defaults, approved fonts, embedded-font requirements, minimum size, overflow rejection and required stat displays.
- Inherited policies, immutable references, assignments and explicit priorities.

Save a template set in **Shared template sets and resources**. Reference it from `requirements.templateSets` and select an allowed member in `defaults.template`. Approved fonts use `sha256:<font asset hash>` or a system family name. A typography default's font asset ID must exist in the chosen template.

Requirements accumulate and may tighten. Defaults resolve in installation, card-type, line, then variant order. Higher priority wins within a scope; contradictory defaults at equal priority fail. Defaults replace whole values rather than implicitly concatenating arrays. Empty intersections, incompatible fixed rules, cycles and calculations exposing private dependencies block activation.

Impact previews identify existing variants needing changes before their next publication. Current publications and copies retain their recorded content. Retire unused policies/resources to stop selecting them for new work; required dependencies cannot be retired. Restore retained revisions and preview another assignment to roll back future rules. This does not reverse transactions. Remove retained private values before republishing under an undefined/public replacement field.

## Integrate or replace the interface

Run `node examples/card-policies.mjs` for museum-postcard metadata, activation, rejected values and stale-review handling. `python examples/card-policy-document.py` emits a language-neutral policy. The [JSON Schema](card-policy.schema.json) and [OpenAPI contract](openapi.json) describe wire inputs; runtime validators also enforce references and authority.

Public exports include `./card-policy`, `./card-policy-schema`, `./presentation/authoring-tools`, `./presentation/text`, `./presentation/stats-csv` and `./card-policy-ui`. `mountStudio` accepts an asynchronous replacement library, destination `policyProvider` and custom panels. Libraries implement `list/get/put`; `share` is optional. Panels receive the project, selection, side, transactional edit and rebuild callbacks. Return `{element, dispose}` for a panel needing cleanup; disposal runs before rerender and unmount.

`addStatBlock(project, side, [{key: "score", scope: "variant"}])` creates an explicit snapshot binding. String keys remain supported when they identify exactly one field; keys shared by multiple scopes require an explicit reference. All requested fields are checked for scope and public visibility before adding layers.

The backend resolves trusted catalog destinations. Preview, import commit and direct publication share validation. Commit carries the returned `policyRevision`; a changed registry/catalog needs another review. Retry keys are bound to the authenticated principal. Content imports cannot install policies. CLI apply also requires `--policy-revision` from the reviewed preview once policies have changed.

Custom presentation stores must call `framework.registerCardPresentation(actor, archive)` from `validatePublication` before exposing an archive. Both supplied hosts wire this gate. Immutable file publication and catalog commitment are separate operations: an unreferenced package does not issue a card. Preserve referenced content and database backups together; use store retention for unreferenced packages.

Grants include `card-policies.read`, `card-policies.manage`, `catalog.preview`, `catalog.publish`, `art.import`, `art.publish` and `card-stats.provide`. Copy updates enforce pinned field source and copy version. `issuedStats` remains immutable; `stats` holds current authorized values with `statsUpdatedAt`. Required copy fields need valid issuance defaults. Provider adapters use the same HTTP command; expressions never execute arbitrary code.

## Limits and verification

Fonts are limited to 8 MiB, 256 tables, 16 MiB declared expansion and 65,535 glyphs. Faces accept at most 50,000 text characters; total embedded fonts are limited to 32 MiB. Scene/package/GPU budgets also apply. Server font/text analysis runs in a worker with a 15-second deadline and a 128 MiB old-generation heap limit. Expressions have bounded depth/operation counts and finite numeric results. Library revisions and registered presentations have installation limits; plan capacity before reaching them.

Automated checks cover editing, policy/privacy boundaries, portable round trips and GPU lifecycles. CI includes Chromium, Firefox and WebKit. Physical touch devices, screen-reader usability, every complex-script font and arbitrary mixed-direction styled paragraphs still need release qualification. Check representative content in the target browser before approving a production font/template set.
