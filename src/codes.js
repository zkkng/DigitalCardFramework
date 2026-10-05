import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { check, text, integer, jsonObject } from './catalog.js';
import { hasPermission } from './access.js';
import { safeData, page } from './data.js';

const identifier = (value, name) => {
  text(value, name, 100);
  check(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), 'INVALID_INPUT', 'Invalid ' + name);
  return value;
};
const terminal = new Set(['redeemed', 'revoked']);
const expired = (row, at) => row.expiresAt !== null && Date.parse(row.expiresAt) <= Date.parse(at);
const context = row => JSON.stringify([row.id, row.poolId, row.providerId]);
const initialize = s => { s.codePools ??= {}; s.codes ??= {}; s.codeRequests ??= {}; s.codeConfirmations ??= {}; };
const operator = (actor, permission) => check(hasPermission(actor, permission), 'FORBIDDEN', 'Operator authority required: ' + permission, 403);
const user = (s, actor) => {
  check(actor?.disabled !== true && actor?.userId && Object.hasOwn(s.users, actor.userId), 'UNAUTHENTICATED', 'A verified user is required', 401);
  return s.users[actor.userId];
};
function event(s, type, data, at) { s.events.push({ id: randomUUID(), sequence: s.events.length + 1, type, data, at }); }
function touch(s, row, at, type, actorId, details = {}, emit = event) {
  row.history.push({ type, at, actorId, ...details });
  const copy = s.copies[row.copyId];
  if (copy && copy.ownerId === row.holderId) copy.version++;
  emit(s, type, { codeId: row.id, copyId: row.copyId, actorId, ...details }, at);
}
function held(s, actor, codeId) {
  const u = user(s, actor), row = s.codes?.[codeId], copy = s.copies[row?.copyId];
  check(row && row.holderId === u.id && copy && copy.state !== 'sealed', 'NOT_FOUND', 'Code not found', 404);
  return row;
}
function unlocked(s, row) {
  const copy = s.copies[row.copyId];
  check(copy?.ownerId !== row.holderId || !copy.lockedBy, 'CARD_LOCKED', 'Release the reservation before accessing this code', 409);
}

/** Secret-free projection used for history, card inspection and public trade disclosures. */
export function codeSummary(s, row, viewerId, at) {
  const copy = s.copies[row.copyId], own = row.holderId === viewerId;
  const unavailable = !own ? 'This code belongs to another holder.' : copy?.state === 'sealed' ? 'Open the pack first.' : !row.revealedAt && (expired(row, at) || terminal.has(row.status)) ? 'This code expired or became unavailable before reveal.' : copy?.ownerId === row.holderId && copy?.lockedBy ? 'Release the reservation before accessing this code.' : null;
  const summary = { id: row.id, attachmentId: row.attachmentId, title: row.title,
    providerId: row.providerId, status: expired(row, at) && !terminal.has(row.status) ? 'expired' : row.status,
    revealed: row.revealedAt !== null, reportedUsed: row.reportedUsed, transfer: row.transfer,
    reveal: row.reveal, expiresAt: row.expiresAt, canReveal: !unavailable, revealUnavailableReason: unavailable,
    redeemedAt: row.redeemedAt, revokedAt: row.revokedAt };
  if (!own) return summary;
  return { ...summary, copyId: row.copyId, cardId: copy.cardId, name: copy.definition.name,
    poolId:row.poolId, batchId:row.batchId, importedAt:row.importedAt,
    createdAt: row.allocatedAt, revealedAt: row.revealedAt, redeemUrl: row.redeemUrl,
    instructions: row.instructions, provenance: structuredClone(copy.provenance ?? copy.source),
    history: structuredClone(row.history), metadata: structuredClone(row.metadata) };
}

