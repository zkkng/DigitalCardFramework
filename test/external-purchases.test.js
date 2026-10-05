import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardFramework, MemoryStore} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {externalPurchaseDigest, externalPurchaseFingerprint, externalPurchaseId} from '../src/external-purchases.js';
import {fixture, admin, code} from './helpers.js';
import {codesFixture, vault} from './codes-fixtures.mjs';

const providerId='test.wallet';
const provider={permissions:['currency.settle'],settlementProviderId:providerId};
function payments(){
  const proofs=new Map();
  return {providers:{[providerId]:{
    validateIntent:({intent})=>intent.externalCurrency==='points'&&intent.externalUnits===String(intent.quote.price.amount),
    verifyProof:({proof})=>proofs.get(proof.reference)===externalPurchaseDigest(proof),
  }},receipt(row,kind='debit',reference=kind+':'+row.terms.transactionId){
    const {providerId,transactionId,userId,externalCurrency,externalUnits}=row.terms;
    const proof={kind,reference,providerId,transactionId,userId,externalCurrency,externalUnits,fingerprint:row.fingerprint};
    if(kind==='refund')Object.assign(proof,{compensationId:row.compensationId,debitReference:row.debitReference});
    proofs.set(reference,externalPurchaseDigest(proof));return proof;
  }};
}
function setup(options={}){
  const store=options.store??new MemoryStore(),base=fixture({...options,store}),pay=payments();
  const core=new CardFramework({store,random:()=>0,clock:()=> '2026-09-30T12:00:00.000Z',bindings:{'demo.code':()=>({code:'PRIVATE-DEMO-CODE'})},externalPurchaseProviders:pay.providers,...options.framework});
  const intent=(transactionId,actor=base.alice,productId='common',quantity=1)=>{
    const quote=core.quote(actor,{productId,quantity});
    return {key:transactionId,providerId,transactionId,userId:actor.userId,externalCurrency:'points',externalUnits:String(quote.price.amount),quote};
  };
  const prepare=(...args)=>core.prepareExternalPurchase(provider,intent(...args));
  const commit=row=>core.commitExternalPurchase(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:pay.receipt(row)});
  return {...base,store,core,pay,intent,prepare,commit};
}

test('canonical fingerprints and provider transactions are order-independent and input-bound',()=>{
  const intent={providerId:'wallet',transactionId:'order-1',userId:'collector',externalCurrency:'points',externalUnits:'25',quote:{productId:'starter',quantity:1,productRevision:2,catalogVersion:3,adminRevision:0,price:{currencyId:'credit',amount:25}}};
  assert.equal(externalPurchaseFingerprint(intent),externalPurchaseFingerprint(Object.fromEntries(Object.entries(intent).reverse())));
  assert.equal(externalPurchaseFingerprint(intent),'22dbe9a3bc27b6530c8937ad1075e265db09e9cdb74022cf88d0694df1f490c1');
  assert.equal(externalPurchaseId('wallet','order-1'),'ep_2c980abbe540231d94dc8489227c6561c7778b772c73b64b9c737720e796217d');
  assert.notEqual(externalPurchaseFingerprint(intent),externalPurchaseFingerprint({...intent,externalCurrency:'bonus'}));
});

for(const backend of ['memory','encrypted-sqlite'])test(`${backend}: pending purchase cursors survive completion and restart`,()=>{
  const directory=mkdtempSync(join(tmpdir(),'pending-purchase-cursor-')),path=join(directory,'state.sqlite'),encryptionKey=Buffer.alloc(32,6);
  const x=setup({store:backend==='memory'?new MemoryStore():new SQLiteStore(path,{encryptionKey})});let core=x.core;
  try{
    const rows=['one','two','three'].map(id=>x.prepare('cursor-'+id)).sort((a,b)=>a.preparationId.localeCompare(b.preparationId));
    const first=core.pendingExternalPurchases(provider,{providerId,limit:1});
    assert.equal(first.items[0].preparationId,rows[0].preparationId);assert.equal(first.nextCursor,rows[0].preparationId);
    x.commit(rows[0]);
    if(backend==='encrypted-sqlite'){core.close();core=new CardFramework({store:new SQLiteStore(path,{encryptionKey}),externalPurchaseProviders:x.pay.providers});}
    const second=core.pendingExternalPurchases(provider,{providerId,after:first.nextCursor,limit:1});
    assert.equal(second.items[0].preparationId,rows[1].preparationId);assert.equal(second.nextCursor,rows[1].preparationId);
    core.cancelExternalPurchase(provider,{preparationId:rows[1].preparationId,fingerprint:rows[1].fingerprint,noDebitReceipt:x.pay.receipt(rows[1],'no_debit')});
    const third=core.pendingExternalPurchases(provider,{providerId,after:second.nextCursor,limit:1});
    assert.deepEqual(third.items.map(row=>row.preparationId),[rows[2].preparationId]);assert.equal(third.nextCursor,null);
    assert.deepEqual(core.pendingExternalPurchases(provider,{providerId,after:'ep_'+'f'.repeat(64),limit:1}),{items:[],nextCursor:null});
    assert.throws(()=>core.pendingExternalPurchases({...provider,settlementProviderId:'other.wallet'},{providerId,after:first.nextCursor}),code('FORBIDDEN'));
    assert.throws(()=>core.packsPage(x.alice,{after:'missing',limit:1}),code('INVALID_CURSOR'));
    assert(core.audit(admin).ok);
  }finally{core.close();rmSync(directory,{recursive:true,force:true});}
});

