# Digital Card Framework

Headless digital card core with durable SQLite persistence and a verified-host HTTP boundary.

Requires Node.js 24.14 or newer. No dependencies or build step are needed.

Run node --test test/*.test.js to verify user-linked inventories, currencies, pack products, finite editions, retry protection, duplicate recipes, private/public albums, binding privacy and atomic card/currency trades.

Import CardFramework from src/index.js and SQLiteStore from src/sqlite.js. The examples/catalog.js manifest demonstrates unrelated lines and independent pack prices. The host supplies verified operator/player contexts; currencies originate in operator grants into framework-managed wallets.

The browser client and reveal controller are exported separately through /client. A public HTTP contract is in docs/openapi.json. The UI composition is the next implementation commit.

Artwork and host-specific game integration stay outside this repository.
