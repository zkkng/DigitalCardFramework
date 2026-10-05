import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardFramework, MemoryStore } from '../src/index.js';
import { CodeService } from '../src/codes.js';
import { SQLiteStore } from '../src/sqlite.js';
import { codesFixture, vault } from './codes-fixtures.mjs';
import { admin, code } from './helpers.js';

const subscriptions=[{id:'all',handler:'external.all',events:['*']},{id:'disclosure',handler:'external.reveal',events:['code.revealed']}];
const codeEvents=['code.pool-configured','code.batch-imported','code.allocated','code.transferred','code.revealed','code.usage-reported','code.redeemed','code.revoked','code.keys-rotated'];

for(const backend of ['memory','sqlite'])test(`${backend}: code lifecycle events enqueue matching durable subscriptions once with secret-free stable identities`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-code-events-')),path=join(dir,'state.sqlite');
  const store=backend==='memory'?new MemoryStore():new SQLiteStore(path),x=codesFixture({store,transfer:'follow-unrevealed',eventSubscriptions:subscriptions});
  try {
    const copy=x.openCode(),codeId=copy.codes[0].id;
    const offer=x.core.proposeTrade(x.alice,{key:'gift',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
    x.core.acceptTrade(x.bob,{key:'accept',tradeId:offer.id});
    x.core.revealCode(x.bob,{key:'reveal',codeId});
    x.core.reportCodeUsage(x.bob,{key:'reported',codeId});
    const proof={providerId:'example.game',eventId:'redemption',codeId,status:'redeemed',occurredAt:'2026-09-30T12:01:00.000Z'};
    x.core.confirmCodeStatus(admin,proof);
    const second=x.openCode();
    x.core.confirmCodeStatus(admin,{...proof,eventId:'revocation',codeId:second.codes[0].id,status:'revoked'});
    x.core.rotateCodeEncryption(admin);
    const before=store.read(s=>({events:s.events,jobs:s.actionJobs}));
    x.core.revealCode(x.bob,{key:'reveal',codeId});
    x.core.reportCodeUsage(x.bob,{key:'reported',codeId});
    x.core.confirmCodeStatus(admin,proof);
    x.core.acceptTrade(x.bob,{key:'accept',tradeId:offer.id});
    assert.deepEqual(store.read(s=>({events:s.events,jobs:s.actionJobs})),before);
    const events=before.events.filter(e=>e.type.startsWith('code.')),jobs=Object.values(before.jobs);
    assert.deepEqual([...new Set(events.map(e=>e.type))].sort(),[...codeEvents].sort());
    for(const event of events){
      const linked=jobs.filter(j=>j.source.eventId===event.id);
      assert.equal(linked.filter(j=>j.source.subscriptionId==='all').length,1,event.type);
      assert.equal(linked.filter(j=>j.source.subscriptionId==='disclosure').length,event.type==='code.revealed'?1:0);
      for(const job of linked){assert.deepEqual(job.params.event,event);assert.equal(job.createdAt,event.at);}
    }
    assert(!JSON.stringify({events,jobs}).includes('SECRET-REWARD'));
    assert.equal(x.core.audit(admin).ok,true);
    if(backend==='sqlite'){
      x.core.close();const reopened=new SQLiteStore(path);
      try {assert.deepEqual(reopened.read(s=>({events:s.events,jobs:s.actionJobs})),before);}finally{reopened.close();}
    }
  } finally {try{x.core.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('code mutations and allocation roll back with event jobs when subscription capacity is exhausted',()=>{
  const x=codesFixture();
  const limited=new CardFramework({store:x.store,codeVault:vault(),eventSubscriptions:[{id:'all',handler:'external.event',events:['*']}],limits:{actionJobs:1}});
  try {
    limited.configureCodePool(admin,{key:'second-pool',pool:{id:'second',providerId:'example.other',name:'Second'}});
    const before=x.store.read(s=>s);
    assert.throws(()=>limited.importCodes(admin,{key:'new-stock',poolId:'second',codes:[{code:'CAPACITY-SECRET'}]}),code('INSTALLATION_CAPACITY'));
    assert.deepEqual(x.store.read(s=>s),before);
    assert.throws(()=>limited.purchase(x.alice,{key:'purchase-at-capacity',...limited.quote(x.alice,{productId:'bundle'})}),code('INSTALLATION_CAPACITY'));
    assert.deepEqual(x.store.read(s=>s),before);
  } finally {x.core.close();}
});

test('standalone code service preserves default event logging without requiring framework subscriptions',()=>{
  const store=new MemoryStore(),service=new CodeService({store,vault:vault(),clock:()=> '2026-09-30T12:00:00.000Z'});
  try {
    const input={key:'pool',pool:{id:'standalone',providerId:'example.provider',name:'Standalone'}};
    service.configurePool(admin,input);service.configurePool(admin,input);
    assert.equal(store.read(s=>s.events.length),1);assert.equal(store.read(s=>s.events[0].type),'code.pool-configured');
    assert.equal(store.read(s=>Object.keys(s.actionJobs??{}).length),0);
  } finally {store.close();}
});