test('preparation is private and allocation creates no spendable intermediate credit',()=>{
  const x=setup(),wallet=x.core.wallet(x.alice),before=x.store.read(s=>({supply:s.supply,packs:s.packs,copies:s.copies,pity:s.pity}));
  const row=x.prepare('order');assert.equal(row.state,'prepared');
  assert.deepEqual(x.store.read(s=>({supply:s.supply,packs:s.packs,copies:s.copies,pity:s.pity})),before);
  assert.deepEqual(x.core.wallet(x.alice),wallet);assert.equal(x.core.packs(x.alice).length,0);
  assert.throws(()=>x.core.externalPurchaseStatus(x.bob,{preparationId:row.preparationId}),code('NOT_FOUND'));
  assert.equal(x.core.externalPurchaseStatus(x.alice,{preparationId:row.preparationId}).snapshot,undefined);
  assert.equal(x.core.pendingExternalPurchases(provider,{providerId}).items.length,1);
  const done=x.commit(row);assert.equal(done.state,'fulfilled');assert.equal(done.purchase.packs.length,1);
  assert.deepEqual(x.core.wallet(x.alice),wallet);assert.deepEqual(x.commit(row),done);
  assert.equal(x.store.read(s=>s.externalPurchases[row.preparationId].snapshot),undefined);
  assert.equal(x.core.pendingExternalPurchases(provider,{providerId}).items.length,0);
  assert(x.core.audit(admin).ok);
});

test('the final-stock loser reaches refund_required and only an exact original-source refund completes it',()=>{
  const x=setup(),one=x.prepare('one',x.alice,'unique'),two=x.prepare('two',x.bob,'unique');
  assert.equal(x.commit(one).state,'fulfilled');
  const failed=x.commit(two);assert.equal(failed.state,'refund_required');assert.equal(failed.failureCode,'POOL_EXHAUSTED');
  assert.equal(x.core.packs(x.bob).length,0);assert.equal(x.store.read(s=>Object.keys(s.copies).length),1);
  const refund=x.pay.receipt(failed,'refund');
  assert.throws(()=>x.core.confirmExternalCompensation(provider,{preparationId:two.preparationId,fingerprint:two.fingerprint,refundReceipt:{...refund,externalCurrency:'other'}}),code('SETTLEMENT_CONFLICT'));
  const input={preparationId:two.preparationId,fingerprint:two.fingerprint,refundReceipt:refund};
  const done=x.core.confirmExternalCompensation(provider,input);assert.equal(done.state,'compensated');assert.deepEqual(x.core.confirmExternalCompensation(provider,input),done);
  assert.equal(x.commit(two).state,'compensated');assert(x.core.audit(admin).ok);
});

test('original product/card terms survive publication, expiry and a commercial pause',()=>{
  let at='2026-09-30T12:00:00.000Z';const x=setup({change:c=>{c.products.find(p=>p.id==='common').availableUntil='2026-10-01T00:00:00Z';},framework:{clock:()=>at}});
  const row=x.prepare('old');const changed=structuredClone(x.c);changed.version++;changed.cards[0].name='Replacement';changed.products.find(p=>p.id==='common').price.amount=99;changed.products.find(p=>p.id==='common').revision++;
  x.core.publishCatalog(admin,changed);x.core.configureAdmin(admin,{key:'pause',expectedRevision:x.core.adminOverview(admin).revision,scope:'site',changes:{packPurchasesPaused:true},reason:'Pause sales'});
  at='2026-10-02T00:00:00.000Z';const done=x.commit(row);assert.equal(done.state,'fulfilled');assert.equal(done.purchase.paid.amount,10);
  const opened=x.core.openPack(x.alice,{key:'open',packId:done.purchase.packs[0].id});assert.equal(opened.cards[0].definition.name,x.c.cards[0].name);assert.equal(x.core.catalog().version,changed.version);
});

test('new account restrictions compensate while proofs and status remain available',()=>{
  const x=setup(),row=x.prepare('restricted');
  x.core.configureAdmin(admin,{key:'restrict',expectedRevision:x.core.adminOverview(admin).revision,scope:'user',targetId:x.alice.userId,changes:{buyingBlocked:true},reason:'Restrict new purchases'});
  const failed=x.commit(row);assert.equal(failed.state,'refund_required');assert.equal(failed.failureCode,'ACCOUNT_RESTRICTED');
});

test('forged proofs, conflicting intents, foreign provider scope and reference reuse fail without allocation',()=>{
  const x=setup(),intent=x.intent('one'),row=x.core.prepareExternalPurchase(provider,intent);
  assert.throws(()=>x.core.prepareExternalPurchase(admin,{...intent,transactionId:'other'}),code('FORBIDDEN'));
  assert.throws(()=>x.core.prepareExternalPurchase(provider,{...intent,externalUnits:'11'}),code('SETTLEMENT_CONFLICT'));
  assert.throws(()=>x.core.prepareExternalPurchase(provider,{...intent,transactionId:'different'}),code('SETTLEMENT_CONFLICT'));
  const proof=x.pay.receipt(row);assert.throws(()=>x.core.commitExternalPurchase(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:{...proof,reference:'forged'}}),code('INVALID_PROOF'));
  x.commit(row);const two=x.prepare('two'),reused=x.pay.receipt(two,'debit',proof.reference);
  assert.throws(()=>x.core.commitExternalPurchase(provider,{preparationId:two.preparationId,fingerprint:two.fingerprint,debitReceipt:reused}),code('SETTLEMENT_CONFLICT'));
  assert.equal(x.core.externalPurchaseStatus(x.alice,{preparationId:two.preparationId}).state,'prepared');
});

