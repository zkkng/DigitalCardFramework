# Add code cards and hybrid rewards

Applies to framework 0.2. Use the headless APIs, HTTP API, or replaceable private Code history view. Run the complete example with `node examples/code-cards.mjs`.

## Choose a type

| Type | Default collection / album picker | Tradable | Trade-up input |
| --- | --- | --- | --- |
| `collectible` (default), `playable`, `art` | Included | Yes | Yes |
| `token` | Included | Yes | No |
| `checklist` | Hidden | Yes | No |
| `code`, `voucher`, `reward` | Hidden | No | No |

These types classify cards and supply behavior defaults. They do not implement game rules, stored-value balances or ticket scanning. All default types are album-eligible; the picker can explicitly include hidden inserts. Override `behavior.collectionDefault`, `albumDefault`, `albumEligible`, `tradable` and `tradeUp` on a card definition. Issued copies retain their behavior snapshot after catalog changes.

Declare your own type in catalog `cardTypes`, for example:

```js
cardTypes: [{id:'example.ticket', name:'Admission ticket', defaults:{
  collectionDefault:false, albumDefault:false, albumEligible:false,
  tradable:false, tradeUp:false
}}]
```

Custom type IDs need a namespace. Validation rejects undeclared types. A **hybrid** is an ordinary card variant with code attachments; it keeps its ordinary collection behavior. Code-bearing copies cannot be consumed as trade-up inputs, even if their card type normally permits it.

For account unlocks without displaying a code, declare `onOpen` actions instead. Code, voucher and reward variants accept code attachments, opening actions, or both. See [account rewards](card-actions.md).

## Attach a code and add an insert slot

A code or voucher variant requires at least one attachment. Any variant can have up to eight. Attachments hold references, never raw secrets:

```js
// Catalog variant
{id:'bonus.standard', cardId:'bonus', rarityId:'common', codes:[{
  id:'reward', poolId:'external.rewards', title:'Your game reward',
  reveal:'scratch', transfer:'retain'
}]}

// Add this slot to a product alongside its ordinary card slots.
{id:'bonus', role:'insert', count:1,
 pool:[{variantId:'bonus.standard', weight:1}],
 metadata:{campaign:'summer'}}
```

A guaranteed slot with `count:1` produces one insert per pack. Add `probability:{numerator:1,denominator:5}` for a one-in-five chance. The decision happens once per slot per pack. An insert does not satisfy normal-card pity or duplicate protection. Every product needs at least one guaranteed slot.

Codes are reserved at purchase, in the same transaction as payment and card issuance. Opening animations do not allocate another code. If required stock runs out, the entire purchase rolls back. Optional slots are skipped only by their configured probability, not silently because of missing stock. A pool with multiple variants chooses among available outcomes using existing weighted draw rules.

## Configure encrypted stock

Supply a vault to `new CardFramework({store,codeVault})`. Import only codes already valid at the external service. Importing a string does not register it at that service.

```js
import {createCodeVault} from '@digital-card/framework/code-vault';
const codeVault=createCodeVault({
  activeKeyId:'v1',
  keys:{v1:encryptionKeyBuffer}, // 32 random bytes, kept outside the database
  indexKey:indexKeyBuffer      // separate persistent 32-byte key
});

framework.configureCodePool(operator, {key:'pool-create',pool:{
  id:'external.rewards',providerId:'example.game',name:'Game reward',
  normalization:'exact',enabled:true,
  redeemUrl:'https://example.com/redeem',
  instructions:'Enter this code in your game account.',
  metadata:{region:'global'}
}});
framework.importCodes(operator, {key:'delivery-123',poolId:'external.rewards',
  codes:receivedCodes.map(item=>({code:item.value,externalId:item.id,
    expiresAt:item.expiry,metadata:{edition:'summer'}})),
  metadata:{delivery:'123'}
});
```

The server principal needs `codes.manage` to configure pools, `codes.import` to add stock, and `codes.confirm` to record verified external status. Player JSON cannot grant those permissions. HTTP operator routes additionally require `exposeOperators:true`.

Imports are atomic and idempotent, limited to 1,000 entries / 2 MiB per batch. Code values are nonempty strings up to 512 characters without control characters. Duplicate codes and external references are rejected across all pools sharing a provider. `exact` preserves spelling and whitespace; `upper-trim` explicitly trims and uppercases. All pools for one provider must share normalization, and pool provider/normalization cannot change later. Use a stable retry key for the same batch; changed contents require a new key.

`codePools(operator)` returns pool configuration and counts. `codeInventory(operator,{limit,after,search,sort})` returns paginated secret-free stock records, including batch ID, external reference, allocation, holder history and lifecycle. Search by batch or provider reference to reconcile a delivery without revealing values. Both require `codes.manage`.

Stock uses AES-256-GCM envelopes with authenticated row/pool/provider context. Duplicate lookup and retry input fingerprints use a separate HMAC key. Plaintext is absent from saved retry results, state events, catalogs, receipts and history. Do not put secrets in metadata, artwork, legacy arbitrary bindings, URLs, logs or portable card bundles: those fields are not secret storage.

## Reveal, report and verify usage

```js
const history=framework.codeHistory(player,{limit:24,search:'summer'});
const secret=framework.revealCode(player,{key:'reveal-123',codeId});
framework.reportCodeUsage(player,{key:'report-123',codeId,used:true});
```

Private history is paginated and includes used, expired, revoked and retained codes. The reveal endpoint rechecks current entitlement on every retry. It rejects sealed packs, another holder, trade locks and an initial reveal after expiry or revocation/redemption. An authorized holder can reread a code they already revealed, including after expiry or use. History provides `canReveal` and an explanation when access is unavailable.

Three facts stay separate:

