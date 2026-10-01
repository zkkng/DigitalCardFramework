# Playground UI verification

30 September 2026, local Windows / Node 24.19.0 / Chrome and the in-app browser.

## Changes

- Card Atelier shell, scoped theme, CSS pack illustrations and geometric fallback card faces.
- Optional named navigation with account balances and sealed-pack count; section mode remains available for alternate compositions.
- Product contents, prices, quantity, base odds and duplicate policy explanation.
- Purchase handoff to My packs, sealed/opened states, concealed card backs, reveal counts, saved-result replay and new/duplicate labels.
- Filtered collection, checkbox selection for trade-ups and offered cards, participant and currency menus.
- Private album creation, automatic display, collection sync and public album browsing.
- Native dialog inspection, edition/opening metadata, keyboard tilt, flip, Escape and explicit close.

## Checks completed

- Existing 41 core, HTTP, client, contract and persistence tests passed after the presentation changes. These tests do not establish visual correctness.
- In-app browser at its existing narrow pane width: shop navigation, collection, card inspector and existing album display inspected visually.
- Desktop Chrome: Rowan/Morgan account switching; Morgan purchased Discovery for 100 Credits (2,000 → 1,900), then opened the pack (0 → 3 owned cards, sealed count 1 → 0), and revealed all cards. Reveal controls disabled on completion.
- Morgan created a private album with three cards. Its display loaded automatically.
- Public album list loaded and Morgan viewed Rowan's existing three-card public album.
- Trading form showed owned-card checkboxes, named recipient and tradable currency choices. No offer was sent during this UI pass.
- Wallet preview displayed 100 Credits → 1 Gem using the configured values. No conversion was submitted during this UI pass.
- The alternate host composition was checked separately with its theme, overridden back and metadata, horizontal album and instant reveal modal.

Automatic approval review rejected creating a new public demo album because it changes sharing access. Private creation and existing public browsing were verified instead; no sharing permission was changed during this check. Trade-up consumption and trade acceptance are covered by the existing core tests, not a new browser mutation in this pass.

Runtime data and screenshots stay outside the Git history. Hosts can replace the visuals through the existing documented renderers, theme/CSS, layout and headless controller contracts.