test('a provider cancellation fence prevents later commit and committed debits cannot be cancelled',()=>{
  const x=setup(),row=x.prepare('cancel'),input={preparationId:row.preparationId,fingerprint:row.fingerprint,noDebitReceipt:x.pay.receipt(row,'no_debit')};
  const cancelled=x.core.cancelExternalPurchase(provider,input);assert.equal(cancelled.state,'cancelled');assert.deepEqual(x.core.cancelExternalPurchase(provider,input),cancelled);
  assert.throws(()=>x.commit(row),code('EXTERNAL_PURCHASE_STATE'));
  const paid=x.prepare('paid');x.commit(paid);
  assert.throws(()=>x.core.cancelExternalPurchase(provider,{preparationId:paid.preparationId,fingerprint:paid.fingerprint,noDebitReceipt:x.pay.receipt(paid,'no_debit')}),code('EXTERNAL_PURCHASE_STATE'));
});

test('every replay alias is durably bound and bounded by admission capacity',()=>{
  const x=setup({framework:{externalPurchaseLimits:{records:2}}}),intent=x.intent('original'),row=x.core.prepareExternalPurchase(provider,intent);
  assert.deepEqual(x.core.prepareExternalPurchase(provider,{...intent,key:'alias'}),row);
  assert.throws(()=>x.core.prepareExternalPurchase(provider,{...intent,key:'alias',transactionId:'changed'}),code('SETTLEMENT_CONFLICT'));
  assert.throws(()=>x.core.prepareExternalPurchase(provider,{...intent,key:'third'}),code('EXTERNAL_PURCHASE_CAPACITY'));
  assert.equal(x.commit(row).state,'fulfilled');
});

test('pending discovery accepts nullable initial cursors equally in memory and SQLite',()=>{
  for(const store of [new MemoryStore(),new SQLiteStore(':memory:')]){
    const x=setup({store});x.prepare('pending');
    const expected=x.core.pendingExternalPurchases(provider,{providerId});
    assert.deepEqual(x.core.pendingExternalPurchases(provider,{providerId,after:null}),expected);
    assert.deepEqual(x.core.pendingExternalPurchases(provider,{providerId,after:''}),expected);
    for(const after of [false,0,{},[]])assert.throws(()=>x.core.pendingExternalPurchases(provider,{providerId,after}),code('INVALID_INPUT'));
    assert.throws(()=>x.core.pendingExternalPurchases(provider,{providerId,unexpected:true}),code('INVALID_INPUT'));x.core.close();
  }
});

test('throwing and colliding generators roll back codes, supply, pity, events and queued actions',()=>{
  for(const factory of [()=>{throw Error('private failure detail');},()=>({code:'SAME-SECRET'})]){
    const base=codesFixture({stock:0,change:c=>{c.variants.find(v=>v.id==='reward.standard').codes[0].poolId='generated';}}),pay=payments();
    const core=new CardFramework({store:base.store,codeVault:vault(),codeGenerators:{example:factory},externalPurchaseProviders:pay.providers,eventSubscriptions:[{id:'cards',handler:'unused',events:['card.issued','code.allocated']}]});
    core.configureCodePool(admin,{key:'generated-pool',pool:{id:'generated',providerId:'example.game',name:'Generated',generator:'example'}});
    const quote=core.quote(base.alice,{productId:'bundle',quantity:2}),row=core.prepareExternalPurchase(provider,{key:'bad',providerId,transactionId:'bad',userId:base.alice.userId,externalCurrency:'points',externalUnits:String(quote.price.amount),quote});
    const select=s=>({codes:s.codes,supply:s.supply,packs:s.packs,copies:s.copies,pity:s.pity,events:s.events,actionJobs:s.actionJobs,balances:s.balances});const before=base.store.read(select);
    const failed=core.commitExternalPurchase(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:pay.receipt(row)});
    assert.equal(failed.state,'refund_required');assert.deepEqual(base.store.read(select),before);assert(!JSON.stringify(failed).includes('private failure'));assert(!JSON.stringify(failed).includes('SAME-SECRET'));
  }
});

