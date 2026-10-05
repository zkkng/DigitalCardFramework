import {createHash} from 'node:crypto';
import {check, integer, FrameworkError} from './catalog.js';
import {hasPermission} from './access.js';

const clone = structuredClone;
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const externalPurchaseDigest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const object = (value, fields, optional = []) => {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key) || optional.includes(key)) && fields.every(key => Object.hasOwn(value, key)), 'INVALID_INPUT', 'Unsupported or missing purchase fields');
};
const identifier = (value, name) => check(typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\u0000-\u001f\u007f]/.test(value), 'INVALID_INPUT', 'Invalid ' + name);
const states = ['prepared', 'fulfilled', 'refund_required', 'cancelled', 'compensated', 'quarantined'];
const pending = state => ['prepared', 'refund_required', 'quarantined'].includes(state);

export function externalPurchaseIntent(input, {legacy = false} = {}) {
  for (const name of ['providerId', 'transactionId', 'userId', 'externalCurrency']) identifier(input[name], name);
  check(typeof input.externalUnits === 'string' && /^[1-9][0-9]{0,39}$/.test(input.externalUnits), 'INVALID_INPUT', 'Invalid external units');
  const quote = clone(input.quote);
  if (legacy && quote && !Object.hasOwn(quote, 'adminRevision')) quote.adminRevision = 0;
  object(quote, ['productId', 'quantity', 'productRevision', 'catalogVersion', 'adminRevision', 'price']);
  identifier(quote.productId, 'product ID');
  integer(quote.quantity, 'quantity', 1, 100);
  for (const name of ['productRevision', 'catalogVersion', 'adminRevision']) integer(quote[name], name, 0);
  object(quote.price, ['currencyId', 'amount']); identifier(quote.price.currencyId, 'currency ID'); integer(quote.price.amount, 'price');
  return {version: 1, providerId: input.providerId, transactionId: input.transactionId, userId: input.userId, externalCurrency: input.externalCurrency, externalUnits: input.externalUnits, quote};
}
export const externalPurchaseFingerprint = input => externalPurchaseDigest(externalPurchaseIntent(input));
export const externalPurchaseId = (providerId, transactionId) => {
  identifier(providerId, 'provider ID'); identifier(transactionId, 'transaction ID');
  return 'ep_' + externalPurchaseDigest({providerId, transactionId});
};

