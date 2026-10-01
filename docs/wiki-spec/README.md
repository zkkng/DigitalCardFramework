# GitHub wiki specification

Status: specification for future documentation. Updated 1 October 2026.

The wiki must let an artist create and deliver a complete digital card line, and let a developer integrate, extend and operate the system using supported contracts. Coverage must be deep. Each page must contain only what its reader needs to complete the stated task or answer the stated question.

This specification defines the future wiki, its acceptance tests and its maintenance process. It does not authorize drafting or publishing the wiki while the system is still being built. Page titles below are a proposed inventory, not evidence that a feature exists.

## Specification contents

| Document | Purpose |
| --- | --- |
| [Section plan](section-plan.md) | Audience paths, proposed pages, artist coverage, backend coverage and integration examples |
| [Writing and examples](writing-and-examples.md) | Page contracts, language rules, screenshots, recipes and reference entries |
| [Acceptance and audits](acceptance-and-audits.md) | Pass conditions, reader trials, audit evidence and rejection rules |
| [Maintenance and publishing](maintenance-and-publishing.md) | GPT bot obligations, feature mapping, release gates, versioning and GitHub publishing |
| [Research and decisions](research-and-decisions.md) | Research reviewed, resulting design choices and evidence limits |

## Required outcomes

| Reader | Must be able to do |
| --- | --- |
| Artist using defaults | Make a card from an image; build layered faces; apply supported finishes and motion; design backs, packs and albums; preview, validate and hand off a line |
| Artist using extensions | Identify which result needs configuration, an installed extension or custom code; prepare assets and requirements for the developer |
| Plugin or mod author | Find the supported extension point; implement it; test conflicts, cleanup and fallback; upgrade without modifying core |
| Host developer | Embed or replace views; connect identity, publishing and game services; preserve authority and ownership rules |
| Operator | Deploy the supported profile; diagnose failures; recover data; manage access, media and upgrades |
| Core contributor or GPT bot | Trace a change to every affected page, example and limit; update and audit them before pushing |

Artist documentation is a first-class release requirement. Backend coverage cannot compensate for missing artist workflows. No page-count quota determines the balance.

## Information architecture

The home page routes readers by what they want to do:

1. Create card art.
2. Build packs and albums.
3. Integrate a website or game.
4. Develop plugins and mods.
5. Operate the backend.
6. Find reference information or fix a problem.

Use audience hubs for navigation. Within each hub, distinguish guided tutorials, task guides, explanations and reference pages. Keep a complete learning path separate from a quick lookup.

The sidebar contains Home, the audience hubs, Examples, Troubleshooting, Reference, Versions and Glossary. It must not become a list of every page. Each hub lists its tasks in a useful order. An alphabetical page index provides a second route.

### Navigation requirements

- A new reader can choose a path without knowing internal module names.
- Every task page names its outcome, requirements and supported version before its first procedure.
- Every page has a parent-hub link. A guided series has previous and next links; unrelated reference pages do not need them.
- Primary tasks take at most three link selections from Home. Verify this with a link graph and reader trials.
- Pages with more than four main sections provide a short contents list. Use descriptive headings and stable anchors.
- A glossary maps artist language to technical identifiers. Examples: shine to material response; cutout to transparency or mask; depth movement to parallax.
- Search aliases belong in hub descriptions, the glossary and the task index. Do not assume control over GitHub's search ranking.
- Use one canonical reference for each contract or limit. Link to it from task pages. Repeat a prerequisite or immediate hazard when its absence would make a step unsafe or confusing.
- Renamed pages retain a short moved-page link. Do not assume GitHub supplies redirects.
- Core instructions work without an external demo, video, hover gesture or downloaded image.

The three-link target and contents-list threshold are project acceptance choices, not research findings. Change them only with recorded reader evidence.

## Feature truth and readiness

A feature record must distinguish these independent facts:

| Dimension | Values |
| --- | --- |
| Implementation | Planned, experimental, supported, deprecated, removed |
| Availability | Built in, optional installed extension, host supplied, unsupported |
| Documentation | Planned, drafted, verified, stale, archived |
| Verification | Exact release or commit, tested environments, evidence, known exclusions |

Do not turn a design proposal into a usage claim. Do not treat a method exported by an unfinished branch as released support. "Supported" means a stated implementation and environment have evidence.

Artist pages state whether the task is possible in the default editor, needs an installed extension, or requires a developer. If no supported route exists, describe the limitation and supported alternative. Do not invent a control, workaround or launch date.

Each public page displays the applicable framework/runtime version and its experimental or deprecated status when relevant. Detailed audit metadata stays in source records. A changed timestamp alone does not prove a page was checked.

## Scope boundaries

The framework wiki owns generic workflows, runtime and backend contracts. The separate host integration repository owns game-specific setup, adapters and case studies. Links between them must identify a compatible version pair.

Art, licensed game data, card bundles and private credentials stay outside both source repositories under the current repository rules. Example generators and manifests may be committed. External sample downloads need rights, stable identifiers, integrity checks and a recovery plan.

The wiki must distinguish editable source art, a portable presentation, a catalog definition, an issued copy, a pack's appearance, pack allocation rules and an album display. These objects have different owners and lifecycles.

## Decisions that precede wiki authoring

Before authoring starts, record the first documented release, named section owners, supported environments, public example storage, asset redistribution terms and the publication credential mechanism. Confirm how the current artist tools expose pack art, album pages and cover art.

Unresolved items stay in the planning inventory with an owner and a next decision. They do not block this specification, and they do not become empty public wiki pages.

## Completion of this specification

This deliverable is complete when the section plan covers the requested audiences and art surfaces, the standards are testable, every page has an audit model, and feature work has a defined documentation obligation.

The future wiki is complete for a release only when the [acceptance gates](acceptance-and-audits.md) pass. No wiki page, automated publishing job or enforcement check is implemented by this specification.
