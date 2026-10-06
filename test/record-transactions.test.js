import {DatabaseSync} from 'node:sqlite';
import {createStateCodec} from '../src/encryption.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin,code} from './helpers.js';
import {CardFramework} from '../src/core.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {summarizeRecords} from '../src/record-accounting.js';

for(const Store of [MemoryStore,SQLiteStore]){
 test(Store.name+' worker aggregates drain accepted work after admission is disabled',async()=>{
  const store=new Store(),x=fixture({store,eventSubscriptions:[{id:'preferences',events:['preferences.updated'],handler:'preferences'}],actionHandlers:{preferences:async()=>({ok:true})}});try{
   store.prepareRecordTransactions();x.core.setPreferences(x.alice,{key:'preferences',inventoryVisibility:'public'});const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:5}]},receive:{copyIds:[],currencies:[]}});
   const catalog=x.core.operatorCatalog(admin);catalog.version++;catalog.capabilities={version:1,primitives:{issuance:true,transfer:true,settlement:true}};x.core.publishCatalog(admin,catalog);
   const read=store.read.bind(store),plan=()=>{store.read=()=>{throw new Error('Worker planning cannot materialize installation state');};try{return x.core.workerPlan(admin);}finally{store.read=read;}};
   const before=store.diagnostics?.(),first=plan();assert.deepEqual(first,{actions:true,maintenance:true});if(before)assert(store.diagnostics().decodedQueryRecords-before.decodedQueryRecords<=2);first.actions=false;assert.equal(plan().actions,true);assert.throws(()=>x.core.workerPlan(x.alice),code('FORBIDDEN'));
   await x.core.dispatchActions(admin);assert.deepEqual(plan(),{actions:false,maintenance:true});x.core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id});assert.deepEqual(plan(),{actions:false,maintenance:false});assert.equal(x.core.audit(admin).ok,true);
  }finally{x.core.close();}
 });
 test(Store.name+' bounded preferences preserve identity, replay and one delivery',async()=>{
  let deliveries=0;const store=new Store(),x=fixture({store,eventSubscriptions:[{id:'preferences',events:['preferences.updated'],handler:'preferences'}],actionHandlers:{preferences:async()=>{deliveries++;}}});try{
   const owned=x.open()[0];store.prepareRecordTransactions();const identity=store.query(q=>q.get('users',x.alice.userId)),before=store.diagnostics?.(),request={key:'preferences',inventoryVisibility:'public',favoriteCopyIds:[owned.id],wishlistCardIds:['dawn'],blockedUserIds:[x.bob.userId]};
   const result=x.core.setPreferences(x.alice,request);assert.deepEqual(x.core.setPreferences(x.alice,request),result);assert.equal(result.inventoryVisibility,'public');assert.deepEqual(result.favoriteCopyIds,[owned.id]);
   if(before){const after=store.diagnostics();assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<40);assert(after.recordWrites-before.recordWrites<15);}
   const current=store.query(q=>q.get('users',x.alice.userId));delete current.preferences;delete identity.preferences;assert.deepEqual(current,identity);
   const snapshot=store.read(s=>s);assert.throws(()=>x.core.setPreferences(x.alice,{key:'prototype',blockedUserIds:['__proto__']}),code('INVALID_INPUT'));assert.throws(()=>store.transactRecords(tx=>{const row=tx.get('users',x.alice.userId);row.provider='changed';tx.put('users',row.id,row);},{preferences:true}),code('INVALID_STATE'));assert.deepEqual(store.read(s=>s),snapshot);
   await x.core.dispatchActions(admin);await x.core.dispatchActions(admin);assert.equal(deliveries,1);assert.equal(x.core.audit(admin).ok,true);
  }finally{x.core.close();}
 });
 test(Store.name+' quote reads selected configuration without installation materialization',()=>{
  const store=new Store(),x=fixture({store});try{
   x.core.configureAdmin(admin,{key:'discount',expectedRevision:0,reason:'Reviewed pricing',scope:'product',targetId:'common',changes:{discountPercent:20}});
   const configurationRecords=store.read(s=>1+Object.keys(s.catalog).length+Object.keys(s.adminControls).length),before=store.diagnostics?.(),read=store.read.bind(store);store.read=()=>{throw new Error('Whole-state read is forbidden');};
   const quote=x.core.quote(x.alice,{productId:'common',quantity:2});assert.equal(quote.price.amount,16);assert.equal(quote.adminRevision,1);
   if(before)assert(store.diagnostics().decodedQueryRecords-before.decodedQueryRecords<=configurationRecords);
   assert.throws(()=>x.core.quote({...x.alice,disabled:true},{productId:'common'}),code('UNAUTHENTICATED'));assert.throws(()=>x.core.quote(x.alice,{productId:'missing'}),code('UNAVAILABLE'));
   assert.throws(()=>x.core.quote({userId:'__proto__'},{productId:'common'}),code('UNAUTHENTICATED'));
   if(before){const after=store.diagnostics();assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert.equal(after.recordWrites,before.recordWrites);}
   store.read=read;assert.equal(store.read(s=>Object.hasOwn(s,'_recordAccounting')),false);
  }finally{x.core.close();}
 });
 test(Store.name+' record scope reads staged values, counts and special identifiers',()=>{
  const store=new Store();try{
   store.prepareRecordTransactions();let retained;
   store.transactRecords(tx=>{retained=tx;tx.put('balances','__proto__',{credits:7});tx.put('balances','alice',{credits:8});
    assert.deepEqual(tx.get('balances','__proto__'),{credits:7});assert.equal(tx.count('balances'),2);
    const values=tx.value('balances');assert.equal(Object.getPrototypeOf(values),Object.prototype);assert.equal(Object.hasOwn(values,'__proto__'),true);assert.equal(values.__proto__.credits,7);
    values.alice.credits=99;assert.equal(tx.get('balances','alice').credits,8);
    assert.equal(tx.append('events',{sequence:1,type:'test'}),0);assert.deepEqual(tx.value('events'),[{sequence:1,type:'test'}]);assert.equal(tx.count('events'),1);
    const counts=tx.ownerCounts('alice');tx.put('copies','test-copy',{id:'test-copy',ownerId:'alice',state:'owned',variantId:'sample'});assert.equal(tx.ownerCounts('alice').ownedCopies,counts.ownedCopies+1);assert.equal(tx.ownerCounts('bob').ownedCopies,0);assert.equal(tx.ownedVariantCount('alice',['sample']),1);assert.equal(tx.ownedVariantCount('bob',['sample']),0);
   });
   assert.throws(()=>retained.get('balances','alice'),code('TRANSACTION_ENDED'));
   assert.equal(store.read(s=>s.balances.__proto__.credits),7);
  }finally{store.close();}
 });
 test(Store.name+' record scope rolls back failures and enforces budgets',()=>{
  const store=new Store();try{
   store.prepareRecordTransactions();const before=store.read(s=>s);
   assert.throws(()=>store.transactRecords(tx=>{tx.put('balances','alice',{credits:1});throw new Error('abort');}),/abort/);
   assert.throws(()=>store.transactRecords(async tx=>{tx.put('balances','alice',{credits:1});}),/Async .*callbacks/);
   assert.throws(()=>store.transactRecords(tx=>{tx.get('balances','alice');tx.get('balances','bob');},{maxRecords:1}),code('TRANSACTION_BUDGET'));
   assert.throws(()=>store.transactRecords(tx=>tx.put('balances','alice',{text:'x'.repeat(100)}),{maxBytes:10}),code('TRANSACTION_BUDGET'));
   assert.deepEqual(store.read(s=>s),before);
  }finally{store.close();}
 });
 test(Store.name+' async acquisition replays and completes admitted packs',async()=>{
  const store=new Store(),x=fixture({store});try{
   store.prepareRecordTransactions();const request={...x.core.quote(x.alice,{productId:'common',quantity:1}),key:'async-buy'};
   const before=store.diagnostics?.(),receipt=await x.core.purchaseAsync(x.alice,request),after=store.diagnostics?.();
   if(before){assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<35);assert(after.recordWrites-before.recordWrites<20);}
   assert.deepEqual(await x.core.purchaseAsync(x.alice,request),receipt);if(after)assert.equal(store.diagnostics().recordWrites,after.recordWrites);
   assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.openPack(x.alice,{packId:receipt.packs[0].id,key:'open'}).cards.length,1);assert.equal(x.core.audit(admin).ok,true);
  }finally{x.core.close();}
 });
 test(Store.name+' accounting is opt-in and unsupported products retain compatibility semantics',async()=>{
  const store=new Store(),x=fixture({store,change(c){c.products.find(p=>p.id==='common').duplicatePolicy={scope:'inventory',fallback:'allow'};}});try{
   assert.equal(store.read(s=>Object.hasOwn(s,'_recordAccounting')),false);
   const request={...x.core.quote(x.alice,{productId:'common',quantity:1}),key:'fallback'};
   const receipt=await x.core.purchaseAsync(x.alice,request);assert.deepEqual(x.core.purchase(x.alice,request),receipt);
   assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.audit(admin).ok,true);
   assert.equal(store.prepareRecordTransactions().prepared,false);
  }finally{x.core.close();}
 });
 test(Store.name+' intent record scope preserves immutable input and scalar boundaries',()=>{
  const store=new Store(),x=fixture({store});try{
   store.prepareRecordTransactions();const intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.core.quote(x.alice,{productId:'common',quantity:1})}),before=store.read(s=>s);
   assert.throws(()=>store.transactRecords(tx=>{const row=tx.get('commandIntents',intent.id);row.input.productId='rare';tx.put('commandIntents',intent.id,row);},{intent:true}),code('INVALID_STATE'));
   assert.throws(()=>store.transactRecords(tx=>tx.setScalar('revision',999),{intent:true}),code('RECORD_TRANSACTION_UNSUPPORTED'));
   assert.throws(()=>store.transactRecords(tx=>tx.setScalar('commandIntentCount',2)),code('RECORD_TRANSACTION_UNSUPPORTED'));
   assert.deepEqual(store.read(s=>s),before);
  }finally{x.core.close();}
 });
}

