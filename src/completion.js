import {check} from './catalog.js';
const contexts=new WeakMap();
export const completionContext=state=>contexts.get(state);
export const completionDefaults={completionRequests:100000,completionJobs:100000,completionEvents:500000,completionObligations:100000,completionBytes:64*1024*1024};
const count=(rows,predicate)=>Object.values(rows??{}).filter(predicate).length;
export const deliveryBytes=65536;
export function reserveDelivery(s,job){
  if(job.completionId||job.deliveryCompletionId)return;
  const id='action:'+job.id;s.completionObligations??={};
  s.completionObligations[id]={id,kind:'action',entityId:job.id,status:'completed',events:0,jobs:1,bytes:deliveryBytes,usedBytes:0,subscriptions:[]};job.deliveryCompletionId=id;
}
export function ordinaryRequestCount(s){
  return count(s.requests,row=>!row.completionId)+count(s.operatorRequests,row=>!row.completionId)+Object.keys(s.externalSettlements??{}).length+Object.keys(s.externalPurchaseKeys??{}).length+Object.values(s.externalPurchases??{}).reduce((total,row)=>total+(row.completionRequests??0),0);
}
export function completionCapacity(s,limits){
  const rows=Object.values(s.completionObligations??{}),pending=rows.filter(row=>row.status==='reserved');
  check(rows.length<=limits.completionObligations,'COMPLETION_CAPACITY','Completion obligation capacity reached',507);
  const bytes=completionPool(s);check(bytes.storedBytes+bytes.reservedBytes<=limits.completionBytes,'COMPLETION_CAPACITY','Completion byte capacity reached',507);
  const usedRequests=count(s.requests,row=>!!row.completionId)+count(s.operatorRequests,row=>!!row.completionId);
  const usedJobs=count(s.actionJobs,row=>!!row.completionId),usedEvents=(s.events??[]).filter(row=>row.completionId).length;
  const usage=new Map(rows.map(row=>[row.id,{requests:0,jobs:0,events:0}]));
  for(const [name,items]of [['requests',Object.values(s.requests??{}).concat(Object.values(s.operatorRequests??{}))],['jobs',Object.values(s.actionJobs??{})],['events',s.events??[]]])for(const item of items){const id=item.completionId??(name==='jobs'?item.deliveryCompletionId:null);if(id){const tally=usage.get(id);check(tally,'INVALID_STATE','Completion record has no obligation',500);tally[name]++;}}
  for(const row of rows){const used=usage.get(row.id);check(used.requests<=1&&used.jobs<=row.jobs&&used.events<=row.events,'COMPLETION_INVARIANT','Completion exceeded its admitted record reservation',500);}
  for(const [name,used,reserved]of [['completionRequests',usedRequests,pending.length],['completionJobs',usedJobs,pending.reduce((n,row)=>n+row.jobs,0)],['completionEvents',usedEvents,pending.reduce((n,row)=>n+row.events,0)]])check(used+reserved<=limits[name],'COMPLETION_CAPACITY',name+' capacity reached',507);
}
export function reserveCompletion(s,{kind,entity,copyIds=[]},subscriptions,limits){
  const id=kind+':'+entity.id;s.completionObligations??={};if(s.completionObligations[id])return s.completionObligations[id];
  const copies=copyIds.map(id=>s.copies[id]).filter(Boolean),codes=copies.reduce((n,copy)=>n+(copy.codeIds?.length??0),0);
  const events=3+copies.length*4+codes*2,jobs=events*subscriptions.length+copies.reduce((n,copy)=>n+(copy.variant.onOpen?.length??0),0);
  // A delivery may append two bounded history records for each of 100 attempts.
  // 64 KiB covers these records, leases and counters including encoded overhead.
  const bytes=8*Buffer.byteLength(JSON.stringify({entity,copies}))+16384*(events+copies.length+1)+deliveryBytes*jobs;
  const row={id,kind,entityId:entity.id,status:'reserved',events,jobs,bytes,usedBytes:0,subscriptions:structuredClone(subscriptions)};
  s.completionObligations[id]=row;completionCapacity(s,limits);return row;
}
export function completionPool(s){
  let storedBytes=0,reservedBytes=0;
  const delivering=new Set(Object.values(s.actionJobs??{}).filter(job=>(job.completionId||job.deliveryCompletionId)&&['pending','running'].includes(job.status)).map(job=>job.completionId??job.deliveryCompletionId));
  for(const row of Object.values(s.completionObligations??{})){
    check(['reserved','completed'].includes(row.status)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&Number.isSafeInteger(row.usedBytes)&&row.usedBytes>=0&&row.usedBytes<=row.bytes&&(row.status!=='reserved'||row.usedBytes===0),'INVALID_STATE','Invalid completion byte accounting',500);
    storedBytes+=row.usedBytes;if(row.status==='reserved'||delivering.has(row.id))reservedBytes+=row.bytes-row.usedBytes;
  }
  check(Number.isSafeInteger(storedBytes)&&Number.isSafeInteger(reservedBytes),'INVALID_STATE','Completion byte accounting exceeds integer range',500);return {storedBytes,reservedBytes};
}
export function withCompletion(s,row,fn,measure,beforeBytes){
  const previous=contexts.get(s);if(previous?.id===row.id)return fn();
  const before=beforeBytes??measure(s).usedBytes,alreadyUsed=row.usedBytes;row.status='completed';contexts.set(s,row);
  try{
    const result=fn();let stable=false;
    for(let i=0;i<12;i++){const bytes=alreadyUsed+Math.max(0,measure(s).usedBytes-before);if(bytes===row.usedBytes){stable=true;break;}row.usedBytes=bytes;}
    check(stable&&row.usedBytes<=row.bytes,'COMPLETION_INVARIANT','Completion exceeded its admitted byte reservation',500);return result;
  }finally{if(previous)contexts.set(s,previous);else contexts.delete(s);}
}
