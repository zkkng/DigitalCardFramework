import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditState } from '../src/audit.js';
import { MemoryStore } from '../src/index.js';
import { SQLiteStore } from '../src/sqlite.js';
import { fixture, admin } from './helpers.js';
import { codesFixture } from './codes-fixtures.mjs';

function fails(state, mutate, issue) {
  const broken=structuredClone(state);mutate(broken);
  const report=auditState(broken);
  assert.equal(report.ok,false);
  assert(report.issues.some(row=>row.code===issue),JSON.stringify(report.issues));
  assert(!JSON.stringify(report).includes('SECRET-REWARD'));
}

for(const backend of ['memory','sqlite'])test(`${backend}: audit reconciles removed wallets, users and currency entries in both directions`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-audit-')),path=join(dir,'state.sqlite');
  const store=backend==='memory'?new MemoryStore():new SQLiteStore(path),x=fixture({store});
  try {
    const state=store.read(s=>s),userId=x.alice.userId;
    assert.equal(auditState(state).ok,true);
    fails(state,s=>{delete s.balances[userId].credits;},'BALANCE_MISSING');
    fails(state,s=>{delete s.balances[userId];},'WALLET_MISSING');
    fails(state,s=>{delete s.users[userId];},'LEDGER_USER_MISSING');
    fails(state,s=>{s.balances.unknown={};},'WALLET_USER_MISSING');
    fails(state,s=>{s.catalog.currencies=s.catalog.currencies.filter(c=>c.id!=='credits');},'LEDGER_CURRENCY_MISSING');
    fails(state,s=>{s.ledger.push(structuredClone(s.ledger[0]));},'LEDGER_DUPLICATE');
    store.transact(s=>{delete s.balances[userId].credits;});
    assert(x.core.audit(admin).issues.some(i=>i.code==='BALANCE_MISSING'));
    if(backend==='sqlite'){
      x.core.close();
      const restored=new SQLiteStore(path);
      try {assert(restored.read(auditState).issues.some(i=>i.code==='BALANCE_MISSING'));} finally {restored.close();}
    }
  } finally {if(backend==='memory')x.core.close();else {try{x.core.close();}catch{}}rmSync(dir,{recursive:true,force:true});}
});

test('audit requires recorded zero ledger accounts but permits untouched empty wallets',()=>{
  const store=new MemoryStore(),x=fixture({store,change(c){c.products.find(p=>p.id==='common').price.amount=10000;}});
  try {
    x.core.registerUser(admin,{provider:'test',subject:'empty',displayName:'Empty'});
    x.buy('common');
    const state=store.read(s=>s);assert.equal(auditState(state).ok,true);
    fails(state,s=>{delete s.balances[x.alice.userId].credits;},'BALANCE_MISSING');
  } finally {x.core.close();}
});

test('audit connects purchases, pack contents and opening receipts without assuming current ownership',()=>{
  const x=codesFixture();
  try {
    const bought=x.buy('bundle'),packId=bought.packs[0].id,copyId=x.store.read(s=>s.packs[packId].copyIds[0]);
    let state=x.store.read(s=>s);assert.equal(auditState(state).ok,true);
    fails(state,s=>{s.packs[packId].copyIds.pop();},'COPY_PACK_MISSING');
    fails(state,s=>{s.packs[packId].copyIds.push(copyId);},'PACK_COPY_INVALID');
    fails(state,s=>{s.packs[packId].ownerId=x.bob.userId;},'SEALED_PACK_INVALID');
    fails(state,s=>{const key=Object.keys(s.requests).find(k=>s.requests[k].result?.id===bought.id);delete s.requests[key];},'PURCHASE_RECEIPT_MISSING');
    fails(state,s=>{Object.values(s.requests).find(r=>r.result?.id===bought.id).result.packs=[];},'PACK_PURCHASE_MISSING');
    x.core.openPack(x.alice,{key:'open',packId});state=x.store.read(s=>s);
    fails(state,s=>{s.packs[packId].receipt.cards.pop();},'PACK_RECEIPT_INVALID');
    const trade=x.core.proposeTrade(x.alice,{key:'gift',toUserId:x.bob.userId,give:{copyIds:[copyId],currencies:[]},receive:{copyIds:[],currencies:[]}});
    x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
    assert.equal(x.core.audit(admin).ok,true);
  } finally {x.core.close();}
});

test('audit distinguishes missing escrow or refund evidence from balanced but wrong ledger rows',()=>{
  const store=new MemoryStore(),x=fixture({store});
  try {
    const trade=x.core.proposeTrade(x.alice,{key:'money',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});
    let state=store.read(s=>s);assert.equal(auditState(state).ok,true);
    fails(state,s=>{s.trades[trade.id].give.currencies[0].amount=11;},'ESCROW_LEDGER_INVALID');
    fails(state,s=>{delete s.trades[trade.id];},'TRADE_RECEIPT_MISSING');
    x.core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id});state=store.read(s=>s);
    fails(state,s=>{s.ledger.find(e=>e.type==='trade.refund').type='grant';},'ESCROW_LEDGER_INVALID');
    assert.equal(x.core.audit(admin).ok,true);
  } finally {x.core.close();}
});

test('audit validates code receipt and holder relationships while retained codes survive trades',()=>{
  const x=codesFixture({transfer:'retain',type:'collectible'});
  try {
    const copy=x.openCode(),codeId=copy.codes[0].id;
    x.core.revealCode(x.alice,{key:'reveal',codeId});
    const trade=x.core.proposeTrade(x.alice,{key:'gift',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
    x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
    const state=x.store.read(s=>s);assert.equal(auditState(state).ok,true);
    fails(state,s=>{s.codes[codeId].revealedBy='missing';},'CODE_DISCLOSURE_INVALID');
    fails(state,s=>{s.codes[codeId].allocatedAt=null;},'CODE_ALLOCATION_INVALID');
    fails(state,s=>{delete s.codes[codeId];},'CODE_BATCH_RECEIPT_INVALID');
    fails(state,s=>{const rows=Object.values(s.codes);rows[1].externalId=rows[0].externalId;},'CODE_EXTERNAL_ID_DUPLICATE');
  } finally {x.core.close();}
});

test('audit connects durable event jobs to their exact events and rejects duplicate delivery identities',()=>{
  const store=new MemoryStore(),x=fixture({store,eventSubscriptions:[{id:'watch',handler:'external.event',events:['*']}]});
  try {
    const state=store.read(s=>s),jobId=Object.keys(state.actionJobs)[0];assert.equal(auditState(state).ok,true);
    fails(state,s=>{s.actionJobs[jobId].source.eventId='missing';},'ACTION_EVENT_INVALID');
    fails(state,s=>{s.actionJobs[jobId].params.event.type='different';},'ACTION_EVENT_INVALID');
    fails(state,s=>{s.actionJobs.duplicate={...structuredClone(s.actionJobs[jobId]),id:'duplicate'};},'ACTION_EVENT_DUPLICATE');
  } finally {x.core.close();}
});