export function codeTransferReason(s, copy) {
  for (const codeId of copy.codeIds ?? []) {
    const row = s.codes[codeId];
    if (row.transfer === 'block') return 'Attached code blocks transfer';
    if (row.transfer === 'follow-unrevealed' && (row.revealedAt || row.reportedUsed || terminal.has(row.status)))
      return 'This code was disclosed or used and cannot follow a trade';
  }
  return null;
}
export function transferCodes(s, copy, from, to, tradeId, at, emit = event) {
  for (const codeId of copy.codeIds ?? []) {
    const row = s.codes[codeId];
    if (row.transfer !== 'follow-unrevealed') continue;
    row.holderId = to;
    row.holderHistory.push(from);
    row.history.push({ type: 'code.transferred', from, to, tradeId, at });
    emit(s, 'code.transferred', { codeId, copyId: copy.id, from, to, tradeId }, at);
  }
}
export function codeStockAvailable(s, specs, at) {
  const required = new Map();
  for (const spec of specs ?? []) required.set(spec.poolId, (required.get(spec.poolId) ?? 0) + 1);
  for (const [poolId, count] of required) {
    if (!s.codePools?.[poolId]?.enabled) return false;
    if (s.codePools[poolId].generator) continue;
    if (Object.values(s.codes ?? {}).filter(row => row.poolId === poolId && row.status === 'available' && !expired(row, at)).length < count) return false;
  }
  return true;
}
export function allocateCodes(s, copy, specs, at, generate, emit = event) {
  copy.codeIds = [];
  for (const spec of specs ?? []) {
    const pool = s.codePools?.[spec.poolId];
    check(pool?.enabled, 'CODE_POOL_UNAVAILABLE', 'Code pool is unavailable', 409);
    const row = pool.generator ? generate(pool) : Object.values(s.codes ?? {}).find(row => row.poolId === pool.id && row.status === 'available' && !expired(row, at));
    check(row, 'CODE_STOCK_EXHAUSTED', 'Code pool is exhausted', 409);
    Object.assign(row, { status: 'allocated', copyId: copy.id, holderId: copy.ownerId,
      attachmentId: spec.id, reveal: spec.reveal, transfer: spec.transfer, title: spec.title ?? pool.name,
      redeemUrl: pool.redeemUrl, instructions: pool.instructions, allocatedAt: at });
    copy.codeIds.push(row.id);
    touch(s, row, at, 'code.allocated', copy.ownerId, {}, emit);
  }
}

