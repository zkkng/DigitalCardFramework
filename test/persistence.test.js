import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {CardFramework} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin,code} from './helpers.js';

test('SQLite restart preserves inventories, balances, edition accounting and idempotency',t=>{
  const dir=mkdtempSync(join(tmpdir(),'digital-card-'));let restored;t.after(()=>{restored?.close();assert(dir.startsWith(join(tmpdir(),'digital-card-')));rmSync(dir,{recursive:true,force:true});});
  const path=join(dir,'test.sqlite'),x=fixture({store:new SQLiteStore(path)}),quote=x.core.quote(x.alice,{productId:'unique'});
  const purchase=x.core.purchase(x.alice,{...quote,key:'durable'}),receipt=x.core.openPack(x.alice,{key:'open',packId:purchase.packs[0].id});
  x.core.saveAlbum(x.alice,{key:'album',name:'Saved',placements:[{copyId:receipt.cards[0].id}]});x.core.close();
  restored=new CardFramework({store:new SQLiteStore(path)});
  assert.equal(restored.inventory(x.alice)[0].id,receipt.cards[0].id);
  assert.equal(restored.wallet(x.alice).credits,9990);
  assert.deepEqual(restored.purchase(x.alice,{...quote,key:'durable'}),purchase);
  assert.equal(restored.albums(x.alice)[0].name,'Saved');
  assert.throws(()=>restored.purchase(x.bob,{...quote,key:'another'}),code('POOL_EXHAUSTED'));
});
test('SQLite failed commands roll back the complete durable state',t=>{
  const store=new SQLiteStore(),x=fixture({store});t.after(()=>x.core.close());
  const before=x.core.events(admin).length;
  assert.throws(()=>x.buy('unique',x.alice,2),code('POOL_EXHAUSTED'));
  assert.equal(x.core.events(admin).length,before);assert.equal(x.core.wallet(x.alice).credits,10000);
  assert.equal(x.open('unique')[0].serialNumber,1);
});
function workerPurchase(path,actor,quote,key) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./purchase-worker.js',import.meta.url),{workerData:{path,actor,quote,key}});
    worker.once('message',resolve);worker.once('error',reject);worker.once('exit',exit=>{if(exit!==0)reject(new Error('Worker exited '+exit));});
  });
}
test('concurrent SQLite connections cannot both purchase the last edition copy',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'digital-card-race-'));t.after(()=>{assert(dir.startsWith(join(tmpdir(),'digital-card-')));rmSync(dir,{recursive:true,force:true});});
  const path=join(dir,'race.sqlite'),x=fixture({store:new SQLiteStore(path)}),quote=x.core.quote(x.alice,{productId:'unique'});
  const results=await Promise.all([workerPurchase(path,x.alice,quote,'a'),workerPurchase(path,x.bob,quote,'b')]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.code==='POOL_EXHAUSTED').length,1);
  assert.equal(x.core.wallet(x.alice).credits+x.core.wallet(x.bob).credits,19990);x.core.close();
});
test('concurrent duplicate purchase keys produce one debit and one pack',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'digital-card-retry-'));t.after(()=>{assert(dir.startsWith(join(tmpdir(),'digital-card-')));rmSync(dir,{recursive:true,force:true});});
  const path=join(dir,'retry.sqlite'),x=fixture({store:new SQLiteStore(path)}),quote=x.core.quote(x.alice,{productId:'common'});
  const results=await Promise.all([workerPurchase(path,x.alice,quote,'same'),workerPurchase(path,x.alice,quote,'same')]);
  assert(results.every(r=>r.ok));assert.deepEqual(results[0].result,results[1].result);
  assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.packs(x.alice).length,1);x.core.close();
});
