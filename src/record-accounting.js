import {completionPool,missingCompletions,ordinaryRequestCount} from './completion.js';
import {check} from './catalog.js';

export const recordAccountingField='_recordAccounting';
export function validRecordAccounting(summary,revision){
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  return summary?.version===3&&summary.revision===revision&&count(summary.usedBytes)
    &&summary.counts!==null&&typeof summary.counts==='object'&&!Array.isArray(summary.counts)&&Object.values(summary.counts).every(count)
    &&['ordinaryRequests','ordinaryJobs','ordinaryEvents','missingCompletions','legacyPurchases','externalReservedBytes'].every(key=>count(summary[key]))
    &&['actions','trades','listings'].every(key=>count(summary.workers?.[key]))
    &&['obligations','requests','jobs','events','storedBytes','reservedBytes'].every(key=>count(summary.completion?.[key]));
}
export function summarizeRecords(state){
  const obligations=Object.values(state.completionObligations??{}),pending=obligations.filter(row=>row.status==='reserved');
  const pool=completionPool(state),requests=Object.values(state.requests??{}).concat(Object.values(state.operatorRequests??{}));
  return {version:3,revision:state.revision,usedBytes:0,
    counts:Object.fromEntries(Object.entries(state).filter(([name,value])=>name!==recordAccountingField&&value&&typeof value==='object').map(([name,value])=>[name,Object.keys(value).length])),
    ordinaryRequests:ordinaryRequestCount(state),ordinaryJobs:Object.values(state.actionJobs??{}).filter(row=>!row.completionId).length,
    ordinaryEvents:(state.events??[]).filter(row=>!row.completionId).length,missingCompletions:missingCompletions(state).length,
    legacyPurchases:Object.values(state.externalPurchases??{}).filter(row=>row.legacy?.purchaseKey).length,
    workers:{actions:Object.values(state.actionJobs??{}).filter(row=>['pending','running'].includes(row.status)).length,trades:Object.values(state.trades??{}).filter(row=>row.status==='pending').length,listings:Object.values(state.listings??{}).filter(row=>row.status==='active').length},
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

/** Rebuild encrypted escrow and copy-reference projections for compatibility writers. */
export function updateTradeEscrow(state){
 const rows=Object.create(null);for(const owner of Object.keys(state._tradeEscrow??{}))rows[owner]=Object.create(null);
 for(const trade of Object.values(state.trades??{}))if(trade.status==='pending')for(const money of trade.give.currencies){
  check(Number.isSafeInteger(money.amount)&&money.amount>0,'INVALID_STATE','Invalid refundable escrow',500);
  const row=rows[trade.fromUserId]??=Object.create(null),sum=BigInt(row[money.currencyId]??0)+BigInt(money.amount);check(sum<=BigInt(Number.MAX_SAFE_INTEGER),'INVALID_STATE','Refundable escrow exceeds integer range',500);row[money.currencyId]=Number(sum);
 }
 state._tradeEscrow=rows;
 const references=Object.create(null);for(const id of Object.keys(state.copies??{}))references[id]={users:[],albums:[]};
 for(const user of Object.values(state.users??{}))for(const id of user.preferences?.favoriteCopyIds??[])if(references[id])references[id].users.push(user.id);
 for(const album of Object.values(state.albums??{}))for(const placement of album.placements??[])if(references[placement.copyId])references[placement.copyId].albums.push(album.id);
 state._copyReferences=references;
}

export const recordPreparationMarker='prepare-accounting-v3';
/** Existing completions may drop stale caches without allocating a migration. */
export function refreshTradeAccounting(state){
 let version;try{version=JSON.parse(state[recordAccountingField]).version;}catch{}
 if(version!==3&&state[recordAccountingField]!==recordPreparationMarker){delete state[recordAccountingField];delete state._tradeEscrow;delete state._copyReferences;return false;}
 updateTradeEscrow(state);return true;
}
