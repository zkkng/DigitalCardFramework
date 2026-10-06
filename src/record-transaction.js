import {isDeepStrictEqual} from 'node:util';
import {check} from './catalog.js';
import {missingCompletions} from './completion.js';

const fieldName=name=>check(typeof name==='string'&&name.length>0&&name.length<=200&&!['__proto__','constructor','prototype'].includes(name),'INVALID_INPUT','Invalid collection');
const keyName=key=>check(typeof key==='string'&&key.length<=2048,'INVALID_INPUT','Invalid record key');
const clone=value=>structuredClone(value);
export function validateAcquisitionChanges(changes){
  const insertOnly=new Set(['copies','packs','requests','ledger','events','actionJobs','completionObligations','_copyReferences']),mutable=new Set(['balances','supply','pity']);
  const additions=Object.create(null);for(const row of changes)if(!row.old){additions[row.collection]??=Object.create(null);additions[row.collection][row.key]=row.value;}
  check(missingCompletions(additions).length===0,'COMPLETION_MIGRATION_REQUIRED','New obligations require completion reservations',503);
  for(const row of changes){
    check(insertOnly.has(row.collection)||mutable.has(row.collection),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside the acquisition transaction scope',409);
    check(!insertOnly.has(row.collection)||!row.old,'RECORD_TRANSACTION_UNSUPPORTED','Acquisition transactions cannot replace accepted records',409);
    if(['requests','events','actionJobs'].includes(row.collection))check(!row.value.completionId,'RECORD_TRANSACTION_UNSUPPORTED','Completion settlement requires its reserved transaction path',409);
    if(row.collection==='_copyReferences')check(additions.copies?.[row.key]&&isDeepStrictEqual(row.value,{users:[],albums:[]}),'INVALID_STATE','New copy reference projection required',500);
    if(row.collection==='events')check(row.value.sequence===row.ordinal+1,'INVALID_STATE','Event sequence differs from append position',500);
    if(row.collection==='actionJobs')check(additions.completionObligations?.[row.value.deliveryCompletionId],'RECORD_TRANSACTION_UNSUPPORTED','New deliveries require a new reservation',409);
  }
}
function validateTradeExchange(plan,counter){
 const trades=plan.changes.filter(row=>row.collection==='trades'),old=trades.find(row=>row.old),created=trades.find(row=>!row.old);check(trades.length===(counter?2:1)&&old?.old.value.status==='pending'&&(counter?old.value.status==='countered'&&created?.value.status==='pending':['accepted','expired'].includes(old.value.status)),'INVALID_STATE','Invalid exchange transition',500);
 const trade=old.value,accepted=trade.status==='accepted',participants=[trade.fromUserId,trade.toUserId],transferred=accepted?new Set([...trade.give.copyIds,...trade.receive.copyIds]):new Set();
 const stable=(value,mutable)=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.includes(key)));
 check(isDeepStrictEqual(stable(old.old.value,['status','completedAt','counterTradeId']),stable(trade,['status','completedAt','counterTradeId'])),'INVALID_STATE','Trade terms are immutable',500);
 if(counter)check(created.value.parentTradeId===trade.id&&trade.counterTradeId===created.key&&created.value.fromUserId===trade.toUserId&&created.value.toUserId===trade.fromUserId&&!plan.completion,'INVALID_STATE','Counteroffer requires fresh ordinary admission',500);
 else check(plan.completion?.id==='trade:'+trade.id&&!plan.completion.admission,'INVALID_STATE','Exchange requires its admitted reservation',500);
 const deltas=new Map(),escrow=new Map(),add=(map,owner,money,sign)=>{const key=JSON.stringify([owner,money.currencyId]);map.set(key,(map.get(key)??0)+sign*money.amount);};
 for(const money of trade.give.currencies){add(escrow,trade.fromUserId,money,-1);add(deltas,accepted?trade.toUserId:trade.fromUserId,money,1);}
 if(accepted)for(const money of trade.receive.currencies){add(deltas,trade.toUserId,money,-1);add(deltas,trade.fromUserId,money,1);}
 if(counter)for(const money of created.value.give.currencies){add(escrow,created.value.fromUserId,money,1);add(deltas,created.value.fromUserId,money,-1);}
 for(const row of plan.changes){
  check(['trades','copies','codes','users','albums','_copyReferences','balances','_tradeEscrow','requests','ledger','events','notifications','actionJobs','completionObligations'].includes(row.collection),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside exchange scope',409);
  if(row.collection==='copies'){
   check(row.old,'INVALID_STATE','Exchange cannot create copies',500);
   if(accepted){const from=trade.give.copyIds.includes(row.key)?trade.fromUserId:trade.toUserId,to=from===trade.fromUserId?trade.toUserId:trade.fromUserId;check(transferred.has(row.key)&&row.old.value.ownerId===from&&row.value.ownerId===to&&row.value.version===row.old.value.version+1&&!row.value.lockedBy,'INVALID_STATE','Invalid ownership transition',500);check(isDeepStrictEqual(stable(row.old.value,['ownerId','acquiredAt','version','lockedBy','bindings','metadata']),stable(row.value,['ownerId','acquiredAt','version','lockedBy','bindings','metadata'])),'INVALID_STATE','Issued copy data is immutable',500);const bindings=clone(row.old.value.bindings);for(const binding of Object.values(bindings))if(binding.transfer==='follow')binding.holderId=to;check(isDeepStrictEqual(bindings,row.value.bindings),'INVALID_STATE','Binding transfer differs',500);const before=row.old.value.metadata,after=row.value.metadata;check(isDeepStrictEqual(stable(before,['transfers']),stable(after,['transfers']))&&after.transfers.length===(before.transfers?.length??0)+1&&isDeepStrictEqual(after.transfers.slice(0,-1),before.transfers??[]),'INVALID_STATE','Transfer history differs',500);}
   else {check(isDeepStrictEqual(stable(row.old.value,['lockedBy']),stable(row.value,['lockedBy'])),'INVALID_STATE','Counteroffer may change only copy locks',500);const target=counter&&created.value.give.copyIds.includes(row.key)?created.key:undefined;check((trade.give.copyIds.includes(row.key)||counter&&created.value.give.copyIds.includes(row.key))&&row.value.lockedBy===target,'INVALID_STATE','Escrow lock differs',500);}
  }else if(['balances','_tradeEscrow'].includes(row.collection)){
   check(participants.includes(row.key),'INVALID_STATE','Only participant balances may change',500);const expected=clone(row.old?.value??{}),changes=row.collection==='balances'?deltas:escrow;for(const [key,delta]of changes){const [owner,currency]=JSON.parse(key);if(owner===row.key){expected[currency]=(expected[currency]??0)+delta;if(row.collection==='_tradeEscrow'&&expected[currency]===0)delete expected[currency];}}check(isDeepStrictEqual(expected,row.value),'INVALID_STATE','Exchange balance or escrow differs',500);
  }else if(row.collection==='users'){
   check(accepted&&row.old&&isDeepStrictEqual(stable(row.old.value,['preferences','lastTradeAt']),stable(row.value,['preferences','lastTradeAt'])),'INVALID_STATE','Account identity is immutable',500);const preferences=clone(row.old.value.preferences);if(preferences)preferences.favoriteCopyIds=(preferences.favoriteCopyIds??[]).filter(id=>!transferred.has(id));check(isDeepStrictEqual(preferences,row.value.preferences),'INVALID_STATE','Favorite removal differs',500);if(!participants.includes(row.key))check(row.old.value.lastTradeAt===row.value.lastTradeAt,'INVALID_STATE','Unrelated account changed',500);
  }else if(row.collection==='albums'){
   check(accepted&&row.old&&row.value.version===row.old.value.version+1&&isDeepStrictEqual(stable(row.old.value,['placements','version']),stable(row.value,['placements','version']))&&isDeepStrictEqual(row.value.placements,row.old.value.placements.filter(p=>!transferred.has(p.copyId))),'INVALID_STATE','Album removal differs',500);
  }else if(row.collection==='_copyReferences')check(accepted&&transferred.has(row.key)&&row.old&&isDeepStrictEqual(row.value,{users:[],albums:[]}),'INVALID_STATE','Transferred references must be cleared',500);
  else if(row.collection==='codes'){
   check(accepted&&row.old&&transferred.has(row.old.value.copyId)&&row.old.value.transfer==='follow-unrevealed'&&isDeepStrictEqual(stable(row.old.value,['holderId','holderHistory','history']),stable(row.value,['holderId','holderHistory','history'])),'INVALID_STATE','Code identity is immutable',500);const copy=plan.changes.find(copy=>copy.collection==='copies'&&copy.key===row.value.copyId);check(row.value.holderId===copy.value.ownerId&&isDeepStrictEqual(row.value.holderHistory,[...row.old.value.holderHistory,copy.old.value.ownerId])&&row.value.history.length===row.old.value.history.length+1&&isDeepStrictEqual(row.value.history.slice(0,-1),row.old.value.history),'INVALID_STATE','Code holder transition differs',500);
  }else if(row.collection==='completionObligations'){
   if(row.old)check(row.key==='trade:'+trade.id&&row.old.value.status==='reserved'&&row.value.status==='completed'&&isDeepStrictEqual(stable(row.old.value,['status','usedBytes']),stable(row.value,['status','usedBytes'])),'INVALID_STATE','Admitted reservation terms are immutable',500);
   else check(counter&&(row.value.kind==='action'||row.key==='trade:'+created.key&&row.value.status==='reserved'),'INVALID_STATE','New counteroffer reservation required',500);
  }else if(!['trades'].includes(row.collection)){
   if(row.collection==='notifications'&&row.old)check(row.value===undefined&&participants.includes(row.old.value.userId),'INVALID_STATE','Only participant history may be trimmed',500);
   else {check(!row.old,'INVALID_STATE','Exchange delivery records are append-only',500);if(['requests','events','actionJobs'].includes(row.collection))check(counter?!row.value.completionId||row.value.completionId==='trade:'+trade.id:row.value.completionId==='trade:'+trade.id,'INVALID_STATE','Exchange completion identity differs',500);}
  }
  if(row.collection==='events')check(row.value.sequence===row.ordinal+1,'INVALID_STATE','Event sequence differs from append position',500);
 }
 for(const row of trades){const reservation=plan.changes.find(item=>item.collection==='completionObligations'&&item.key==='trade:'+row.key);check(reservation,'INVALID_STATE','Exchange reservation is missing',500);}
}
export function validateRecordPlan(plan,{intent=false,preferences=false,packCompletion=false,tradeProposal=false,tradeCompletion=false,tradeAcceptance=false,tradeCounter=false}={}){
  if(!plan.changes.length&&!plan.scalars.length&&!plan.completion)return;
  if(tradeAcceptance||tradeCounter){check(!intent&&!preferences&&!packCompletion&&!tradeProposal&&!tradeCompletion&&!plan.scalars.length&&tradeAcceptance!==tradeCounter,'RECORD_TRANSACTION_UNSUPPORTED','Invalid exchange scope',409);return validateTradeExchange(plan,tradeCounter);}
  if(tradeProposal||tradeCompletion){
    check(!intent&&!preferences&&!packCompletion&&!plan.scalars.length&&tradeProposal!==tradeCompletion,'RECORD_TRANSACTION_UNSUPPORTED','Invalid trade scope',409);
    const trades=plan.changes.filter(row=>row.collection==='trades');check(trades.length===1,'INVALID_STATE','One trade transition required',500);const trade=trades[0],sender=trade.value.fromUserId;
    check(tradeProposal?!trade.old&&trade.value.status==='pending':trade.old?.value.status==='pending'&&['cancelled','declined'].includes(trade.value.status),'INVALID_STATE','Invalid trade transition',500);
    const reservation=plan.changes.find(row=>row.collection==='completionObligations'&&row.key==='trade:'+trade.key);check(reservation&&reservation.value.kind==='trade'&&reservation.value.entityId===trade.key,'INVALID_STATE','Trade reservation required',500);
    if(tradeCompletion){check(plan.completion?.id===reservation.key&&!plan.completion.admission&&reservation.old?.value.status==='reserved'&&reservation.value.status==='completed','INVALID_STATE','Admitted trade reservation required',500);const stable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['status','completedAt'].includes(key)));check(isDeepStrictEqual(stable(trade.old.value),stable(trade.value)),'INVALID_STATE','Trade terms are immutable',500);for(const field of ['id','kind','entityId','bytes','events','jobs'])check(isDeepStrictEqual(reservation.old.value[field],reservation.value[field]),'INVALID_STATE','Reservation terms are immutable',500);}
    else check(!plan.completion&&!reservation.old&&reservation.value.status==='reserved','INVALID_STATE','New trade reservation required',500);
    for(const row of plan.changes){
      check(['trades','copies','balances','_tradeEscrow','requests','ledger','events','notifications','actionJobs','completionObligations'].includes(row.collection),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside trade scope',409);
      if(row.collection==='copies'){check(row.old&&trade.value.give.copyIds.includes(row.key)&&row.value.ownerId===sender,'INVALID_STATE','Only offered copies may change',500);const stable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='lockedBy'));check(isDeepStrictEqual(stable(row.old.value),stable(row.value)),'INVALID_STATE','Trade may change only copy reservation',500);check(tradeProposal?!row.old.value.lockedBy&&row.value.lockedBy===trade.key:row.old.value.lockedBy===trade.key&&!row.value.lockedBy,'INVALID_STATE','Escrow lock differs',500);}
      else if(['balances','_tradeEscrow'].includes(row.collection)){check(row.key===sender,'INVALID_STATE','Only sender escrow and balance may change',500);const expected=structuredClone(row.old?.value??{});for(const money of trade.value.give.currencies){const sign=(tradeProposal?1:-1)*(row.collection==='_tradeEscrow'?1:-1);expected[money.currencyId]=(expected[money.currencyId]??0)+sign*money.amount;if(row.collection==='_tradeEscrow'&&expected[money.currencyId]===0)delete expected[money.currencyId];}check(isDeepStrictEqual(expected,row.value),'INVALID_STATE','Trade balance or escrow projection differs',500);}
      else if(row.collection==='notifications'&&row.old){check(row.value===undefined&&[sender,trade.value.toUserId].includes(row.old.value.userId),'INVALID_STATE','Only participant history may be trimmed',500);}
      else if(!['trades','completionObligations'].includes(row.collection)){check(!row.old,'INVALID_STATE','Trade delivery records are append-only',500);if(['requests','events','actionJobs'].includes(row.collection))check(tradeCompletion?row.value.completionId===reservation.key:!row.value.completionId,'INVALID_STATE','Trade delivery reservation differs',500);}
      if(row.collection==='events')check(row.value.sequence===row.ordinal+1,'INVALID_STATE','Event sequence differs from append position',500);
    }
    if(tradeProposal)validateAcquisitionChanges(plan.changes.filter(row=>!['trades','copies','balances','_tradeEscrow','notifications'].includes(row.collection)));
    return;
  }
  if(packCompletion){
    check(!intent&&!preferences&&!plan.scalars.length&&plan.completion&&!plan.completion.admission,'RECORD_TRANSACTION_UNSUPPORTED','Pack opening requires its admitted reservation',409);
    const reservation=plan.changes.find(row=>row.collection==='completionObligations'&&row.key===plan.completion.id);check(reservation?.old?.value.kind==='pack'&&reservation.old.value.status==='reserved'&&reservation.value.status==='completed','INVALID_STATE','Pending pack reservation required',500);
    for(const row of plan.changes){
      check(['copies','packs','requests','events','notifications','actionJobs','completionObligations'].includes(row.collection),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside pack completion scope',409);
      if(row.collection==='copies'||row.collection==='packs'){
        check(row.old,'INVALID_STATE','Opening cannot create pack or copy records',500);const mutable=row.collection==='copies'?['state','openedAt','openedBy','version','actionJobIds']:['openedAt','receipt'];
        const stable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.includes(key)));check(isDeepStrictEqual(stable(row.old.value),stable(row.value)),'INVALID_STATE','Issued pack and copy snapshots are immutable',500);
        if(row.collection==='copies')check(row.old.value.state==='sealed'&&row.value.state==='owned'&&row.value.version===row.old.value.version+1,'INVALID_STATE','Opening requires a sealed copy transition',500);
        else check(row.key===reservation.value.entityId&&!row.old.value.receipt&&row.value.receipt?.id===row.key,'INVALID_STATE','Opening receipt must match the reserved pack',500);
      }else if(row.collection==='completionObligations'){check(row===reservation,'INVALID_STATE','Opening cannot spend another reservation',500);for(const field of ['id','kind','entityId','bytes','events','jobs'])check(isDeepStrictEqual(row.old.value[field],row.value[field]),'INVALID_STATE','Reservation terms are immutable',500);}
      else if(row.collection==='notifications'&&row.value===undefined){const pack=plan.changes.find(item=>item.collection==='packs');check(row.old&&row.old.value.userId===pack?.value.ownerId,'INVALID_STATE','Opening may trim only its owner notifications',500);}
      else {check(!row.old,'INVALID_STATE','Opening only appends receipts and delivery records',500);if(['requests','events','actionJobs'].includes(row.collection))check(row.value.completionId===reservation.key,'INVALID_STATE','Opening records require their reservation identity',500);if(row.collection==='events')check(row.value.sequence===row.ordinal+1,'INVALID_STATE','Event sequence differs from append position',500);}
    }
    return;
  }
  if(preferences){
    check(!intent&&!plan.scalars.length&&!plan.completion,'RECORD_TRANSACTION_UNSUPPORTED','Preferences require ordinary admission',409);
    check(plan.changes.every(row=>['users','requests','events','actionJobs','completionObligations','_copyReferences'].includes(row.collection)),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside preferences transaction scope',409);
    for(const row of plan.changes.filter(row=>row.collection==='users')){check(row.old,'RECORD_TRANSACTION_UNSUPPORTED','Preferences cannot create accounts',409);const {preferences:oldPreferences,...old}=row.old.value,{preferences:newPreferences,...next}=row.value;check(isDeepStrictEqual(old,next),'INVALID_STATE','Account identity is immutable in preferences transactions',500);}
    for(const row of plan.changes.filter(row=>row.collection==='_copyReferences')){check(row.old,'INVALID_STATE','Copy reference projection is missing',500);const expected=clone(row.old.value);for(const user of plan.changes.filter(row=>row.collection==='users')){expected.users=expected.users.filter(id=>id!==user.key);if(user.value.preferences?.favoriteCopyIds?.includes(row.key))expected.users.push(user.key);}check(isDeepStrictEqual(expected,row.value),'INVALID_STATE','Favorite projection differs',500);}
    return validateAcquisitionChanges(plan.changes.filter(row=>!['users','_copyReferences'].includes(row.collection)));
  }
  if(!intent){check(!plan.scalars.length&&!plan.completion,'RECORD_TRANSACTION_UNSUPPORTED','Acquisition cannot mutate scalars or settle reservations',409);return validateAcquisitionChanges(plan.changes);}
  for(const row of plan.scalars)check(row.name==='commandIntentCount'&&Number.isSafeInteger(row.value)&&row.value===(row.old??0)+1,'RECORD_TRANSACTION_UNSUPPORTED','Invalid intent count change',409);
  for(const row of plan.changes){
    check(['commandIntents','commandIntentHeads','completionObligations'].includes(row.collection),'RECORD_TRANSACTION_UNSUPPORTED','Collection is outside intent transaction scope',409);
    if(row.collection==='commandIntents'&&row.old)for(const field of ['id','userId','command','input','createdAt'])check(isDeepStrictEqual(row.old.value[field],row.value[field]),'INVALID_STATE','Intent identity and reviewed input are immutable',500);
    if(row.collection==='completionObligations'){check(row.value.kind==='intent'&&row.key===row.value.id,'INVALID_STATE','Intent reservation is required',500);if(row.old)for(const field of ['id','kind','entityId','bytes','events','jobs'])check(isDeepStrictEqual(row.old.value[field],row.value[field]),'INVALID_STATE','Reservation terms are immutable',500);}
  }
  if(plan.completion){const row=plan.changes.find(row=>row.collection==='completionObligations'&&row.key===plan.completion.id);check(row&&((!!row.old)!==plan.completion.admission),'INVALID_STATE','Completion must use its own admitted reservation',500);}
}

