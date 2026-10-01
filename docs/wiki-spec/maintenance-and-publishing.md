# Maintenance and publishing

[Specification home](README.md)

## On this page

- [Work during the planning phase](#work-during-the-planning-phase)
- [Required work before every feature push](#required-work-before-every-feature-push)
- [Change-impact matrix](#change-impact-matrix)
- [Registers and source layout](#registers-and-source-layout)
- [Required automated checks](#required-automated-checks)
- [GitHub wiki publishing contract](#github-wiki-publishing-contract)
- [Versions and retention](#versions-and-retention)
- [Host repository coordination](#host-repository-coordination)
- [Ownership and ongoing review](#ownership-and-ongoing-review)

Documentation is part of feature delivery. The GPT bot or contributor changing a feature owns its documentation impact, updates and evidence. Passing code tests alone does not complete the change.

This page specifies future automation. No new CI check, protected-branch rule or wiki publisher is installed by this specification.

## Work during the planning phase

Until the user starts wiki authoring:

1. Review the [section plan](section-plan.md) when changing a feature.
2. Update affected coverage, limitations, extension needs and example briefs.
3. Maintain existing implementation/contract documents required by the repository.
4. Record documentation impact and evidence in the change's verification record.
5. Do not create speculative wiki procedures or publish empty placeholder pages.

Planning work must preserve the distinction between a new requirement and a verified capability.

## Required work before every feature push

Once wiki authoring begins:

1. Inspect the code diff, public exports, schemas, controls, defaults, errors and affected dependencies.
2. Use the feature-to-documentation register to identify affected pages, entries, examples, media, versions and translations if maintained.
3. Follow dependency links. A changed mask rule may affect import guidance, effects, examples, troubleshooting and plugin contracts.
4. Update changed instructions and references. Re-audit related unchanged text and record why it remains correct.
5. Reproduce affected examples and visual checks against the candidate code. Re-capture images only when appearance, controls or meaning changed.
6. Run documentation checks and record the audit. Obtain independent review where required.
7. Include documentation source and evidence in the same change as code. If another repository owns part of the documentation, include its exact related commit.
8. Push only after applicable checks pass. Publish the matching approved wiki snapshot at release and verify the result.

Intermediate feature-branch pushes still need an impact assessment and accurate corresponding draft source. Only released behavior enters the public supported wiki. A known code/documentation mismatch is recorded as a blocking incomplete change, not hidden behind a green test summary.

"No documentation impact" requires a concrete explanation tied to the changed behavior and reviewed feature IDs. Pure internal refactoring can qualify. Changes to defaults, limits, errors, permissions, import fidelity, fallback, timing, performance policy or extension behavior normally affect documentation.

## Change-impact matrix

| Change | Minimum audit targets |
| --- | --- |
| Artist UI or terminology | Procedure, glossary, screenshots, first-card path and accessibility instructions |
| Material, mask, coordinate or motion behavior | Artist meaning, exact reference, imports, fixed-input examples, fallback and troubleshooting |
| New art surface | Complete-line workflow, asset requirements, rendering/export path, host contract and example library |
| Importer or format | Supported profile, fidelity report, limits, recovery and preserved/converted/rejected examples |
| API, event or plugin contract | Reference, recipes, version compatibility, lifecycle, conflicts and migrations |
| Permission or identity behavior | Role guides, trusted boundary, error recovery, integration and operator procedures |
| Catalog, copy or transaction behavior | Domain model, invariants, retry/recovery, examples and host responsibilities |
| Resource policy or measured support | Artist optimization, limits, device matrix, benchmark conditions and fallbacks |
| Storage, deployment or dependency | Setup, configuration, security assumptions, operations, backup/restore and upgrade |
| Removal or deprecation | Capability table, all incoming links/examples, migration, archive and moved-page notices |
| Host integration | Integration docs, generic contract claims, pinned compatibility pair and external assets |

File-path mappings help find impact, but cannot determine it alone. A private code change can alter visible behavior.

## Registers and source layout

Proposed layout in the framework repository:

```text
docs/wiki-spec/             This specification
docs/wiki-source/           Future editable Markdown pages
docs/wiki-meta/             Future page, feature, example and media registers
docs/wiki-audits/           Future audit and change-impact records
examples/                  Executable generic source and fixture generators
```

Store art and captured media externally. Store only references and permitted metadata in Git.

Each page record needs: stable ID, title/slug, reader, page type, task, parent hub, feature IDs, dependencies, owner, status, supported versions, source file, examples/media and audit references.

Each feature record needs: stable ID, public surfaces, implementation/availability status, code/schema/test sources, affected page IDs and owner. Include controls and extension points that are not exported functions.

Each media record needs: immutable URL/identifier, checksum, rights, capture recipe/build, alt text/caption, pages using it and retention owner.

Use one record source to generate navigation and audit coverage where practical. Do not require authors to maintain several copies of the same mapping.

## Required automated checks

| Check | Required behavior |
| --- | --- |
| Structure | Validate records, templates, unique IDs/slugs, heading order and required metadata |
| Coverage | Compare changed feature mappings with public-surface changes; flag unmapped or stale entries |
| Links | Check internal pages, anchors, source links, examples and media references |
| Terminology/style | Flag prohibited prose dashes, banned filler, inconsistent terms and unidentified placeholders |
| Examples | Parse configs against the target schema; execute marked runnable examples; verify expected output |
| Reference drift | Compare generated fields/defaults/types with authoritative contracts; show a reviewable diff |
| Media drift | Identify captures tied to changed controls/behavior; require review or replacement |
| Audit completeness | Require exact candidate code revision and applicable technical/editorial review evidence |
| Publication | Verify generated page set, source revision, wiki revision and rendered links after sync |

CI must run untrusted pull-request checks without publication credentials. Publication uses reviewed source and restricted credentials. Failure of a required check fails the gate; an unavailable test is not silently skipped.

Automation cannot prove an instruction makes sense to artists or that a screenshot illustrates the claimed effect. Those remain explicit audit tasks.

## GitHub wiki publishing contract

Keep editable documentation in the main repository so code and documentation receive normal review together. Publish an approved snapshot to the separate GitHub wiki Git repository. GitHub documents the separate clone workflow and the default branch as the live wiki branch. This source-to-wiki arrangement is our design choice. [GitHub wiki editing](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages)

Generate a Home page, stable page files, `_Sidebar.md` and `_Footer.md`. GitHub recognizes the latter two filenames for custom navigation and footer content. [GitHub sidebar and footer](https://docs.github.com/en/communities/documenting-your-project-with-wikis/creating-a-footer-or-sidebar-for-your-wiki)

Use ordinary Markdown links and portable page names. The publisher must translate source-relative links to valid wiki destinations and fail on collisions or broken anchors. Strip internal metadata from reader pages.

Required publication sequence:

1. Build the complete candidate page set from one source commit.
2. Validate links, navigation, media access and version labels.
3. Preview representative pages and every materially changed layout in a GitHub-compatible renderer.
4. Check for remote wiki changes and publication races. Do not overwrite an unexpected manual edit.
5. Publish one wiki commit and record its source SHA.
6. Verify Home, changed pages, navigation, anchors, media and source/version footer on GitHub.
7. Record success only after those checks pass.

Normal editing happens in source. Emergency manual wiki corrections must be reconciled into source before the next publication. Serialize publishers; do not force-push over another writer.

The code repository and wiki are separate Git histories. Treat publication failure as a visible release failure and retry the same source snapshot. Do not imply that the two pushes are atomic.

## Versions and retention

The public wiki defaults to the latest supported release. Experimental previews must be visibly separate. Each page states applicable versions; an experimental runtime can differ from the overall framework version.

Keep immutable documentation snapshots with release tags in the source repository. Link older supported versions from the Versions page. Preserve old examples and media for their supported lifetime. A GitHub wiki history entry alone is not an adequate reader-facing version selector.

Breaking changes require old/new behavior, affected versions, migration steps, compatibility limits and rollback consequences. Removed features retain a searchable explanation and migration link.

A stale page remains visibly stale until revalidated. Do not silently switch its version label. If it could cause harm or mislead a core workflow, correct or withdraw the affected instruction immediately.

## Host repository coordination

The framework owns generic contracts and examples. The integration owns game-specific wiring, configuration and operational details.

A case study records framework commit/version, portable format version, integration commit, example entry point, permitted asset source and verification. Link immutable code revisions; a link to a moving default branch is not reproducibility evidence.

A framework change that breaks the case study requires either a verified integration update or an explicit compatibility limitation. Do not claim the integration was retested when only generic tests ran. Keep mock game services distinguishable from live integrations.

## Ownership and ongoing review

Assign a maintainer to each hub and a technical owner to each feature family. The changing bot handles the update; the owner resolves scope and review disputes.

At each release, review coverage, stale evidence, unresolved defects, compatibility and broken external assets. At each planning boundary, review new reader tasks and section structure. Repeated support questions and failed reader tasks create documentation issues linked to the responsible pages.

Track task completion, search/navigation failures, repeated questions, example failures and stale entries. Do not use page count, word count or documentation traffic as a quality score.
