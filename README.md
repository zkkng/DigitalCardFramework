# Digital Card Framework

**Build a digital card collection around your own artwork, community, or game.**

Digital Card Framework is a self-hosted backend for creating, distributing, and collecting digital cards. It includes a visual **Card Maker Studio**, an interactive card player, and a basic reference website. Use them together, embed individual components, or connect your own frontend.

**Active development:** implemented features are still being hardened; APIs may change.

![Two layered cards turning back and forth, with shifting depth, fireworks, petals, and reflected light](https://github.com/user-attachments/assets/af94fd67-6148-474a-9720-2d243f186a86)

*A 30 fps loop from the player, showing two cards in a connected scene. Artwork is hosted separately.*

## What it does today

| Area | Features |
| --- | --- |
| Cards | Simple images or layered, animated faces; backs, foil and holographic finishes, depth, flip/zoom, and connected compositions |
| Collections | Accounts, owned copies, numbered editions and ownership history; search, favorites, wishlists, and public or private albums |
| Distribution | Configurable packs, rarity, prices, limited editions, opening reveals, duplicate rules, and trade-ups |
| Trading and shops | Card/currency offers, administrator and player shops, scheduled releases, and free draws for a chance to buy limited releases |
| Content and rewards | Bulk catalog imports, custom stats and metadata, private code cards, and opening rewards connected through host integrations |

## Card Maker Studio

![Card Maker Studio with a layered card preview, layer list, finish controls, and export tools](https://github.com/user-attachments/assets/3707d905-4606-4882-ab36-4e538c48b64c)

- **Start with your art:** turn an image into a card, import supported PSD/ORA/ZIP layers, or open an existing card package.
- **Text and stats:** edit typography, embed custom fonts, bind typed metadata, and reuse masks, styles and templates. Administrators can enforce versioned [card policies](docs/card-authoring-policies.md).
- **Build the look:** arrange front/back layers, adjust depth and finishes, paint effect masks, and add animated GIF or video layers.
- **Preview and hand off:** turn the card live, undo/redo changes, save local drafts and editable projects, capture still previews, and export portable `.dcard` files.

Layered imports report compatibility limits. Advanced motion can require code or JSON. The reference site connects visual editing to reviewed catalog publication; exporting a card does not issue an owned copy.

## Make it yours

Define your artwork, card data, rarities, currencies, pack rules, and trading policies. Developers can replace views, themes, renderers, and host adapters through public APIs, or use the backend without the bundled website. Optional rendering adapters support additional media.

The reference website provides basic collecting workflows. Major layout changes, custom effects, and connections to identity, payment, or game services require developer work. This is a collection framework, not a ready-made card battle game or a drag-and-drop website builder. You supply the artwork and hosting; blockchain is not required.

## Planned

- Simpler setup with independently selectable collecting, pack, trading, and shop capabilities.
- A more complete artist workflow spanning cards, pack artwork, and albums.
- Broader plugin support across programming languages, clearer extension contracts, improved storage and performance, and release hardening.

These are development goals, not yet supported features.

## Documentation

**The wiki is coming soon.** It will be the home for setup instructions, artist tutorials, customization guides, API references, and operations documentation.

For now, use the [existing technical documentation](docs), [card authoring and player guides](docs/complex-cards/README.md), and [customization examples](docs/customization-recipes.md).
