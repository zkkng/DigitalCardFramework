# Spend an external wallet on card packs

API version 0.2; external purchase contract version 1. Use this server API when another service owns the player's balance. The framework records the reviewed pack terms, then either creates the complete purchase or records that the original payment needs a refund. It never turns the external payment into a spendable intermediate framework balance.

These methods require trusted host code. The default HTTP adapter does not expose them to browsers. See [core API](core-api.md), [identity and permissions](access-and-identity.md), and [production operations](production.md).

Run `node examples/external-wallet.js` for a headless Shapes purchase using a fictional local wallet. The [example source](../examples/external-wallet.js) shows provider composition through public methods. Its in-memory ledger is a demonstration; an operational host needs durable payment and order storage.

## Register a payment provider

Pass `externalPurchaseProviders` to `CardFramework`. Each entry supplies two synchronous callbacks:

| Callback | Return `true` only when |
| --- | --- |
| `validateIntent({intent,user})` | The account may spend the selected external currency and the external units exactly pay for the quoted framework price. |
| `verifyProof({proof,intent,preparationId,operation})` | Trusted, authenticated evidence proves this exact debit, cancellation fence, or refund and permits the requested operation. |

Obtain evidence from your payment service before calling a framework mutation. Give the callback an immutable, verified record to compare. A receipt supplied by a browser is not evidence. Compare every bound field, including the immutable account, source currency, amount, transaction, fingerprint and receipt reference.

Callbacks run inside a storage transaction. They must not perform network calls, payments, file writes, or other external effects. They receive detached inputs and must return the literal value `true`. Promises, exceptions and other values are rejected. Keep references free of passwords, tokens and redeemable codes.

`operation` is `debit`, `no_debit`, `refund`, or `resolve_legacy`. For `resolve_legacy`, verify current authoritative status as well as the original debit: a previously refunded payment cannot fund an adopted purchase. Historical debit evidence used during terminal replay is distinct from permission to perform a new recovery action.

Construct the actor on the server:

```js
const provider = {
  permissions: ['currency.settle'],
  settlementProviderId: 'host.wallet'
};
```

An administrator also needs the exact provider scope. Never accept this actor from request JSON. Keep a recovery principal available for existing obligations when you disable new purchases.

## Complete a purchase

1. Verify the player's session and obtain a fresh `framework.quote(player,{productId,quantity})`.
2. Persist a unique host order ID and the player's immutable account, selected payment source, exact amount and quote. Preserve them across retries.
3. Call `prepareExternalPurchase(provider,input)`. Persist its `preparationId` and `fingerprint` before requesting payment.
4. Debit the external wallet once, using the same host order ID. Resolve an uncertain debit through that service's durable status or replay API.
5. After a confirmed debit, call `commitExternalPurchase` with verified debit evidence.
6. If the result is `fulfilled`, deliver the returned pack IDs and finalize the external payment. If it is `refund_required`, refund the exact amount to its original source, then call `confirmExternalCompensation` with verified refund evidence.

```js
const prepared = framework.prepareExternalPurchase(provider, {
  key: order.id,
  providerId: 'host.wallet',
  transactionId: order.id,
  userId: player.userId,
  externalCurrency: order.source,
  externalUnits: order.units, // Positive decimal string, for example "250".
  quote: order.quote
});

// debitReceipt comes from authenticated, durable provider evidence.
const result = framework.commitExternalPurchase(provider, {
  preparationId: prepared.preparationId,
  fingerprint: prepared.fingerprint,
  debitReceipt
});
```

Prepare validates the current quote and admission limits. It does not reserve stock or reveal card outcomes. Commit allocates the entire purchase atomically using the original product, catalog and card-policy snapshot. Later price changes, sale expiry and commercial pauses do not change those accepted terms. Current account restrictions, exhausted stock, unavailable code generation or allocation capacity can instead produce `refund_required`. No partial pack, code or internal credit survives failed allocation.

An exception or timeout is never permission to refund. The framework transaction may have committed despite a lost response. Read its durable status or replay the exact command until the outcome is known. Refund only a persisted `refund_required` result. The external wallet must also guarantee that refunds and payment finalization are idempotent and cannot both occur for one debit.

## States and recovery

| State | Next action |
| --- | --- |
| `prepared` | Resolve the external payment. Commit a proven debit, or cancel after a durable no-debit fence. |
| `fulfilled` | Return the original purchase. Finalize the external payment; do not debit or allocate again. |
| `refund_required` | Refund the original account, currency and units once; confirm that refund. |
| `cancelled` | No debit may occur. Preserve the provider's cancellation fence. |
| `compensated` | The original payment was refunded; no purchase was delivered. |
| `quarantined` | Legacy evidence conflicts or is incomplete. Stop automatic settlement and investigate. This state does not authorize a refund. |

`cancelExternalPurchase(provider,{preparationId,fingerprint,noDebitReceipt})` requires evidence that a late debit can no longer commit. A timeout, missing response or momentary “not found” result is insufficient. There is no automatic expiration of prepared purchases.

`confirmExternalCompensation(provider,{preparationId,fingerprint,refundReceipt})` accepts only the expected original-source refund. Repeating an exact terminal command returns its recorded result; changing its terms or evidence conflicts.

Run a recovery job using `pendingExternalPurchases(provider,{providerId,after,limit})`. The default page size is 50; the maximum is 100. Continue with `nextCursor` until it is null. This cursor is an exclusive preparation-ID boundary within the selected provider's pending records; completing or cancelling its referenced purchase does not invalidate it. Restart from the first page on the next recovery pass so newly admitted records before the previous boundary are included. Check the external provider before advancing each order. Keep errors visible to operators and retry unknown outcomes with the same identities.

