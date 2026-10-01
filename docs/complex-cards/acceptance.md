# Complex card acceptance checks

These are implementation gates, not tests that have already passed. The documentation example checker has a narrower scope described at the end. Capture exact build, browser and device versions for runtime results. Automated developer testing and code review are required; an optional owner playthrough must not block delivery of implemented code.

## Portable content and authority

| ID | Scenario | Required result |
| --- | --- | --- |
| P01 | Export and import into a clean host with a different URL/base path | Both faces and all required media resolve; no original project path needed |
| P02 | Repack identical payload with different ZIP timestamps/order | Same logical digest; archive byte digest may differ |
| P03 | Alter one media byte or scene input | Integrity fails or a new digest is generated; old digest is never overwritten |
| P04 | Import duplicate keys, traversal, symlinks, case collisions, forged size or ZIP bomb | Reject in bounded quarantine work; nothing published |
| P05 | Missing nested glTF/animation font/image, external URL in portable profile | Reject with the dependency path and reason |
| P06 | Unsupported required capability or unavailable optional recipe | Required feature blocks interactive activation; permitted fallback remains usable |
| P07 | Duplicate publish retry; cancellation during compile | Idempotent registration; no copies issued and no partial descriptor published |
| P08 | Copy pins old presentation, catalog receives a new revision | Existing copy remains pinned; new catalog can choose the new digest |
| P09 | Replay/skip/crash a complex pack reveal | Same committed copy IDs and allocation; no reroll or extra debit |
| P10 | Inspect a card containing an owner-only code binding | Player descriptor, events and network assets contain no private code |
| P11 | Remove old catalog version while copies still reference its assets | Garbage collection retains referenced content |
| P12 | Restore content storage from archive and rebuild | Pinned presentation restored with verified dependency closure |

## Visual behavior

| ID | Scenario | Required result |
| --- | --- | --- |
| V01 | Hold input-driven card still, then reverse tilt | Stillness after smoothing settles; reversible effects with no independent loop |
| V02 | Scrub firework from hidden to full bloom | Feathered art-shaped reveal; no hard full-disc boundary |
| V03 | Shimmer lake and rotate glittery petals | Highlights stay in local masks; petals respond independently of clouds |
| V04 | Switch three painted poses at extreme tilt values | Consistent source origin/contact point; no visible frame-size jump |
| V05 | Front/back flip through edge-on; back text and video | Correct orientation and face activation, with bounded prewarm |
| V06 | Join companion cards at neutral and extreme tilt | Seam anchors remain coherent, or editor reports composition limits |
| V07 | Compare lite and standard with fixed inputs | Subjects/identity preserved; every substitution is documented |
| V08 | Nearest-sampled pixel art beside smooth painting | Independent sampling preserved; no unwanted texture fringes |
| V09 | Render on two supported backends | Golden masks/blends/pivots agree within documented color tolerances |
| V10 | Reload with same public appearance seed | Same particle/flake arrangement; no dependence on frame rate |

## Lifecycle, performance and failures

| ID | Scenario | Required result |
| --- | --- | --- |
| R01 | 100 mount → interact → flip → dispose cycles | No growth in live view handles/listeners/decoders; cache stays within budget |
| R02 | Dispose while decoding/loading; rapidly reopen | Aborted work cannot attach late resources or revive a disposed view |
| R03 | 1,000-card album, scroll and inspect | Grid uses posters/virtualization; only budgeted views become active |
| R04 | 15 minutes continuous interaction on supported mobile profiles | Record frame percentiles, stalls and resource plateau; no escalating allocation trend |
| R05 | 5 minutes settled idle and background-tab transitions | Input-only stage schedules no continuous rendering; video pauses when inactive |
| R06 | Flip between two video faces repeatedly | Decoder policy and consent remain enforced; inactive sources release |
| R07 | Autoplay rejected, unsupported codec, offline media | Poster/control remains; no unhandled promise rejection or blank card |
| R08 | WebGL context loss and restoration | Rebuild from immutable descriptor or stable poster fallback |
| R09 | Sustained slow frames trigger quality governor | One explained downgrade, cooldown, no rapid oscillation or identity change |
| R10 | Network response arrives after route change | Correct cancellation and no DOM/resource resurrection |
| R11 | Multiple active cards share a stage | Total budget enforced across cards; per-card limits do not multiply silently |
| R12 | Video frame/scratch asset replacement | Owned VideoFrames/ImageBitmaps/render targets are explicitly released |