test('preparation rejects predictable binding, code provider and shared stock failures without drawing',()=>{
  for(const bindings of [{}, {'demo.code':async()=>({})}, {'demo.code':(async()=>({})).bind(null)}]){
    const x=setup({framework:{bindings}}),before=x.store.read(s=>s);
    assert.throws(()=>x.prepare('binding',x.alice,'unique'),code(Object.keys(bindings).length?'INVALID_PROVIDER':'MISSING_PROVIDER'));
    assert.deepEqual(x.store.read(s=>s),before);
  }
  for(const defect of ['missing-generator','async-generator','missing-vault','wrong-vault','shared-stock']){
    let calls=0;
    const base=codesFixture({stock:defect==='shared-stock'?1:0,change:c=>{
      if(defect==='shared-stock')c.products.find(p=>p.id==='bundle').slots.push({id:'second-code',role:'insert',count:1,pool:[{variantId:'reward.standard',weight:1}]});
      else c.variants.find(v=>v.id==='reward.standard').codes[0].poolId='generated';
    }}),pay=payments();
    if(defect!=='shared-stock')new CardFramework({store:base.store,codeVault:vault(),codeGenerators:{factory:()=>({code:'UNUSED'})}}).configureCodePool(admin,{key:'generated-readiness',pool:{id:'generated',providerId:'example.game',name:'Generated',generator:'factory'}});
    const core=new CardFramework({store:base.store,random:()=>{calls++;return 0;},externalPurchaseProviders:pay.providers,codeVault:defect==='missing-vault'?undefined:vault(defect==='wrong-vault'?{indexKey:Buffer.alloc(32,8)}:{}),codeGenerators:defect==='missing-generator'?{}:{factory:defect==='async-generator'?async()=>{calls++;return {code:'UNUSED'};}:()=>{calls++;return {code:'UNUSED'};}}});
    const quote=core.quote(base.alice,{productId:'bundle'}),input={key:defect,providerId,transactionId:defect,userId:base.alice.userId,externalCurrency:'points',externalUnits:String(quote.price.amount),quote};
    const before=base.store.read(s=>s);
    assert.throws(()=>core.prepareExternalPurchase(provider,input),code({'missing-generator':'MISSING_CODE_GENERATOR','async-generator':'INVALID_PROVIDER','missing-vault':'CODE_KEYS','wrong-vault':'CODE_KEYS','shared-stock':'CODE_STOCK_EXHAUSTED'}[defect]));
    assert.equal(calls,0);assert.deepEqual(base.store.read(s=>s),before);
  }
});

test('preflight rejects mandatory finite supply pressure before any external debit',()=>{
  const x=setup(),before=x.store.read(s=>s);
  assert.throws(()=>x.prepare('impossible-quantity',x.alice,'unique',2),code('SOLD_OUT'));
  assert.deepEqual(x.store.read(s=>s),before);
});

test('preflight counts total generated-code demand across alternative pools',()=>{
  let calls=0;const base=codesFixture({stock:0,change:c=>{
    c.variants.find(v=>v.id==='reward.standard').codes[0].poolId='generated-one';
    c.variants.push({...structuredClone(c.variants.find(v=>v.id==='reward.standard')),id:'reward.alternate',codes:[{id:'game',poolId:'generated-two'}]});
    const slot=c.products.find(p=>p.id==='bundle').slots.find(s=>s.id==='reward');slot.count=2;slot.pool.push({variantId:'reward.alternate',weight:1});
  }}),pay=payments();
  const core=new CardFramework({store:base.store,codeVault:vault(),codeLimits:{maxCodes:1},codeGenerators:{factory:()=>{calls++;return {code:'UNUSED'};}},externalPurchaseProviders:pay.providers});
  for(const id of ['generated-one','generated-two'])core.configureCodePool(admin,{key:id,pool:{id,providerId:'example.game',name:id,generator:'factory'}});
  const quote=core.quote(base.alice,{productId:'bundle'}),before=base.store.read(s=>s);
  assert.throws(()=>core.prepareExternalPurchase(provider,{key:'generated-total',providerId,transactionId:'generated-total',userId:base.alice.userId,externalCurrency:'points',externalUnits:'10',quote}),code('INSTALLATION_CAPACITY'));
  assert.equal(calls,0);assert.deepEqual(base.store.read(s=>s),before);
});

test('lost commit response is recovered from the original durable identity after encrypted restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'external-purchase-')),path=join(directory,'state.sqlite'),encryptionKey=Buffer.alloc(32,5);
  try{
    const x=setup({store:new SQLiteStore(path,{encryptionKey})}),row=x.prepare('restart'),done=x.commit(row);x.core.close();
    const store=new SQLiteStore(path,{encryptionKey}),core=new CardFramework({store,externalPurchaseProviders:x.pay.providers});
    assert.deepEqual(core.lookupExternalPurchase(provider,{providerId,transactionId:'restart'}),done);
    assert.deepEqual(core.commitExternalPurchase(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:x.pay.receipt(row)}),done);
    assert.equal(core.packs(x.alice).length,1);core.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('legacy paid purchase adoption retains original packs and fences unsafe old command replay',()=>{
  const x=setup(),intent=x.intent('legacy'),purchaseKey='old-purchase';
  x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:intent.quote.price.currencyId,amount:intent.quote.price.amount,externalCurrency:intent.externalCurrency,externalUnits:intent.externalUnits});
  const purchase=x.core.purchase(x.alice,{...intent.quote,key:purchaseKey}),row={terms:{version:1,...intent},fingerprint:externalPurchaseFingerprint(intent)};
  const input={...intent,purchaseKey,debitReceipt:x.pay.receipt(row)},done=x.core.reconcileLegacyExternalPurchase(provider,input);
  assert.equal(done.state,'fulfilled');assert.deepEqual(done.purchase,purchase);assert.deepEqual(x.core.reconcileLegacyExternalPurchase(provider,input),done);
  assert.throws(()=>x.core.purchase(x.alice,{...intent.quote,key:purchaseKey}),code('EXTERNAL_PURCHASE_STATE'));assert.equal(x.core.packs(x.alice).length,1);
});

