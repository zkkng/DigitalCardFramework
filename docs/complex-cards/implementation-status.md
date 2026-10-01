# Runtime implementation coverage — 1 October 2026

The portable implementation is under `src/presentation`. The broader design is a roadmap, not a claim that every media standard or production integration is complete.

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

## Verification

Repeatable tests live in `test/presentation*.test.js`, `test/access.test.js`, and the existing core suite. They cover archive integrity/bombs, schema references, idempotent storage, failed policy decisions, signatures, bounded motion, real catalog acquisition/trade pinning, custom effects and headless publication. Browser scripts exercise migrated visuals, studio export/drafts/masks, three real optional adapters, a video back, early disposal, context recovery, reduced motion, PSD/ORA/ZIP import and separate-origin program rejection.

The resumed audit expanded verification from 95 to 137 Node tests, added a standalone synthetic browser suite and CI matrix, and found/fixed lifecycle, budget, mask, import and creator races. See the [full audit, requirement matrix, remaining gaps and repeatable commands](audit-2026-10-01.md). Edge, Firefox and WebKit pass the tested WebGL2 subset; physical iPhone qualification remains open. Reports and screenshots live outside source Git in `outputs/PortableCardQA`.


## Explicit limits

See [runtime](runtime.md) for rendering and lifecycle limits, [creator API](creator-api.md) for source-format compatibility and publication semantics, and [access](../access-and-identity.md) for account/admin scope. No KHR_interactivity, Live2D rig adapter, arbitrary Photoshop fidelity, automatic role-management console, mint/bridge system, production multi-tenant storage, or independent security audit is claimed.

Native media sanitization, production identity-provider configuration, external storage/CDN and a host's authoritative publishing API remain deployment integrations. The static reference demo is not a publicly writable catalog server. Experimental APIs are version-pinned; do not describe them as a universal established card standard.
