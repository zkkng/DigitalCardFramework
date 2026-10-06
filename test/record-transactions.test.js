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
    const counts=tx.ownerCounts('alice');tx.put('copies','test-copy',{id:'test-copy',ownerId:'alice',state:'owned'});assert.equal(tx.ownerCounts('alice').ownedCopies,counts.ownedCopies+1);assert.equal(tx.ownerCounts('bob').ownedCopies,0);
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
  await assert.rejects(core.purchaseAsync(x.alice,{...request,key:'rejected'}),code('STORAGE_CAPACITY'));assert.deepEqual(bounded.read(s=>s),before);
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
