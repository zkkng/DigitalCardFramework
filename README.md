# Digital Card Framework

A working, headless digital card core with a durable SQLite store, HTTP API, browser client, and optional default UI. Pack opening, ownership, albums and economies are generic; unrelated sets and host account systems use the same public interfaces.

Requires Node.js 24.14 or newer. No package installation or build step is needed.

## Run

~~~sh
node --test test/*.test.js
node examples/server.js
~~~

Open http://127.0.0.1:4317 for the standalone demo, or /alternate for a different host composition. The demo uses two fictional accounts, three currencies, two lines, three pack products, a 1-of-1 edition, a duplicate trade-up recipe and private attached data. Dawn uses runtime-generated geometric SVG layers to demonstrate parallax; no artwork files are stored in this repository. It binds only to loopback. Demo starting balances are issued once and the database persists in ignored data/demo.sqlite.

The Card Atelier playground separates Pack shop, My packs, Collection, Albums, Trading and Wallet. Buy a pack, open it in My packs, reveal the saved results, then inspect or display the cards. Switch Rowan/Morgan to test separate inventories. [Navigation and participant configuration](docs/customization-recipes.md#guided-playground-navigation) uses the public UI API; `/alternate` continues to demonstrate a host-owned arrangement.

## Implemented core

- Stable users linked by host provider and immutable subject; one inventory per user.
- Multiple integer-unit currencies with rational relative values, exact conversions, explicit optional rounding, audit ledgers and independent trade permissions.
- Multiple products per line with independent price/currency, quantity limits, weighted slots, rarity tiers and finite variant supply including 1 of 1.
- Server-committed pack contents at purchase; sealed inventory and edition capacity survive restart. Opening/replay never rerolls or charges again.
- Individual copies with immutable source, original opener/time, serial X of Y, current ownership, transfer provenance and definition/variant snapshots.
- Optional duplicate protection by pack or inventory, with an explicit reject/allow fallback.
- Optional recipes consuming a configurable count of matching copies for a weighted higher-rarity result.
- Optional card trades, currency trades or mixed trades. Sender escrow, recipient acceptance, cancellation/decline, expiry, current policy checks and atomic exchange.
- Private/public albums, ordered placements, per-album layout data, optimistic update versions and removal of transferred/consumed cards from previous displays.
- Namespaced attached data with public/private visibility, follow/retain/block transfer rules and single-use local state.
- Durable command idempotency, transaction rollback, a committed event journal and operator-issued currency.
- Replaceable card, back, inspector metadata, album, reveal and page compositions. Defaults include CSS card backs, pointer/keyboard 3D inspection, layered parallax, gloss, holo, emissive layers, foil masks and reduced motion.

## Embed or replace

~~~js
import {CardFramework} from './src/index.js';
import {SQLiteStore} from './src/sqlite.js';

const framework = new CardFramework({store:new SQLiteStore('cards.sqlite')});
// Server-side only: verified operator context and validated host identity.
const operator = {role:'admin'};
framework.publishCatalog(operator, manifest);
const user = framework.registerUser(operator, {
  provider:'your-host', subject:verifiedImmutableSubject, displayName:'Collector'
});
~~~

The browser can mount the reference application or use only the headless client:

~~~js
import {createClient} from './src/client.js';
import {mountFramework} from './src/ui.js';

const app = mountFramework(container, {
  client:createClient(),
  theme:{'--dc-accent':'#bdc4ff'},
  sections:['collection','albums','shop','wallet','packs'],
  cardRenderer:myRenderer,
  albumRenderer:myAlbumLayout
});
await app.ready;
// When your host route unmounts:
app.dispose();
~~~

Use the dedicated public package subpaths when consuming this repository as a package: the root core export, /sqlite, /http, /client and /ui. Browser entrypoints import no Node modules.

Read [API and configuration](docs/core-api.md), [customization recipes](docs/customization-recipes.md), [storage and transaction decisions](docs/adr-001-core-runtime.md) and [implementation coverage](docs/implementation-status.md). [OpenAPI](docs/openapi.json) describes the HTTP resources and command schemas.

The [portable complex card design](docs/complex-cards/README.md) specifies a proposed media bundle, lifecycle-managed player, creator studio, video backs, selective materials, optional 3D/program adapters and mobile resource budgets. It includes research, draft schemas, examples and implementation gates; these new presentation capabilities are not yet implemented.

## Deployment boundary

This is the first core runtime, not a live Quiet Grove integration. Core balances are authoritative inside the framework transaction; an external game wallet is not yet a supported money provider. The host must verify identity and map it to a registered user; the HTTP adapter intentionally accepts no client-supplied user IDs or admin roles. Operator contexts are trusted server objects, never browser credentials.

The SQLite adapter serializes a whole-state document for a small installation. PostgreSQL storage, an external-wallet recovery protocol, migrations beyond schema 1, production rate limiting, external reward delivery, secret encryption/rotation, webhook dispatch and distributed deployment remain separate work. Attached codes are data and local use records; consumeBinding does not deliver a game reward or invalidate an external code. Use retain/block for credentials until a bridge defines rotation/revocation.

Framework code, tests, fixtures and documentation belong in this repository. Artwork and game assets remain in external content storage. Host-specific account and economy integration belongs in a separate integration repository. The [original proposal](docs/proposal/specification.md) remains design guidance; [current coverage](docs/implementation-status.md) distinguishes implemented behavior from future targets.
