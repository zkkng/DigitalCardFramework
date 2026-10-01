import { check, integer, text, jsonObject } from "./catalog.js";
import { contentDigest } from "./importer.js";
import { safeData } from "./data.js";

export const tradingDefaults = Object.freeze({
  enabled: true,
  defaultDecision: "allow",
  rules: [],
  maxCardsPerSide: 100,
  maxCurrenciesPerSide: 20,
  allowGifts: true,
  minAccountAgeSeconds: 0,
  cooldownSeconds: 0,
  maxExpirySeconds: 604800,
  allowedCurrencyIds: null,
});
const fields = {
  copyIds: (c) => c.id,
  cardIds: (c) => c.cardId,
  variantIds: (c) => c.variantId,
  lineIds: (c) => c.lineId,
  rarityIds: (c) => c.rarityId,
  types: (c) => c.definition.type ?? "collectible",
};
export function validateTradingPolicy(input) {
  jsonObject(input);
  const p = { ...tradingDefaults, ...safeData(input) };
  check(
    Object.keys(p).every((k) => Object.hasOwn(tradingDefaults, k)),
    "INVALID_INPUT",
    "Unknown trading setting",
  );
  check(
    typeof p.enabled === "boolean" &&
      typeof p.allowGifts === "boolean" &&
      ["allow", "deny"].includes(p.defaultDecision),
    "INVALID_INPUT",
    "Invalid trading decision",
  );
  for (const [key, max] of Object.entries({
    maxCardsPerSide: 1000,
    maxCurrenciesPerSide: 100,
    minAccountAgeSeconds: 31536000,
    cooldownSeconds: 31536000,
    maxExpirySeconds: 604800,
  }))
    integer(p[key], key, key === "maxExpirySeconds" ? 1 : 0, max);
  if (p.allowedCurrencyIds !== null)
    check(
      Array.isArray(p.allowedCurrencyIds) &&
        p.allowedCurrencyIds.length <= 100 &&
        p.allowedCurrencyIds.every((v) => typeof v === "string"),
      "INVALID_INPUT",
      "Invalid trading currency list",
    );
  check(
    Array.isArray(p.rules) && p.rules.length <= 200,
    "INVALID_INPUT",
    "At most 200 trading rules",
  );
  const ids = new Set();
  for (const rule of p.rules) {
    jsonObject(rule);
    check(
      Object.keys(rule).every((k) =>
        ["id", "decision", "reason", "channels", "match"].includes(k),
      ),
      "INVALID_INPUT",
      "Unknown trading rule field",
    );
    text(rule.id, "rule ID", 100);
    check(!ids.has(rule.id), "INVALID_INPUT", "Duplicate rule ID");
    ids.add(rule.id);
    check(
      ["allow", "deny"].includes(rule.decision),
      "INVALID_INPUT",
      "Invalid rule decision",
    );
    text(rule.reason, "rule reason", 300);
    rule.channels ??= ["trade", "sale"];
    check(
      Array.isArray(rule.channels) &&
        rule.channels.length > 0 &&
        rule.channels.every((x) => ["trade", "sale"].includes(x)),
      "INVALID_INPUT",
      "Invalid rule channels",
    );
    jsonObject((rule.match ??= {}));
    for (const [key, values] of Object.entries(rule.match)) {
      check(
        [...Object.keys(fields), "tags", "metadata"].includes(key),
        "INVALID_INPUT",
        "Unknown rule selector",
      );
      if (key === "metadata") jsonObject(values);
      else
        check(
          Array.isArray(values) &&
            values.length > 0 &&
            values.length <= 1000 &&
            values.every((v) => typeof v === "string"),
          "INVALID_INPUT",
          "Invalid rule selector list",
        );
    }
  }
  return p;
}
export function transferPolicyReason(s, copy, channel, at) {
  const lock = copy.transferLock;
  if (lock && (!lock.until || Date.parse(lock.until) > Date.parse(at)))
    return lock.reason;
  const p = s.tradingPolicy?.policy ?? tradingDefaults;
  if (!p.enabled) return "Transfers are disabled";
  for (const rule of p.rules) {
    if (!rule.channels.includes(channel)) continue;
    const matches = Object.entries(rule.match).every(([key, values]) =>
      key === "tags"
        ? values.some((v) => copy.definition.tags?.includes(v))
        : key === "metadata"
          ? Object.entries(values).every(
              ([k, v]) =>
                Object.hasOwn(copy.definition.metadata ?? {}, k) &&
                contentDigest(copy.definition.metadata[k]) === contentDigest(v),
            )
          : values.includes(fields[key](copy)),
    );
    if (matches) return rule.decision === "allow" ? null : rule.reason;
  }
  return p.defaultDecision === "deny"
    ? "No transfer rule allows this card"
    : null;
}
export function assertTradePolicy(
  s,
  { fromUserId, toUserId, give, receive, expiresInSeconds },
  at,
) {
  const p = s.tradingPolicy?.policy ?? tradingDefaults;
  check(p.enabled, "TRANSFER_BLOCKED", "Trading is disabled", 403);
  for (const side of [give, receive]) {
    check(
      side.copyIds.length <= p.maxCardsPerSide &&
        side.currencies.length <= p.maxCurrenciesPerSide,
      "TRANSFER_BLOCKED",
      "Offer exceeds configured limits",
      403,
    );
    check(
      !p.allowedCurrencyIds ||
        side.currencies.every((x) =>
          p.allowedCurrencyIds.includes(x.currencyId),
        ),
      "TRANSFER_BLOCKED",
      "Currency is excluded from trading",
      403,
    );
  }
  check(
    p.allowGifts ||
      (give.copyIds.length + give.currencies.length > 0 &&
        receive.copyIds.length + receive.currencies.length > 0),
    "TRANSFER_BLOCKED",
    "One-way gifts are disabled",
    403,
  );
  if (expiresInSeconds !== undefined)
    check(
      expiresInSeconds <= p.maxExpirySeconds,
      "TRANSFER_BLOCKED",
      "Offer expiry exceeds configured limit",
      403,
    );
  for (const id of [fromUserId, toUserId]) {
    const user = s.users[id];
    check(
      Date.parse(at) - Date.parse(user.createdAt) >=
        p.minAccountAgeSeconds * 1000,
      "TRANSFER_BLOCKED",
      "Account is too new to trade",
      403,
    );
    check(
      !user.lastTradeAt ||
        Date.parse(at) - Date.parse(user.lastTradeAt) >=
          p.cooldownSeconds * 1000,
      "TRANSFER_BLOCKED",
      "Trading cooldown is active",
      403,
    );
  }
}