/** Uses the same transaction store as pack allocation. No raw codes in projections or retry records. */
export class CodeService {
  #store; #vault; #clock; #maxCodes; #maxRequests; #generators; #emit;
  constructor({ store, vault, clock, generators = {}, maxCodes = 50000, maxRequests = 200000, emit = event }) {
    integer(maxCodes, 'code capacity', 1, 1000000); integer(maxRequests, 'code request capacity', 1, 10000000);
    this.#store = store; this.#vault = vault; this.#clock = clock; this.#generators = generators;
    check(typeof emit === 'function', 'INVALID_INPUT', 'Code event emitter must be a function');
    this.#maxCodes = maxCodes; this.#maxRequests = maxRequests; this.#emit = emit;
  }
  #keys() { check(this.#vault, 'CODE_KEYS', 'Configure the server code vault first', 503); return this.#vault; }
  #checkVault(s) {
    const vault=this.#keys(), marker=vault.fingerprint({purpose:'digital-card-code-index-v1'});
    check(!s.codeIndexCheck || s.codeIndexCheck===marker,'CODE_KEYS','Code index key does not match stored inventory',503);
    s.codeIndexCheck=marker;return vault;
  }
  #once(s, actorId, key, operation, input, fn) {
    text(key, 'idempotency key', 128); initialize(s);
    const vault = this.#checkVault(s), token = vault.fingerprint({ actorId, key }), hash = vault.fingerprint({ operation, input });
    const old = s.codeRequests[token];
    if (old) { check(old.hash === hash, 'IDEMPOTENCY_CONFLICT', 'Code request key already used', 409); return structuredClone(old.result); }
    check(Object.keys(s.codeRequests).length < this.#maxRequests, 'INSTALLATION_CAPACITY', 'Code request capacity reached', 507);
    const result = fn(); s.codeRequests[token] = { hash, result: structuredClone(result) }; return result;
  }

  /** Read-only readiness check; it never allocates stock or invokes a generator. */
  assertAllocationReady(s, specs = [], at, { quantity = 1 } = {}) {
    integer(quantity, 'code allocation quantity', 1, 1000000);
    check(Array.isArray(specs), 'INVALID_INPUT', 'Code attachments must be an array');
    if (!specs.length) return { requiredCodes: 0, generatedCodes: 0 };
    check(typeof at === 'string' && Number.isFinite(Date.parse(at)), 'INVALID_INPUT', 'Allocation time is required');
    const vault = this.#keys(), marker = vault.fingerprint({ purpose: 'digital-card-code-index-v1' });
    check(!s.codeIndexCheck || s.codeIndexCheck === marker, 'CODE_KEYS', 'Code index key does not match stored inventory', 503);
    const required = new Map();
    for (const spec of specs) {
      const count = (required.get(spec?.poolId) ?? 0) + quantity;
      integer(count, 'required code count', 1, 1000000);
      required.set(spec?.poolId, count);
    }
    let generatedCodes = 0, requiredCodes = 0;
    for (const [poolId, count] of required) {
      const pool = s.codePools?.[poolId];
      check(pool?.enabled, 'CODE_POOL_UNAVAILABLE', 'Code pool is unavailable', 409);
      requiredCodes += count;
      if (pool.generator) {
        const generator = Object.hasOwn(this.#generators, pool.generator) && this.#generators[pool.generator];
        check(typeof generator === 'function', 'MISSING_CODE_GENERATOR', 'Code generator unavailable', 503);
        check(!types.isAsyncFunction(generator) && !types.isGeneratorFunction(generator) && !['[object AsyncFunction]', '[object GeneratorFunction]', '[object AsyncGeneratorFunction]'].includes(Object.prototype.toString.call(generator)), 'INVALID_PROVIDER', 'Code generator must return synchronously');
        generatedCodes += count;
        continue;
      }
      const available = Object.values(s.codes ?? {}).filter(row => row.poolId === poolId && row.status === 'available' && !expired(row, at));
      check(available.length >= count, 'CODE_STOCK_EXHAUSTED', 'Code pool is exhausted', 409);
      // Every eligible row can become the next draw after another committed allocation.
      for (const row of available) {
        check(row.providerId === pool.providerId, 'CODE_INTEGRITY', 'Code provider does not match its pool', 500);
        const value = vault.open(row.secret, context(row));
        check(row.fingerprint === vault.fingerprint({ providerId: row.providerId, code: value }), 'CODE_INTEGRITY', 'Code lookup fingerprint does not match its encrypted value', 500);
      }
    }
    if (generatedCodes) this.assertGeneratedCapacity(s, generatedCodes);
    return { requiredCodes, generatedCodes };
  }

  assertGeneratedCapacity(s, count) {
    integer(count, 'generated code count', 0);
    check(Object.keys(s.codes ?? {}).length + count <= this.#maxCodes, 'INSTALLATION_CAPACITY', 'Code capacity reached', 507);
  }

  allocateGenerated(s, pool, copy, at) {
    const generator = this.#generators[pool.generator];
    check(typeof generator === 'function', 'MISSING_CODE_GENERATOR', 'Code generator unavailable', 503);
    check(Object.keys(s.codes ?? {}).length < this.#maxCodes, 'INSTALLATION_CAPACITY', 'Code capacity reached', 507);
    const value = generator({ copy: structuredClone(copy), pool: structuredClone(pool) });
    if(value && typeof value.then==='function')Promise.resolve(value).catch(()=>{});
    check(value && !value.then, 'INVALID_PROVIDER', 'Code generator must return synchronously');
    text(value.code, 'generated code', 512);
    check(!/[\u0000-\u001f\u007f]/.test(value.code), 'INVALID_PROVIDER', 'Generated code contains control characters');
    const code = pool.normalization === 'upper-trim' ? value.code.trim().toUpperCase() : value.code;
    text(code,'generated code',512);
    const vault = this.#checkVault(s), fingerprint = vault.fingerprint({providerId:pool.providerId,code});
    check(!Object.values(s.codes).some(row=>row.fingerprint===fingerprint || (value.externalId && row.providerId===pool.providerId && row.externalId===value.externalId)), 'DUPLICATE_CODE', 'Generated identity collision', 409);
    if(value.externalId !== undefined)text(value.externalId,'external code reference',300);
    const row={id:randomUUID(),poolId:pool.id,providerId:pool.providerId,fingerprint,batchId:null,importedAt:at,
      externalId:value.externalId??null,expiresAt:null,metadata:jsonObject(value.metadata??{}),status:'available',
      copyId:null,holderId:null,holderHistory:[],allocatedAt:null,revealedAt:null,revealedBy:null,
      reportedUsed:false,redeemedAt:null,revokedAt:null,history:[]};
    row.secret=vault.seal(code,context(row));s.codes[row.id]=row;return row;
  }
  allocate(s,copy,specs,at) { return allocateCodes(s,copy,specs,at,(pool)=>this.allocateGenerated(s,pool,copy,at),this.#emit); }
  transfer(s,copy,from,to,tradeId,at) { return transferCodes(s,copy,from,to,tradeId,at,this.#emit); }
  registrationMaterial(actor,codeId) {
    operator(actor,'codes.manage'); identifier(codeId,'code ID');
    return this.#store.read(s=>{
      const row=s.codes?.[codeId];check(row,'NOT_FOUND','Code not found',404);
      const vault=this.#keys();check(!s.codeIndexCheck||s.codeIndexCheck===vault.fingerprint({purpose:'digital-card-code-index-v1'}),'CODE_KEYS','Code index key does not match stored inventory',503);
      return {codeId:row.id,providerId:row.providerId,externalId:row.externalId,holderId:row.holderId,
        copyId:row.copyId,metadata:structuredClone(row.metadata),code:vault.open(row.secret,context(row))};
    });
  }

  configurePool(actor, { key, pool }) {
    operator(actor, 'codes.manage');
    const clean = safeData(pool); check(clean && typeof clean==='object' && !Array.isArray(clean),'INVALID_INPUT','Pool must be an object');
    identifier(clean.id, 'pool ID'); identifier(clean.providerId, 'provider ID'); text(clean.name, 'pool name');
    if(clean.generator!==undefined){identifier(clean.generator,'generator ID');check(typeof this.#generators[clean.generator]==='function','MISSING_CODE_GENERATOR','Install the configured code generator',503);}
    clean.normalization ??= 'exact'; clean.enabled ??= true; clean.metadata = jsonObject(clean.metadata ?? {});
    clean.instructions ??= ''; clean.redeemUrl ??= null;
    check(['exact', 'upper-trim'].includes(clean.normalization) && typeof clean.enabled === 'boolean', 'INVALID_INPUT', 'Invalid pool policy');
    check(typeof clean.instructions === 'string' && clean.instructions.length <= 2000, 'INVALID_INPUT', 'Instructions are too long');
    if (clean.redeemUrl !== null) {
      let url; try { url = new URL(clean.redeemUrl); } catch {}
      check(url?.protocol === 'https:' && !url.username && !url.password && clean.redeemUrl.length <= 2000, 'INVALID_INPUT', 'Redemption link must be HTTPS without credentials');
    }
    check(Object.keys(clean).every(k => ['id', 'providerId', 'name', 'normalization', 'enabled', 'metadata', 'instructions', 'redeemUrl', 'generator'].includes(k)), 'INVALID_INPUT', 'Unknown pool field');
    return this.#store.transact(s => this.#once(s, actor.userId ?? 'operator', key, 'pool', clean, () => {
      const old = s.codePools[clean.id];
      check(Object.values(s.codePools).every(pool=>pool.providerId!==clean.providerId||pool.normalization===clean.normalization),'POOL_IDENTITY','Pools for one provider must use the same normalization',409);
      check(!old || old.providerId === clean.providerId && old.normalization === clean.normalization && old.generator === clean.generator, 'POOL_IDENTITY', 'Provider, normalization and generator are immutable', 409);
      check(old || Object.keys(s.codePools).length < 1000, 'INSTALLATION_CAPACITY', 'Too many code pools', 507);
      s.codePools[clean.id] = { ...clean, createdAt: old?.createdAt ?? this.#clock() };
      this.#emit(s, 'code.pool-configured', { poolId: clean.id, actorId: actor.userId ?? null }, this.#clock());
      return s.codePools[clean.id];
    }));
  }
  importBatch(actor, { key, poolId, codes, metadata = {} }) {
    operator(actor, 'codes.import'); identifier(poolId, 'pool ID');
    const input = safeData({ poolId, codes, metadata }, { maxBytes: 2 * 1024 * 1024 });
    check(Array.isArray(codes) && codes.length > 0 && codes.length <= 1000, 'INVALID_INPUT', 'Import 1–1000 codes per batch');
    jsonObject(metadata);
    return this.#store.transact(s => this.#once(s, actor.userId ?? 'operator', key, 'import', input, () => {
      const pool = s.codePools[poolId]; check(pool, 'NOT_FOUND', 'Pool not found', 404);
      check(Object.keys(s.codes).length + codes.length <= this.#maxCodes, 'INSTALLATION_CAPACITY', 'Code capacity reached', 507);
      const fingerprints = new Set(Object.values(s.codes).map(row => row.fingerprint));
      const batchId = randomUUID(), at = this.#clock(), ids = [];
      for (const item of codes) {
        check(item && Object.keys(item).every(k => ['code', 'expiresAt', 'externalId', 'metadata'].includes(k)), 'INVALID_INPUT', 'Invalid code entry');
        text(item.code, 'code', 512); check(!/[\u0000-\u001f\u007f]/.test(item.code), 'INVALID_INPUT', 'Code contains control characters');
        const value = pool.normalization === 'upper-trim' ? item.code.trim().toUpperCase() : item.code;
        const fingerprint = this.#vault.fingerprint({ providerId: pool.providerId, code: value });
        check(!fingerprints.has(fingerprint), 'DUPLICATE_CODE', 'Batch contains an already imported code', 409); fingerprints.add(fingerprint);
        const expiresAt = item.expiresAt ?? null;
        check(expiresAt === null || typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.parse(at), 'INVALID_INPUT', 'Code expiry must be in the future');
        if (item.externalId !== undefined) {
          text(item.externalId, 'external code reference', 300);
          check(!Object.values(s.codes).some(row=>row.providerId===pool.providerId&&row.externalId===item.externalId),'DUPLICATE_CODE','External code reference is already imported',409);
        }
        const row = { id: randomUUID(), poolId, providerId: pool.providerId, fingerprint,
          batchId, importedAt: at, externalId: item.externalId ?? null, expiresAt, metadata: jsonObject(item.metadata ?? {}),
          status: 'available', copyId: null, holderId: null, holderHistory: [], allocatedAt: null,
          revealedAt: null, revealedBy: null, reportedUsed: false, redeemedAt: null, revokedAt: null, history: [] };
        row.secret = this.#vault.seal(value, context(row)); s.codes[row.id] = row; ids.push(row.id);
      }
      this.#emit(s, 'code.batch-imported', { batchId, poolId, count: ids.length, actorId: actor.userId ?? null, metadata: jsonObject(metadata) }, at);
      return { batchId, poolId, count: ids.length, ids, importedAt: at };
    }));
  }
  pools(actor) {
    operator(actor, 'codes.manage');
    return this.#store.read(s => Object.values(s.codePools ?? {}).map(pool => ({ ...pool,
      counts: Object.values(s.codes ?? {}).filter(row => row.poolId === pool.id).reduce((out, row) => {
        const state = expired(row, this.#clock()) && !terminal.has(row.status) ? 'expired' : row.status;
        out[state] = (out[state] ?? 0) + 1; return out;
      }, {}) })));
  }
  inventory(actor, options = {}) {
    operator(actor,'codes.manage');
    return this.#store.read(s=>page(Object.values(s.codes??{}).map(row=>({
      id:row.id,name:row.title??s.codePools[row.poolId].name,createdAt:row.importedAt,
      poolId:row.poolId,providerId:row.providerId,batchId:row.batchId,externalId:row.externalId,
      importedAt:row.importedAt,expiresAt:row.expiresAt,allocatedAt:row.allocatedAt,
      status:expired(row,this.#clock())&&!terminal.has(row.status)?'expired':row.status,
      copyId:row.copyId,holderId:row.holderId,holderHistory:row.holderHistory,
      revealedAt:row.revealedAt,reportedUsed:row.reportedUsed,redeemedAt:row.redeemedAt,
      revokedAt:row.revokedAt,metadata:row.metadata,history:row.history,
    })),options));
  }
  history(actor, options = {}) {
    return this.#store.read(s => {
      const u = user(s, actor);
      const rows = Object.values(s.codes ?? {}).filter(row => s.copies[row.copyId]?.state !== 'sealed' && (row.holderId === u.id || row.holderHistory.includes(u.id)))
        .map(row => ({ ...codeSummary(s, row, u.id, this.#clock()), copyId: row.copyId,
          name: s.copies[row.copyId].definition.name, createdAt: row.allocatedAt }));
      return page(rows, options);
    });
  }
  reveal(actor, { key, codeId }) {
    identifier(codeId, 'code ID');
    // Recheck entitlement even on a replay: no secret is persisted in a retry result.
    return this.#store.transact(s => {
      const row = held(s, actor, codeId); unlocked(s, row);
      if (!row.revealedAt) check(!expired(row, this.#clock()) && !terminal.has(row.status), 'CODE_UNAVAILABLE', 'Code has expired or is no longer available', 410);
      const code = this.#keys().open(row.secret, context(row));
      this.#once(s, actor.userId, key, 'reveal', { codeId }, () => {
        if (!row.revealedAt) { row.revealedAt = this.#clock(); row.revealedBy = actor.userId; touch(s, row, row.revealedAt, 'code.revealed', actor.userId, {}, this.#emit); }
        return { codeId };
      });
      return { ...codeSummary(s, row, actor.userId, this.#clock()), code };
    });
  }
  reportUsage(actor, { key, codeId, used = true }) {
    identifier(codeId, 'code ID'); check(typeof used === 'boolean', 'INVALID_INPUT', 'used must be boolean');
    return this.#store.transact(s => {
      const row = held(s, actor, codeId); unlocked(s, row);
      check(row.revealedAt, 'CODE_NOT_REVEALED', 'Reveal the code before reporting usage', 409);
      return this.#once(s, actor.userId, key, 'report', { codeId, used }, () => {
        row.reportedUsed = used; touch(s, row, this.#clock(), 'code.usage-reported', actor.userId, { used }, this.#emit);
        return codeSummary(s, row, actor.userId, this.#clock());
      });
    });
  }
  confirm(actor, { providerId, eventId, codeId, status, occurredAt }) {
    operator(actor, 'codes.confirm'); identifier(providerId, 'provider ID'); identifier(codeId, 'code ID'); text(eventId, 'provider event ID', 300);
    check(!actor.codeProviderIds||actor.codeProviderIds.includes(providerId),'FORBIDDEN','Provider confirmation scope does not match',403);
    check(terminal.has(status), 'INVALID_INPUT', 'Provider status must be redeemed or revoked');
    check(typeof occurredAt === 'string' && Number.isFinite(Date.parse(occurredAt)), 'INVALID_INPUT', 'Provider event time is required');
    return this.#store.transact(s => {
      initialize(s); const row = s.codes[codeId];
      check(row?.providerId === providerId, 'NOT_FOUND', 'Provider code not found', 404);
      const vault = this.#checkVault(s), token = vault.fingerprint({ providerId, eventId }), hash = vault.fingerprint({ codeId, status, occurredAt });
      if (s.codeConfirmations[token]) { check(s.codeConfirmations[token].hash === hash, 'PROVIDER_EVENT_CONFLICT', 'Provider event reused with different data', 409); return { codeId, status: row.status }; }
      check(Object.keys(s.codeConfirmations).length < this.#maxRequests, 'INSTALLATION_CAPACITY', 'Code confirmation capacity reached', 507);
      check(!terminal.has(row.status) || row.status === status, 'CODE_STATE_CONFLICT', 'Conflicting terminal code status requires operator investigation', 409);
      if (row.status !== status) {
        row.status = status; row[status === 'redeemed' ? 'redeemedAt' : 'revokedAt'] = occurredAt;
        touch(s, row, this.#clock(), 'code.' + status, actor.userId ?? null, { providerId, eventId, occurredAt }, this.#emit);
      }
      s.codeConfirmations[token] = { hash, codeId, providerId, eventId, status, occurredAt };
      return { codeId, status: row.status };
    });
  }
  /** Trusted host-only lookup material. Never mount this as an HTTP read route. */
  lookupMaterial(actor, codeId) {
    identifier(codeId, 'code ID');
    return this.#store.read(s => {
      const row = held(s, actor, codeId);
      return { codeId, providerId: row.providerId, externalId: row.externalId, code: this.#keys().open(row.secret, context(row)) };
    });
  }
  rotateEncryption(actor) {
    operator(actor, 'codes.manage');
    return this.#store.transact(s => {
      const vault=this.#checkVault(s);
      let count = 0;
      for (const row of Object.values(s.codes ?? {})) { row.secret = vault.seal(vault.open(row.secret, context(row)), context(row)); count++; }
      this.#emit(s, 'code.keys-rotated', { count, actorId: actor.userId ?? null }, this.#clock());
      return { count };
    });
  }
  verifyVault(actor) {
    operator(actor,'codes.manage');
    return this.#store.read(s=>{if(!Object.keys(s.codes??{}).length)return {count:0};const vault=this.#checkVault(s);for(const row of Object.values(s.codes)){const code=vault.open(row.secret,context(row));check(row.fingerprint===vault.fingerprint({providerId:row.providerId,code}),'CODE_INTEGRITY','Code lookup fingerprint does not match its encrypted value',500);}return {count:Object.keys(s.codes).length};});
  }
}
