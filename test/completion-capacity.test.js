import test from 'node:test';
import assert from 'node:assert/strict';
import {CardFramework,MemoryStore} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin,code} from './helpers.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {completionCapacity,completionDefaults,completionPool} from '../src/completion.js';
import {codesFixture,vault} from './codes-fixtures.mjs';
const clock=()=> '2026-09-30T12:00:00.000Z';
const subscriptions=[{id:'all',handler:'events',events:['*']}];
test('opening reserves repeated large code metadata, provenance and maximum action attachments',()=>{
 const dir=mkdtempSync(join(tmpdir(),'completion-projection-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core;
 try{
  const store=new SQLiteStore(path,{encryptionKey}),metadata={text:'x'.repeat(32000)},x=codesFixture({store,stock:0,change(c){const variant=c.variants.find(row=>row.id==='reward.standard'),product=c.products.find(row=>row.id==='bundle');variant.codes=Array.from({length:8},(_,i)=>({id:'code-'+i,poolId:'rewards'}));variant.onOpen=Array.from({length:16},(_,i)=>({id:'action-'+i,handler:'deliver',params:{text:'a'.repeat(12000)}}));product.metadata=metadata;product.slots[1].metadata=metadata;}});core=x.core;
  core.importCodes(admin,{key:'stock',poolId:'rewards',codes:Array.from({length:8},(_,i)=>({code:'QUALIFICATION-'+i,metadata}))});const pack=x.buy('bundle').packs[0];
  const codeId=store.read(s=>Object.values(s.codes)[0].id);assert.throws(()=>core.confirmCodeStatus(admin,{providerId:'example.game',eventId:'oversize-date',codeId,status:'revoked',occurredAt:'2026-10-01'+ ' '.repeat(100)}),code('INVALID_INPUT'));
  core.confirmCodeStatus(admin,{providerId:'example.game',eventId:'revoked',codeId,status:'revoked',occurredAt:'2026-10-01T00:00:00Z'});
  const cap=store.read(s=>store.measure(s).totalBytes);core.close();const bounded=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store:bounded,clock,codeVault:vault()});
  const receipt=core.openPack(x.alice,{key:'open',packId:pack.id});assert.equal(receipt.cards.find(card=>card.cardId==='reward').codes.length,8);assert.deepEqual(core.openPack(x.alice,{key:'open',packId:pack.id}),receipt);assert.equal(core.audit(admin).ok,true);
  const reservation=bounded.read(s=>s.completionObligations['pack:'+pack.id]);assert(reservation.usedBytes<reservation.bytes);assert.equal(bounded.read(s=>Object.values(s.actionJobs).filter(job=>job.completionId===reservation.id).length),16);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' legacy migration fences admission and backfills atomically',()=>{
 const store=new Store(),x=fixture({store,eventSubscriptions:subscriptions});try{
  const pack=x.buy().packs[0],trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});
  store.transact(s=>{delete s.completionObligations;for(const job of Object.values(s.actionJobs))delete job.deliveryCompletionId;});
  const before=store.read(s=>s),limited=new CardFramework({store,clock,eventSubscriptions:subscriptions,limits:{completionObligations:1}});
  assert.throws(()=>limited.backfillCompletionReservations(admin),code('COMPLETION_CAPACITY'));assert.deepEqual(store.read(s=>s),before);
  const core=new CardFramework({store,clock,eventSubscriptions:subscriptions});
  for(const command of [()=>core.setPreferences(x.alice,{key:'new',inventoryVisibility:'public'}),()=>core.grantCurrency(admin,{userId:x.alice.userId,currencyId:'credits',amount:1,key:'new',reason:'Funding'}),()=>core.settleExternalCredit(admin,{providerId:'fixture',transactionId:'new',userId:x.alice.userId,currencyId:'credits',amount:1,externalCurrency:'credits',externalUnits:'1'})]){assert.throws(command,code('COMPLETION_MIGRATION_REQUIRED'));assert.deepEqual(store.read(s=>s),before);}
  assert.equal(core.wallet(x.alice).credits,9980);assert(core.backfillCompletionReservations(admin).count>=3);assert.deepEqual(core.backfillCompletionReservations(admin),{count:0});
  assert.deepEqual(store.read(s=>s.requests),before.requests);assert.deepEqual(store.read(s=>s.balances),before.balances);assert.deepEqual(store.read(s=>s.trades),before.trades);
  core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id});core.openPack(x.alice,{key:'open',packId:pack.id});assert.equal(core.audit(admin).ok,true);
 }finally{x.core.close();}
});
test('completion records cannot spend another obligation reservation',()=>{
 const row={id:'trade:a',status:'completed',bytes:1000,usedBytes:0,jobs:1,events:1};
 const state={completionObligations:{a:row,b:{...row,id:'trade:b',status:'reserved',jobs:10,events:10}},actionJobs:{a:{completionId:row.id},b:{completionId:row.id}}};
 assert.throws(()=>completionCapacity(state,completionDefaults),code('COMPLETION_INVARIANT'));
 state.actionJobs={};state.events=[{completionId:row.id},{completionId:row.id}];assert.throws(()=>completionCapacity(state,completionDefaults),code('COMPLETION_INVARIANT'));
 state.events=[];state.requests={a:{completionId:row.id},b:{completionId:row.id}};assert.throws(()=>completionCapacity(state,completionDefaults),code('COMPLETION_INVARIANT'));
});
test('completion byte accounting rejects invalid status and excess credit',()=>{
 for(const patch of [{status:'unknown'},{usedBytes:101},{usedBytes:-1}])assert.throws(()=>completionPool({completionObligations:{a:{status:'completed',bytes:100,usedBytes:0,...patch}}}),code('INVALID_STATE'));
});
test('retained completion credit cannot fund ordinary writes after a receipt is removed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'completion-retained-')),path=join(dir,'state.sqlite');let core;
 try{
  const original=new SQLiteStore(path),x=fixture({store:original});core=x.core;const pack=x.buy().packs[0];core.openPack(x.alice,{key:'open',packId:pack.id});
  const cap=original.read(s=>original.measure(s).totalBytes);core.close();
  const store=new SQLiteStore(path,{maxStateBytes:cap});core=new CardFramework({store,clock});
  store.transact(s=>{for(const [key,row]of Object.entries(s.requests))if(row.completionId)delete s.requests[key];});
  const before=store.read(s=>s),reclaimed=cap-store.measure(before).totalBytes;
  assert.throws(()=>store.transact(s=>{s.replacementPayload='x'.repeat(reclaimed+100);}),code('STORAGE_CAPACITY'));assert.deepEqual(store.read(s=>s),before);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
for(const tagged of [false,true])test('encrypted delivery survives 100 attempts at the ordinary byte boundary, completion '+tagged,()=>{
 const dir=mkdtempSync(join(tmpdir(),'completion-delivery-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core,now=Date.parse(clock());
 try{
  const initial=new SQLiteStore(path,{encryptionKey}),x=fixture({store:initial,eventSubscriptions:subscriptions});core=x.core;
  const trade=core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id});
  let target;initial.transact(s=>{target=Object.values(s.actionJobs).find(job=>!!job.completionId===tagged).id;for(const job of Object.values(s.actionJobs))if(job.id!==target)job.status='succeeded';});
  const cap=initial.read(s=>initial.measure(s).totalBytes);core.close();
  let store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store,clock:()=>new Date(now).toISOString(),actionOptions:{maxAttempts:100}});
  for(let attempt=1;attempt<=100;attempt++){
   const job=core.claimAction(admin);assert.equal(job.id,target);assert.equal(job.attempts,attempt);
   const result=core.settleAction(admin,{jobId:job.id,leaseToken:job.leaseToken,succeeded:attempt===100});assert.equal(result.status,attempt===100?'succeeded':'pending');now+=3600001;
   if(attempt===50){core.close();store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store,clock:()=>new Date(now).toISOString(),actionOptions:{maxAttempts:100}});}
  }
  assert.equal(core.claimAction(admin),null);assert.equal(core.audit(admin).ok,true);assert.equal(store.read(s=>completionPool(s).reservedBytes),0);
  const before=store.read(s=>s);assert.throws(()=>core.setPreferences(x.alice,{key:'ordinary',inventoryVisibility:'public'}),code('STORAGE_CAPACITY'));assert.deepEqual(store.read(s=>s),before);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' external settlement uses the ordinary receipt pool after completion',()=>{
  const store=new Store(),x=fixture({store});try{
    const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});
    x.core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id});
    const requests=store.read(s=>Object.values(s.requests).filter(row=>!row.completionId).length+Object.keys(s.operatorRequests??{}).length+1);
    const core=new CardFramework({store,clock,limits:{requests}}),input={providerId:'fixture',transactionId:'first',userId:x.alice.userId,currencyId:'credits',amount:1,externalCurrency:'credits',externalUnits:'1'};
    const receipt=core.settleExternalCredit(admin,input);assert.equal(receipt.balance,10001);assert.deepEqual(core.settleExternalCredit(admin,input),receipt);
    const before=store.read(s=>s);assert.throws(()=>core.settleExternalCredit(admin,{...input,transactionId:'second'}),code('INSTALLATION_CAPACITY'));assert.deepEqual(store.read(s=>s),before);assert.equal(core.audit(admin).ok,true);
  }finally{x.core.close();}
});
for(const Store of [MemoryStore,SQLiteStore])for(const boundary of ['requests','actionJobs','events'])for(const kind of ['trade','listing','paid-pack'])test(Store.name+' completes '+kind+' at '+boundary+' capacity',()=>{
  const store=new Store(),x=fixture({store,eventSubscriptions:subscriptions});let actor=x.alice,target,command,input;
  try{
    if(kind==='trade'){target=x.core.proposeTrade(actor,{key:'admit',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});command='cancelTrade';input={key:'resolve',tradeId:target.id};}
    else if(kind==='listing'){actor={...x.alice,role:'admin'};const shop=x.core.createShop(actor,{key:'shop',name:'Stock',kind:'admin'});target=x.core.createListing(actor,{key:'admit',shopId:shop.id,title:'Stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2}});command='cancelListing';input={key:'resolve',listingId:target.id};}
    else{target=x.buy().packs[0];command='openPack';input={key:'resolve',packId:target.id};}
    const cap=store.read(s=>boundary==='requests'?Object.keys(s.requests).length+Object.keys(s.operatorRequests??{}).length:boundary==='events'?s.events.length:Object.keys(s.actionJobs).length);
    const core=new CardFramework({store,clock,eventSubscriptions:subscriptions,limits:{[boundary]:cap}});const result=core[command](actor,input);assert.deepEqual(core[command](actor,input),result);assert.equal(core.audit(admin).ok,true);
    assert(store.read(s=>Object.values(s.requests).some(row=>row.completionId)));assert(store.read(s=>Object.values(s.actionJobs).some(row=>row.completionId)));
    if(kind==='trade')assert.equal(core.wallet(actor).credits,10000);
  }finally{x.core.close();}
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' refuses new obligations when completion receipt reservations are full',()=>{
  const store=new Store(),x=fixture({store});try{
    const core=new CardFramework({store,clock,limits:{completionRequests:1}}),input={toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}};
    const first=core.proposeTrade(x.alice,{...input,key:'first'}),before=store.read(s=>s);assert.throws(()=>core.proposeTrade(x.alice,{...input,key:'second'}),code('COMPLETION_CAPACITY'));assert.deepEqual(store.read(s=>s),before);
    core.cancelTrade(x.alice,{key:'complete',tradeId:first.id});assert.throws(()=>core.proposeTrade(x.alice,{...input,key:'second'}),code('COMPLETION_CAPACITY'));assert.equal(core.wallet(x.alice).credits,10000);
  }finally{x.core.close();}
});
test('countering and complete stock sale release original reservations',()=>{
 const store=new MemoryStore(),x=fixture({store});try{
  const old=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});x.core.counterTrade(x.bob,{key:'counter',tradeId:old.id,give:{copyIds:[],currencies:[{currencyId:'credits',amount:5}]},receive:{copyIds:[],currencies:[]}});assert.equal(store.read(s=>s.completionObligations['trade:'+old.id].status),'completed');
  const actor={...x.alice,role:'admin'},shop=x.core.createShop(actor,{key:'shop',name:'Stock',kind:'admin'}),listing=x.core.createListing(actor,{key:'listing',shopId:shop.id,title:'Stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:1}}),quote=x.core.quoteListing(x.bob,{listingId:listing.id});x.core.buyListing(x.bob,{...quote,key:'buy'});assert.equal(store.read(s=>s.completionObligations['listing:'+listing.id].status),'completed');assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});
test('removed subscriptions are never resurrected by an older obligation',()=>{
 const store=new MemoryStore(),x=fixture({store,eventSubscriptions:subscriptions});try{
  const pack=x.buy().packs[0],before=store.read(s=>Object.keys(s.actionJobs).length),core=new CardFramework({store,clock,eventSubscriptions:[]});core.openPack(x.alice,{key:'open',packId:pack.id});assert.equal(store.read(s=>Object.keys(s.actionJobs).length),before);assert.equal(core.audit(admin).ok,true);
 }finally{x.core.close();}
});

for(const Store of [MemoryStore,SQLiteStore])for(const outcome of ['accepted','declined','expired'])test(Store.name+' completes funded card trade at all ordinary record limits: '+outcome,()=>{
 const store=new Store(),x=fixture({store,eventSubscriptions:subscriptions});try{
  const [copy]=x.open(),trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[{currencyId:'credits',amount:5}]}});
  const limits=store.read(s=>({requests:Object.values(s.requests).filter(row=>!row.completionId).length,events:s.events.filter(row=>!row.completionId).length,actionJobs:Object.values(s.actionJobs).filter(row=>!row.completionId).length}));
  const core=new CardFramework({store,clock:outcome==='expired'?()=> '2026-10-30T12:00:00.000Z':clock,eventSubscriptions:subscriptions,limits});
  if(outcome==='accepted'){const input={key:'accept',tradeId:trade.id},result=core.acceptTrade(x.bob,input);assert.equal(result.status,outcome);assert.deepEqual(core.acceptTrade(x.bob,input),result);assert.equal(store.read(s=>s.copies[copy.id].ownerId),x.bob.userId);}
  else if(outcome==='declined'){const input={key:'decline',tradeId:trade.id},result=core.cancelTrade(x.bob,input);assert.equal(result.status,outcome);assert.deepEqual(core.cancelTrade(x.bob,input),result);}
  else{const result=core.sweepExpiredTrades(admin);assert.equal(result.ok,true);assert.deepEqual(result.completed,[trade.id]);assert.deepEqual(core.sweepExpiredTrades(admin).completed,[]);}
  assert.equal(store.read(s=>s.trades[trade.id].status),outcome);assert.equal(core.audit(admin).ok,true);
 }finally{x.core.close();}
});

for(const legacy of [false,true])for(const kind of ['trade','listing','paid-pack'])test('encrypted restart completes '+kind+' at the exact ordinary byte boundary, legacy '+legacy,()=>{
 const dir=mkdtempSync(join(tmpdir(),'completion-bytes-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core;
 try{
  const store=new SQLiteStore(path,{encryptionKey}),x=fixture({store,eventSubscriptions:subscriptions});core=x.core;let actor=x.alice,target,command,input;
  if(kind==='trade'){target=core.proposeTrade(actor,{key:'admit',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});command='cancelTrade';input={key:'complete',tradeId:target.id};}
  else if(kind==='listing'){actor={...x.alice,role:'admin'};const shop=core.createShop(actor,{key:'shop',name:'Stock',kind:'admin'});target=core.createListing(actor,{key:'listing',shopId:shop.id,title:'Stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2}});command='cancelListing';input={key:'complete',listingId:target.id};}
  else{target=x.buy().packs[0];command='openPack';input={key:'complete',packId:target.id};}
  if(legacy)store.transact(s=>{delete s.completionObligations;for(const job of Object.values(s.actionJobs??{}))delete job.deliveryCompletionId;});
  else store.transact(s=>{s.revision=8;});
  const cap=store.read(s=>store.measure(s).totalBytes);core.close();const bounded=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store:bounded,clock,eventSubscriptions:subscriptions});
  if(legacy){assert(core.backfillCompletionReservations(admin).count>0);assert.deepEqual(core.backfillCompletionReservations(admin),{count:0});}
  const receipt=core[command](actor,input);assert.deepEqual(core[command](actor,input),receipt);assert(bounded.read(s=>bounded.measure(s).totalBytes===bounded.measure(s).usedBytes));assert(bounded.read(s=>bounded.measure(s).usedBytes>cap));assert.equal(core.audit(admin).ok,true);
  const before=bounded.read(s=>s);assert.throws(()=>core.setPreferences(x.alice,{key:'new-work',inventoryVisibility:'public'}),code('STORAGE_CAPACITY'));assert.deepEqual(bounded.read(s=>s),before);
  core.close();core=new CardFramework({store:new SQLiteStore(path,{encryptionKey,maxStateBytes:cap}),clock,eventSubscriptions:subscriptions});assert.deepEqual(core[command](actor,input),receipt);assert.equal(core.audit(admin).ok,true);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
