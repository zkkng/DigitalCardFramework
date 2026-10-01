export function initialState() {
  return {schemaVersion:1, revision:0, catalog:null, users:{}, balances:{}, packs:{}, copies:{},
    albums:{}, trades:{}, supply:{}, requests:{}, ledger:[], events:[]};
}
// The transaction callback must be synchronous; commit its state and result together.
export class MemoryStore {
  #state = initialState();
  read(fn) { return structuredClone(fn(structuredClone(this.#state))); }
  transact(fn) {
    const draft = structuredClone(this.#state);
    const result = fn(draft);
    if (result?.then) throw new Error('Async transaction callbacks are unsupported');
    draft.revision++;
    this.#state = draft;
    return structuredClone(result);
  }
  close() {}
}
