/** Run: node examples/external-currency-provider.mjs. Synthetic funds only. */
import assert from "node:assert/strict";
import { CardFramework, createCurrencyGateway } from "../src/index.js";
import { sampleCatalog } from "./catalog.js";
const framework = new CardFramework();
framework.publishCatalog({ role: "admin" }, sampleCatalog);
const user = framework.registerUser(
  { permissions: ["accounts.register"] },
  {
    provider: "example",
    subject: "collector",
    displayName: "Example collector",
  },
);
const externalAccounts = new Map([[user.id, "points-account-1"]]);
// In a real host, this data comes from the authenticated external service.
const receipts = new Map([
  [
    "transfer-001",
    {
      transactionId: "transfer-001",
      account: "points-account-1",
      currency: "POINTS",
      amountUnits: "200",
      status: "settled",
    },
  ],
]);
const gateway = createCurrencyGateway({
  framework,
  providers: {
    "example.points": {
      resolveAccount: ({ userId }) => externalAccounts.get(userId),
      lookup: async ({ transactionId, signal }) => {
        signal.throwIfAborted();
        return structuredClone(receipts.get(transactionId));
      },
      currencies: {
        POINTS: { currencyId: "credits", numerator: 1, denominator: 1 },
      },
    },
  },
});
const actor = { userId: user.id },
  command = { providerId: "example.points", transactionId: "transfer-001" };
const first = await gateway.reconcile(actor, command),
  retry = await gateway.reconcile(actor, command);
assert.deepEqual(first, retry);
assert.equal(framework.wallet(actor).credits, 200);
console.log(
  JSON.stringify(
    {
      creditedOnce: true,
      balance: framework.wallet(actor),
      providers: gateway.describe(),
    },
    null,
    2,
  ),
);
framework.close();
