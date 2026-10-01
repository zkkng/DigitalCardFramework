import { CardFramework } from "../src/index.js";
import { sampleCatalog } from "./catalog.js";
/** Fictional accounts and internal currency; never connect this fixture to production. */
export function exampleFramework(options = {}) {
  const core = new CardFramework(options),
    catalog = structuredClone(sampleCatalog),
    operator = { role: "admin" };
  catalog.products.push({
    id: "example.pack",
    lineId: "sky",
    name: "Example pack",
    revision: 1,
    price: { currencyId: "credits", amount: 10 },
    slots: [{ count: 1, pool: [{ variantId: "dawn.standard", weight: 1 }] }],
  });
  options.configureCatalog?.(catalog);
  core.publishCatalog(operator, catalog);
  const register = (subject) => {
    const user = core.registerUser(operator, {
      provider: "example",
      subject,
      displayName: subject,
    });
    core.grantCurrency(operator, {
      key: "initial",
      userId: user.id,
      currencyId: "credits",
      amount: 100,
      reason: "Synthetic example balance",
    });
    return { userId: user.id };
  };
  const seller = register("Seller"),
    buyer = register("Buyer");
  return { core, seller, buyer, operator: { ...seller, role: "admin" } };
}
