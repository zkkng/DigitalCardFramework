import {completionPool,missingCompletions,ordinaryRequestCount} from './completion.js';
import {check} from './catalog.js';

export const recordAccountingField='_recordAccounting';
export function validRecordAccounting(summary,revision){
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  return summary?.version===1&&summary.revision===revision&&count(summary.usedBytes)
    &&summary.counts!==null&&typeof summary.counts==='object'&&!Array.isArray(summary.counts)&&Object.values(summary.counts).every(count)
    &&['ordinaryRequests','ordinaryJobs','ordinaryEvents','missingCompletions','legacyPurchases','externalReservedBytes'].every(key=>count(summary[key]))
    &&['obligations','requests','jobs','events','storedBytes','reservedBytes'].every(key=>count(summary.completion?.[key]));
}
export function summarizeRecords(state){
  const obligations=Object.values(state.completionObligations??{}),pending=obligations.filter(row=>row.status==='reserved');
  const pool=completionPool(state),requests=Object.values(state.requests??{}).concat(Object.values(state.operatorRequests??{}));
  return {version:1,revision:state.revision,usedBytes:0,
    counts:Object.fromEntries(Object.entries(state).filter(([name,value])=>name!==recordAccountingField&&value&&typeof value==='object').map(([name,value])=>[name,Object.keys(value).length])),
    ordinaryRequests:ordinaryRequestCount(state),ordinaryJobs:Object.values(state.actionJobs??{}).filter(row=>!row.completionId).length,
    ordinaryEvents:(state.events??[]).filter(row=>!row.completionId).length,missingCompletions:missingCompletions(state).length,
    legacyPurchases:Object.values(state.externalPurchases??{}).filter(row=>row.legacy?.purchaseKey).length,
    completion:{obligations:obligations.length,requests:requests.filter(row=>row.completionId).length+pending.length,
      jobs:Object.values(state.actionJobs??{}).filter(row=>row.completionId).length+pending.reduce((n,row)=>n+row.jobs,0),
      events:(state.events??[]).filter(row=>row.completionId).length+pending.reduce((n,row)=>n+row.events,0),
      storedBytes:pool.storedBytes,reservedBytes:pool.reservedBytes},
    externalReservedBytes:Object.values(state.externalPurchases??{}).reduce((n,row)=>n+(row.completionBytes??0),0)};
}

/** Compatibility writers refresh the revision-bound summary inside their transaction. */
export function updateRecordAccounting(state,measure){
  const summary=summarizeRecords(state);
  for(let i=0;i<12;i++){
    state[recordAccountingField]=JSON.stringify(summary);
    const bytes=measure(state);
    if(bytes===summary.usedBytes)return summary;
    summary.usedBytes=bytes;
  }
  throw new Error('Record accounting did not stabilize');
}

/** Derived metadata is part of an admitted completion's actual byte cost. */
export function finalizeRecordAccounting(state,previous,measure){
  const candidates=Object.values(state.completionObligations??{}).filter(row=>row.usedBytes>(previous.completionObligations?.[row.id]?.usedBytes??0)
    ||row.status==='completed'&&previous.completionObligations?.[row.id]?.status==='reserved').map(row=>({row,base:row.usedBytes}));
  if(!candidates.length)return updateRecordAccounting(state,measure);
  const baseline=measure(state);let extra=0;
  for(let i=0;i<12;i++){
    let remaining=extra;
    for(const {row,base}of candidates){const assigned=Math.min(remaining,row.bytes-base);row.usedBytes=base+assigned;remaining-=assigned;}
    check(remaining===0,'COMPLETION_INVARIANT','Completion record accounting exceeds its reserved bytes',500);
    const summary=updateRecordAccounting(state,measure),needed=Math.max(0,summary.usedBytes-baseline);
    if(needed===extra)return summary;
    extra=needed;
  }
  check(false,'COMPLETION_INVARIANT','Completion record accounting did not stabilize',500);
}