/** Provider callbacks attest evidence obtained outside a transaction; they must be synchronous and side-effect free. */
export class ExternalPurchaseService {
  #b; #providers; #limits;
  constructor(bridge, {providers = {}, limits = {}} = {}) {
    object(limits, [], ['pendingPerUser', 'pendingPerProvider', 'records']);
    this.#limits = {pendingPerUser: 20, pendingPerProvider: 1000, records: 100000, ...limits};
    for (const [name, value] of Object.entries(this.#limits)) integer(value, name, 1, 1000000);
    check(providers && typeof providers === 'object' && !Array.isArray(providers), 'INVALID_INPUT', 'External providers must be an object');
    this.#providers = new Map(Object.entries(providers).map(([providerId, provider]) => {
      identifier(providerId, 'provider ID');
      check(typeof provider?.validateIntent === 'function' && typeof provider?.verifyProof === 'function', 'INVALID_PROVIDER', 'External provider requires intent and proof validators');
      return [providerId, {validateIntent: provider.validateIntent, verifyProof: provider.verifyProof}];
    }));
    this.#b = bridge;
  }
  #now() {
    const at = this.#b.clock();
    check(typeof at === 'string' && at.length <= 32 && Number.isFinite(Date.parse(at)), 'INVALID_PROVIDER', 'Invalid purchase clock');
    return at;
  }
  #provider(actor, providerId) {
    check(hasPermission(actor, 'currency.settle') && actor.settlementProviderId === providerId, 'FORBIDDEN', 'Scoped settlement provider required', 403);
    const provider = this.#providers.get(providerId);
    check(provider, 'FORBIDDEN', 'Settlement provider is not registered', 403);
    return provider;
  }
  #attest(callback, context, code) {
    let result;
    try { result = callback(clone(context)); } catch { throw new FrameworkError(code, 'Provider evidence rejected', 403); }
    if (result?.then) { Promise.resolve(result).catch(() => {}); throw new FrameworkError('INVALID_PROVIDER', 'Provider validators must be synchronous', 500); }
    check(result === true, code, 'Provider evidence rejected', 403);
  }
  #init(s) { s.externalPurchases ??= {}; s.externalPurchaseProofs ??= {}; s.externalPurchaseKeys ??= {}; }
  #projection(row, provider = false) {
    const result = {};
    for (const field of ['preparationId', 'fingerprint', 'state', 'terms', 'preparedAt', 'fulfilledAt', 'purchase', 'failureCode', 'compensationId', 'refundRequiredAt', 'cancelledAt', 'compensatedAt', 'quarantinedAt', 'legacyResolution']) if (row[field] !== undefined) result[field] = clone(row[field]);
    if (provider && row.debitReference) result.debitReference = row.debitReference;
    return result;
  }
  #readable(actor, row) {
    check(row && actor?.disabled !== true, 'NOT_FOUND', 'External purchase not found', 404);
    const provider = hasPermission(actor, 'currency.settle') && actor.settlementProviderId === row.terms.providerId && this.#providers.has(row.terms.providerId);
    check(provider || actor?.userId === row.terms.userId, 'NOT_FOUND', 'External purchase not found', 404);
    return this.#projection(row, provider);
  }
  status(actor, input) {
    object(input, ['preparationId']); identifier(input.preparationId, 'preparation ID');
    return this.#b.store.query ? this.#b.store.query(q => this.#readable(actor, q.get('externalPurchases', input.preparationId)))
      : this.#b.store.read(s => this.#readable(actor, own(s.externalPurchases, input.preparationId)));
  }
  lookup(actor, input) {
    object(input, ['providerId', 'transactionId']);
    return this.status(actor, {preparationId: externalPurchaseId(input.providerId, input.transactionId)});
  }
  pending(actor, input) {
    object(input,['providerId'],['after','limit']);
    const {providerId,limit=50}=input,after=input.after??'';
    this.#provider(actor, providerId); integer(limit, 'page limit', 1, 100); check(typeof after==='string','INVALID_INPUT','Cursor must be a string or null');if (after) identifier(after, 'cursor');
    const project = result => ({items: result.items.map(row => this.#projection(row, true)), nextCursor: result.next});
    if (this.#b.store.query) return this.#b.store.query(q => project(q.pageExternalPurchases({providerId, states: ['prepared', 'refund_required', 'quarantined'], after, limit})));
    return this.#b.store.read(s => {
      const rows = Object.values(s.externalPurchases ?? {}).filter(row => row.terms.providerId === providerId && pending(row.state) && row.preparationId > after).sort((a, b) => a.preparationId.localeCompare(b.preparationId));
      return project({items: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].preparationId : null});
    });
  }
  #get(s, actor, input) {
    const row = own(s.externalPurchases, input.preparationId);
    check(row, 'NOT_FOUND', 'External purchase not found', 404);
    const provider = this.#provider(actor, row.terms.providerId);
    check(input.fingerprint === row.fingerprint, 'SETTLEMENT_CONFLICT', 'Purchase fingerprint differs', 409);
    return {row, provider};
  }
  #proof(s, row, provider, proof, kind, operation=kind) {
    const fields = ['kind', 'reference', 'providerId', 'transactionId', 'userId', 'externalCurrency', 'externalUnits', 'fingerprint'];
    object(proof, kind === 'refund' ? [...fields, 'compensationId', 'debitReference'] : fields);
    identifier(proof.reference, 'proof reference');
    check(proof.kind === kind && proof.fingerprint === row.fingerprint && ['providerId', 'transactionId', 'userId', 'externalCurrency', 'externalUnits'].every(name => proof[name] === row.terms[name]), 'SETTLEMENT_CONFLICT', 'Payment proof terms differ', 409);
    if (kind === 'refund') check(proof.compensationId === row.compensationId && proof.debitReference === row.debitReference, 'SETTLEMENT_CONFLICT', 'Refund proof differs from original debit', 409);
    const hash = externalPurchaseDigest(proof), token = externalPurchaseDigest({providerId: row.terms.providerId, reference: proof.reference});
    const existing = own(s.externalPurchaseProofs, token), oldHash = row.proofHashes?.[kind];
    check((!existing || existing.preparationId === row.preparationId && existing.hash === hash) && (!oldHash || oldHash === hash), 'SETTLEMENT_CONFLICT', 'Payment proof already used or changed', 409);
    this.#attest(provider.verifyProof, {proof, intent: row.terms, preparationId: row.preparationId, operation}, 'INVALID_PROOF');
    return {hash, token, kind, reference: proof.reference};
  }
  #saveProof(s, row, proof) {
    row.proofHashes ??= {}; row.proofHashes[proof.kind] = proof.hash;
    row.proofReferences ??= {}; row.proofReferences[proof.kind] = proof.reference;
    s.externalPurchaseProofs[proof.token] = {preparationId: row.preparationId, hash: proof.hash, kind: proof.kind};
    if (proof.kind === 'debit') row.debitReference = proof.reference;
  }
  #measure(s) {
    if (this.#b.store.measure) return this.#b.store.measure(s);
    const usedBytes = Buffer.byteLength(JSON.stringify(s));
    const reservedBytes = Object.values(s.externalPurchases ?? {}).reduce((total, row) => total + (row.completionBytes ?? 0), 0);
    return {usedBytes, reservedBytes, totalBytes: usedBytes + reservedBytes, limitBytes: Infinity};
  }
  #fits(s,previousTotal=0) {
    const measured = this.#measure(s);
    check(measured.totalBytes <= measured.limitBytes || measured.totalBytes<=previousTotal, 'STORAGE_CAPACITY', 'External purchase completion exceeds storage capacity', 507);
  }
  #reserve(s, row, resolutionCandidate=null) {
    // Bound the largest failure/confirmation record and both proof-index entries before debit.
    const draft = clone(s), future = draft.externalPurchases[row.preparationId];
    future.state = 'compensated'; future.completionBytes = 0;
    future.failureCode = 'X'.repeat(64); future.refundRequiredAt = 'X'.repeat(32); future.compensatedAt = 'X'.repeat(32);
    future.quarantinedAt = 'X'.repeat(32); future.cancelledAt = 'X'.repeat(32);
    // A UTF-16 code unit may require six JSON bytes, including escaped lone surrogates.
    const longestReference='\ud800'.repeat(128);
    future.compensationId = 'ec_' + 'f'.repeat(64); future.debitReference = longestReference;
    future.proofHashes = {debit: 'f'.repeat(64), refund: 'f'.repeat(64), no_debit: 'f'.repeat(64)};
    future.proofReferences = {debit: longestReference, refund: longestReference, no_debit: longestReference};
    for (let n = 0, added=0; added < 3; n++) {
      const key=externalPurchaseDigest({reservationBudget:row.preparationId,n});
      if(Object.hasOwn(draft.externalPurchaseProofs,key))continue;
      draft.externalPurchaseProofs[key]={preparationId:row.preparationId,hash:'f'.repeat(64),kind:'no_debit'};added++;
    }
    let maximumBytes=this.#measure(draft).usedBytes;
    if(resolutionCandidate){
      const resolved=clone(s),next=resolved.externalPurchases[row.preparationId];
      next.state='fulfilled';next.fulfilledAt='X'.repeat(32);next.purchase=clone(resolutionCandidate.purchase);next.completionBytes=0;next.completionRequests=0;
      next.legacyResolution={key:longestReference,actorId:longestReference,reason:'\ud800'.repeat(500),decision:{kind:'adopt_purchase',purchaseKey:resolutionCandidate.purchaseKey},purchaseId:next.purchase.id,adoptedQuote:clone(row.terms.quote),at:'X'.repeat(32)};
      resolved.operatorRequests??={};let token,n=0;
      do{token='external-resolution:'+externalPurchaseDigest({reservationBudget:row.preparationId,n:n++});}while(Object.hasOwn(resolved.operatorRequests,token));
      resolved.operatorRequests[token]={hash:'f'.repeat(64),result:this.#projection(next,true)};
      maximumBytes=Math.max(maximumBytes,this.#measure(resolved).usedBytes);
    }
    const growth = Math.max(0, maximumBytes - this.#measure(s).usedBytes);
    // Decimal reservation fields can grow by at most sixteen bytes; revision metadata is bounded separately.
    row.completionBytes = growth + 64;
    this.#fits(s);
  }
  #new(s, actor, input, legacy = false) {
    object(input, ['key', 'providerId', 'transactionId', 'userId', 'externalCurrency', 'externalUnits', 'quote'], legacy ? ['purchaseKey', 'debitReceipt'] : []);
    identifier(input.key, 'idempotency key');
    const intent = externalPurchaseIntent(input, {legacy}), provider = this.#provider(actor, intent.providerId);
    const fingerprint = externalPurchaseDigest(intent), preparationId = externalPurchaseId(intent.providerId, intent.transactionId);
    this.#init(s);
    const key = externalPurchaseDigest({providerId: intent.providerId, key: input.key}), oldKey = own(s.externalPurchaseKeys, key), old = own(s.externalPurchases, preparationId);
    check(!oldKey || oldKey.preparationId === preparationId && oldKey.fingerprint === fingerprint, 'SETTLEMENT_CONFLICT', 'Preparation key already used', 409);
    if (old) {
      check(old.fingerprint === fingerprint, 'SETTLEMENT_CONFLICT', 'External transaction has different terms', 409);
      if(!oldKey){
        check(Object.keys(s.externalPurchaseKeys).length<this.#limits.records,'EXTERNAL_PURCHASE_CAPACITY','External purchase key capacity reached',507);
        s.externalPurchaseKeys[key]={preparationId,fingerprint};this.#b.capacity(s);this.#fits(s);
      }
      return {row: old, provider, replay: true};
    }
    check(legacy || !own(s.externalSettlements, externalPurchaseDigest({providerId: intent.providerId, transactionId: intent.transactionId})), 'EXTERNAL_PURCHASE_STATE', 'Reconcile the existing legacy settlement', 409);
    const rows = Object.values(s.externalPurchases);
    check(rows.length < this.#limits.records && Object.keys(s.externalPurchaseKeys).length < this.#limits.records && rows.filter(row => pending(row.state) && row.terms.userId === intent.userId).length < this.#limits.pendingPerUser && rows.filter(row => pending(row.state) && row.terms.providerId === intent.providerId).length < this.#limits.pendingPerProvider, 'EXTERNAL_PURCHASE_CAPACITY', 'External purchase admission capacity reached', 507);
    const user = this.#b.user(s, {userId: intent.userId});
    this.#attest(provider.validateIntent, {intent, user}, 'INVALID_PROOF');
    const row = {preparationId, fingerprint, state: 'prepared', terms: intent, preparedAt: this.#now(), completionBytes: 0, proofHashes: {}};
    if (!legacy) row.snapshot = this.#b.capture(s, user, intent.quote);
    s.externalPurchases[preparationId] = row; s.externalPurchaseKeys[key] = {preparationId, fingerprint};
    this.#b.capacity(s); this.#reserve(s, row);
    return {row, provider, replay: false};
  }
  prepare(actor, input) {
    return this.#b.store.transact(s => {
      const {row} = this.#new(s, actor, input);
      return this.#projection(row, true);
    });
  }
  #refund(row, code) {
    row.state = 'refund_required'; row.failureCode = /^[A-Z0-9_]{1,64}$/.test(code ?? '') ? code : 'ALLOCATION_FAILED';
    row.compensationId = 'ec_' + externalPurchaseDigest({preparationId: row.preparationId, fingerprint: row.fingerprint});
    row.refundRequiredAt = this.#now(); delete row.snapshot;
  }
  #allocate(s, row) {
    const draft = clone(s), candidate = draft.externalPurchases[row.preparationId];
    try {
      candidate.purchase = this.#b.allocate(draft, candidate);
      candidate.state = 'fulfilled'; candidate.fulfilledAt = this.#now(); candidate.completionBytes = 0; delete candidate.snapshot;
      this.#b.capacity(draft);
    } catch (error) { this.#refund(row, error instanceof FrameworkError ? error.code : 'ALLOCATION_FAILED'); return; }
    // Storage measurement errors are unknown operational outcomes, not allocation refusals.
    const measured = this.#measure(draft);
    if (measured.totalBytes > measured.limitBytes) { this.#refund(row, 'STORAGE_CAPACITY'); return; }
    Object.assign(s, draft);
  }
  commit(actor, input) {
    object(input, ['preparationId', 'fingerprint', 'debitReceipt']);
    return this.#b.store.transact(s => {
      const {row, provider} = this.#get(s, actor, input), proof = this.#proof(s, row, provider, input.debitReceipt, 'debit');
      if (row.state !== 'prepared') {
        check(['fulfilled', 'refund_required', 'compensated'].includes(row.state) && row.proofHashes.debit === proof.hash, 'EXTERNAL_PURCHASE_STATE', 'Purchase cannot accept a debit', 409);
        return this.#projection(row, true);
      }
      const before=this.#measure(s), reserve=row.completionBytes;
      this.#saveProof(s, row, proof); this.#allocate(s, row);
      const current=s.externalPurchases[row.preparationId];
      if(current.state==='refund_required')current.completionBytes=Math.max(0,reserve-Math.max(0,this.#measure(s).usedBytes-before.usedBytes));
      return this.#projection(s.externalPurchases[row.preparationId], true);
    });
  }
  cancel(actor, input) {
    object(input, ['preparationId', 'fingerprint', 'noDebitReceipt']);
    return this.#b.store.transact(s => {
      const {row, provider} = this.#get(s, actor, input), proof = this.#proof(s, row, provider, input.noDebitReceipt, 'no_debit');
      check(row.state === 'prepared' || row.state === 'cancelled' && row.proofHashes.no_debit === proof.hash, 'EXTERNAL_PURCHASE_STATE', 'Purchase cannot be cancelled', 409);
      if (row.state === 'prepared') { this.#saveProof(s, row, proof); row.state = 'cancelled'; row.cancelledAt = this.#now(); row.completionBytes = 0; delete row.snapshot; }
      return this.#projection(row, true);
    });
  }
  compensate(actor, input) {
    object(input, ['preparationId', 'fingerprint', 'refundReceipt']);
    return this.#b.store.transact(s => {
      const {row, provider} = this.#get(s, actor, input), proof = this.#proof(s, row, provider, input.refundReceipt, 'refund');
      check(row.state === 'refund_required' || row.state === 'compensated' && row.proofHashes.refund === proof.hash, 'EXTERNAL_PURCHASE_STATE', 'Purchase cannot be compensated', 409);
      if (row.state === 'refund_required') { this.#saveProof(s, row, proof); row.state = 'compensated'; row.compensatedAt = this.#now(); row.completionBytes = 0; delete row.snapshot; }
      return this.#projection(row, true);
    });
  }
  legacy(actor, input) {
    identifier(input.purchaseKey, 'legacy purchase key');
    return this.#b.store.transact(s => {
      const {row, provider, replay} = this.#new(s, actor, input, true), proof = this.#proof(s, row, provider, input.debitReceipt, 'debit');
      if (replay) { check(row.legacy?.purchaseKey === input.purchaseKey && row.proofHashes.debit === proof.hash, 'SETTLEMENT_CONFLICT', 'Legacy reconciliation differs', 409); return this.#projection(row, true); }
      row.legacy = {purchaseKey: input.purchaseKey};
      this.#reserve(s,row);
      const before=this.#measure(s),reserve=row.completionBytes;
      this.#saveProof(s, row, proof);
      const resolution = this.#b.legacy(s, row);
      let reservedResolution=false;
      if (resolution.purchase) { row.state = 'fulfilled'; row.purchase = clone(resolution.purchase); row.fulfilledAt = this.#now(); row.completionBytes = 0; }
      else if (resolution.quarantine) {
        row.state = 'quarantined'; row.failureCode = resolution.quarantine; row.quarantinedAt = this.#now();
        const candidate=resolution.quarantine==='LEGACY_CREDIT_SPENT'?this.#b.resolutionCandidate(s,row):null;
        if(candidate){row.legacy.resolutionPurchaseKey=candidate.purchaseKey;row.completionRequests=1;this.#b.capacity(s);this.#reserve(s,row,candidate);reservedResolution=true;}
      }
      else if (resolution.failure) this.#refund(row, resolution.failure);
      else { row.snapshot = resolution.snapshot; this.#allocate(s, row); }
      const current=s.externalPurchases[row.preparationId];
      if(pending(current.state)&&!reservedResolution)current.completionBytes=Math.max(0,reserve-Math.max(0,this.#measure(s).usedBytes-before.usedBytes));
      return this.#projection(s.externalPurchases[row.preparationId], true);
    });
  }
  resolveLegacy(actor,input){
    object(input,['preparationId','fingerprint','key','reason','decision']);object(input.decision,['kind','purchaseKey']);
    identifier(input.key,'resolution key');identifier(input.decision.purchaseKey,'legacy purchase key');
    check(input.decision.kind==='adopt_purchase','INVALID_INPUT','Unsupported legacy resolution');
    check(typeof input.reason==='string'&&input.reason.trim().length>0&&Array.from(input.reason).length<=500&&!/[\u0000-\u001f\u007f]/.test(input.reason),'INVALID_INPUT','A bounded resolution reason is required');
    check(hasPermission(actor,'maintenance.run'),'FORBIDDEN','Attributed maintenance authority required',403);
    const actorId=actor.userId??actor.id;identifier(actorId,'operator identity');
    return this.#b.store.transact(s=>{
      const {row,provider}=this.#get(s,actor,input),providerId=row.terms.providerId,token='external-resolution:'+externalPurchaseDigest({providerId,actorId,key:input.key}),hash=externalPurchaseDigest({type:'external-purchase.legacy-resolved',providerId,actorId,input});
      s.operatorRequests??={};const previous=own(s.operatorRequests,token);
      if(previous){check(previous.hash===hash&&row.legacyResolution?.key===input.key&&row.legacyResolution?.actorId===actorId,'IDEMPOTENCY_CONFLICT','Resolution key already used',409);return clone(previous.result);}
      check(row.state==='quarantined'&&row.failureCode==='LEGACY_CREDIT_SPENT'&&row.legacy,'EXTERNAL_PURCHASE_STATE','This quarantine cannot adopt a purchase',409);
      const originalProof={kind:'debit',reference:row.debitReference,fingerprint:row.fingerprint,...Object.fromEntries(['providerId','transactionId','userId','externalCurrency','externalUnits'].map(key=>[key,row.terms[key]]))};
      this.#proof(s,row,provider,originalProof,'debit','resolve_legacy');
      check(row.completionRequests===1&&row.legacy.resolutionPurchaseKey===input.decision.purchaseKey,'LEGACY_RESOLUTION_REJECTED','A preadmitted proven purchase is required',409);
      const purchase=this.#b.resolveLegacy(s,row,input.decision.purchaseKey),previousTotal=this.#measure(s).totalBytes;
      row.purchase=clone(purchase);row.state='fulfilled';row.fulfilledAt=this.#now();row.completionBytes=0;row.completionRequests=0;
      row.legacyResolution={key:input.key,actorId,reason:input.reason,decision:clone(input.decision),purchaseId:purchase.id,adoptedQuote:clone(row.terms.quote),at:row.fulfilledAt};
      const result=this.#projection(row,true);s.operatorRequests[token]={hash,result:clone(result)};
      this.#fits(s,previousTotal);return result;
    });
  }
}

export function assertExternalPurchaseState(s) {
  for (const row of Object.values(s.externalPurchases ?? {})) {
    check(states.includes(row.state) && row.fingerprint === externalPurchaseDigest(row.terms) && row.preparationId === externalPurchaseId(row.terms.providerId, row.terms.transactionId), 'EXTERNAL_PURCHASE_INVARIANT', 'Invalid external purchase identity', 500);
    check(Number.isSafeInteger(row.completionBytes) && row.completionBytes >= 0 && (pending(row.state) || row.completionBytes === 0), 'EXTERNAL_PURCHASE_INVARIANT', 'Invalid completion reservation', 500);
    check((row.state === 'fulfilled') === !!row.purchase, 'EXTERNAL_PURCHASE_INVARIANT', 'Invalid paid delivery state', 500);
  }
}
