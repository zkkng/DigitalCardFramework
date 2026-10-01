# Allocate a limited drop with a raffle

Applies to framework 0.2. Run `node examples/raffles.mjs`. This implementation uses **free entry for a chance to purchase**, with no paid entry tickets.

## Create reserved stock and entry terms

Add raffle terms to an ordinary shop listing:

```js
const listing=framework.createListing(operator,{
  key:'limited-drop',shopId,title:'Limited release',
  price:{currencyId:'credits',amount:50},
  items:{kind:'mint-card',variantId:'limited.holo',quantity:20},
  previewAt:'2027-06-01T00:00:00Z',startsAt:'2027-06-02T00:00:00Z',
  raffle:{entryClosesAt:'2027-06-03T00:00:00Z',claimSeconds:3600,winners:20}
});
```

The listing's start time is the opening of entries. Winners cannot exceed stock. Claim windows range from 60 seconds to seven days. If a listing end time is provided, it must leave the full claim window after the entry deadline. Draws delayed by a scheduler may have a shorter remaining window when that end is reached.

The same reserved-stock, shop ownership, accepted-currency and issuance rules apply as in [shops](shops-and-releases.md). Raffle stock is exclusive to this listing and cannot also be sold directly or entered into another transaction.

## Enter and draw

```js
framework.enterRaffle(player,{key:'entry-1',listingId});
const status=framework.raffleStatus(player,{listingId});
// After the entry deadline, on a trusted worker:
framework.drawRaffle(drawPrincipal,{key:'draw-1',listingId});
```

One entry is allowed per verified framework account. Repeating entry never charges or creates another entry. The account must be eligible to purchase, cannot be the seller, and must not be blocked by the seller. `policies.canPurchase` can add host-specific eligibility. There is no balance hold at entry; a winner may need to fund their account before claiming.

The `raffles.draw` permission is required to draw. Cryptographic `randomInt` selects unique winners and assigns each an exclusive stock unit in one transaction. An optional `raffleRandom(bound)` constructor provider must return an integer in `[0,bound)`; use it only with a reviewed randomness source. Draw results persist once, even when another request key is used. Empty or undersubscribed raffles are valid and award no more winners than entrants.

The production maintenance cycle calls `drawDueRaffles(principal,{limit:20})` every minute. Another host can schedule that method or call `drawRaffle` directly. Maintenance does not grant premature entry, drawing or purchase permission. Notifications identify winning accounts and their claim deadline.

## Claim and expire

A winner calls `quoteListing` and `buyListing` as for an ordinary shop purchase. The server checks the current authenticated account, assigned unit, unclaimed win, funds, current policy and deadline. Each win buys exactly one unit. A failed payment preserves the win until its deadline. Another account cannot claim it, and a repeated purchase cannot consume it twice.

Claims start when the draw commits, not when a client animation plays. `raffleStatus` returns entry count, the current account's entry/win/claim state, draw time and applicable deadline; it never lists other entrants. Full winner records are restricted to the operator draw result and trusted persisted state.

After the claim deadline, maintenance releases unclaimed stock and closes the listing. There is no automatic redraw. Canceling closes unused rights and returns unsold stock; completed orders remain valid. Stock beyond the winner count is also returned when the listing closes. Create a new listing to offer returned stock under new terms.

## Scope and customization

The default Marketplace renders free-entry terms, entry status, draw-pending state and winner claim controls. Replace its listing renderer or the complete view without altering allocation. The headless APIs support bot-driven publication and management.

This is an auditable server draw, not a cryptographic public fairness proof. A database operator remains trusted. Account uniqueness is not a defense against a person controlling several accounts; host identity and eligibility controls must address that. Paid lottery tickets, automatic redraws, transferable winning rights, provable-randomness protocols and any jurisdiction-specific requirements are not supplied by this contract.

HTTP: `POST /api/raffles/enter`, `/api/raffles/status`, `/api/operator/raffles/draw`, followed by the ordinary listing quote and purchase endpoints. See [OpenAPI](openapi.json).
