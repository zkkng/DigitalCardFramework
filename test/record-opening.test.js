import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {SQLiteStore} from '../src/sqlite.js';
import {CardFramework} from '../src/core.js';
import {fixture,admin,code} from './helpers.js';
import {FrameworkError} from '../src/catalog.js';
import {summarizeRecords} from '../src/record-accounting.js';

test('bounded encrypted opening survives rollback, restart and full capacity with immutable snapshots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'record-opening-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32),clock=()=> '2026-09-30T12:00:00.000Z',eventSubscriptions=[{id:'opening',handler:'opened',events:['pack.opened']}];let core,deliveries=0;const actionHandlers={opened:async()=>{deliveries++;},badge:async()=>{deliveries++;}};
 try{
  let store=new SQLiteStore(path,{encryptionKey}),x=fixture({store,eventSubscriptions,actionHandlers,change(c){const product=c.products.find(p=>p.id==='common');product.slots[0].count=2;product.name='Original edition pack';c.variants.find(v=>v.id==='dawn.standard').onOpen=[{id:'badge',handler:'badge',params:{badge:'dawn'}}];}});core=x.core;store.prepareRecordTransactions();const packs=x.buy('common',x.alice,2).packs,originalName=x.c.cards.find(c=>c.id==='dawn').name,originalProduct=structuredClone(packs[0].product);
  const catalog=core.operatorCatalog(admin);catalog.version++;catalog.cards.find(c=>c.id==='dawn').name='Updated edition name';const product=catalog.products.find(p=>p.id==='common');product.revision++;product.name='New edition pack';core.publishCatalog(admin,catalog);assert.deepEqual(core.packs(x.alice)[0].product,originalProduct);const cap=store.read(s=>store.measure(s).totalBytes);core.close();
  store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store,clock,eventSubscriptions,actionHandlers});const before=store.read(s=>s),records=store.transactRecords.bind(store);let fail=true;
  store.transactRecords=(fn,options)=>records(tx=>{const result=fn(tx);if(fail&&tx.get('packs',packs[0].id)?.receipt){fail=false;throw new FrameworkError('OPEN_INTERRUPTED','Interrupted before commit',503);}return result;},options);
  assert.throws(()=>core.openPack(x.alice,{key:'open',packId:packs[0].id}),code('OPEN_INTERRUPTED'));assert.deepEqual(store.read(s=>s),before);assert.equal(deliveries,0);core.close();
  store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store,clock,eventSubscriptions,actionHandlers});const diagnostics=store.diagnostics(),receipt=core.openPack(x.alice,{key:'open',packId:packs[0].id}),after=store.diagnostics();assert.equal(after.compatibilityMaterializations,diagnostics.compatibilityMaterializations);assert(after.decodedQueryRecords-diagnostics.decodedQueryRecords<45);assert(after.recordWrites-diagnostics.recordWrites<20);
  assert.deepEqual(receipt.cards.map(c=>c.isNew),[true,false]);assert(receipt.cards.every(c=>c.definition.name===originalName));assert.deepEqual(core.openPack(x.alice,{key:'open',packId:packs[0].id}),receipt);assert.equal(store.diagnostics().recordWrites,after.recordWrites);assert.deepEqual(core.packs(x.alice).find(p=>p.id===receipt.id).product,originalProduct);
  const second=core.openPack(x.alice,{key:'second',packId:packs[1].id});assert(second.cards.every(c=>!c.isNew));await core.dispatchActions(admin);await core.dispatchActions(admin);assert.equal(deliveries,6);assert.equal(core.audit(admin).ok,true);
  store.read(s=>{const actual=summarizeRecords(s);actual.usedBytes=store.measure(s).usedBytes;assert.deepEqual(JSON.parse(s._recordAccounting),actual);});
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

test('notification retention boundary uses compatibility opening without losing history',()=>{
 const store=new SQLiteStore(),x=fixture({store});try{
  store.prepareRecordTransactions();const pack=x.buy().packs[0];store.transact(s=>{s.notifications=Array.from({length:2000},(_,i)=>({id:'old-'+i,userId:x.alice.userId,type:'test',data:{},at:'2026-09-30T12:00:00.000Z',read:false}));});const before=store.diagnostics();const receipt=x.core.openPack(x.alice,{key:'open',packId:pack.id});assert.equal(receipt.cards.length,1);assert(store.diagnostics().compatibilityMaterializations>before.compatibilityMaterializations);assert.equal(store.read(s=>s.notifications.length),2000);assert.equal(store.read(s=>s.notifications[0].id),'old-1');assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});

test('record budget exhaustion cannot strand an admitted opening',()=>{
 const store=new SQLiteStore(),x=fixture({store});try{
  store.prepareRecordTransactions();const pack=x.buy().packs[0],records=store.transactRecords.bind(store);store.transactRecords=(fn,options)=>records(fn,options?.packCompletion?{...options,maxRecords:1}:options);const receipt=x.core.openPack(x.alice,{key:'open',packId:pack.id});assert.equal(receipt.cards.length,1);assert.deepEqual(x.core.openPack(x.alice,{key:'open',packId:pack.id}),receipt);assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});

test('retired historical variants still prevent a false new-card opening',()=>{
 const store=new SQLiteStore(),x=fixture({store,change(c){c.variants.push({...structuredClone(c.variants.find(v=>v.id==='dawn.standard')),id:'dawn.history'});}});try{
  x.core.administerCards(admin,{key:'history',action:'give',userId:x.alice.userId,variantId:'dawn.history',quantity:1,reason:'Historical edition',expectedRevision:x.core.adminOverview(admin).revision});const pack=x.buy().packs[0],catalog=x.core.operatorCatalog(admin);catalog.version++;
  const removed=structuredClone(catalog);removed.variants=removed.variants.filter(v=>v.id!=='dawn.history');assert.throws(()=>x.core.publishCatalog(admin,removed),code('CATALOG_CONFLICT'));
  const remapped=structuredClone(catalog);remapped.variants.find(v=>v.id==='dawn.history').cardId='aurora';assert.throws(()=>x.core.publishCatalog(admin,remapped),code('CATALOG_CONFLICT'));
  catalog.variants.find(v=>v.id==='dawn.history').enabled=false;x.core.publishCatalog(admin,catalog);store.prepareRecordTransactions();const before=store.diagnostics(),receipt=x.core.openPack(x.alice,{key:'open',packId:pack.id});assert.equal(receipt.cards[0].isNew,false);assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});
