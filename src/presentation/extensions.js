import { ensure, canonical } from "./data.js";

/** Host-installed code only. A package can request capabilities, never install code. */
export function composeExtensions(
  modules,
  { select = {}, configuration = {}, apiVersion = "0.1.0" } = {},
) {
  const ids = new Map(),
    providers = new Map();
  for (const module of modules) {
    ensure(
      /^[a-z][a-z0-9.-]+$/.test(module.id) && !ids.has(module.id),
      "PLUGIN",
      "Invalid or duplicate module ID",
    );
    ensure(
      /^\d+\.\d+\.\d+$/.test(module.version) &&
        module.apiVersion === apiVersion,
      "PLUGIN_VERSION",
      "Incompatible module " + module.id,
    );
    ensure(
      module.trust === "host-installed" &&
        typeof module.create === "function" &&
        typeof module.estimate === "function" &&
        module.fallback,
      "PLUGIN",
      "Incomplete trusted module contract",
    );
    module.validate?.(configuration[module.id] ?? {});
    ids.set(module.id, module);
    for (const slot of module.provides ?? []) {
      const list = providers.get(slot) ?? [];
      list.push(module);
      providers.set(slot, list);
    }
  }
  const edges = new Map(modules.map((m) => [m.id, new Set()]));
  for (const m of modules) {
    for (const id of m.after ?? []) {
      ensure(ids.has(id), "PLUGIN_ORDER", "Unknown predecessor");
      edges.get(m.id).add(id);
    }
    for (const id of m.before ?? []) {
      ensure(ids.has(id), "PLUGIN_ORDER", "Unknown successor");
      edges.get(id).add(m.id);
    }
  }
  const ordered = [];
  while (ordered.length < modules.length) {
    const next = [...ids.keys()]
      .sort()
      .find(
        (id) =>
          !ordered.includes(id) &&
          [...edges.get(id)].every((x) => ordered.includes(x)),
      );
    ensure(next, "PLUGIN_CYCLE", "Extension ordering cycle");
    ordered.push(next);
  }
  const slots = {};
  for (const [slot, list] of providers) {
    const chosen = select[slot] ?? (list.length === 1 ? list[0].id : null);
    ensure(
      chosen && list.some((m) => m.id === chosen),
      "PLUGIN_CONFLICT",
      "Select exactly one provider for " + slot,
    );
    slots[slot] = chosen;
  }
  for (const slot of Object.keys(select))
    ensure(providers.has(slot), "PLUGIN_SLOT", "Unknown selected slot");
  return {
    modules: ordered.map((id) => ids.get(id)),
    get: (slot) => ids.get(slots[slot]),
    explainComposition: () => ({
      apiVersion,
      order: ordered.slice(),
      slots: { ...slots },
      versions: Object.fromEntries(modules.map((m) => [m.id, m.version])),
    }),
  };
}

/** Each field explicitly grants scopes; limits remain a final host constraint. */
export function resolveConfiguration(schema, layers, { ceilings = {} } = {}) {
  const result = {};
  for (const [key, field] of Object.entries(schema))
    result[key] = structuredClone(field.default);
  for (const { scope, values } of layers)
    for (const [key, value] of Object.entries(values)) {
      const field = schema[key];
      ensure(
        field && field.scopes.includes(scope),
        "CONFIG_SCOPE",
        "Override not permitted: " + key,
      );
      ensure(typeof value === field.type, "CONFIG_TYPE", "Wrong type: " + key);
      if (field.type === "number")
        ensure(
          Number.isFinite(value) &&
            value >= (field.min ?? -Infinity) &&
            value <= (field.max ?? Infinity),
          "CONFIG_RANGE",
          "Out of range: " + key,
        );
      result[key] = value;
    }
  for (const [key, max] of Object.entries(ceilings))
    if (typeof result[key] === "number")
      result[key] = Math.min(result[key], max);
  ensure(canonical(result).length <= 32768, "LIMIT", "Configuration too large");
  return result;
}
