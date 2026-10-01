# Deliver account rewards and opening actions

Applies to framework 0.2. Run `node examples/card-actions.mjs`. Use actions when opening a card should unlock an external account item without displaying a bearer code.

## Declare an action reward

```js
// Card definition: hidden from default collection/album pickers.
{id:'welcome.reward',lineId:'welcome',name:'Welcome reward',type:'reward'}

// Variant: public parameters, not credentials or executable source.
{id:'welcome.reward.standard',cardId:'welcome.reward',rarityId:'common',onOpen:[
  {id:'badge',handler:'example.unlock',params:{sku:'welcome-badge'}}
]}
```

Up to 16 uniquely identified `onOpen` actions are allowed per variant. Any ordinary card can also have actions, codes, or both. `code`, `voucher` and `reward` variants need at least one code attachment or opening action. The `reward` type defaults to hidden collection/album discovery, nontradable, not a trade-up input; explicit album inclusion remains available.

The first authoritative opening creates jobs in the same transaction as opening the card. Replaying an animation or repeating `openPack` creates no extra jobs. Direct primary shop cards and trade-up outputs are opened when awarded. `openCard({key,copyId})` opens an owned, unreserved copy obtained through another supported path. The beneficiary is fixed to that opener, even if the card later transfers or is consumed.

## Register trusted server handlers

Production `HOST_MODULE` exports `actionHandlers`; embedded hosts pass them to `new CardFramework({actionHandlers})`.

```js
export const actionHandlers={
  'example.unlock':async({idempotencyKey,userId,params,source,signal})=>{
    const externalAccount=await accountLinks.lookup(userId);
    if(!externalAccount)throw new Error('Account link unavailable');
    await provider.unlock({
      account:externalAccount,sku:params.sku,idempotencyKey,signal
    });
  }
};
```

This snippet assumes host-owned account mapping and an authenticated provider SDK. Validate the requested SKU and provider response in that adapter. The framework supplies the immutable recipient; do not let parameters choose another recipient or grant authority. Catalog publishers can request registered handlers, so expose only operations those publishers are authorized to issue. Catalog action parameters are public.

Handlers may call APIs or run installed application code. The names resolve to a server allowlist; uploaded data cannot supply JavaScript, shell commands or arbitrary request URLs for the framework to execute. Credentials, endpoint configuration and account mapping stay in the host. A handler resolves only after its effect is confirmed, or throws when it is not confirmed. Returned values and raw exceptions are never exposed as reward payloads.

## Delivery guarantees and recovery

Opening commits a durable job before any external request runs. Workers execute jobs afterward. Each job moves through `pending`, `running`, `succeeded`, or `dead`; a lease fences old acknowledgments after another worker takes over. A worker crash can cause retry after lease expiry. Timeouts signal cancellation and ignore late local completion.

**Delivery is at least once.** Every attempt uses the same job ID as its downstream idempotency key. The receiver must persist deduplication records. A remote request may succeed before the worker crashes or times out; the framework cannot make arbitrary external APIs exactly-once. Never implement compensation by assuming a timeout means nothing happened.

Defaults through `actionOptions`:

| Option | Default | Constraint |
| --- | --- | --- |
| `maxAttempts` | 8 | 1–100 per retry cycle |
| `timeoutMs` | 15,000 | 1–300,000 |
| `leaseMs` | 60,000 | Greater than timeout; up to 3,600,000 |
| `retryMs` | 1,000 | Exponential retry base; delay capped at one hour |

The installation's `limits.actionJobs` defaults to 50,000. Job history is bounded to 2,000 entries; the manual retry-receipt table is bounded to 20,000 entries. Capacity exhaustion needs operator intervention. The existing whole-state storage byte limit also applies; row limits are not a throughput promise.

`fulfillments(player,{limit,after})` shows only that player's sanitized status/history. `actionJobs(operator,options)` requires `actions.manage`. `retryAction(operator,{key,jobId})` retries a dead job with the same downstream identity and an idempotent operator request. Review/reconcile an ambiguous external outcome before retrying a provider that lacks deduplication.

## Choose your worker

```js
await framework.dispatchActions(workerPrincipal,{limit:10,signal});
```

The worker principal needs `actions.dispatch`; collectors cannot claim or acknowledge deliveries over HTTP. Alternative workers can call `claimAction(principal)` and `settleAction(principal,{jobId,leaseToken,succeeded})`, using their own execution process. A current unexpired lease is required for settlement. Persisting/claiming happens synchronously; the external work is asynchronous and outside that transaction.

The production host runs a bounded one-second worker when `actionHandlers` are configured. Set `actionWorker:false` in `HOST_MODULE` to run a separate worker. Shutdown aborts the current cycle before closing storage. Missing handlers remain unconfirmed and eventually become dead; installing the handler and explicitly retrying recovers them.

## Subscribe to committed framework events

```js
export const eventSubscriptions=[{
  id:'host.opened',handler:'example.open-notification',events:['card.opened']
}];
```

Subscribers enqueue one durable job per matching core event in the event's transaction. The handler receives `params.event` and a source containing event/subscription IDs. Subscriptions are host configuration, capped at 50 with unique IDs. Explicit event names are preferred; `'*'` observes all core events. Do not create feedback loops by emitting the same observed event from its handler. These subscriptions cover core events; they are not a promise that every internal helper or provider emits a public event. Fulfillment state is available through its own history.

Default **Account rewards** shows delivery state and refresh controls. Operators can switch to the delivery queue and retry dead jobs. Replace `views.rewards`, or import `renderFulfillments` from the `marketplace-ui` package subpath. HTTP exposes private `/api/fulfillments`, privileged `/api/operator/actions` and `/api/operator/actions/retry`; there is no public arbitrary-execution or delivery-acknowledgment endpoint.
