# Default administration panel

Applies to framework 0.2.0. These APIs and the default panel are experimental. The panel supplies everyday controls for the reference website and can be replaced by a host interface.

## Open the panel

Install the root dependencies with `pnpm install --frozen-lockfile`, run `pnpm start`, and open the loopback URL printed by the server. Choose **Rowan**, select **Switch**, then open **Administration**. Rowan is the demo operator; Morgan is a collector. **Basic** shows everyday controls; **Advanced** adds rarity weighting and technical detail. Mode changes do not grant permissions.

For real accounts, configure trusted operator identity through the [production host](production.md). Routes require host operator exposure and server-assigned permissions. Never grant roles from browser input.

| Area | Tasks |
| --- | --- |
| Overview | Check states and reach common tasks |
| Card lines | Pause sales; change pack prices, discounts and rarity weighting |
| People | Search accounts, restrict buying/selling/trading, give or remove cards |
| Website | Control pack purchases, direct trading and user shops |
| Activity | Inspect named administrator changes and their reasons |

## Change a price or discount

1. Open **Card lines**, choose **Manage** for the line, then **Edit** for its pack.
2. Set the regular price and discount. Inspect the final amount in the existing currency.
3. Optionally add a reason, then choose **Review changes**.
4. Check the target and old/new values, then **Save changes**. **Cancel** discards the review.

Prices use whole currency units. Discounts are whole percentages from 0 through 99. The charge rounds down with a minimum of one unit: 101 at 10% off charges 90. Overrides affect future direct catalog purchases; shop listings retain their independent advertised prices. Previous receipts remain unchanged. **Reset pack settings to catalog** clears the price override, discount and rarity factors together.

Advanced rarity multipliers adjust existing pool weights: 2 doubles the base weight, 0 excludes it, and omitted factors use 1. Card rarity/rank does not change. Weighting changes that empty a slot or remove every configured pity-eligible outcome are rejected. Shares describe configured weights; stock, duplicate prevention, optional slots and pity can change actual draws. Existing packs retain their allocated cards.

## Control activity

| Control | Stops | Retains |
| --- | --- | --- |
| Pack purchases | New catalog and listed-pack purchases | Opening owned packs; committed-result recovery |
| Trading | New direct offers and acceptance | Cancellation, rejection and expiry; separate shop sales |
| User shops | New player shops/listings and purchases from them | Records and listing cancellation; separate administrator shops |
| Line sales | Pack and relevant listing sales for the line | Ownership and purchased packs |

These rules apply to custom clients too. Resuming cannot override disabled catalog products, transfer rules or host callbacks. Controls do not delete records or automatically cancel pending obligations. Website shows overall commerce and trading policy status. Per-card rules and host callbacks can still reject an operation.

## Manage a person

Open **People**, use **Find people**, then **Manage** beside the intended account. IDs distinguish duplicate names when necessary.

- Blocking buying prevents purchases by that account.
- Blocking selling prevents new sales and purchases from that seller; listing cancellation remains available.
- Blocking trading prevents direct offers/acceptance involving that account. Shop sales remain separately controlled.

**Give cards** issues a variant/quantity under normal supply and binding rules and may trigger its configured opening effects. **Remove cards** retires exact owned copies, removes album/favorite placements and preserves issuance history. Finite supply and serials are not recycled. Neither action automatically charges or refunds currency.

Removal is unavailable for sealed/reserved copies or cards with codes, bindings or opening actions requiring separate entitlement revocation. Each unavailable choice explains why. Short references distinguish unlimited copies. Granting a new copy does not restore a retired copy's identity.

## Save, retry and history

Every change records a reason. Settings can use an automatic action note; card grants/removals require your explanation. Authorized operators see reasons and changes in **Activity**. Another administration or catalog update can invalidate a review; reload and review again.

The default panel stores pending commands in session storage, preserving the exact request/key across remount or reload in that browser session. Retry the pending action after an uncertain response. Closing the session or storage failure limits this recovery; custom hosts may supply stronger storage. A completed grant is never repeated merely to refresh the screen.

Pack quotes include `adminRevision`. Custom purchase clients must forward it with `productRevision` and `catalogVersion`. `STALE_QUOTE` requires a new quote and review. Previously committed requests remain recoverable during pauses.

## Embed or replace

```js
import {createClient} from '@digital-card/framework/client';
import {mountAdminPanel} from '@digital-card/framework/admin-ui';

const client = createClient();
const me = await client.me();
const panel = mountAdminPanel(document.querySelector('#admin'), {
  client, namespace: me.userId
});
await panel.ready;
// When the host route unmounts:
// panel.dispose();
```

The namespace identifies the authenticated operator. The reference uses `renderAdminPanel` as its `admin` view; replace that view or mount the panel independently. Styles are scoped. `requestLeave(callback)` lets a host route guard unsaved changes before navigation.

For custom markup, import `createAdminController` from `@digital-card/framework/admin-client`. It takes `{client,storage,namespace}` and exposes `getState`, `subscribe`, `load`, `users`, `person`, `history`, `stage`, `cancel`, `confirm` and `dispose`. Stage a `configureAdmin` or `administerCards` command with a named target and readable before/after rows, then confirm after review. The raw controller persists only when storage is supplied. Dispose it on unmount.

The public client exposes `adminOverview`, `adminUsers`, `adminUser`, `adminHistory`, `configureAdmin` and `administerCards`. Reads require `admin.read`, settings `admin.manage`, and inventory changes `admin.cards`. A trusted admin has all three. Advanced mode does not alter authority.

For custom hosts, `playerShopsEnabled:null` uses the host commerce default; a boolean explicitly enables/disables user shops. The independent `playerShopsPaused` setting is an additional veto. Other commerce and transfer policies still apply. See the [HTTP contract](openapi.json) and [executable headless example](../examples/admin-headless.mjs).

Content creation, identity/deployment, currency refunds, account deletion and custom entitlement recovery remain in their respective host workflows.
