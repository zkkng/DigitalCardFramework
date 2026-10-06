import {isDeepStrictEqual} from 'node:util';
import {check} from './catalog.js';
import {missingCompletions} from './completion.js';

const fieldName=name=>check(typeof name==='string'&&name.length>0&&name.length<=200&&!['__proto__','constructor','prototype'].includes(name),'INVALID_INPUT','Invalid collection');
const keyName=key=>check(typeof key==='string'&&key.length<=2048,'INVALID_INPUT','Invalid record key');
const clone=value=>structuredClone(value);
export function validateAcquisitionChanges(changes){
  const insertOnly=new Set(['copies','packs','requests','ledger','events','actionJobs','completionObligations']),mutable=new Set(['balances','supply','pity']);
  const additions=Object.create(null);for(const row of changes)if(!row.old){additions[row.collection]??=Object.create(null);additions[row.collection][row.key]=row.value;}
  check(missingCompletions(additions).length===0,'COMPLETION_MIGRATION_REQUIRED','New obligations require completion reservations',503);
  for(const row of changes){
    check(insertOnly.has(row.collection)||mutable.has(row.collection),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside the acquisition transaction scope',409);
    check(!insertOnly.has(row.collection)||!row.old,'RECORD_TRANSACTION_UNSUPPORTED','Acquisition transactions cannot replace accepted records',409);
    if(['requests','events','actionJobs'].includes(row.collection))check(!row.value.completionId,'RECORD_TRANSACTION_UNSUPPORTED','Completion settlement requires its reserved transaction path',409);
    if(row.collection==='events')check(row.value.sequence===row.ordinal+1,'INVALID_STATE','Event sequence differs from append position',500);
    if(row.collection==='actionJobs')check(additions.completionObligations?.[row.value.deliveryCompletionId],'RECORD_TRANSACTION_UNSUPPORTED','New deliveries require a new reservation',409);
  }
}

/** Synchronous record scope inside one database transaction; no external awaits. */
export function createRecordTransaction(backend,{maxRecords=4096,maxBytes=16*1024*1024}={}){
  check(Number.isSafeInteger(maxRecords)&&maxRecords>=1&&maxRecords<=100000,'INVALID_INPUT','Invalid record budget');
  check(Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=64*1024*1024,'INVALID_INPUT','Invalid byte budget');
  let active=true,reads=0,bytes=0;
  const fields=new Map(),records=new Map(),nextOrdinals=new Map(),createdKinds=new Map();
  const live=()=>check(active,'TRANSACTION_ENDED','Record transaction has ended',409);
  const charge=size=>{live();reads++;bytes+=size;check(reads<=maxRecords&&bytes<=maxBytes,'TRANSACTION_BUDGET','Record transaction read budget exceeded',507);};
  const field=name=>{live();fieldName(name);if(!fields.has(name))fields.set(name,backend.field(name,charge));return fields.get(name);};
  const load=(name,key)=>{field(name);keyName(key);const token=JSON.stringify([name,key]);if(!records.has(token)){const old=backend.record(name,key,charge);records.set(token,{collection:name,key,old,value:old?.value,ordinal:old?.ordinal});}return records.get(token);};
  const ordinal=name=>{if(!nextOrdinals.has(name))nextOrdinals.set(name,backend.nextOrdinal(name));const value=nextOrdinals.get(name);nextOrdinals.set(name,value+1);return value;};
  const api={
    get(name,key){return clone(load(name,key).value);},
    value(name){const metadata=field(name),kind=metadata?.kind??createdKinds.get(name);if(!kind)return undefined;if(kind==='scalar')return clone(metadata.value);const result=kind==='array'?[]:{};
      for(const row of backend.entries(name,charge)){const token=JSON.stringify([name,row.key]);if(!records.has(token))records.set(token,{collection:name,key:row.key,old:row,value:row.value,ordinal:row.ordinal});}
      for(const row of [...records.values()].filter(row=>row.collection===name&&row.value!==undefined).sort((a,b)=>a.ordinal-b.ordinal))Object.defineProperty(result,row.key,{value:clone(row.value),enumerable:true,writable:true,configurable:true});return result;},
    count(name){const metadata=field(name);check(metadata?.kind!=='scalar','INVALID_INPUT','count requires a collection');charge(0);return backend.count(name)+[...records.values()].filter(row=>row.collection===name&&!row.old&&row.value!==undefined).length;},
    ownerCounts(ownerId){keyName(ownerId);charge(0);const result=clone(backend.ownerCounts(ownerId));
      const apply=(collection,row,delta)=>{if(!row)return;if(collection==='copies'&&row.ownerId===ownerId){result.copies+=delta;if(row.state==='owned')result.ownedCopies+=delta;if(row.state==='sealed')result.sealedCopies+=delta;}if(collection==='packs'&&row.ownerId===ownerId){result.packs+=delta;if(!row.openedAt)result.unopenedPacks+=delta;}if(collection==='codes'&&row.holderId===ownerId)result.codes+=delta;};
      for(const row of records.values()){apply(row.collection,row.old?.value,-1);apply(row.collection,row.value,1);}return result;},
    put(name,key,value){const metadata=field(name),kind=metadata?.kind??createdKinds.get(name);check(!kind||kind==='object','INVALID_INPUT','put requires an object collection');check(value!==undefined,'INVALID_INPUT','Cannot store undefined');createdKinds.set(name,'object');const row=load(name,key);row.value=clone(value);if(row.ordinal===undefined)row.ordinal=ordinal(name);return clone(value);},
    append(name,value){const metadata=field(name),kind=metadata?.kind??createdKinds.get(name);check(!kind||kind==='array','INVALID_INPUT','append requires an array collection');check(value!==undefined,'INVALID_INPUT','Cannot store undefined');createdKinds.set(name,'array');const index=ordinal(name),key=String(index),row=load(name,key);check(!row.old,'INVALID_STATE','Append position is occupied',500);row.value=clone(value);row.ordinal=index;row.array=true;return index;},
  };
  return {api,close(){active=false;},finish(){live();const changes=[...records.values()].filter(row=>!isDeepStrictEqual(row.old?.value,row.value));
    check(changes.length<=maxRecords,'TRANSACTION_BUDGET','Record transaction write budget exceeded',507);
    const written=changes.reduce((total,row)=>total+Buffer.byteLength(JSON.stringify(row.value)),0);check(written<=maxBytes,'TRANSACTION_BUDGET','Record transaction write byte budget exceeded',507);
    return {changes,fields,reads,bytes,written};}};
}
