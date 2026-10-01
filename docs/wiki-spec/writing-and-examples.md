# Writing and examples

[Specification home](README.md)

## On this page

- [Language rules](#language-rules)
- [Page contracts](#page-contracts)
- [Artist control descriptions](#artist-control-descriptions)
- [Example selection](#example-selection)
- [Screenshots and visual comparisons](#screenshots-and-visual-comparisons)
- [Consistency](#consistency)

These rules apply to every published entry, including reference rows, captions, examples and troubleshooting. Friendly language is permitted in the home introduction. Instructions remain direct, factual and specific.

## Language rules

1. Start with the result, definition or action. Remove announcements about what the page will discuss.
2. Use the artist's vocabulary before introducing technical vocabulary. Define a necessary term once, then use it consistently.
3. Name the actor when responsibility matters: artist, publisher, host, server or player.
4. Use exact UI labels and identifiers. Put UI controls in bold and code identifiers in backticks.
5. State units, coordinate frame, valid range, defaults and conditions wherever a value affects behavior.
6. Separate a requirement, a recommendation and a hard limit. "Must" is required, "should" is recommended, and "may" is optional.
7. Ban em dashes and en dashes used as prose punctuation. Write ranges with "to". Preserve required literal identifiers and exact quoted diagnostics; document any character-lint exemption.
8. Ban promotional claims, rhetorical questions, storytelling, decorative conclusions and filler such as "simply", "seamlessly", "unlock", "delve" and "powerful".
9. Do not say "easy", "obvious", "just" or "intuitive" in an instruction. Show the action.
10. Do not call something fast, secure, portable, lossless, supported or production ready without scope and evidence.
11. Remove repeated framing and stock transitions. Do not restate a table as a paragraph.
12. Preserve the condition when shortening a sentence. Concision must not remove a prerequisite, failure mode or expected result.

Vocabulary lint finds candidates. It cannot establish clarity or authorship. Do not use an AI detector as a quality gate.

### Editorial examples

These examples demonstrate wording. They do not specify current controls.

| Reject | Preferred form |
| --- | --- |
| "Unlock stunning depth with our powerful layer system." | "Place foreground artwork on a separate layer." |
| "Simply configure the desired parameters." | "Set **Depth** for the foreground layer." Use this label only if it exists. |
| "Optimize your image." | "Reduce the image dimensions until the validation report is below the documented limit." |
| "This option controls how the material behaves." | Name the visible change, its units and the input that changes it. |
| "All plugins are secure." | State where extension code runs, what it can access and which restrictions are enforced. |
| "See here for more." | "See the supported source formats." Link that phrase to the canonical page. |

## Page contracts

Use the following order when applicable. Omit empty sections. Do not add a heading merely to satisfy a template.

### Tutorial

- Outcome and one representative result.
- Supported version, skill assumptions, required tools/files/permissions and starting state.
- Numbered steps along one successful route.
- Observable checkpoints where a wrong state would affect later work.
- Final result and a reload or validation check.
- Likely failures and the next useful task.

Use a small complete project. Keep optional variations in linked recipes. Do not require readers to understand the backend to finish the first card.

### Task guide

- Outcome, applicability and prerequisites.
- Shortest complete supported procedure.
- Expected result.
- Relevant limitation or failure and recovery.
- Exact reference and one next step when useful.

Separate UI and code procedures. If only a code route exists, say so before the steps and identify the developer handoff.

### Explanation

- The question the page answers.
- The model and relationships needed to answer it.
- One example or diagram where helpful.
- Consequences, tradeoffs and limits.
- Links to procedures and exact reference.

Architecture pages explain responsibilities and decisions. Avoid tours of source files that provide no reader benefit.

### Reference

For a property: name, meaning, type, units/coordinate frame, default, accepted range or values, omission behavior, interactions, errors, availability/version and a minimal example when meaning is not obvious.

For an API or extension: purpose, public entry point, execution environment, inputs, outputs, authority, state changes, event timing, ordering, concurrency, retries, cancellation, errors and cleanup. State "not applicable" only when omission would otherwise leave doubt.

For an import format: supported tool/version/profile, preserved properties, conversions, unsupported properties, validation/report behavior and fallback.

Generated schemas may supply exact fields. Humans must supply intent, consequences and examples.

### Troubleshooting

Use symptom or exact error as the title. Give the likely cause, a non-destructive check, corrective action, expected result and next step if it fails. State when retrying is safe. Avoid generic advice to reinstall, clear everything or disable security.

### Integration recipe

Record the desired change, default behavior, extension mechanism, code location, complete minimal implementation, registration, expected result and test command. Include fallback, conflicts, disposal and version compatibility. Link the larger working project.

## Artist control descriptions

Every artistic control needs both a visual explanation and exact semantics.

| Required information | Example of the question it answers |
| --- | --- |
| Visible effect | What changes in the card? |
| Scope | One layer, face, card, album member or whole display? |
| Input | Time, tilt, pointer, host data or a constant? |
| Amount | Which units and useful starting values apply? |
| Interaction | Does a mask, crop or parent transform alter it? |
| Cost and fallback | What happens on lower quality or without an adapter? |
| Availability | Default editor, API, installed extension or host code? |
| Verification | Which fixture demonstrates the behavior? |

Do not substitute a perceptual description for the actual numeric definition. A mask diagram must match the renderer's channel and inversion rules.

## Example selection

Use one primary example to teach a concept. Add another only for a meaningful difference: failure/recovery, a boundary, another supported mechanism, compatibility or a visual distinction. Move large variants to the example library.

There is no screenshot or example quota. Each item must name the question it answers in its authoring record. Remove it if the surrounding material answers the same question equally well.

### Reproducibility

Each runnable example records:

- Stable example ID, intended outcome and supporting pages.
- Exact source commit and dependency/runtime versions.
- Setup, working directory, execution command and placeholders.
- Required assets, permitted source, checksum, license and access requirements.
- Expected output or visual state, including inputs/time/seed where relevant.
- Verification command, environment and latest passing evidence.
- Cleanup and any side effects or destructive step.

Code examples use public APIs. Complete examples include imports and registration. Snippets link to the complete file and state what was omitted. Mark pseudocode explicitly; never present invented signatures as runnable code.

Expected error examples assert rejection and its cause. Visual examples require visual review; schema validation cannot prove appearance. Example code and rendered snippets must share a source or receive a drift check.

Synthetic examples must run without private art, paid accounts or production services unless the page explicitly documents that integration. A mock must be labeled and must not be cited as evidence that the external service works.

## Screenshots and visual comparisons

- Use a screenshot for locating a control, recognizing a state or judging a visual effect.
- Prefer a diagram for layer order, coordinates, masks and system boundaries.
- Prefer a fixed before/after pair for finish, sampling, depth and quality changes. Keep the art, scale, pose, lighting and other parameters constant.
- Use a short optional recording when motion is the subject. Supply static key frames and a text description. Avoid autoplaying loops in core reading paths.
- Crop to the relevant area while retaining enough context to find it. Use a few numbered callouts tied to nearby text.
- Place the image beside or immediately after the step it explains. Captions state what to inspect, not "Screenshot".
- Give images meaningful alt text. Complex diagrams also need an adjacent explanation or linked text equivalent.
- Keep commands, errors, values and instructions selectable as text. Screenshots never carry the only copy.
- Capture the documented release. Store capture recipe, build, environment, input and source asset identifier.
- Never use a generated mockup as evidence of actual UI or renderer behavior.
- Store approved media externally under repository asset rules. Use stable immutable references and check public access.
- Remove secrets, private accounts and unlicensed material before publication.

Check the rendered page on desktop, at 200% zoom and at a narrow mobile width. Essential text and callouts must remain readable. Wide tables need a smaller representation or a clear text alternative. Required content must not depend on collapsed sections.

## Consistency

Maintain a shared term list, capitalization list, page templates, reference field order and example conventions. The same concept gets the same name in the UI, guide, caption and API mapping.

Use sentence case headings and task verbs for procedures. Use nouns for reference titles. Avoid vague headings such as "Advanced", "Other" and "Miscellaneous".

Keep tables for comparisons or repeated fields. Split a table when its cells become paragraphs. Use numbered lists for ordered actions and bullets for independent items.

Word counts and sentence lengths are review signals only. If a page has several unrelated outcomes, split it. If a shorter page forces readers to reconstruct omitted context from five other pages, restore the context.
