# Repository boundaries

Confirmed user requirement: all framework development is tracked in Git and pushed to GitHub. Artwork is excluded. host-specific integration is a separate GitHub repository.

The framework owns generic catalog, pack, ownership, collection, album, transfer and extension logic; configurable presentation; adapter interfaces; schemas; migrations; tests; and documentation. Generic test fixtures contain structured data and references, not production artwork.

The integration owns host-specific account mappings, configured currency operations, game reward delivery, server bridge code, deployment wiring and host configuration. It depends on a documented framework release or pinned revision. The framework must not import integration code or depend on host-specific running.

Artwork lives in external content storage or independent content workspaces. Manifests reference assets through configured providers. Neither repository should receive generated paintings, sprite sheets, original game data or asset archives by copying this demo checkout.

Develop in the correct repository from the start. Commit meaningful work and push it to that repository's configured GitHub remote. Never call a local commit pushed without verifying the push succeeded. Record blocked publication explicitly when a destination or authentication is missing.

Any shared behavior discovered during integration is implemented in the framework and consumed through a versioned contract. Host behavior remains in the integration. Verify dependency direction during reviews. Document breaking changes and compatibility rather than silently copying framework internals into the host repository.

The current art demo and its Sites source are presentation research, not the framework repository. Framework-bound reusable code must be deliberately extracted and generalized; artwork must remain outside.
