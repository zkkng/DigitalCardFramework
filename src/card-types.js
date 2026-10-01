/** Browser-safe defaults. Types describe cards; attached entitlements add capabilities. */
export const cardTypeDefaults = Object.freeze(Object.fromEntries([
  ['collectible', true, true, true], ['playable', true, true, true],
  ['art', true, true, true], ['token', true, true, false],
  ['checklist', false, true, false], ['code', false, false, false],
  ['voucher', false, false, false],
].map(([id, visible, tradable, tradeUp]) => [id, Object.freeze({
  collectionDefault: visible, albumDefault: visible, albumEligible: true, tradable, tradeUp,
})])));

export function cardBehavior(definition) {
  return { ...(cardTypeDefaults[definition.type ?? 'collectible'] ?? cardTypeDefaults.collectible), ...definition.behavior };
}
