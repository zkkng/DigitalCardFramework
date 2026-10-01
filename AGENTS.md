# Repository instructions

- This is the reusable digital card framework repository.
- Keep all named host integrations, domain-specific logic, branding and currency identifiers outside this repository. The framework and its documentation must remain system agnostic.
- Keep every art asset and game data file outside this repository. Use structured manifests and configurable asset references.
- Preserve generic accounts, currency providers, card subjects and namespaced bindings.
- Read docs/customization-architecture.md before feature work. Each feature needs a documented customization contract and a public-API example; verify alternative composition without editing core. Keep headless logic separate from default UI and host wiring.
- Commit framework changes in this repository and push to its configured GitHub remote at task completion. Verify success; report missing destination/authentication as a blocker.
- Do not treat this planning scaffold as an implemented platform.

## Wiki documentation requirements

- Read [the wiki specification](docs/wiki-spec/README.md) before feature work. During planning, update the affected section inventory, limitations and example briefs; do not draft or publish the wiki until the user starts authoring.
- Once wiki authoring begins, every feature push requires an impact assessment, updated affected documentation and examples, and the audits in [acceptance and audits](docs/wiki-spec/acceptance-and-audits.md). The bot changing the feature owns this work.
- Review related unchanged entries too. A no-impact decision needs a concrete reason. Record evidence for accuracy, clarity, concision and reader understanding; do not claim verification from a timestamp or self-review alone.
- Preserve artist guidance, backend contracts and extension recipes as separate reader paths. Keep implementation state, availability and tested versions explicit.
- Follow the specified source review and wiki publication process. CI enforcement remains future work until implemented and verified.