test('bounded acquisition rolls back at storage capacity without losing accepted completion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'record-capacity-')),path=join(dir,'state.sqlite');let core;
 try{
  const store=new SQLiteStore(path),x=fixture({store});core=x.core;store.prepareRecordTransactions();
  const request={...core.quote(x.alice,{productId:'common',quantity:1}),key:'accepted'},receipt=await core.purchaseAsync(x.alice,request),cap=store.read(s=>store.measure(s).totalBytes);core.close();
  const bounded=new SQLiteStore(path,{maxStateBytes:cap});core=new CardFramework({store:bounded,clock:()=> '2026-09-30T12:00:00.000Z'});const before=bounded.read(s=>s);
  await assert.rejects(core.purchaseAsync(x.alice,{...request,key:'rejected'}),code('STORAGE_CAPACITY'));assert.throws(()=>core.setPreferences(x.alice,{key:'capacity',inventoryVisibility:'public'}),code('STORAGE_CAPACITY'));assert.deepEqual(bounded.read(s=>s),before);
  assert.deepEqual(await core.purchaseAsync(x.alice,request),receipt);core.openPack(x.alice,{packId:receipt.packs[0].id,key:'open'});assert.equal(core.audit(admin).ok,true);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

test('encrypted acquisition changes bounded records and recovers its receipt and outbox after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'record-acquisition-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32),clock=()=> '2026-09-30T12:00:00.000Z';let core;
 try{
  const store=new SQLiteStore(path,{encryptionKey}),x=fixture({store,eventSubscriptions:[{id:'purchase',handler:'purchase',events:['packs.purchased']}]});core=x.core;
  store.transact(s=>{for(let i=0;i<1000;i++){s.requests['unrelated:'+i]={hash:'old',result:{padding:'x'.repeat(200)}};}});
  store.prepareRecordTransactions();const request={...core.quote(x.alice,{productId:'common',quantity:1}),key:'durable'},before=store.diagnostics();
  const receipt=await core.purchaseAsync(x.alice,request),after=store.diagnostics();
  assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<35);assert(after.recordWrites-before.recordWrites<20);
  store.read(s=>{const cached=JSON.parse(s._recordAccounting),actual=summarizeRecords(s);actual.usedBytes=store.measure(s).usedBytes;assert.deepEqual(cached,actual);});
  core.close();let deliveries=0;const reopened=new SQLiteStore(path,{encryptionKey});core=new CardFramework({store:reopened,clock,actionHandlers:{purchase:async()=>{deliveries++;}}});
  const restart=reopened.diagnostics();assert.deepEqual(await core.purchaseAsync(x.alice,request),receipt);assert.equal(reopened.diagnostics().recordWrites,restart.recordWrites);
  await core.dispatchActions(admin);await core.dispatchActions(admin);assert.equal(deliveries,1);assert.equal(core.wallet(x.alice).credits,9990);assert.equal(core.audit(admin).ok,true);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' opening trims only the owner journal with stable retained order and accurate deletion accounting',async()=>{
 const store=new Store(),x=fixture({store});try{
  store.transact(s=>{s.notifications=[];for(let i=0;i<2000;i++){s.notifications.push({id:'a:'+i,userId:x.alice.userId,type:'sample',at:String(i),read:false,data:{}});s.notifications.push({id:'b:'+i,userId:x.bob.userId,type:'sample',at:String(i),read:false,data:{}});}});
  store.prepareRecordTransactions();const buy=await x.core.purchaseAsync(x.alice,{...x.core.quote(x.alice,{productId:'common',quantity:1}),key:'trim-buy'}),before=store.diagnostics?.();
  const result=x.core.openPack(x.alice,{packId:buy.packs[0].id,key:'trim-open'}),after=store.diagnostics?.();
  if(before){assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<40);assert(after.recordWrites-before.recordWrites<20);}
  const state=store.read(s=>s),alice=state.notifications.filter(n=>n.userId===x.alice.userId),bob=state.notifications.filter(n=>n.userId===x.bob.userId);
  assert.equal(alice.length,2000);assert.equal(alice[0].id,'a:1');assert.equal(alice.at(-1).type,'pack.opened');assert.deepEqual(bob.map(n=>n.id),Array.from({length:2000},(_,i)=>'b:'+i));
  const cached=JSON.parse(state._recordAccounting),actual=summarizeRecords(state);actual.usedBytes=store.measure(state).usedBytes;assert.deepEqual(cached,actual);
  assert.deepEqual(x.core.openPack(x.alice,{packId:buy.packs[0].id,key:'trim-open'}),result);
  const original=state.notifications.map(n=>n.id);x.core.readNotifications(x.alice,{key:'mark-read',ids:['a:1']});assert.deepEqual(store.read(s=>s.notifications.map(n=>n.id)),original);assert.equal(store.read(s=>s.notifications.find(n=>n.id==='a:1').read),true);
  const read=store.read;store.read=()=>{throw Error('No whole-state read');};assert.equal(x.core.notifications(x.bob,{limit:10}).total,2000);store.read=read;store.transact(s=>s.notifications.reverse());assert.deepEqual(store.read(s=>s.notifications.map(n=>n.id)),original.slice().reverse());store.transact(s=>s.notifications.unshift({id:'inserted',userId:x.bob.userId,type:'test',data:{},at:'now',read:false}));assert.equal(store.read(s=>s.notifications[0].id),'inserted');
 }finally{x.core.close();}
});

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' bounded trade proposal and cancellation preserve escrow, immutable cards, receipts and queued events',async()=>{
 const store=new Store(),x=fixture({store,eventSubscriptions:[{id:'trade',handler:'trade',events:['trade.proposed','trade.cancelled']}]});try{
  const copy=x.open()[0];store.prepareRecordTransactions();const original=store.read(s=>s.copies[copy.id]),input={key:'bounded-trade',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[{currencyId:'credits',amount:50}]},receive:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]}};
  const before=store.diagnostics?.(),trade=x.core.proposeTrade(x.alice,input),after=store.diagnostics?.();if(before){assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<45);assert(after.recordWrites-before.recordWrites<15);}
  assert.equal(x.core.wallet(x.alice).credits,9940);assert.equal(store.read(s=>s._tradeEscrow[x.alice.userId].credits),50);assert.deepEqual(x.core.proposeTrade(x.alice,input),trade);
  assert.throws(()=>x.core.proposeTrade(x.alice,{...input,message:'different'}),code('IDEMPOTENCY_CONFLICT'));
  const cancellationBefore=store.diagnostics?.(),cancel=x.core.cancelTrade(x.bob,{key:'decline',tradeId:trade.id}),cancellationAfter=store.diagnostics?.();assert.equal(cancel.status,'declined');if(cancellationBefore){assert.equal(cancellationAfter.compatibilityMaterializations,cancellationBefore.compatibilityMaterializations);assert(cancellationAfter.decodedQueryRecords-cancellationBefore.decodedQueryRecords<45);}
  assert.equal(x.core.wallet(x.alice).credits,9990);assert.deepEqual(store.read(s=>s.copies[copy.id]),original);assert.deepEqual(store.read(s=>s._tradeEscrow[x.alice.userId]),{});assert.deepEqual(x.core.cancelTrade(x.bob,{key:'decline',tradeId:trade.id}),cancel);
  store.read(s=>{const actual=summarizeRecords(s);actual.usedBytes=store.measure(s).usedBytes;assert.deepEqual(JSON.parse(s._recordAccounting),actual);assert.equal(Object.values(s.actionJobs).filter(row=>row.source?.type==='event').length,2);});assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' escrow projection survives compatibility mutations and rejects corrupt refunds',()=>{
 const store=new Store(),x=fixture({store});try{
  const offer=key=>x.core.proposeTrade(x.alice,{key,toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:20}]},receive:{copyIds:[],currencies:[]}}),first=offer('one'),second=offer('two');
  assert.equal(store.read(s=>s._tradeEscrow[x.alice.userId].credits),40);store.transact(s=>{s.balances[x.alice.userId].credits=Number.MAX_SAFE_INTEGER-30;});const invalid=store.read(s=>s);assert.throws(()=>x.core.cancelTrade(x.alice,{key:'overflow',tradeId:first.id}),code('BALANCE_OVERFLOW'));assert.deepEqual(store.read(s=>s),invalid);store.transact(s=>{s.balances[x.alice.userId].credits=9960;});x.core.acceptTrade(x.bob,{key:'accept-compat',tradeId:first.id});assert.equal(store.read(s=>s._tradeEscrow[x.alice.userId].credits),20);
  // Model an older writer by deleting projection metadata after its otherwise valid commit.
  const transact=store.transact.bind(store);store.transact=fn=>transact(s=>{const result=fn(s);delete s._recordAccounting;delete s._tradeEscrow;return result;});store.transact(s=>{s.users[x.alice.userId].displayName='Updated';});store.transact=transact;
  const third=offer('three');assert.equal(store.read(s=>s._tradeEscrow[x.alice.userId].credits),40);assert.equal(store.read(s=>JSON.parse(s._recordAccounting).version),2);x.core.cancelTrade(x.alice,{key:'cancel-two',tradeId:second.id});assert.equal(store.read(s=>s._tradeEscrow[x.alice.userId].credits),20);
  const records=store.transactRecords.bind(store);store.transactRecords=(fn,options)=>records(tx=>{const get=tx.get;tx.get=(field,id)=>field==='_tradeEscrow'?{credits:-1}:get(field,id);return fn(tx);},options);const before=store.read(s=>s);assert.throws(()=>x.core.cancelTrade(x.alice,{key:'corrupt',tradeId:third.id}),code('INVALID_STATE'));assert.deepEqual(store.read(s=>s),before);store.transactRecords=records;
  x.core.cancelTrade(x.alice,{key:'cancel-three',tradeId:third.id});assert.equal(x.core.wallet(x.alice).credits,9980);assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});

