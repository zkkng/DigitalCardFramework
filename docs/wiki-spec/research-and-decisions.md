# Research and decisions

[Specification home](README.md)

## On this page

- [Concise and scannable writing](#concise-and-scannable-writing)
- [Words and pictures](#words-and-pictures)
- [API learning and examples](#api-learning-and-examples)
- [Separate documentation purposes](#separate-documentation-purposes)
- [Complete procedures](#complete-procedures)
- [Accessible visual explanations](#accessible-visual-explanations)
- [GitHub constraints](#github-constraints)
- [Project evidence inspected](#project-evidence-inspected)
- [Limits of this research](#limits-of-this-research)

Reviewed 1 October 2026. The sources below informed the specification. The operational thresholds, ownership model and release gates are project decisions. The research does not establish a universal word count, screenshot count or number of pages.

## Concise and scannable writing

Morkes and Nielsen's research report, *Concise, SCANNABLE, and Objective: How to Write for the Web* (1997), compares writing styles using task performance and other usability measures. It supports removing promotional language and making information easy to scan. The reported improvement belongs to that study's sites and participants; it is not a forecast for this wiki. [Research report](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/)

**Design decision:** descriptive headings, factual opening sentences, no sales language and a deletion pass on every page. Verify the result through reader tasks rather than a readability score alone.

## Words and pictures

Mayer and Moreno, *Nine Ways to Reduce Cognitive Load in Multimedia Learning* (2003), reviews learning studies and explains segmentation, relevant visual cues and placing explanatory words near the corresponding picture. Much of the evidence concerns instructional multimedia and transfer tests, not GitHub documentation. Its narration-related findings must not be used to remove captions or accessible text alternatives. [Paper PDF](https://carpentries.github.io/instructor-training/files/papers/mayer-reduce-cognitive-load-2003.pdf)

**Design decision:** keep one task per guide, place annotated figures beside the relevant instruction, and use controlled comparisons. Remove decorative media. Preserve text equivalents and let the reader control motion.

## API learning and examples

Kuhn and DeLine, *On Designing Better Tools for Learning APIs* (2012), reports work with 19 professional developers. Participants valued examples and source credibility while resisting irrelevant information. The study concerns one corporation and the Silverlight API, which limits generalization to other readers. [Paper PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2017/01/1402.1188.pdf), [publication record](https://www.microsoft.com/en-us/research/publication/designing-better-tools-learning-apis/)

**Design decision:** connect natural-language tasks to exact public entry points. Give examples a stable identity, full source, versions and verification. Put deeper variants in a library instead of expanding every guide.

Robillard and DeLine's *A field study of API learning obstacles* identifies intent, examples, scenario mapping, finding one's way through an API, and presentation as documentation concerns. The Microsoft publication abstract was reviewed; the full journal paper was not used as evidence here. [Publication abstract](https://www.microsoft.com/en-us/research/publication/field-study-api-learning-obstacles/)

**Design decision:** reference pages must explain purpose and consequences in addition to signatures.

## Separate documentation purposes

Diataxis distinguishes tutorials, task guides, explanation and reference according to reader needs. It is a practitioner framework, not a controlled study proving a particular navigation design. [Framework](https://diataxis.fr/)

**Design decision:** use these page types within artist/developer/operator paths. Artists should not need to understand documentation taxonomy to choose where to start.

## Complete procedures

Google's developer style guide specifies actions, context, placeholders, results and handling of optional or repeated procedures. This is editorial guidance rather than experimental evidence. [Procedures guide](https://developers.google.com/style/procedures)

**Design decision:** use consistent page contracts and numbered actions with observable results. Keep alternate routes separate when mixing them would interrupt the task.

## Accessible visual explanations

W3C's guidance for complex images calls for short identification and an accessible account of the essential information. A picture that carries technical meaning needs more than a decorative caption. [Complex images](https://www.w3.org/WAI/tutorials/images/complex/)

**Design decision:** retain instructions as text, describe important visual relationships and test narrow/zoomed layouts. A video or interactive demo is supplementary.

## GitHub constraints

GitHub documents wiki editing through a separate Git repository, filename-based page titles and custom sidebar/footer files. These are platform capabilities, not evidence of documentation quality. [Wiki editing](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages), [sidebar and footer](https://docs.github.com/en/communities/documenting-your-project-with-wikis/creating-a-footer-or-sidebar-for-your-wiki)

**Design decision:** review documentation in the framework repository, then publish a verified wiki snapshot. Test link translation and the actual GitHub rendering before claiming publication is complete.

## Project evidence inspected

The repository inspection found existing design, runtime, authoring, access, customization and verification documents. The framework baseline was `b45489c`; the working tree also contained active implementation changes. No new runtime conformance claim is made by this specification.

Primary inputs:

- [Repository instructions](../../AGENTS.md) and [repository overview](../../README.md).
- [Customization architecture](../customization-architecture.md).
- [Creator API](../complex-cards/creator-api.md) and [runtime coverage](../complex-cards/implementation-status.md).
- [Existing audit and limitations](../complex-cards/audit-2026-10-01.md).
- [Identity and access](../access-and-identity.md).
- External host integration.

The source material contains a mixture of current behavior and future design. The wiki must recheck each imported claim against its selected release. Existing prose must pass the new standards before reuse.

## Limits of this research

Research informed the structure and review method. It does not prove this unpublished wiki is clear or usable. Artist comprehension, example adequacy, navigation and actual rendering remain acceptance work.

The three-link route, 60-second findability task, initial reader cohort and per-change gates are explicit project choices. Record outcomes and revise those choices if evidence shows a better rule. Do not weaken factual accuracy, completeness or the prohibition on prose em dashes.