test('legacy unspent credit is reversed atomically; spent credit is quarantined without refund',()=>{
  for(const spent of [false,true]){
    const x=setup(),intent=x.intent('legacy-credit'),purchaseKey='old-purchase',before=x.core.wallet(x.alice).credits;
    const settlement={providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:intent.quote.price.currencyId,amount:intent.quote.price.amount,externalCurrency:intent.externalCurrency,externalUnits:intent.externalUnits};
    x.core.settleExternalCredit(admin,settlement);if(spent)x.core.purchase(x.alice,{...intent.quote,key:'unrelated'});
    const row={terms:intent,fingerprint:externalPurchaseFingerprint(intent)},input={...intent,purchaseKey,debitReceipt:x.pay.receipt(row)};
    const result=x.core.reconcileLegacyExternalPurchase(provider,input);assert.equal(result.state,spent?'quarantined':'fulfilled');
    assert.equal(x.core.wallet(x.alice).credits,before);assert.equal(x.core.packs(x.alice).length,1);
    assert.throws(()=>x.core.settleExternalCredit(admin,settlement),code('EXTERNAL_PURCHASE_STATE'));
    if(spent)assert.equal(result.compensationId,undefined);
  }
});

test('contradictory legacy receipt, ledger and delivery evidence is quarantined',()=>{
  for(const corrupt of [
    (s,ctx)=>{s.requests[ctx.requestKey].result.packs=[];},
    (s,ctx)=>{s.externalSettlements[ctx.token].result.amount=999;},
    (s,ctx)=>{s.externalSettlements[ctx.token].result.balance=999;},
    (s,ctx)=>{s.ledger.push({...s.ledger.find(row=>row.type==='purchase'&&row.reference===ctx.purchase.id),id:'duplicate-debit'});},
    (s,ctx)=>{delete s.copies[s.packs[ctx.purchase.packs[0].id].copyIds[0]];},
    (s,ctx)=>{s.requests[ctx.requestKey].result.paid=null;},
  ]){
    const x=setup(),intent=x.intent('legacy-corruption'),purchaseKey='old-purchase';
    const token=externalPurchaseDigest({providerId,transactionId:intent.transactionId});
    x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:intent.quote.price.currencyId,amount:intent.quote.price.amount,externalCurrency:intent.externalCurrency,externalUnits:intent.externalUnits});
    const purchase=x.core.purchase(x.alice,{...intent.quote,key:purchaseKey});
    x.store.transact(s=>corrupt(s,{token,purchase,requestKey:x.alice.userId+':'+purchaseKey}));
    const before=x.core.wallet(x.alice),row={terms:intent,fingerprint:externalPurchaseFingerprint(intent)};
    const result=x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey,debitReceipt:x.pay.receipt(row)});
    assert.equal(result.state,'quarantined');assert.equal(result.purchase,undefined);assert.equal(result.compensationId,undefined);assert.deepEqual(x.core.wallet(x.alice),before);
  }
});

test('an attributed operator can explicitly adopt only the proven credit-funded legacy purchase',()=>{
  const store=new MemoryStore(),pay=payments();
  const base=fixture({store}),user=base.core.registerUser(admin,{provider:'test',subject:'unfunded',displayName:'Unfunded'}),collector={userId:user.id};
  const core=new CardFramework({store,externalPurchaseProviders:pay.providers}),quote=core.quote(collector,{productId:'common'});
  const intent={key:'legacy-funded',providerId,transactionId:'legacy-funded',userId:user.id,externalCurrency:'points',externalUnits:'10',quote};
  core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:user.id,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
  const alternate=core.purchase(collector,{...quote,key:'alternate'}),proofRow={terms:intent,fingerprint:externalPurchaseFingerprint(intent)};
  const quarantined=core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'original',debitReceipt:pay.receipt(proofRow)});assert.equal(quarantined.state,'quarantined');
  const operator={...provider,id:'operator-one',permissions:['currency.settle','maintenance.run']};
  const input={preparationId:quarantined.preparationId,fingerprint:quarantined.fingerprint,key:'resolve-one',reason:'Verified the original payment funded this existing purchase',decision:{kind:'adopt_purchase',purchaseKey:'alternate'}};
  const unchanged=()=>store.read(s=>({balances:s.balances,copies:s.copies,codes:s.codes,packs:s.packs,supply:s.supply,ledger:s.ledger,events:s.events})),before=unchanged();
  assert.throws(()=>core.resolveLegacyExternalPurchase(provider,input),code('FORBIDDEN'));
  assert.throws(()=>core.resolveLegacyExternalPurchase({...operator,id:undefined},input),code('INVALID_INPUT'));
  assert.throws(()=>core.resolveLegacyExternalPurchase(operator,{...input,decision:{kind:'adopt_purchase',purchaseKey:'missing'}}),code('LEGACY_RESOLUTION_REJECTED'));
  const settlementToken=externalPurchaseDigest({providerId,transactionId:intent.transactionId}),savedBalance=store.read(s=>s.externalSettlements[settlementToken].result.balance);
  store.transact(s=>{s.externalSettlements[settlementToken].result.balance=savedBalance+1;});
  const contradicted=store.read(s=>s);assert.throws(()=>core.resolveLegacyExternalPurchase(operator,input),code('LEGACY_RESOLUTION_REJECTED'));assert.deepEqual(store.read(s=>s),contradicted);
  store.transact(s=>{s.externalSettlements[settlementToken].result.balance=savedBalance;});
  const resolved=core.resolveLegacyExternalPurchase(operator,input);assert.equal(resolved.state,'fulfilled');assert.deepEqual(resolved.purchase,alternate);assert.equal(resolved.legacyResolution.actorId,operator.id);assert.equal(resolved.legacyResolution.decision.purchaseKey,'alternate');assert.deepEqual(resolved.terms,quarantined.terms);assert.deepEqual(unchanged(),before);
  assert.deepEqual(core.resolveLegacyExternalPurchase(operator,input),resolved);
  assert.throws(()=>core.resolveLegacyExternalPurchase(operator,{...input,reason:'Different decision'}),code('IDEMPOTENCY_CONFLICT'));
  assert(core.audit(admin).ok);
});