test('bounded encrypted trade cancellation survives rollback and restart at ordinary capacity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'record-trade-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32),clock=()=> '2026-09-30T12:00:00.000Z';let core;
 try{
  let store=new SQLiteStore(path,{encryptionKey}),x=fixture({store});core=x.core;const copy=x.open()[0],trade=core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[{currencyId:'credits',amount:25}]},receive:{copyIds:[],currencies:[]}}),cap=store.read(s=>store.measure(s).totalBytes);core.close();
  store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store,clock});const before=store.read(s=>s),records=store.transactRecords.bind(store);store.transactRecords=(fn,options)=>records(tx=>{const result=fn(tx);if(options?.tradeCompletion)throw Error('interrupted trade commit');return result;},options);
  assert.throws(()=>core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id}),/interrupted trade commit/);assert.deepEqual(store.read(s=>s),before);core.close();
  store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store,clock});const metrics=store.diagnostics(),result=core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id});assert.equal(result.status,'cancelled');assert.equal(store.diagnostics().compatibilityMaterializations,metrics.compatibilityMaterializations);assert.equal(core.wallet(x.alice).credits,9990);assert.equal(store.read(s=>s.copies[copy.id].lockedBy),undefined);assert.deepEqual(core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id}),result);assert.equal(core.audit(admin).ok,true);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

