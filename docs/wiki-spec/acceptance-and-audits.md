# Acceptance and audits

[Specification home](README.md)

## On this page

- [Acceptance criteria](#acceptance-criteria)
- [The four required editorial audits](#the-four-required-editorial-audits)
- [Audit procedure](#audit-procedure)
- [Human reader trials](#human-reader-trials)
- [Defects and release policy](#defects-and-release-policy)
- [Audit record template](#audit-record-template)
- [Verification of the enforcement process](#verification-of-the-enforcement-process)

A page passes only when every applicable criterion passes. Scores cannot average away a factual error. A missing check is unverified, not passed.

Audit each independently usable unit: page, procedure, reference entry, example and media item. A page-level record may group units only if it enumerates them and records exceptions.

## Acceptance criteria

| ID | Pass condition | Required evidence |
| --- | --- | --- |
| W01 | Each supported feature maps to its affected audiences, canonical reference, task guidance and necessary examples | Release capability inventory compared with exports, schemas, UI controls, configuration and extension points |
| W02 | Artist coverage includes fronts, backs, layers, finishes, motion, packs, album pages and covers | Complete-line coverage review; unavailable routes labeled explicitly |
| W03 | Planned, experimental, supported and host-supplied behavior cannot be confused | Per-feature state and version checked against implementation |
| W04 | Every behavioral claim is traceable to the documented release | Claim/section to source symbol, schema, test or reproduced observation |
| W05 | Procedures have complete prerequisites, actual labels, ordered actions and observable outcomes | Reproduction from a clean starting state without author assistance |
| W06 | Entries pass clarity, concision, accuracy and comprehension review | Separate findings for all four dimensions; fixes or justified non-applicability |
| W07 | Each exposed artist control has visual meaning and exact semantics | Control inventory compared with artist guide and reference |
| W08 | Code and data examples execute or are explicitly non-runnable | Pinned example suite and expected output; all skips explained |
| W09 | Visual claims match actual rendering | Fixed-input capture plus visual review; fallback and alternate face where relevant |
| W10 | Every image/example earns its place and is accessible | Purpose, caption/alt text, text equivalent, rights and capture provenance |
| W11 | Plugins and mods use documented public contracts with full lifecycle and trust details | Generic recipe, conflict/failure/cleanup test and alternate composition |
| W12 | Host-specific examples have versioned links and independent generic counterparts | Compatibility pair, source link and asset-access instructions |
| W13 | Backend guidance covers authority, transactions, persistence and failure recovery | Contract review plus relevant success/failure/restore evidence |
| W14 | Navigation is task-based, complete and usable | No broken internal links/anchors or orphan pages; primary tasks within three selections |
| W15 | Published pages are usable in GitHub's actual renderer | Desktop, narrow-width, zoom and keyboard inspection; critical image/text checks |
| W16 | Affected pages and examples are re-audited for every change | Change-impact record; stale state cleared only by relevant evidence |
| W17 | Publication contains the approved source and correct version | Source SHA, wiki SHA, rendered-page checks and link/media verification |
| W18 | No unresolved release-blocking documentation defect remains | Defect register, reviewer decision and release audit |
| W19 | Section plan expands with product scope | Inventory review at feature and release boundaries |
| W20 | Language and terminology comply throughout | Character/style lint plus editorial review; no prose em dashes |

"All supported features" includes configuration-only, command-line and extension APIs. It does not mean every private internal function deserves a public page.

## The four required editorial audits

| Dimension | Reviewer must establish | Reject when |
| --- | --- | --- |
| Clarity | The actor, action, object, conditions and result have one reasonable interpretation | "It", "configure" or "supported" leaves a material ambiguity |
| Concision | Each sentence, image and example contributes to the reader's task | It repeats, advertises, narrates the authoring process or adds an irrelevant branch |
| Accuracy | Behavior, labels, values and scope match the version and evidence | A proposal, guess, mock or old screenshot is presented as current behavior |
| Ease of understanding | The target reader can find and apply the information with stated prerequisites | It assumes undefined jargon, missing steps or implementation knowledge the artist does not have |

Review labels alone are insufficient. Record the examined units, evidence and concrete findings. Zero findings is allowed only after the checks were performed.

## Audit procedure

1. Identify the exact release or commit, changed contracts, target readers and affected units.
2. Compare each relevant statement against code, schema, actual UI and tests. Record discrepancies before editing.
3. Reproduce procedures and examples in their stated environment. Record output and limitations.
4. Review headings alone, then instructions alone. Resolve unclear routing, labels and prerequisites.
5. Perform a deletion pass. Remove filler and duplicate explanation without removing necessary context.
6. Inspect figures, comparisons, fallback behavior and the rendered page.
7. Check related pages, terms, links, compatibility tables and example references.
8. Record pass/fail, unresolved issues, reviewer and evidence. Re-run affected checks after corrections.

A bot may perform evidence gathering, reproduction and editorial review. A bot cannot claim to have conducted a human reader trial. Independent review means a different reviewer from the author; repeating a self-review does not meet that condition.

## Human reader trials

Before the first public wiki release, test with at least three artists and two developers/operators who did not author the pages. Artists should be comfortable with image tools and need no programming background. These numbers are project release targets for finding defects, not statistical proof.

| Task | Success criterion |
| --- | --- |
| Find the right guide | Find a relevant starting page within 60 seconds from Home using visible navigation |
| Make a first card | Import supplied permitted art, set a distinct back, export and reload |
| Build layered art | Add depth and one localized finish, recognize the result and inspect the fallback |
| Design a line | Locate and follow the available pack/page/cover routes; correctly identify any host-only or unsupported surface |
| Repair a failure | Identify a deliberately unsupported import or misplaced mask and follow the documented recovery |
| Extend a host | Choose the correct public contract, run the recipe and demonstrate cleanup |
| Explain authority | Correctly identify which operation publishes art, issues copies or only changes presentation |
| Recover an operation | Use the documented failure/retry or restore procedure in a disposable environment |

Assign relevant tasks by role. Every assigned participant must complete the critical tasks without facilitator repair or an undocumented workaround. Record completion, wrong turns, assistance, confusing terms and errors. The facilitator may clarify the test prompt, not the instructions.

Run one transfer task using different art or parameters. Copying a tutorial exactly does not establish understanding. Fix blocking findings and re-test affected tasks with a fresh suitable reader when possible; record any repeated-participant limitation.

For later releases, repeat trials for materially changed artist workflows, navigation and authority/recovery flows. Audit every entry technically and editorially; do not claim every minor reference row needs a separate human study. If required participants are unavailable, the human gate remains pending.

## Defects and release policy

| Severity | Examples | Release consequence |
| --- | --- | --- |
| Critical | Credential exposure, ownership bypass, destructive recovery advice, false transactional guarantee | Block release or remove the affected claim/instruction immediately |
| Major | Wrong value, broken runnable example, missing prerequisite, unusable navigation, invented UI, missing artist surface, essential inaccessible figure | Block affected documentation and the feature's release |
| Minor | Local wording or formatting defect with no changed interpretation | Fix before approval of a new/changed page; track existing unrelated debt separately |

No exceptions for inaccurate behavior or unsafe instructions. A workflow can be removed from supported scope only by an explicit product decision reflected throughout the inventory and wiki. Calling a failing guide "experimental" does not make false instructions acceptable.

Transient external-link failure is retried and inspected. A required unavailable asset is a failure. An optional external reference may carry a tracked availability issue if the page remains complete.

## Audit record template

This is a proposed record format, not an implemented schema.

| Field | Required content |
| --- | --- |
| Identity | Record ID, page IDs, section anchors, example/media IDs |
| Scope | Feature IDs, reader roles, documentation state, changed behavior |
| Versions | Source commit, runtime/schema/extension versions, documentation commit, capture build |
| Accuracy | Claim or section, source/test/observation, result and limitations |
| Reproduction | Setup, command/actions, expected and actual result, evidence location |
| Editorial | Clarity, concision, accuracy and understanding findings |
| Visual/access | Figure checks, fallback, rendered environment, text alternatives |
| Review | Author, technical reviewer, editorial reviewer, human-trial reference if required |
| Decision | Pass/fail/pending, blockers, issues, date and affected follow-up |

One person may cover technical and editorial review if qualified. Critical artist workflows and trust/transaction/recovery contracts require independent review. The feature bot remains responsible for resolving findings and recording the result.

## Verification of the enforcement process

Before calling the future gates operational, demonstrate that they reject:

- A public API/default change with no documentation impact record.
- A new feature with no page mapping.
- A stale image after a UI change.
- An example copied from an incompatible version.
- A "no documentation impact" claim that ignores a changed limit.
- A passing schema test presented as visual evidence.
- A release with a broken required media reference.
- A failed wiki sync reported as a successful publication.

The documentation system must prove its checks work. This specification does not claim those checks already exist.
