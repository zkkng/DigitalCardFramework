import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,code} from './helpers.js';
import {validateCatalog} from '../src/index.js';

test('immutable host subjects link one inventory despite display-name changes',()=>{
  const x=fixture();const user=x.core.registerUser(admin,{provider:'test',subject:'alice',displayName:'Renamed'});
  assert.equal(user.id,x.alice.userId);assert.equal(user.displayName,'Renamed');
  assert.throws(()=>x.core.registerUser(x.alice,{provider:'evil',subject:'a',displayName:'a'}),code('FORBIDDEN'));
  assert.throws(()=>x.core.wallet({userId:'unknown'}),code('UNAUTHENTICATED'));
});
test('quote trusts published line-specific price and quantity limits',()=>{
  const x=fixture();
  assert.equal(x.core.quote(x.alice,{productId:'sky.basic',quantity:2}).price.amount,200);
  assert.equal(x.core.quote(x.alice,{productId:'garden.basic'}).price.amount,60);
  assert.equal(x.core.quote(x.alice,{productId:'sky.premium'}).price.currencyId,'gems');
  assert.throws(()=>x.core.quote(x.alice,{productId:'common',quantity:21}),code('INVALID_INPUT'));
  assert.throws(()=>x.core.quote(x.alice,{productId:'common',quantity:1.5}),code('INVALID_INPUT'));
});
test('purchase retry returns the same packs and debits once; conflicting key fails',()=>{
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});
  const a=x.core.purchase(x.alice,{...quote,key:'same'}),b=x.core.purchase(x.alice,{...quote,key:'same'});
  assert.deepEqual(a,b);assert.equal(x.core.wallet(x.alice).credits,9990);
  assert.throws(()=>x.core.purchase(x.alice,{...quote,quantity:2,key:'same'}),code('IDEMPOTENCY_CONFLICT'));
  assert.equal(x.core.inventory(x.alice).length,0);
});
test('opening/replaying preserves result, opener, timestamp and copy identity',()=>{
  const x=fixture(),pack=x.buy().packs[0];
  assert.throws(()=>x.core.openPack(x.bob,{key:'unauthorized',packId:pack.id}),code('NOT_FOUND'));
  const a=x.core.openPack(x.alice,{key:'open',packId:pack.id}),b=x.core.openPack(x.alice,{key:'replay',packId:pack.id});
  assert.deepEqual(a,b);assert.equal(a.cards[0].openedBy,x.alice.userId);
  assert.equal(a.cards[0].openedByName,'Alice');assert.equal(a.cards[0].openedAt,'2026-09-30T12:00:00.000Z');
  assert.equal(x.core.inventory(x.alice).length,1);assert.equal(a.cards[0].isNew,true);
  assert.equal(x.open()[0].isNew,false);
});
test('finite editions count sealed packs; failed batch rolls back debit and serial allocation',()=>{
  const x=fixture();
  assert.throws(()=>x.buy('unique',x.alice,2),code('POOL_EXHAUSTED'));
  assert.equal(x.core.wallet(x.alice).credits,10000);assert.equal(x.core.packs(x.alice).length,0);
  const pack=x.buy('unique').packs[0];
  assert.throws(()=>x.buy('unique',x.bob),code('POOL_EXHAUSTED'));
  const card=x.core.openPack(x.alice,{key:'open',packId:pack.id}).cards[0];
  assert.equal(card.serialNumber,1);assert.equal(card.editionTotal,1);
});
test('insufficient balance and overflow never partially update the ledger',()=>{
  const x=fixture();const old=x.core.history(x.alice);
  assert.throws(()=>x.core.convert(x.alice,{key:'x',from:'credits',to:'gems',amount:20000,catalogVersion:1}),code('INSUFFICIENT_FUNDS'));
  assert.throws(()=>x.core.grantCurrency(admin,{userId:x.alice.userId,currencyId:'credits',amount:Number.MAX_SAFE_INTEGER,reason:'overflow',key:'overflow'}),code('BALANCE_OVERFLOW'));
  assert.deepEqual(x.core.history(x.alice),old);
});
test('weighted boundary uses weights and excludes exhausted editions',()=>{
  const x=fixture({random:n=>n-1});
  const first=x.open('sky.basic');assert.equal(first[0].variantId,'solstice.unique');
  const next=x.open('sky.basic');assert(!next.some(c=>c.variantId==='solstice.unique'));
});
test('within-pack and inventory duplicate protection have explicit exhausted-pool behavior',()=>{
  const x=fixture({change:c=>{
    const p=c.products.find(p=>p.id==='common');p.slots[0].count=2;
    p.duplicatePolicy={scope:'pack',fallback:'reject'};
  }});
  assert.throws(()=>x.buy(),code('POOL_EXHAUSTED'));assert.equal(x.core.wallet(x.alice).credits,10000);
  const y=fixture({change:c=>c.products.find(p=>p.id==='common').duplicatePolicy={scope:'inventory',fallback:'reject'}});
  y.buy();assert.throws(()=>y.buy(),code('POOL_EXHAUSTED'));
});
test('fallback allow produces duplicates without exceeding finite stock',()=>{
  const x=fixture({change:c=>{const p=c.products.find(p=>p.id==='common');p.slots[0].count=3;p.duplicatePolicy={scope:'pack',fallback:'allow'};}});
  assert.equal(x.open().length,3);
});
test('catalog revisions invalidate quotes while purchased packs retain snapshots',()=>{
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'}),pack=x.buy().packs[0];
  const next=structuredClone(x.c);next.version=2;next.products.find(p=>p.id==='common').price.amount=30;next.products.find(p=>p.id==='common').revision=2;
  next.cards.find(c=>c.id==='dawn').name='New art title';
  x.core.publishCatalog(admin,next);
  assert.throws(()=>x.core.purchase(x.alice,{...quote,key:'stale'}),code('STALE_QUOTE'));
  assert.equal(x.core.openPack(x.alice,{key:'open',packId:pack.id}).cards[0].definition.name,'Dawn');
  const bad=structuredClone(next);bad.version=3;bad.variants.find(v=>v.id==='solstice.unique').supplyLimit=2;
  assert.throws(()=>x.core.publishCatalog(admin,bad),code('CATALOG_CONFLICT'));
});
test('validation rejects cross-line cards, invalid odds, prototype IDs and malformed recipes',()=>{
  const x=fixture();
  for(const change of[
    c=>c.products[0].slots[0].pool[0].weight=0,
    c=>c.products[0].slots[0].pool[0].variantId='fern.standard',
    c=>c.currencies[0].id='constructor',
    c=>c.recipes[0].outputPool=[{variantId:'dawn.standard',weight:1}],
    c=>c.variants[0].bindings={'bare':{visibility:'owner',transfer:'block',data:{}}}
  ]){const c=structuredClone(x.c);change(c);assert.throws(()=>validateCatalog(c));}
});
test('currency ratios are exact, explicit floor is disclosed, and stale values cannot convert',()=>{
  const x=fixture();
  const result=x.core.convert(x.alice,{key:'convert',from:'credits',to:'gems',amount:300,catalogVersion:1});
  assert.equal(result.received,3);assert.equal(x.core.wallet(x.alice).gems,3);
  assert.deepEqual(x.core.convert(x.alice,{key:'convert',from:'credits',to:'gems',amount:300,catalogVersion:1}),result);
  assert.throws(()=>x.core.convert(x.alice,{key:'fraction',from:'credits',to:'gems',amount:101,catalogVersion:1}),code('INEXACT_CONVERSION'));
  const floor=x.core.convert(x.alice,{key:'floor',from:'credits',to:'gems',amount:101,rounding:'floor',catalogVersion:1});
  assert.equal(floor.received,1);assert.equal(floor.remainderNumerator,'1');
  x.core.grantCurrency(admin,{userId:x.alice.userId,currencyId:'stamps',amount:2,key:'stamps',reason:'test'});
  const ratio=x.core.convert(x.alice,{key:'ratio',from:'stamps',to:'credits',amount:2,catalogVersion:1});assert.equal(ratio.received,5);
  assert.throws(()=>x.core.convert(x.alice,{key:'stale',from:'credits',to:'gems',amount:100,catalogVersion:2}),code('STALE_QUOTE'));
});
test('trade-up consumes exactly configured duplicates once and keeps issued serials',()=>{
  const x=fixture(),cards=x.open('common',x.alice,3),input={key:'up',recipeId:'sky.upgrade',copyIds:cards.map(c=>c.id)};
  const output=x.core.tradeUp(x.alice,input);
  assert.equal(output.rarityId,'rare');assert.equal(output.serialNumber,1);
  assert.deepEqual(x.core.tradeUp(x.alice,input),output);assert.equal(x.core.inventory(x.alice).length,1);
  assert.throws(()=>x.core.tradeUp(x.alice,{...input,key:'again'}),code('NOT_OWNED'));
});
test('trade-up validates distinct input copies, line, rarity, binding and output stock',()=>{
  const x=fixture(),cards=x.open('common',x.alice,3);
  assert.throws(()=>x.core.tradeUp(x.alice,{key:'same',recipeId:'sky.upgrade',copyIds:[cards[0].id,cards[0].id,cards[1].id]}),code('INVALID_INPUT'));
  assert.throws(()=>x.core.tradeUp(x.bob,{key:'steal',recipeId:'sky.upgrade',copyIds:cards.map(c=>c.id)}),code('NOT_OWNED'));
  const y=fixture({change:c=>c.variants.find(v=>v.id==='aurora.holo').supplyLimit=1});
  y.open('rare');const inputs=y.open('common',y.alice,3);
  assert.throws(()=>y.core.tradeUp(y.alice,{key:'soldout',recipeId:'sky.upgrade',copyIds:inputs.map(c=>c.id)}),code('POOL_EXHAUSTED'));
  assert.equal(y.core.inventory(y.alice).length,4);
});
test('card and currency trade acceptance is atomic, authenticated and idempotent',()=>{
  const x=fixture(),a=x.open()[0],b=x.open('rare',x.bob)[0];
  const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,
    give:{copyIds:[a.id],currencies:[{currencyId:'credits',amount:100}]},
    receive:{copyIds:[b.id],currencies:[{currencyId:'credits',amount:50}]}});
  assert.equal(x.core.wallet(x.alice).credits,9890);
  assert.throws(()=>x.core.acceptTrade(x.alice,{key:'wrong',tradeId:trade.id}),code('NOT_FOUND'));
  const accepted=x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
  assert.equal(accepted.status,'accepted');
  assert.equal(x.core.inventory(x.alice)[0].id,b.id);assert.equal(x.core.inventory(x.bob)[0].id,a.id);
  assert.equal(x.core.wallet(x.alice).credits,9940);assert.equal(x.core.wallet(x.bob).credits,10040);
  assert.deepEqual(x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id}),accepted);
  assert.throws(()=>x.core.acceptTrade(x.bob,{key:'again',tradeId:trade.id}),code('TRADE_CLOSED'));
  assert.equal(x.core.inventory(x.bob)[0].openedBy,x.alice.userId);
});
test('offer reserves cards/currency; cancel refunds once and permits transfer again',()=>{
  const x=fixture(),a=x.open()[0];
  const input={toUserId:x.bob.userId,give:{copyIds:[a.id],currencies:[{currencyId:'credits',amount:100}]},receive:{copyIds:[],currencies:[]}};
  const trade=x.core.proposeTrade(x.alice,{...input,key:'first'});
  assert.throws(()=>x.core.proposeTrade(x.alice,{...input,key:'second'}),code('CARD_LOCKED'));
  x.core.cancelTrade(x.bob,{key:'decline',tradeId:trade.id});assert.equal(x.core.wallet(x.alice).credits,9990);
  x.core.cancelTrade(x.bob,{key:'decline',tradeId:trade.id});assert.equal(x.core.wallet(x.alice).credits,9990);
  x.core.proposeTrade(x.alice,{...input,key:'third'});
});
test('accepting an unavailable requested card fails without losing escrow',()=>{
  const x=fixture(),a=x.open()[0],b=x.open('rare',x.bob)[0];
  const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[a.id],currencies:[{currencyId:'credits',amount:100}]},receive:{copyIds:[b.id],currencies:[]}});
  const competing=x.core.proposeTrade(x.bob,{key:'lock',toUserId:x.alice.userId,give:{copyIds:[b.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
  assert.throws(()=>x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id}),code('CARD_LOCKED'));
  assert.equal(x.core.inventory(x.alice)[0].id,a.id);assert.equal(x.core.wallet(x.alice).credits,9890);
  x.core.cancelTrade(x.bob,{key:'unlock',tradeId:competing.id});x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
});
test('expired trades release currency/card escrow even when the feature is disabled',()=>{
  let time='2026-09-30T12:00:00.000Z';const x=fixture({clock:()=>time}),a=x.open()[0];
  const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,expiresInSeconds:1,give:{copyIds:[a.id],currencies:[{currencyId:'credits',amount:100}]},receive:{copyIds:[],currencies:[]}});
  const next=structuredClone(x.c);next.version=2;next.features.cardTrading=false;next.features.currencyTrading=false;x.core.publishCatalog(admin,next);
  time='2026-09-30T12:00:02.000Z';x.core.sweepExpiredTrades(admin);
  assert.equal(x.core.trades(x.alice)[0].status,'expired');assert.equal(x.core.wallet(x.alice).credits,9990);
  assert.throws(()=>x.core.acceptTrade(x.bob,{key:'late',tradeId:trade.id}),code('TRADE_CLOSED'));
});
test('currency-only trades work while card trading is disabled; nontradable units fail',()=>{
  const x=fixture({change:c=>c.features.cardTrading=false});
  const trade=x.core.proposeTrade(x.alice,{key:'money',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});
  x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});assert.equal(x.core.wallet(x.bob).credits,10010);
  assert.throws(()=>x.core.proposeTrade(x.alice,{key:'stamps',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'stamps',amount:1}]},receive:{copyIds:[],currencies:[]}}),code('TRANSFER_BLOCKED'));
});
test('private binding data is absent from catalog and public albums, retained holder can consume once',()=>{
  const x=fixture(),copy=x.open('unique')[0];
  assert(!JSON.stringify(x.core.catalog()).includes('PRIVATE-DEMO-CODE'));
  const album=x.core.saveAlbum(x.alice,{key:'album',name:'Public',visibility:'public',placements:[{copyId:copy.id}]});
  assert.equal(x.core.viewAlbum(null,album.id).cards[0].copy.bindings['demo.code'],undefined);
  assert.equal(x.core.inspectCard(x.alice,copy.id).bindings['demo.code'].data.code,'PRIVATE-DEMO-CODE');
  const trade=x.core.proposeTrade(x.alice,{key:'trade',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
  assert.throws(()=>x.core.consumeBinding(x.alice,{key:'locked',copyId:copy.id,namespace:'demo.code'}),code('CARD_LOCKED'));
  x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
  assert.equal(x.core.inspectCard(x.bob,copy.id).bindings['demo.code'],undefined);
  assert.equal(x.core.bindings(x.alice)[0].copyId,copy.id);
  x.core.consumeBinding(x.alice,{key:'use',copyId:copy.id,namespace:'demo.code'});
  assert.throws(()=>x.core.consumeBinding(x.alice,{key:'use-again',copyId:copy.id,namespace:'demo.code'}),code('ALREADY_USED'));
  assert.throws(()=>x.core.consumeBinding(x.bob,{key:'steal',copyId:copy.id,namespace:'demo.code'}),code('NOT_FOUND'));
});
test('follow and block bindings implement explicit transfer policies',()=>{
  const x=fixture({change:c=>c.variants.find(v=>v.id==='dawn.standard').bindings={'sample.reference':{visibility:'owner',transfer:'follow',data:{externalId:'abc'}}}});
  const a=x.open()[0];const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[a.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
  x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
  assert.equal(x.core.inspectCard(x.bob,a.id).bindings['sample.reference'].holderId,x.bob.userId);
  assert.equal(x.core.bindings(x.alice).length,0);
  const y=fixture({change:c=>c.variants.find(v=>v.id==='dawn.standard').bindings={'sample.code':{visibility:'owner',transfer:'block',data:{code:'x'}}}});
  const b=y.open()[0];assert.throws(()=>y.core.proposeTrade(y.alice,{key:'blocked',toUserId:y.bob.userId,give:{copyIds:[b.id],currencies:[]},receive:{copyIds:[],currencies:[]}}),code('TRANSFER_BLOCKED'));
});
test('binding factory failure rolls back currency and finite stock',()=>{
  const x=fixture({bindings:{'demo.code':()=>{throw new Error('provider failed');}}});
  assert.throws(()=>x.buy('unique'),/provider failed/);assert.equal(x.core.wallet(x.alice).credits,10000);assert.equal(x.core.packs(x.alice).length,0);
});
test('album privacy, ownership, optimistic versions, arbitrary layout data and transfer cleanup',()=>{
  const x=fixture(),a=x.open()[0],layout={id:'custom',columns:4,custom:{x:1}};
  const album=x.core.saveAlbum(x.alice,{key:'album',name:'Private',layout,placements:[{copyId:a.id,position:5,data:{rotation:10}}]});
  assert.deepEqual(album.layout,layout);assert.throws(()=>x.core.viewAlbum(x.bob,album.id),code('NOT_FOUND'));
  assert.throws(()=>x.core.saveAlbum(x.bob,{key:'steal',albumId:album.id,expectedVersion:1,name:'Steal'}),code('NOT_FOUND'));
  assert.throws(()=>x.core.saveAlbum(x.alice,{key:'stale',albumId:album.id,expectedVersion:0,name:'Stale'}),code('VERSION_CONFLICT'));
  const trade=x.core.proposeTrade(x.alice,{key:'give',toUserId:x.bob.userId,give:{copyIds:[a.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
  x.core.acceptTrade(x.bob,{key:'accept',tradeId:trade.id});
  assert.equal(x.core.viewAlbum(x.alice,album.id).cards.length,0);assert.equal(x.core.albums(x.alice)[0].version,2);
});
test('one copy can display in multiple albums; duplicate placement cannot inflate a single album',()=>{
  const x=fixture(),copy=x.open()[0];
  for(const key of ['a','b'])x.core.saveAlbum(x.alice,{key,name:key,placements:[{copyId:copy.id}]});
  assert.equal(x.core.albums(x.alice).length,2);assert.equal(x.core.inventory(x.alice).length,1);
  assert.throws(()=>x.core.saveAlbum(x.alice,{key:'duplicate',name:'Bad',placements:[{copyId:copy.id},{copyId:copy.id}]}),code('INVALID_INPUT'));
});
test('every optional module can be disabled while collecting still works',()=>{
  const x=fixture({change:c=>{for(const k of Object.keys(c.features))c.features[k]=false;}});
  assert.equal(x.open().length,1);
  assert.throws(()=>x.core.publicAlbums(),code('FEATURE_DISABLED'));
  assert.throws(()=>x.core.convert(x.alice,{key:'convert',from:'credits',to:'gems',amount:100,catalogVersion:1}),code('FEATURE_DISABLED'));
  assert.throws(()=>x.core.tradeUp(x.alice,{key:'up',recipeId:'sky.upgrade',copyIds:[]}),code('FEATURE_DISABLED'));
});
test('custom host policy can veto a transfer through the public constructor',()=>{
  const x=fixture({policies:{canTransfer:()=>false}}),copy=x.open()[0];
  assert.throws(()=>x.core.proposeTrade(x.alice,{key:'policy',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}}),code('TRANSFER_BLOCKED'));
});
test('layers and arbitrary namespaced attributes survive acquisition and public rendering models',()=>{
  const x=fixture({change:c=>{
    c.cards[0].layers=[{id:'background',src:'https://assets.example.test/bg.webp',depth:0},{id:'subject',src:'/subject.png',depth:12,effect:'emissive'}];
    c.cards[0].metadata['custom.rank']=7;
  }});
  const copy=x.open()[0];assert.equal(copy.definition.layers[1].depth,12);assert.equal(copy.definition.metadata['custom.rank'],7);
  const events=x.core.events(admin);assert(events.some(e=>e.type==='pack.opened'));
  assert(events.every((e,i)=>e.sequence===i+1));
  assert.throws(()=>x.core.events(x.alice),code('FORBIDDEN'));
});

test('disabling trading blocks acceptance but still permits escrow cancellation',()=>{
  const x=fixture();
  const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,
    give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});
  const next=structuredClone(x.c);next.version=2;next.features.cardTrading=false;next.features.currencyTrading=false;
  x.core.publishCatalog(admin,next);
  assert.throws(()=>x.core.acceptTrade(x.bob,{key:'blocked',tradeId:trade.id}),code('FEATURE_DISABLED'));
  assert.equal(x.core.cancelTrade(x.alice,{key:'cancel',tradeId:trade.id}).status,'cancelled');
  assert.equal(x.core.wallet(x.alice).credits,10000);
});