test('stale escrow accounting cannot force allocation during full-capacity completion or replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'trade-stale-')),path=join(dir,'state.sqlite');let core;
 try{
  let store=new SQLiteStore(path),x=fixture({store});core=x.core;const input={key:'one',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:20}]},receive:{copyIds:[],currencies:[]}},trade=core.proposeTrade(x.alice,input);core.proposeTrade(x.alice,{...input,key:'two'});core.close();
  const db=new DatabaseSync(path),codec=createStateCodec(),row=db.prepare("SELECT payload FROM framework_fields WHERE name='_recordAccounting'").get(),envelope=codec.decode(row.payload),summary=JSON.parse(envelope.value);summary.version=1;envelope.value=JSON.stringify(summary);db.prepare("UPDATE framework_fields SET payload=? WHERE name='_recordAccounting'").run(codec.encode(envelope));db.exec("DELETE FROM framework_entities WHERE collection='_tradeEscrow'; DELETE FROM framework_fields WHERE name='_tradeEscrow';");db.close();
  const inspection=new SQLiteStore(path,{readOnly:true}),cap=inspection.read(s=>inspection.measure(s).totalBytes);inspection.close();store=new SQLiteStore(path,{maxStateBytes:cap});core=new CardFramework({store,clock:()=> '2026-09-30T12:00:00.000Z'});
  const result=core.cancelTrade(x.alice,{key:'cancel-stale',tradeId:trade.id});assert.equal(result.status,'cancelled');assert.equal(store.read(s=>s._recordAccounting),undefined);assert.equal(store.read(s=>s._tradeEscrow),undefined);const before=store.diagnostics();assert.deepEqual(core.cancelTrade(x.alice,{key:'cancel-stale',tradeId:trade.id}),result);assert.equal(store.diagnostics().recordWrites,before.recordWrites);assert.equal(core.wallet(x.alice).credits,9980);assert.equal(core.audit(admin).ok,true);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
