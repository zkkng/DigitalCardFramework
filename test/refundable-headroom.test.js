import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {MemoryStore,CardFramework} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin,code} from './helpers.js';
const MAX=Number.MAX_SAFE_INTEGER;
const offer=(x,key='offer',actor=x.alice,toUserId=x.bob.userId,amount=10)=>x.core.proposeTrade(actor,{key,toUserId,give:{copyIds:[],currencies:[{currencyId:'credits',amount}]},receive:{copyIds:[],currencies:[]},expiresInSeconds:60});
const fill=(x,actor=x.alice,reserved=10)=>x.core.grantCurrency(admin,{key:'fill-'+actor.userId,userId:actor.userId,currencyId:'credits',amount:MAX-x.core.wallet(actor).credits-reserved,reason:'Boundary funding'});
for(const Store of [MemoryStore,SQLiteStore]){
  test(Store.name+' counts all refundable escrow and rolls back excessive credits',()=>{
    const store=new Store(),x=fixture({store});try{
      const a=offer(x,'a'),b=offer(x,'b',x.alice,x.bob.userId,20);fill(x,x.alice,30);
      const before=store.read(s=>s);
      assert.throws(()=>x.core.grantCurrency(admin,{key:'too-much',userId:x.alice.userId,currencyId:'credits',amount:1,reason:'Boundary'}),code('BALANCE_OVERFLOW'));
      assert.throws(()=>x.core.settleExternalCredit(admin,{providerId:'provider',transactionId:'credit',userId:x.alice.userId,currencyId:'credits',amount:1,externalCurrency:'credits',externalUnits:'1'}),code('BALANCE_OVERFLOW'));
      assert.deepEqual(store.read(s=>s),before);
      x.core.cancelTrade(x.alice,{key:'cancel',tradeId:a.id});x.core.cancelTrade(x.bob,{key:'decline',tradeId:b.id});
      assert.equal(x.core.wallet(x.alice).credits,MAX);assert.equal(x.core.audit(admin).ok,true);
      assert.equal(x.core.cancelTrade(x.alice,{key:'cancel',tradeId:a.id}).status,'cancelled');assert.equal(x.core.wallet(x.alice).credits,MAX);
    }finally{x.core.close();}
  });
  test(Store.name+' incoming acceptance respects unrelated escrow and can be retried safely',()=>{
    const store=new Store(),x=fixture({store});try{
      const own=offer(x,'own'),incoming=offer(x,'incoming',x.bob,x.alice.userId);fill(x);
      const before=store.read(s=>s);assert.throws(()=>x.core.acceptTrade(x.alice,{key:'accept',tradeId:incoming.id}),code('BALANCE_OVERFLOW'));assert.deepEqual(store.read(s=>s),before);
      x.core.convert(x.alice,{key:'spend',from:'credits',to:'gems',amount:300,catalogVersion:1});x.core.acceptTrade(x.alice,{key:'accept',tradeId:incoming.id});x.core.cancelTrade(x.alice,{key:'cancel',tradeId:own.id});
      assert.equal(x.core.wallet(x.alice).credits,MAX-290);assert.equal(x.core.audit(admin).ok,true);
    }finally{x.core.close();}
  });
  test(Store.name+' counter releases its original liability exactly once',()=>{
    const store=new Store(),x=fixture({store});try{
      const initial=offer(x);fill(x);const counter=x.core.counterTrade(x.bob,{key:'counter',tradeId:initial.id,give:{copyIds:[],currencies:[{currencyId:'credits',amount:5}]},receive:{copyIds:[],currencies:[]}});
      assert.equal(x.core.wallet(x.alice).credits,MAX);x.core.cancelTrade(x.bob,{key:'cancel-counter',tradeId:counter.id});assert.equal(x.core.wallet(x.bob).credits,10000);assert.equal(x.core.audit(admin).ok,true);
    }finally{x.core.close();}
  });
  test(Store.name+' one invalid expiry rolls back alone and reports safe diagnostics',()=>{
    let now='2026-09-30T12:00:00.000Z';const store=new Store(),x=fixture({store,clock:()=>now});try{
      const bad=offer(x,'bad'),good=offer(x,'good',x.bob,x.alice.userId);store.transact(s=>{s.balances[x.alice.userId].credits=MAX;});
      now='2026-09-30T12:02:00.000Z';const report=x.core.sweepExpiredTrades(admin);
      assert.deepEqual(report,{ok:false,completed:[good.id],failed:[{tradeId:bad.id,code:'BALANCE_OVERFLOW'}]});assert.equal(store.read(s=>s.trades[bad.id].status),'pending');assert.equal(x.core.wallet(x.bob).credits,10000);
      assert.equal(store.read(s=>s.ledger.filter(e=>e.type==='trade.refund'&&e.reference===bad.id).length),0);assert.equal(x.core.trades(x.bob).length,2);
    }finally{x.core.close();}
  });
}
test('encrypted disk restart preserves maximum refundable headroom and expiry',()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-headroom-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core;
  try{
    const store=new SQLiteStore(path,{encryptionKey}),x=fixture({store});core=x.core;const trade=offer(x);fill(x);core.close();core=new CardFramework({store:new SQLiteStore(path,{encryptionKey}),clock:()=> '2026-09-30T12:02:00.000Z'});
    assert.deepEqual(core.sweepExpiredTrades(admin),{ok:true,completed:[trade.id],failed:[]});assert.equal(core.wallet(x.alice).credits,MAX);assert.equal(core.audit(admin).ok,true);
    assert.deepEqual(core.sweepExpiredTrades(admin),{ok:true,completed:[],failed:[]});
  }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
