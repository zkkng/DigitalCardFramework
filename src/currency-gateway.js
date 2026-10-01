import { check, text, integer } from "./catalog.js";

/** Server-only bridge: irrevocably settled external funds become local ledger units.
 * Providers fetch/verify authoritative evidence; request bodies never carry an amount.
 */
export function createCurrencyGateway({
  framework,
  providers,
  timeoutMs = 15000,
}) {
  integer(timeoutMs, "provider timeout", 1, 120000);
  const registry = new Map();
  for (const [id, provider] of Object.entries(providers ?? {})) {
    text(id, "provider ID", 100);
    check(
      typeof provider.resolveAccount === "function" &&
        typeof provider.lookup === "function",
      "INVALID_PROVIDER",
      "Provider needs resolveAccount and lookup",
    );
    check(
      provider.currencies && typeof provider.currencies === "object",
      "INVALID_PROVIDER",
      "Explicit currency mappings required",
    );
    for (const mapping of Object.values(provider.currencies)) {
      text(mapping.currencyId, "currency ID", 100);
      for (const key of ["numerator", "denominator"])
        integer(mapping[key] ?? 1, key, 1, Number.MAX_SAFE_INTEGER);
    }
    registry.set(id, {
      ...provider,
      currencies: structuredClone(provider.currencies),
    });
  }
  return {
    describe() {
      return [...registry].map(([id, p]) => ({
        id,
        currencies: structuredClone(p.currencies),
        contract: "dc.currency-settlement@1",
      }));
    },
    async reconcile(actor, { providerId, transactionId }, { signal } = {}) {
      framework.me(actor); // Includes disabled-user and existence checks.
      text(transactionId, "external transaction ID", 300);
      const provider = registry.get(providerId);
      check(provider, "UNKNOWN_PROVIDER", "Unknown currency provider", 404);
      const deadline = AbortSignal.timeout(timeoutMs),
        combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      combined.throwIfAborted();
      let abort;
      try {
        return await Promise.race([
          (async () => {
            const account = await provider.resolveAccount({
              userId: actor.userId,
              signal: combined,
            });
            text(account, "external account", 300);
            const receipt = await provider.lookup({
              transactionId,
              account,
              signal: combined,
            });
            combined.throwIfAborted();
            check(
              receipt?.transactionId === transactionId &&
                receipt?.account === account,
              "SETTLEMENT_MISMATCH",
              "Settlement does not belong to this account",
              403,
            );
            check(
              receipt.status === "settled",
              "SETTLEMENT_PENDING",
              "External funds are not final",
              409,
            );
            const mapping = Object.hasOwn(provider.currencies, receipt.currency)
              ? provider.currencies[receipt.currency]
              : null;
            check(
              mapping,
              "UNKNOWN_CURRENCY",
              "External currency is not mapped",
            );
            check(
              typeof receipt.amountUnits === "string" &&
                /^[1-9][0-9]{0,39}$/.test(receipt.amountUnits),
              "INVALID_PROVIDER",
              "Provider amount must be a positive integer string",
            );
            const numerator =
                BigInt(receipt.amountUnits) * BigInt(mapping.numerator ?? 1),
              denominator = BigInt(mapping.denominator ?? 1);
            check(
              numerator % denominator === 0n,
              "INEXACT_CONVERSION",
              "External amount does not convert to whole ledger units",
            );
            const amount = Number(numerator / denominator);
            integer(amount, "settled amount", 1, Number.MAX_SAFE_INTEGER);
            // Dedicated authority is held by this server composition, never returned to a client.
            return framework.settleExternalCredit(
              { permissions: ["currency.settle"] },
              {
                providerId,
                transactionId,
                userId: actor.userId,
                currencyId: mapping.currencyId,
                amount,
                externalCurrency: receipt.currency,
                externalUnits: receipt.amountUnits,
              },
            );
          })(),
          new Promise((_, reject) => {
            abort = () => reject(combined.reason);
            combined.addEventListener("abort", abort, { once: true });
            if (combined.aborted) abort();
          }),
        ]);
      } finally {
        combined.removeEventListener("abort", abort);
      }
    },
  };
}
