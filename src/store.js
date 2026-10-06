import {completionPool} from './completion.js';
import {isDeepStrictEqual} from 'node:util';
import {querySnapshot, memoryQueries, completionBytes} from './storage-query.js';
export function initialState() {
  return {schemaVersion:1, revision:0, catalog:null, users:{}, balances:{}, packs:{}, copies:{},
    albums:{}, trades:{}, supply:{}, requests:{}, ledger:[], events:[]};
}
// The transaction callback must be synchronous; commit its state and result together.
export class MemoryStore {
  #state = initialState();
  read(fn) { return structuredClone(fn(structuredClone(this.#state))); }
  query(fn) { return querySnapshot(memoryQueries(this.#state),fn); }
  measure(state) { const usedBytes=Buffer.byteLength(JSON.stringify(state)),reservedBytes=completionBytes(state);const pool=completionPool(state);return {usedBytes,reservedBytes,totalBytes:usedBytes+reservedBytes,limitBytes:Infinity,completionStoredBytes:pool.storedBytes,completionReservedBytes:pool.reservedBytes}; }
  assertCapacity(state) { return this.measure(state); }
  transact(fn) {
    const draft = structuredClone(this.#state);
    const result = fn(draft);
    if (result?.then) throw new Error('Async transaction callbacks are unsupported');
    const detachedResult = structuredClone(result);
    if (!isDeepStrictEqual(draft,this.#state)) {draft.revision++;this.#state = draft;}
    return detachedResult;
  }
  close() {}
}
