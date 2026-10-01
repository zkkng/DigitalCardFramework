# Research decisions: open card creation

Reviewed 1 October 2026. These are engineering interpretations of the cited primary work, not claims that a paper validates this implementation.

## Explicit variation points

The Software Engineering Institute's [Variability in Software Product Lines](https://www.sei.cmu.edu/library/variability-in-software-product-lines/) explains the need to plan and manage variation mechanisms consistently. Applied here: use a small set of named interfaces for import, effects, rendering, catalog authority and storage. Do not introduce a fresh plugin framework for each feature. Configuration handles common choices; installed code handles new behavior. This reduces accidental combinations and makes limits explainable.

## Contracts belong to the host

Eclipse's [Notes on the Eclipse Plug-in Architecture](https://www.eclipse.org/articles/Article-Plug-in-architecture/plugin_architecture.html) describes host-defined extension points, callback contracts and declarative contributions. Applied here: host-installed effect recipes expand to validated portable data; adapter requirements are declared, and uploaded cards cannot register executable modules. Default behavior is exposed through the same public interfaces available to adopters. Explicit selection resolves competing replacements.

## Services need lifecycle semantics

The [OSGi Core 8 service-layer specification](https://docs.osgi.org/specification/osgi.core/8.0.0/framework.service.html) separates service interfaces, registration and lifecycle. Applied here: renderer adapters publish an API version, estimate resources, initialize with cancellation, update/render, and dispose. The composition root owns implementations and cleanup. We do not need OSGi's entire dynamic container to obtain those benefits.

## Chosen boundaries and rejected excess

- Public commands can be called by UI, scripts, a game or a job runner. Observational events report outcomes; injected strategies control them.
- Creation and presentation never take ownership authority from the collection/trading core.
- Effect recipes are convenient authoring macros. The saved artifact uses a stable scene/material schema and declared adapter capabilities.
- Raw JPG, layered source, and advanced imported media converge on one package/player contract.
- Domain transaction hooks remain separate from visual animation callbacks. Skipping or replaying an opening cannot allocate a second pack.
- No global mutable service locator, untrusted plugin marketplace, arbitrary hook around every private function, or generated option for every future idea.
- A compatibility claim requires an executable alternate composition. Current tests exercise a replacement effect recipe and headless pack publication into the real core; browser checks exercise multiple host layouts and adapter disposal.

## Interchange choices

[OpenRaster's file layout](https://www.openraster.org/baseline/file-layout-spec.html) and [layer-stack specification](https://www.openraster.org/baseline/layer-stack-spec.html) provide an existing ZIP/PNG/XML interchange path. Our import profile is narrower than the whole standard and reports compositing mismatches. [ag-psd's documented limitations](https://github.com/Agamnentzar/ag-psd) guide the bounded PSD profile. [Live2D's model3 format](https://github.com/Live2D/CubismSpecs/blob/master/FileFormats/model3.json.md) references rig/runtime components, so it is a separate adapter opportunity rather than a synonym for a layered image.

See [creator API](creator-api.md) for executable contracts and [runtime guide](runtime.md) for operational limits.
