import {completionPool} from './completion.js';
import {createRecordTransaction,validateRecordPlan} from './record-transaction.js';
import {validRecordAccounting,recordAccountingField,finalizeRecordAccounting,refreshTradeAccounting,recordPreparationMarker} from './record-accounting.js';
import {isDeepStrictEqual} from 'node:util';
import {querySnapshot, memoryQueries, completionBytes} from './storage-query.js';
export function initialState() {
  return {schemaVersion:1, revision:0, catalog:null, users:{}, balances:{}, packs:{}, copies:{},
    albums:{}, trades:{}, supply:{}, requests:{}, ledger:[], events:[]};
}
// The transaction callback must be synchronous; commit its state and result together.
export class MemoryStore {
  #state = initialState();
  #recordActive=false;
  read(fn) {if(this.#recordActive)throw new Error('Nested storage operations are unsupported');return structuredClone(fn(structuredClone(this.#state))); }
  query(fn) {if(this.#recordActive)throw new Error('Nested storage operations are unsupported');return querySnapshot(memoryQueries(this.#state),fn); }
  measure(state) { const usedBytes=Buffer.byteLength(JSON.stringify(state)),reservedBytes=completionBytes(state);const pool=completionPool(state);return {usedBytes,reservedBytes,totalBytes:usedBytes+reservedBytes,limitBytes:Infinity,completionStoredBytes:pool.storedBytes,completionReservedBytes:pool.reservedBytes}; }
  assertCapacity(state) { return this.measure(state); }
  transact(fn) {
    if(this.#recordActive)throw new Error('Nested storage operations are unsupported');
    const draft = structuredClone(this.#state);
    const result = fn(draft);
    if (result?.then) throw new Error('Async transaction callbacks are unsupported');
    const detachedResult = structuredClone(result);
    if (!isDeepStrictEqual(draft,this.#state)) {draft.revision++;if(Object.hasOwn(draft,recordAccountingField)&&refreshTradeAccounting(draft)){finalizeRecordAccounting(draft,this.#state,value=>Buffer.byteLength(JSON.stringify(value)));}this.#state = draft;}
    return detachedResult;
  }
  prepareRecordTransactions({force=false}={}){return this.transact(state=>{let summary;try{summary=JSON.parse(state[recordAccountingField]);}catch{}if(!force&&validRecordAccounting(summary,state.revision))return {prepared:false};state[recordAccountingField]=recordPreparationMarker;return {prepared:true};});}
  transactRecords(fn,options={}){
    return this.transact(state=>{
      const bytes=value=>Buffer.byteLength(JSON.stringify(value)??''),scope=createRecordTransaction({
        field:(name,charge)=>{if(!Object.hasOwn(state,name))return undefined;const value=state[name],kind=Array.isArray(value)?'array':value!==null&&typeof value==='object'?'object':'scalar';if(kind==='scalar')charge(bytes(value));return {kind,value};},
        record:(name,key,charge)=>{const index=name==='notifications'?(state[name]??[]).findIndex(row=>row.id===key):key;const exists=Object.hasOwn(state[name]??{},index);charge(exists?bytes(state[name][index]):0);return exists?{value:structuredClone(state[name][index]),ordinal:Object.keys(state[name]).indexOf(String(index))}:undefined;},
        entries:(name,charge)=>Object.entries(state[name]??{}).map(([key,value],ordinal)=>{charge(bytes(value));return {key:name==='notifications'?value.id:key,value:structuredClone(value),ordinal};}),
        count:name=>Object.keys(state[name]??{}).length,nextOrdinal:name=>Object.keys(state[name]??{}).length,
        ownerCounts:ownerId=>memoryQueries(state).collectionCounts(ownerId),
        notificationOverflow:(ownerId,keep,charge)=>{const rows=(state.notifications??[]).filter(row=>row.userId===ownerId);charge(0);return rows.slice(0,Math.max(0,rows.length-keep)).map(row=>{charge(bytes(row));return {key:row.id};});},
        ownedVariantCount:(ownerId,variantIds)=>Object.values(state.copies??{}).filter(row=>row.ownerId===ownerId&&row.state==='owned'&&variantIds.includes(row.variantId)).length,
      },options);
      this.#recordActive=true;
      try{const value=fn(scope.api);if(value?.then)throw new Error('Async transaction callbacks are unsupported');const plan=scope.finish();validateRecordPlan(plan,options);const beforeBytes=bytes(state);if(plan.changes.length||plan.scalars.length){let summary;try{summary=JSON.parse(state[recordAccountingField]);}catch{}if(!validRecordAccounting(summary,state.revision))throw Object.assign(new Error('Prepare revision-bound record accounting before using record transactions'),{code:'RECORD_MIGRATION_REQUIRED',status:503});}for(const row of plan.changes){state[row.collection]??=row.array?[]:{};if(row.collection==='notifications'){const index=state.notifications.findIndex(item=>item.id===row.key);if(row.value===undefined){if(index>=0)state.notifications.splice(index,1);}else if(index>=0)state.notifications[index]=structuredClone(row.value);else state.notifications.push(structuredClone(row.value));}else Object.defineProperty(state[row.collection],row.key,{value:structuredClone(row.value),enumerable:true,writable:true,configurable:true});}for(const row of plan.scalars)state[row.name]=structuredClone(row.value);if(plan.completion){const row=state.completionObligations[plan.completion.id],base=plan.changes.find(r=>r.collection==='completionObligations'&&r.key===row.id).old?.value.usedBytes??0;let stable=false;for(let i=0;i<12;i++){const used=base+Math.max(0,bytes(state)-beforeBytes);if(used===row.usedBytes){stable=true;break;}row.usedBytes=used;}if(!stable||row.usedBytes>row.bytes)throw Object.assign(new Error('Completion exceeds its reservation'),{code:'COMPLETION_INVARIANT',status:500});}return value;}finally{scope.close();this.#recordActive=false;}
    });
  }
  close() {}
}