/** Synchronous record scope inside one database transaction; no external awaits. */
export function createRecordTransaction(backend,{maxRecords=4096,maxBytes=16*1024*1024}={}){
  check(Number.isSafeInteger(maxRecords)&&maxRecords>=1&&maxRecords<=100000,'INVALID_INPUT','Invalid record budget');
  check(Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=64*1024*1024,'INVALID_INPUT','Invalid byte budget');
  let active=true,reads=0,bytes=0;
  const fields=new Map(),records=new Map(),nextOrdinals=new Map(),createdKinds=new Map(),scalars=new Map();let completion;
  const live=()=>check(active,'TRANSACTION_ENDED','Record transaction has ended',409);
  const charge=size=>{live();reads++;bytes+=size;check(reads<=maxRecords&&bytes<=maxBytes,'TRANSACTION_BUDGET','Record transaction read budget exceeded',507);};
  const field=name=>{live();fieldName(name);if(!fields.has(name))fields.set(name,backend.field(name,charge));return fields.get(name);};
  const load=(name,key)=>{field(name);keyName(key);const token=JSON.stringify([name,key]);if(!records.has(token)){const old=backend.record(name,key,charge);records.set(token,{collection:name,key,old,value:old?.value,ordinal:old?.ordinal});}return records.get(token);};
  const ordinal=name=>{if(!nextOrdinals.has(name))nextOrdinals.set(name,backend.nextOrdinal(name));const value=nextOrdinals.get(name);nextOrdinals.set(name,value+1);return value;};
  const api={
    get(name,key){return clone(load(name,key).value);},
    value(name){const metadata=field(name);if(scalars.has(name))return clone(scalars.get(name).value);const kind=metadata?.kind??createdKinds.get(name);if(!kind)return undefined;if(kind==='scalar')return clone(metadata.value);const result=kind==='array'?[]:{};
      for(const row of backend.entries(name,charge)){const token=JSON.stringify([name,row.key]);if(!records.has(token))records.set(token,{collection:name,key:row.key,old:row,value:row.value,ordinal:row.ordinal});}
      for(const row of [...records.values()].filter(row=>row.collection===name&&row.value!==undefined).sort((a,b)=>a.ordinal-b.ordinal)){if(name==='notifications')result.push(clone(row.value));else Object.defineProperty(result,row.key,{value:clone(row.value),enumerable:true,writable:true,configurable:true});}return result;},
    count(name){const metadata=field(name);check(metadata?.kind!=='scalar','INVALID_INPUT','count requires a collection');charge(0);return backend.count(name)+[...records.values()].filter(row=>row.collection===name).reduce((n,row)=>n+Number(row.value!==undefined)-Number(!!row.old),0);},
    ownerCounts(ownerId){keyName(ownerId);charge(0);const result=clone(backend.ownerCounts(ownerId));
      const apply=(collection,row,delta)=>{if(!row)return;if(collection==='copies'&&row.ownerId===ownerId){result.copies+=delta;if(row.state==='owned')result.ownedCopies+=delta;if(row.state==='sealed')result.sealedCopies+=delta;}if(collection==='packs'&&row.ownerId===ownerId){result.packs+=delta;if(!row.openedAt)result.unopenedPacks+=delta;}if(collection==='codes'&&row.holderId===ownerId)result.codes+=delta;};
      for(const row of records.values()){apply(row.collection,row.old?.value,-1);apply(row.collection,row.value,1);}return result;},
    ownedVariantCount(ownerId,variantIds){keyName(ownerId);check(Array.isArray(variantIds)&&variantIds.length<=2000&&variantIds.every(id=>typeof id==='string'&&id.length<=2048),'INVALID_INPUT','Invalid owned variant query');charge(Buffer.byteLength(JSON.stringify(variantIds)));const ids=new Set(variantIds),matches=row=>!!row&&row.ownerId===ownerId&&row.state==='owned'&&ids.has(row.variantId);let total=backend.ownedVariantCount(ownerId,[...ids]);for(const row of records.values())if(row.collection==='copies')total+=Number(matches(row.value))-Number(matches(row.old?.value));return total;},
    put(name,key,value){const metadata=field(name),kind=metadata?.kind??createdKinds.get(name);check(!kind||kind==='object','INVALID_INPUT','put requires an object collection');check(value!==undefined,'INVALID_INPUT','Cannot store undefined');createdKinds.set(name,'object');const row=load(name,key);row.value=clone(value);if(row.ordinal===undefined)row.ordinal=ordinal(name);if(name==='copies'&&!row.old)api.put('_copyReferences',key,{users:[],albums:[]});return clone(value);},
    append(name,value){const metadata=field(name),kind=metadata?.kind??createdKinds.get(name);check(!kind||kind==='array','INVALID_INPUT','append requires an array collection');check(value!==undefined,'INVALID_INPUT','Cannot store undefined');createdKinds.set(name,'array');const index=ordinal(name),key=name==='notifications'?value.id:String(index),row=load(name,key);check(!row.old&&row.value===undefined,'INVALID_STATE','Append position is occupied',500);row.value=clone(value);row.ordinal=index;row.array=true;return index;},
    trimNotifications(ownerId,limit=2000){keyName(ownerId);check(limit===2000,'INVALID_INPUT','Notification retention is fixed');field('notifications');const pending=[...records.values()].filter(row=>row.collection==='notifications'&&row.value?.userId===ownerId&&!row.old).length;for(const item of backend.notificationOverflow(ownerId,limit-pending,charge)){const row=load('notifications',item.key);row.value=undefined;}},
    setScalar(name,value){const metadata=field(name);check(!metadata||metadata.kind==='scalar','INVALID_INPUT','Scalar field required');check(value!==undefined,'INVALID_INPUT','Cannot store undefined');scalars.set(name,{name,old:metadata?.value,value:clone(value)});},
    reserveIntentCompletion(id,{admission=false}={}){live();keyName(id);check(!completion,'INVALID_STATE','Only one intent reservation can fund a transaction',500);completion={id,admission};},
    reserveTradeCompletion(id){live();keyName(id);check(!completion,'INVALID_STATE','Only one reservation can fund a transaction',500);completion={id,admission:false};},
    reservePackCompletion(id){live();keyName(id);check(!completion,'INVALID_STATE','Only one reservation can fund a transaction',500);completion={id,admission:false};},
  };
  return {api,close(){active=false;},finish(){live();const changes=[...records.values()].filter(row=>!isDeepStrictEqual(row.old?.value,row.value)||completion&&row.collection==='completionObligations'&&row.key===completion.id);
    const changedScalars=[...scalars.values()].filter(row=>!isDeepStrictEqual(row.old,row.value));check(changes.length+changedScalars.length<=maxRecords,'TRANSACTION_BUDGET','Record transaction write budget exceeded',507);
    const written=changes.concat(changedScalars).reduce((total,row)=>total+Buffer.byteLength(JSON.stringify(row.value)??''),0);check(written<=maxBytes,'TRANSACTION_BUDGET','Record transaction write byte budget exceeded',507);
    return {changes,scalars:changedScalars,completion,fields,reads,bytes,written};}};
}