Initial frame-pacing targets: on a declared 60 fps supported profile, p95 interval ≤20 ms and p99 ≤34 ms during the scripted interaction; on a declared 30 fps fallback, p95 ≤40 ms. Record stalls over 100 ms separately. These are proposed release targets, not results from the current demo. Use a warm-up period, a repeatable input trace and distinguish load stalls from steady playback.

Run available browser automation for Chromium, WebKit and Firefox, then physical-device profiling where available. Desktop WebKit or mobile viewport emulation does not establish iPhone GPU, thermal or video-decoder performance. Test a physical iPhone in ordinary and low-power conditions before making that support claim. Lack of direct device access does not require waiting for the owner to finish the code; it requires an honest verification limitation.

Use resource counters plus browser tooling. A flat JavaScript heap or a capped array does not prove that GPU/video resources are stable. Distinguish cache warm-up from monotonic growth and record the baseline after deliberate cache eviction as well as ordinary view disposal.

## Accessibility, extensions and identity

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Keyboard-only inspect, flip, close and focus return | All controls reachable; no focus trap |
| A02 | Reduced motion/static mode and denied orientation | Identity/actions remain available; drag/keyboard works |
| A03 | Flashing/glitter recipe at extreme intensity | Author warning and bounded safe profile; no assumption automation proves WCAG |
| A04 | Multiple audio-capable cards | No sound before consent; host mute/focus policy honored |
| X01 | Install a custom recipe and alternate page composition | No core edits or internal imports; public contract fixtures pass |
| X02 | Competing renderers, plugin version mismatch, disable plugin | Deterministic diagnostics and fallback; no import-order selection |
| X03 | Program card attempts network, navigation or privileged action | Sandbox/CSP/broker policy rejects; no domain mutation |
| X04 | Spoofed bridge message from another frame | Source/nonce/channel/schema validation rejects |
| X05 | Behavior graph exceeds execution budget | Controlled suspension/fallback with diagnostic, not main-thread runaway |
| I01 | Authenticated wallet no longer owns a token | Fresh provider evidence controls permission; login alone grants no ownership |
| I02 | Reorg or stale ownership resolver | Pending/stale state, no unauthorized local transfer |
| I03 | Download an external-token presentation | Does not mint, transfer or fabricate token ownership |

## Creator workflow

Automate fresh project → layer import → mask → effect → tilt mapping → back video → posters/descriptions → lite preview → save/reload → export → clean host import. Verify persisted IDs, mask alignment, undo history, explicit unsupported-import warnings and deterministic export. Create a second composition from the same recipes with a different layout to prove templates do not force a composition.

For animation, import distinct poses, align anchors and inspect the resulting atlas before export. For a batch/AI workflow, invalid asset references and unsupported recipe versions must return structured errors with useful document paths. A valid export must be reproducible without the original editor session.

## Checks supplied with this design

`node docs/complex-cards/check-examples.mjs` validates the example manifest and two scene documents against the included draft schemas, then checks references, capability declarations, atlas bounds and track targets/order. It also requires 12 deliberately invalid examples to fail.

Passing that checker establishes consistency of the supplied design examples. It does **not** establish any runtime gate above, archive/media safety, rendering fidelity, deployment or mobile performance. Record the actual checker run in the design delivery; do not count it as implementation of the player.