- **Revealed:** the server disclosed the code to its holder.
- **Reported used:** the holder marked it used; they can clear this personal annotation.
- **Redeemed / revoked:** a trusted operator or provider confirmed a terminal status.

Code responses use `Cache-Control: no-store`. The reference UI keeps secrets only in memory and clears its view on disposal. A bearer code cannot be made secret again after someone copies it.

For provider status lookup, supply `createCodeGateway({framework,providers})` from the public `code-gateway` subpath. Each configured provider implements `lookup({codeId,providerId,externalId,code,signal})` and returns `{codeId,status:'unknown'}` or `{codeId,status:'redeemed'|'revoked',eventId,occurredAt}`. The adapter must authenticate its upstream response and honor cancellation. The bridge validates code identity, enforces a timeout, sanitizes provider errors and deduplicates confirmed events. It performs no external redemption action.

A verified webhook can instead call `confirmCodeStatus` with those fields plus `providerId`. Verify its signature before constructing a server principal. Restrict that principal with `permissions:['codes.confirm'],codeProviderIds:['example.game']`. Reused events with conflicting payloads and conflicting terminal states fail closed. Without provider integration, reported usage remains unverified.

## Decide what happens on trade

| Attachment policy | Result |
| --- | --- |
| `retain` (default) | The original holder retains the code and history when the physical card copy trades. The next owner cannot reveal it. |
| `follow-unrevealed` | The entitlement moves with the card while undisclosed and unused. Reveal, reported use, confirmed use or revocation blocks later transfer. Prior holders retain a secret-free historical entry. |
| `block` | The attachment blocks card transfer. |

The card's `behavior.tradable` must also allow trading. A code card is nontradable by default. Trade review includes attachment status, and entitlement changes update copy versions so stale offers cannot silently complete. These policies govern in-app access; external providers govern whether a code is valid at redemption time.

## Replace the reveal interaction

`mountFramework(root,{client,codeRevealRenderer})` accepts a complete custom renderer. Use `views.codes` to replace the entire history view or remove `codes` from configured sections. Headless users need no DOM.

```js
import {renderCodeReveal,createCodeRevealController}
  from '@digital-card/framework/code-ui';

const view=renderCodeReveal({codeId,mode:'peel'}, {
  reveal:input=>client.revealCode(input),
  key:client.requestKey,
  threshold:0.45
});
container.append(view.node);
// On unmount:
view.dispose();
```

Built-in `scratch` and `peel` interactions call the authenticated reveal callback after the threshold is reached. An equivalent button supports keyboard users. `open` automatically calls the same endpoint only inside the private history view. No secret sits underneath a cosmetic mask before reveal. The headless controller coalesces in-flight requests and retains the same key for retry. Never put reveal results or import inputs into a persistent command queue.

Custom renderer signature: `({codeId,mode},{reveal,key}) => {node,dispose}`. A renderer receives a callback, not preloaded plaintext. Replace the look and gesture without modifying authorization. The runnable [example](../examples/code-cards.mjs) demonstrates ordinary cards, hybrids, inserts and an alternative provider composition using public APIs.

## Read origin metadata

Every new copy has immutable `provenance` with `version`, `catalogVersion`, `issuedAt`, `definitionDigest`, `variantDigest` and its source fields. Pack copies also record:

- `purchaseId`, `packId`, `productId`, `productRevision`, `productDigest`;
- `packIndex`, `position`, `slotId`, `slotIndex`, `slotRole`, `slotOrdinal`;
- `packMetadata` and `slotMetadata` snapshots.

Trade-up origins record their input copy IDs. Non-pack origins remain explicit. Copy issue, opening, code allocation/disclosure/status and card transfers emit ordered events. Code history retains import/batch information in operator state and holder lifecycle entries. There is no plaintext code in those events. Authorized operators use existing event APIs; owners inspect their copies and private code history. Public views omit purchase linkage, private pack/slot metadata and account transfer trails.

`backfillProvenance(operator)` requires `maintenance.run` and fills only missing records from existing copy/pack evidence. The production host runs it on startup. Reconstructed records are marked `reconstructed:true`; unavailable historical fields remain absent or null. Backfill cannot recover metadata never recorded. Metadata objects are bounded to 32 KiB, depth 16 and 10,000 nodes; they are structured data, not executable code.

## Deploy and operate

The production host reads `CODE_ACTIVE_KEY_ID`, `CODE_VAULT_KEYS` (JSON mapping key ID to 64-digit hexadecimal key) and `CODE_INDEX_KEY` (64 hexadecimal digits). Keys also support `_FILE` secret injection. Keep code keys distinct from each other and the state encryption key. Startup verifies stored code envelopes and fails if a code-bearing catalog lacks vault configuration.

Rotate encryption by loading both old and new keys, selecting the new active key, and invoking trusted server-only `rotateCodeEncryption(operator)`. Verify with `verifyCodeVault(operator)` before removing old keys. Keep keys needed by old backups. **Keep the index key stable**; replacing it fails closed and requires an explicit migration, which is not provided. Back up the database and both key families separately and test restores.

`codeLimits:{maxCodes,maxRequests}` adjusts bounded inventory and retry/confirmation capacities (defaults 50,000 and 200,000). SQLite still has its whole-state 64 MiB default limit; those row limits do not promise that every payload will fit. Allocation is transactional across connections, not a distributed high-throughput service. Configure production identity, TLS, rate limiting and access according to [production setup](production.md). Refund/reissue policy, upstream redemption, webhook authentication and retention requirements belong to the host.

See [HTTP schemas](openapi.json) for private `/codes`, `/codes/reveal`, `/codes/report`, optional `/codes/reconcile`, and privileged `/operator/codes`, `/operator/code-pools`, `/operator/codes/import`, `/operator/codes/confirm`. All paths are under `/api`.