test('a contradictory saved settlement balance cannot reverse unspent legacy credit',()=>{
  const x=setup(),intent=x.intent('wrong-saved-balance'),token=externalPurchaseDigest({providerId,transactionId:intent.transactionId});
  x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
  x.store.transact(s=>{s.externalSettlements[token].result.balance++;});
  const financial=()=>x.store.read(s=>({balances:s.balances,ledger:s.ledger,events:s.events,packs:s.packs,copies:s.copies,codes:s.codes,supply:s.supply,settlements:s.externalSettlements})),before=financial();
  const result=x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'original',debitReceipt:x.pay.receipt({terms:intent,fingerprint:externalPurchaseFingerprint(intent)})});
  assert.equal(result.state,'quarantined');assert.equal(result.failureCode,'LEGACY_CREDIT_EVIDENCE');assert.equal(result.compensationId,undefined);assert.deepEqual(financial(),before);
});

test('accepted legacy quarantine reserves its operator receipt and large adoption at full capacity',()=>{
  const directory=mkdtempSync(join(tmpdir(),'legacy-resolution-capacity-')),path=join(directory,'state.sqlite'),encryptionKey=Buffer.alloc(32,4);let core;
  try{
    const store=new SQLiteStore(path,{encryptionKey}),base=fixture({store,change:c=>{c.products.find(p=>p.id==='common').metadata={description:'x'.repeat(20000)};}}),pay=payments();
    const user=base.core.registerUser(admin,{provider:'test',subject:'zero-funded',displayName:'Collector'}),collector={userId:user.id};
    core=new CardFramework({store,externalPurchaseProviders:pay.providers});const quote=core.quote(collector,{productId:'common'}),intent={key:'bounded-legacy',providerId,transactionId:'bounded-legacy',userId:user.id,externalCurrency:'points',externalUnits:'10',quote};
    core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:user.id,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
    const alternate=core.purchase(collector,{...quote,key:'alternate'}),occupied=store.read(s=>Object.keys(s.requests).length+Object.keys(s.operatorRequests??{}).length+Object.keys(s.externalSettlements??{}).length),limit=occupied+2;
    core=new CardFramework({store,externalPurchaseProviders:pay.providers,limits:{requests:limit}});
    const row=core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'original',debitReceipt:pay.receipt({terms:intent,fingerprint:externalPurchaseFingerprint(intent)})});assert.equal(row.state,'quarantined');
    assert.equal(store.read(s=>s.externalPurchases[row.preparationId].completionRequests),1);
    assert.throws(()=>core.grantCurrency(admin,{key:'competing-command',userId:user.id,currencyId:'credits',amount:1,reason:'Additional credit'}),code('INSTALLATION_CAPACITY'));
    const maximumBytes=store.read(s=>store.measure(s).totalBytes),financial=store.read(s=>({balances:s.balances,ledger:s.ledger,packs:s.packs,copies:s.copies,supply:s.supply}));core.close();
    const bounded=new SQLiteStore(path,{encryptionKey,maxStateBytes:maximumBytes});core=new CardFramework({store:bounded,externalPurchaseProviders:pay.providers,limits:{requests:limit}});
    const actor={...provider,id:'\ud800'.repeat(128),permissions:['currency.settle','maintenance.run']},input={preparationId:row.preparationId,fingerprint:row.fingerprint,key:'\ud800'.repeat(128),reason:'\ud800'.repeat(500),decision:{kind:'adopt_purchase',purchaseKey:'alternate'}};
    const result=core.resolveLegacyExternalPurchase(actor,input);assert.equal(result.state,'fulfilled');assert.deepEqual(result.purchase,alternate);assert.deepEqual(core.resolveLegacyExternalPurchase(actor,input),result);
    assert.deepEqual(bounded.read(s=>({balances:s.balances,ledger:s.ledger,packs:s.packs,copies:s.copies,supply:s.supply})),financial);assert(bounded.read(s=>bounded.measure(s).totalBytes<=maximumBytes));assert.equal(bounded.read(s=>s.externalPurchases[row.preparationId].completionRequests),0);
  }finally{core?.close();rmSync(directory,{recursive:true,force:true});}
});

