# Supported portable card capabilities

The portable implementation is under `src/presentation`. The supported profiles and limitations below define its scope.

## Implemented

- Versioned, deterministic ZIP package, canonical integrity index, bounded parsing/decompression, declared dependencies and verified selective asset loading.
- WebGL2 shared stage; images, groups, text, masked local materials, angle expressions, registered pose frames, video/audio lifecycle, poster fallback, quality budgets and context recovery.
- Actual optional Three/embedded-GLB, approved-Rive and passive-dotLottie adapters; separate-origin approved-program bridge; SIWE/external ownership adapter; signatures and multi-card assembly.
- Creator studio, undo/redo, masks, custom flake silhouettes, material presets, motion JSON, frame imports, local drafts and export. One-image creation plus PSD/ORA/layered-ZIP import with compatibility reports.
- Public headless authoring pipeline, replacement importers/effect recipes, programmatic exact material properties, batch build, two-phase presentation/catalog publication, CLI and Fetch-style import endpoints.
- Immutable presentation references in catalog and issued-copy snapshots, poster grids and interactive inspectors, alternative standalone host composition.
- Durable bounded import jobs, authorization callback, scanner boundary, atomic content publication, quarantine and retention review.
- Granular server administrative permissions, replaceable identity/access mapping, default collector restrictions and current-session permission revocation.
- Two companion cards migrated using approved artwork outside Git; accurate renderer-generated face posters. Generic source stays separate from the host-specific integration tools and media.

## Explicit limits

See [runtime](runtime.md) for rendering and lifecycle limits, [creator API](creator-api.md) for source-format compatibility and publication semantics, and [access](../access-and-identity.md) for account/admin scope. No KHR_interactivity, Live2D rig adapter, arbitrary Photoshop fidelity, automatic role-management console, mint/bridge system, production multi-tenant storage, or independent security audit is claimed.

Native media sanitization, production identity-provider configuration, external storage/CDN and a host's authoritative publishing API remain deployment integrations. The static reference demo is not a publicly writable catalog server. Experimental APIs are version-pinned; do not describe them as a universal established card standard.
