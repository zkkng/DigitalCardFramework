# Configure trading and resale

Applies to framework 0.2. Run `node examples/trading-controls.mjs` for a complete public-API example.

## Set the installation policy

A verified principal with `trading.manage` replaces the policy using its current revision. Omitted settings take their defaults; this is not a partial merge.

```js
const {revision}=framework.tradingPolicy();
framework.configureTrading(operator,{key:'policy-1',expectedRevision:revision,policy:{
  enabled:true, defaultDecision:'allow', maxCardsPerSide:20,
  allowGifts:true, minAccountAgeSeconds:3600, cooldownSeconds:30,
  allowedCurrencyIds:['credits'], maxExpirySeconds:86400,
  rules:[{
    id:'no-code-transfers',decision:'deny',reason:'Reward cards stay with their holder',
    channels:['trade','sale'],match:{types:['code','reward','voucher']}
  },{
    id:'event-hold',decision:'deny',reason:'This event line is temporarily locked',
    match:{lineIds:['event.line'],tags:['event']}
  }]
}});
```

Rules are evaluated in order; the first matching rule decides allow or deny. Within a rule, every supplied selector must match. List selectors match any listed value. Select by `copyIds`, `cardIds`, `variantIds`, `lineIds`, `rarityIds`, `types`, `tags`, or exact `metadata` values from the issued card definition. Metadata object key ordering does not change equality. Tags and metadata are immutable issued snapshots, so a later catalog edit does not relabel old copies. An empty match selects every card. Channels default to both `trade` and `sale`.

| Setting | Default | Range / behavior |
| --- | --- | --- |
| `enabled` | true | Disable direct trades and card resale |
| `defaultDecision` | allow | Decision when no selector matches |
| `rules` | [] | Up to 200 ordered rules |
| `maxCardsPerSide` | 100 | 0–1,000 |
| `maxCurrenciesPerSide` | 20 | 0–100 |
| `allowGifts` | true | Permit offers with an empty opposing side |
| `minAccountAgeSeconds` | 0 | Up to 31,536,000 |
| `cooldownSeconds` | 0 | Time since the account's last completed trade/resale; up to 31,536,000 |
| `maxExpirySeconds` | 604,800 | 1–604,800; omitted offer expiry uses the smaller of this and 24 hours |
| `allowedCurrencyIds` | null | Null accepts configured eligible currencies; [] disallows currency offers |

Account age, cooldown, gift, quantity and currency restrictions apply to both sides, including secondary shop sales. Paid secondary sales also require the catalog's currency-trading switch. Primary shop issuance has separate purchase authorization; it can sell a card whose definition intentionally makes subsequent transfers impossible.

## Lock one issued copy

```js
framework.setCardTransferLock(operator,{
  key:'hold-copy',copyId,locked:true,reason:'Held for account review',
  until:'2027-01-01T00:00:00Z' // optional; omitted means indefinite
});
framework.setCardTransferLock(operator,{key:'release-copy',copyId,locked:false});
```

This lock is independent of trade/listing escrow. It blocks trades, resale and delivery of reserved primary stock; it increments the copy version so an older reviewed trade cannot complete. Expiry uses server time. Removing an administrative lock does not remove another transaction's reservation.

Locks govern transfers. They do not erase ownership, retract already delivered external rewards or change game rules. Definitions separately control trade-up eligibility. Use those controls when a restricted card must also be excluded from recipe consumption.

## Precedence and rechecks

Ownership, transaction reservations, card-definition nontradability, active individual locks, and code/binding transfer restrictions remain mandatory. A matching allow rule cannot bypass them. Live policy and installed host hooks can further restrict transfers. Direct offer creation and completion check both sides; shop delivery rechecks current restrictions. A tightened policy does not prevent canceling an existing offer and returning its escrow.

## Install custom checks

Pass synchronous server functions through the public constructor or production `HOST_MODULE`:

```js
export const policies={
  canTransfer(copy,ownerId,{channel,toUserId}){
    // toUserId is null during a general inventory/listing eligibility preview.
    return true; // or a safe, public reason string
  },
  canTrade({channel,fromUserId,toUserId,give,receive,expiresInSeconds}){
    return give.copyIds.length<=20 || 'This offer exceeds the host limit';
  }
};
```

Hooks receive cloned context and must make synchronous decisions. Do not call a remote API inside a database transaction. Synchronize external eligibility into a local host policy cache, then recheck at completion. Returning a promise is not an authorization grant. Installed modules are trusted server code; card JSON cannot install one.

The default reference application exposes **Trading controls** to authorized operators, with the complete policy JSON and individual-copy lock controls. Custom applications use the same client methods or replace the view via `views.tradingControls`. All inputs and reasons are rendered as text.

HTTP: `GET /api/trading-policy`, `POST /api/operator/trading`, `POST /api/operator/card-lock`. See [OpenAPI](openapi.json) for bounded request schemas and [identity and access](access-and-identity.md) for server-derived permissions.