Use `externalPurchaseStatus(actor,{preparationId})` or `lookupExternalPurchase(actor,{providerId,transactionId})` for individual orders. A collector can read only their own projection. A scoped provider can also read the debit reference needed for recovery. These results omit card outcomes, code secrets, proof hashes and stored catalog snapshots.

## Inputs, proofs and retry identity

All new preparation fields are required: `key`, `providerId`, `transactionId`, `userId`, `externalCurrency`, `externalUnits`, and `quote`. The quote contains `productId`, `quantity`, `productRevision`, `catalogVersion`, `adminRevision`, and `price:{currencyId,amount}`. Use the unmodified quote returned by the framework.

Identifiers and receipt references are bounded to 128 characters without control characters. External units are a positive decimal string of at most 40 digits, with no leading zero. Quantity is 1–100. Prices are positive safe integers; revisions are nonnegative safe integers. Unknown input fields are rejected.

Character limits count Unicode code points. Keep strings unchanged when signing or hashing them; visually identical normalized strings can have different identities.

All proofs contain:

```js
{
  kind: 'debit', // Or 'no_debit' or 'refund'.
  reference: 'opaque-provider-receipt',
  providerId, transactionId, userId,
  externalCurrency, externalUnits, fingerprint
}
```

A refund proof also contains `compensationId` and `debitReference` from the `refund_required` provider projection. A reference is unique across all proof kinds for that provider. Use separate references for a debit, cancellation and refund. Replays require exactly the original evidence.

One provider transaction identifies one purchase, regardless of the preparation key used to find it. A key cannot be reused for a different intent. Keep transaction namespaces unique within each database; do not reuse a provider's IDs after migration or restoration.

Use the package's `externalPurchaseFingerprint(input)` and `externalPurchaseId(providerId,transactionId)` helpers when implementing another adapter. The fingerprint hashes the canonical intent with `version:1`, excluding `key`. Canonical JSON recursively sorts object keys lexicographically, preserves array order and exact strings, uses no whitespace, and is encoded as UTF-8. It does not normalize Unicode. The preparation ID is `ep_` plus the SHA-256 digest of the canonical `{providerId,transactionId}` object. A fingerprint binds terms; it does not authenticate a payment.

Machine-readable input and result definitions are exported by `@digital-card/framework/external-purchase-contracts` and included in the [OpenAPI components](openapi.json). Their presence does not create HTTP routes.

## Limits and legacy orders

The default external limits are 20 pending purchases per user, 1,000 per provider, and 100,000 retained purchases. Override them through trusted `externalPurchaseLimits` configuration after measuring capacity. Preparation reserves space for the failure/refund record before payment. Successful allocation still needs ordinary copy, pack, event and storage capacity. Disk failure or an unknown database commit remains an operational failure, never a refund decision.

Retain completed records, proof bindings and request keys as replay protection. Back up framework state, the host order journal and their keys together. Restore a consistent set while writers are stopped; verify both sides before resuming payment recovery.

For an old external-credit-then-purchase integration, use `reconcileLegacyExternalPurchase` with the original payment terms, verified debit evidence and original `purchaseKey`. It can adopt an exactly matching historical purchase or reverse a proven, still-unspent settlement credit before resolving delivery or refund. It never creates new credit. Missing, spent or contradictory evidence is quarantined. The old settlement and purchase identities are fenced against replay after reconciliation. Do not reset balances or manually refund a quarantined order without reconciling its entire history.

Legacy quotes may omit `adminRevision`; this absence canonicalizes to zero. Preserve the original quote and request identity. If the original delivery terms cannot be reconstructed, a coherent paid order can require a refund instead of silently receiving different cards.

### Resolve a proven earlier purchase

If a legacy order is quarantined as `LEGACY_CREDIT_SPENT`, an operator can explicitly adopt an existing purchase that consumed its credit. This is a narrow recovery operation: the original credit must start from zero and the next movement in that same wallet must be the exact purchase debit back to zero. The earlier purchase must match the original quote and have complete delivery evidence. It cannot already belong to another external order. The operation creates no cards, credit, refund or events.

First obtain current authoritative payment status. Confirm that the original debit was retained and has not been refunded. Use a trusted, attributed actor with the exact provider scope, `currency.settle`, `maintenance.run`, and an immutable `userId` or `id`. Then call:

```js
framework.resolveLegacyExternalPurchase(operator, {
  preparationId: order.preparationId,
  fingerprint: order.fingerprint,
  key: decisionId,
  reason: 'Adopt the verified earlier purchase',
  decision: {kind: 'adopt_purchase', purchaseKey: earlierPurchaseKey}
});
```

Keep the decision key through retries. Reasons contain 1–500 Unicode characters without control characters. A successful result is `fulfilled` with the original intent, original purchase IDs and an attributed `legacyResolution` record. Prior quarantine details remain as history. Changing a recorded decision conflicts. Reconciliation reserves the eligible decision's request slot and encoded result space before accepting that quarantine; ordinary commands cannot consume them. Contradictory evidence leaves the quarantine intact. Insufficient admission space leaves the legacy order unchanged and requiring operator recovery before reconciliation.

This operation does not repair corrupt records or adopt a differently priced product. Keep new economic work paused for an inconsistent installation. Restore a verified consistent backup, retain the external provider's durable payment/refund history, and reconcile every outstanding order before reopening purchases. Never overwrite evidence with guessed balances or receipts.
