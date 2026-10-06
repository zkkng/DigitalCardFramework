# Workflow capabilities

New catalogs default to accounts, catalog browsing and collection inventory. Pack acquisition, direct card sales, user trade offers and resale are separate opt-ins. The example catalog explicitly selects the `demo` preset; copying its configuration enables all four workflows.

Set `capabilities` in the catalog before publishing:

```js
capabilities: {
  version: 1,
  preset: 'storefront',
  primitives: { issuance: true, settlement: true }
}
```

This profile enables direct card sales without packs, trade offers or resale. An admin shop can issue a `mint-card` listing and sell its exact reserved units through the normal listing quote and purchase commands.

| Preset | Enabled workflows |
| --- | --- |
| `minimal` (default) | None |
| `storefront` | `directSales` |
| `packCollection` | `packs` |
| `demo` | `packs`, `directSales`, `trading`, `resale` |

Explicit `workflows` booleans override the preset, including `false`. Omitted workflow flags inherit the preset. Omitted primitive flags are `false`; presets never install providers or grant permissions. Published catalogs contain the resolved version, all workflow flags and all primitive flags, rather than the preset shorthand. Unknown fields, unsupported versions and non-boolean flags fail validation.

| Workflow | Required primitives |
| --- | --- |
| `packs` | `issuance`; paid acquisition also requires `settlement` |
| `directSales` | `issuance`, `settlement` |
| `trading` | `transfer`; offers containing currency also require `settlement` |
| `resale` | `transfer`, `settlement` |

These primitives describe enabled framework operations. User trade offers are distinct from the transfer primitive used by resale. Resale still checks ownership, copy transfer policy, account restrictions, tradable currency, balances and listing terms. It does not require `features.cardTrading` or `features.currencyTrading`. Those older flags restrict the contents of new user trade offers.

For paid packs without other workflows, use `preset: 'packCollection'` with `issuance` and `settlement` enabled. An issuance-only pack profile supports zero-price primary `mint-pack` listings; catalog pack products continue to require a positive price. For resale without trade offers, set `workflows: {resale: true}` with `transfer` and `settlement` enabled. These configurations work through the headless API and do not require the bundled frontend. Run `node examples/capabilities.mjs` to inspect the four example profiles.

## Availability and admission

`GET /api/capabilities`, also exposed as `client.capabilities()`, returns the current principal's `configured` and `available` workflow flags, a `draining` workflow list, `history: {codes, rewards}`, `migrationRequired`, and contract `version: 1`. Availability includes account restrictions, site pauses and the commerce switch. It is a feature-level hint: individual products, prices, transfer policies, permissions and provider requirements are checked again when executing a command. History flags indicate retained code and delivery records for this principal, independently of enabled workflows; they preserve Code history and Account rewards navigation after admissions stop.

Disabled workflow admissions fail with `FEATURE_DISABLED` before committing state. A required primitive that is unavailable produces `CAPABILITY_UNAVAILABLE`. Existing immutable request receipts are looked up before new admission checks, so replay retains the original result after disabling a workflow. Disabling the commerce switch also rejects new shops and listings, including operator-created shops.

The reference frontend loads capability information before optional models. A collection-only mount requests catalog, account, capabilities and inventory, plus the command recovery journal when that API is supported. It omits pack, wallet, album and trade queries and their navigation, empty states and counters. Pending work keeps its applicable recovery view available through the `draining` list.

## Disable, drain and re-enable

Publish a new catalog version with the relevant workflow set to `false`. Retain the primitives needed by accepted obligations; removing one causes an atomic `CAPABILITY_OBLIGATION` rejection. This includes unopened packs, pending trade escrow, active listings and unresolved external purchase preparations. Publishing a profile does not cancel accepted work, recreate receipts or repeat deliveries.

Paid packs remain openable. Trade escrow remains cancellable or acceptable under current ownership, recipient authorization and transfer policies. Listings remain cancellable or expirable so reserved stock can be released. Existing raffle purchase rights can be claimed while new entries and ordinary purchases are disabled. Completed command receipts remain replayable. Re-enable by publishing another catalog version with the desired workflow flags; prior request keys still identify their original operations.

Read and history APIs remain available to authorized principals after disable. Workflow controls do not delete inventory, receipts, code history or delivery records. Security restrictions such as a blocked account or revoked operator permission still apply during recovery.

The production host starts action delivery and maintenance timers only when pending jobs, trade escrow or active listings require them. It refreshes that plan after API mutations and worker cycles, and stops timers after the work drains. `workerPlan(operator)` exposes the same pending-work summary to custom hosts; custom schedulers should reconcile it after their own headless mutations. Existing queued deliveries continue after their originating workflow is disabled.

## Existing installations

A persisted catalog from before capability profiles is not silently converted to new defaults. Reads and accepted-work recovery remain available, while new workflow admissions return `CAPABILITY_MIGRATION_REQUIRED`. `GET /api/capabilities` reports `migrationRequired: true`.

Read the installed catalog through the operator API, explicitly choose the workflows and primitives to retain, increment its catalog version, and publish through the normal catalog import preview/commit flow. Preserve existing IDs and product revisions unless changing those products. The publication transaction checks accepted obligations and rejects removal of required primitives. A deliberate all-disabled profile must still retain primitives needed to drain old work.

Review host-specific permissions, currency providers and action handlers separately. A capability profile does not create credentials or replace provider configuration.