test('legacy resolution rejects an ambiguous pre-existing wallet balance and a changed debit proof',()=>{
  const x=setup(),intent=x.intent('ambiguous'),purchaseKey='original';
  x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
  x.core.purchase(x.alice,{...intent.quote,key:'alternate'});
  const row={terms:intent,fingerprint:externalPurchaseFingerprint(intent)},quarantine=x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey,debitReceipt:x.pay.receipt(row)});
  const operator={...provider,id:'operator',permissions:['currency.settle','maintenance.run']},input={preparationId:quarantine.preparationId,fingerprint:quarantine.fingerprint,key:'resolution',reason:'Review',decision:{kind:'adopt_purchase',purchaseKey:'alternate'}};
  const before=x.store.read(s=>s);assert.throws(()=>x.core.resolveLegacyExternalPurchase(operator,input),code('LEGACY_RESOLUTION_REJECTED'));assert.deepEqual(x.store.read(s=>s),before);
  const revoked=new CardFramework({store:x.store,externalPurchaseProviders:{[providerId]:{validateIntent:()=>true,verifyProof:()=>false}}});
  assert.throws(()=>revoked.resolveLegacyExternalPurchase(operator,input),code('INVALID_PROOF'));assert.deepEqual(x.store.read(s=>s),before);
});

test('operator decision keys cannot collide through actor/key separators',()=>{
  const x=setup();
  const prepare=transactionId=>{
    const user=x.core.registerUser(admin,{provider:'test',subject:transactionId,displayName:'Collector'}),collector={userId:user.id},intent=x.intent(transactionId,collector);
    x.core.settleExternalCredit(admin,{providerId,transactionId,userId:user.id,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
    x.core.purchase(collector,{...intent.quote,key:'alternate'});
    return x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'original',debitReceipt:x.pay.receipt({terms:intent,fingerprint:externalPurchaseFingerprint(intent)})});
  };
  const one=prepare('namespace-one'),two=prepare('namespace-two');
  for(const [row,id,key]of [[one,'operator:part','key'],[two,'operator','part:key']]){
    const actor={...provider,id,permissions:['currency.settle','maintenance.run']},input={preparationId:row.preparationId,fingerprint:row.fingerprint,key,reason:'Reviewed independent obligation',decision:{kind:'adopt_purchase',purchaseKey:'alternate'}};
    const result=x.core.resolveLegacyExternalPurchase(actor,input);assert.equal(result.state,'fulfilled');assert.deepEqual(x.core.resolveLegacyExternalPurchase(actor,input),result);
  }
});

test('a second payment cannot adopt an already-bound purchase or an older unrelated purchase',()=>{
  for(const secondCreditAfterPurchase of [false,true]){
    const x=setup(),first=x.intent('binding-one'),second=x.intent('binding-two');
    const credit=intent=>x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
    const reconcile=intent=>x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'shared-existing-purchase',debitReceipt:x.pay.receipt({terms:intent,fingerprint:externalPurchaseFingerprint(intent)})});
    credit(first);if(!secondCreditAfterPurchase)credit(second);
    x.core.purchase(x.alice,{...first.quote,key:'shared-existing-purchase'});
    assert.equal(reconcile(first).state,'fulfilled');if(secondCreditAfterPurchase)credit(second);
    const before=x.store.read(s=>({balances:s.balances,ledger:s.ledger,packs:s.packs,copies:s.copies})),rejected=reconcile(second);
    assert.equal(rejected.state,'quarantined');assert.equal(rejected.failureCode,secondCreditAfterPurchase?'LEGACY_PURCHASE_CONFLICT':'LEGACY_PURCHASE_ALREADY_BOUND');assert.equal(rejected.compensationId,undefined);assert.deepEqual(x.store.read(s=>({balances:s.balances,ledger:s.ledger,packs:s.packs,copies:s.copies})),before);
  }
});

test('an intervening deposit prevents explicit zero-funded legacy resolution',()=>{
  const x=setup(),user=x.core.registerUser(admin,{provider:'test',subject:'intervening-deposit',displayName:'Collector'}),collector={userId:user.id},intent=x.intent('intervening',collector);
  x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:user.id,currencyId:'credits',amount:10,externalCurrency:'points',externalUnits:'10'});
  x.core.grantCurrency(admin,{key:'deposit',userId:user.id,currencyId:'credits',amount:1,reason:'Independent deposit'});x.core.purchase(collector,{...intent.quote,key:'alternate'});
  const row=x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'original',debitReceipt:x.pay.receipt({terms:intent,fingerprint:externalPurchaseFingerprint(intent)})}),before=x.store.read(s=>s);
  assert.equal(row.state,'quarantined');assert.throws(()=>x.core.resolveLegacyExternalPurchase({...provider,id:'operator',permissions:['currency.settle','maintenance.run']},{preparationId:row.preparationId,fingerprint:row.fingerprint,key:'resolve',reason:'Review',decision:{kind:'adopt_purchase',purchaseKey:'alternate'}}),code('LEGACY_RESOLUTION_REJECTED'));assert.deepEqual(x.store.read(s=>s),before);
});

test('expired legacy terms reverse coherent credit then require compensation without creating packs',()=>{
  const x=setup(),intent=x.intent('old-terms'),purchaseKey='purchase',before=x.core.wallet(x.alice);
  x.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:intent.userId,currencyId:intent.quote.price.currencyId,amount:intent.quote.price.amount,externalCurrency:intent.externalCurrency,externalUnits:intent.externalUnits});
  const changed=structuredClone(x.c);changed.version++;x.core.publishCatalog(admin,changed);
  const row={terms:intent,fingerprint:externalPurchaseFingerprint(intent)},result=x.core.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey,debitReceipt:x.pay.receipt(row)});
  assert.equal(result.state,'refund_required');assert.equal(result.failureCode,'STALE_QUOTE');assert.deepEqual(x.core.wallet(x.alice),before);assert.equal(x.core.packs(x.alice).length,0);
});

