export const workflowNames = Object.freeze(['packs', 'directSales', 'trading', 'resale']);
export const primitiveNames = Object.freeze(['issuance', 'transfer', 'settlement']);
const disabled = Object.freeze({packs:false, directSales:false, trading:false, resale:false});
const presets = Object.freeze({
  minimal:disabled,
  storefront:Object.freeze({...disabled, directSales:true}),
  packCollection:Object.freeze({...disabled, packs:true}),
  demo:Object.freeze({packs:true, directSales:true, trading:true, resale:true}),
});
const dependencies = Object.freeze({
  packs:Object.freeze(['issuance']), directSales:Object.freeze(['issuance', 'settlement']),
  trading:Object.freeze(['transfer']), resale:Object.freeze(['transfer', 'settlement']),
});

function invalid(message) {
  const error = new Error(message);
  error.name = 'CapabilityConfigurationError';
  error.code = 'INVALID_CAPABILITY_CONFIG';
  error.status = 400;
  throw error;
}
function record(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path + ' must be a plain object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) invalid(path + ' has an unknown field');
    if (!('value' in Object.getOwnPropertyDescriptor(value, key))) invalid(path + ' cannot contain accessors');
  }
  return value;
}
function flags(value, names, path) {
  record(value, names, path);
  const result = {};
  for (const name of names) {
    if (!Object.hasOwn(value, name)) continue;
    if (typeof value[name] !== 'boolean') invalid(path + '.' + name + ' must be boolean');
    result[name] = value[name];
  }
  return result;
}

/** Workflow presets never install providers or grant permissions. */
export function resolveCapabilities(raw = {}) {
  record(raw, ['version', 'preset', 'workflows', 'primitives'], 'capabilities');
  if (Object.hasOwn(raw, 'version') && raw.version !== 1) invalid('capabilities.version must be 1');
  const preset = Object.hasOwn(raw, 'preset') ? raw.preset : 'minimal';
  if (typeof preset !== 'string' || !Object.hasOwn(presets, preset)) invalid('Unknown capability preset');
  const workflows = Object.freeze({...presets[preset],
    ...flags(Object.hasOwn(raw, 'workflows') ? raw.workflows : {}, workflowNames, 'workflows')});
  const primitives = Object.freeze({issuance:false, transfer:false, settlement:false,
    ...flags(Object.hasOwn(raw, 'primitives') ? raw.primitives : {}, primitiveNames, 'primitives')});
  for (const workflow of workflowNames) {
    if (workflows[workflow]) for (const dependency of dependencies[workflow]) {
      if (!primitives[dependency]) invalid(workflow + ' requires explicitly configured ' + dependency);
    }
  }
  return Object.freeze({version:1, workflows, primitives});
}

function providerDecision(config, required, ready) {
  if (required.some(name => config.primitives[name] !== true)) return {allowed:false, reason:'dependency-missing'};
  if (required.some(name => ready?.[name] !== true)) return {allowed:false, reason:'provider-unavailable'};
  return {allowed:true};
}
export function workflowRequirements(workflow, paid = false) {
  if (!workflowNames.includes(workflow)) invalid('Unknown workflow');
  const required = dependencies[workflow];
  return paid && !required.includes('settlement') ? Object.freeze([...required, 'settlement']) : required;
}

/** Facts must come from current authoritative state, not client availability hints. */
export function admitWorkflow(config, workflow, {permitted, eligible, ready, paid = false}) {
  const required = workflowRequirements(workflow, paid);
  if (config.workflows[workflow] !== true) return {allowed:false, reason:'disabled'};
  if (permitted !== true) return {allowed:false, reason:'forbidden'};
  if (eligible !== true) return {allowed:false, reason:'ineligible'};
  return providerDecision(config, required, ready);
}

function validateObligation(row) {
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.principal !== 'string' || !row.principal
      || !workflowNames.includes(row.workflow) || !['pending', 'settled'].includes(row.state)
      || !Array.isArray(row.recoveryRequirements)
      || row.recoveryRequirements.some(name => !primitiveNames.includes(name))) invalid('Invalid durable capability obligation');
}

/** Disabling admission cannot remove providers needed by accepted work. */
export function transitionCapabilities(next, obligations) {
  const draining = new Set();
  for (const row of obligations) {
    validateObligation(row);
    if (row.state !== 'pending') continue;
    for (const requirement of row.recoveryRequirements) {
      if (next.primitives[requirement] !== true) invalid('Pending obligation ' + row.id + ' requires ' + requirement);
    }
    if (!next.workflows[row.workflow]) draining.add(row.workflow);
  }
  return Object.freeze({next, draining:Object.freeze(workflowNames.filter(name => draining.has(name)))});
}

/** Only server-loaded obligations qualify for draining or immutable receipt replay. */
export function recoverWorkflow(config, obligation, principal, permitted, ready) {
  validateObligation(obligation);
  if (permitted !== true || principal !== obligation.principal) return {allowed:false, reason:'forbidden'};
  if (obligation.state === 'settled') return {allowed:true, replay:true};
  return providerDecision(config, obligation.recoveryRequirements, ready);
}

/** Public hints omit provider configuration and never replace per-resource checks. */
export function capabilityAvailability(config, permitted, ready) {
  return Object.freeze(Object.fromEntries(workflowNames.map(workflow => [workflow,
    config.workflows[workflow] === true && permitted?.[workflow] === true
      && providerDecision(config, dependencies[workflow], ready).allowed])));
}
