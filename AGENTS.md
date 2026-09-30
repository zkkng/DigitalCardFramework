# Repository instructions

- This is the reusable digital card framework repository.
- Keep MapleStory/Quiet Grove host logic in the separate integration repository.
- Keep every art asset and game data file outside this repository. Use structured manifests and configurable asset references.
- Preserve generic accounts, currency providers, card subjects and namespaced bindings.
- Read docs/customization-architecture.md before feature work. Each feature needs a documented customization contract and a public-API example; verify alternative composition without editing core. Keep headless logic separate from default UI and host wiring.
- Commit framework changes in this repository and push to its configured GitHub remote at task completion. Verify success; report missing destination/authentication as a blocker.
- Do not treat this planning scaffold as an implemented platform.