test('bounded byte reservations preserve the refusal and refund route at storage capacity',()=>{
  const directory=mkdtempSync(join(tmpdir(),'external-capacity-')),path=join(directory,'state.sqlite'),encryptionKey=Buffer.alloc(32,6);
  let core;
  try{
    const x=setup({store:new SQLiteStore(path,{encryptionKey})}),row=x.prepare('capacity',x.alice,'common',20);
    const budget=x.store.read(s=>x.store.measure(s).totalBytes)+128;x.core.close();
    const store=new SQLiteStore(path,{encryptionKey,maxStateBytes:budget});core=new CardFramework({store,externalPurchaseProviders:x.pay.providers});
    assert.throws(()=>core.grantCurrency(admin,{key:'ordinary-admission',userId:x.alice.userId,currencyId:'credits',amount:1,reason:'Additional credit'}),code('STORAGE_CAPACITY'));
    const failed=core.commitExternalPurchase(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:x.pay.receipt(row,'debit','\ud800'.repeat(128))});
    assert.equal(failed.state,'refund_required');assert.equal(failed.failureCode,'STORAGE_CAPACITY');assert.equal(core.packs(x.alice).length,0);
    const completed=core.confirmExternalCompensation(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,refundReceipt:x.pay.receipt(failed,'refund','\udfff'.repeat(128))});
    assert.equal(completed.state,'compensated');assert(store.read(s=>store.measure(s).totalBytes<=budget));
  }finally{core?.close();rmSync(directory,{recursive:true,force:true});}
});

test('request admission and action capacity cannot strand an accepted debit',()=>{
  const store=new MemoryStore(),base=fixture({store}),pay=payments();
  const occupied=store.read(s=>Object.keys(s.requests).length+Object.keys(s.operatorRequests??{}).length+Object.keys(s.externalSettlements??{}).length);
  const core=new CardFramework({store,limits:{requests:occupied+1},externalPurchaseProviders:pay.providers}),quote=core.quote(base.alice,{productId:'common'});
  const row=core.prepareExternalPurchase(provider,{key:'last-slot',providerId,transactionId:'last-slot',userId:base.alice.userId,externalCurrency:'points',externalUnits:'10',quote});
  assert.throws(()=>core.grantCurrency(admin,{key:'new-command',userId:base.alice.userId,currencyId:'credits',amount:1,reason:'Credit'}),code('INSTALLATION_CAPACITY'));
  assert.equal(core.commitExternalPurchase(provider,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:pay.receipt(row)}).state,'fulfilled');
  const y=setup({framework:{limits:{actionJobs:1},eventSubscriptions:[{id:'issued',handler:'unused',events:['card.issued']}]}}),prepared=y.prepare('action-capacity');
  y.core.purchase(y.bob,{...y.core.quote(y.bob,{productId:'common'}),key:'other'});
  const before=y.store.read(s=>({copies:s.copies,events:s.events,jobs:s.actionJobs})),failed=y.commit(prepared);
  assert.equal(failed.state,'refund_required');assert.equal(failed.failureCode,'INSTALLATION_CAPACITY');assert.deepEqual(y.store.read(s=>({copies:s.copies,events:s.events,jobs:s.actionJobs})),before);
});

test('unknown post-commit transport failure never becomes a compensation decision',()=>{
  const backing=new MemoryStore();let lose=false;
  const store={read:fn=>backing.read(fn),transact:fn=>{const result=backing.transact(fn);if(lose){lose=false;throw Error('Acknowledgement unavailable');}return result;},close:()=>{}};
  const x=setup({store}),row=x.prepare('unknown');lose=true;assert.throws(()=>x.commit(row),/Acknowledgement unavailable/);
  const status=x.core.lookupExternalPurchase(provider,{providerId,transactionId:'unknown'});assert.equal(status.state,'fulfilled');assert.equal(status.compensationId,undefined);assert.deepEqual(x.commit(row),status);assert.equal(x.core.packs(x.alice).length,1);
});

test('prepared work survives an encrypted checkpoint restore and allocates only once',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'external-restore-')),path=join(directory,'state.sqlite'),restored=join(directory,'checkpoint.sqlite'),encryptionKey=Buffer.alloc(32,7);
  let core;
  try{
    const x=setup({store:new SQLiteStore(path,{encryptionKey})}),row=x.prepare('checkpoint');await x.store.backup(restored);x.core.close();
    core=new CardFramework({store:new SQLiteStore(restored,{encryptionKey}),externalPurchaseProviders:x.pay.providers});
    assert.equal(core.pendingExternalPurchases(provider,{providerId}).items[0].preparationId,row.preparationId);
    const input={preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:x.pay.receipt(row)};
    const result=core.commitExternalPurchase(provider,input);assert.equal(result.state,'fulfilled');assert.deepEqual(core.commitExternalPurchase(provider,input),result);assert.equal(core.packs(x.alice).length,1);
  }finally{core?.close();rmSync(directory,{recursive:true,force:true});}
});
