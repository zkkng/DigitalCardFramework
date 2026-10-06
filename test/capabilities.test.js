import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,code} from './helpers.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {resolveCapabilities,workflowNames} from '../src/capability-policy.js';
import {Window} from 'happy-dom';
import {mountFramework} from '../src/ui.js';
import {codesFixture} from './codes-fixtures.mjs';
const primitives={issuance:true,transfer:true,settlement:true};
const profile=workflow=>({version:1,workflows:{[workflow]:true},primitives});
const disable=x=>{x.c.version++;x.c.capabilities={version:1,primitives};x.core.publishCatalog(admin,x.c);};

test('capability defaults, preset precedence and dependencies are explicit',()=>{
  assert.ok(workflowNames.every(name=>!resolveCapabilities().workflows[name]));
  assert.equal(resolveCapabilities({preset:'demo',primitives,workflows:{trading:false}}).workflows.trading,false);
  for(const raw of [null,[],{version:2},{workflows:{packs:'yes'}},{preset:'demo'},Object.create({preset:'demo'})])assert.throws(()=>resolveCapabilities(raw),code('INVALID_CAPABILITY_CONFIG'));
  let invoked=false;assert.throws(()=>resolveCapabilities({get preset(){invoked=true;return 'demo';}}));assert.equal(invoked,false);
});

for(const Store of [MemoryStore,SQLiteStore]) {
 test(Store.name+': omitted capabilities admit collection only without partial workflow state',()=>{
  const store=new Store(),x=fixture({store,change:c=>{delete c.capabilities;}});
  try{
   const before=store.read(s=>s);
   assert.deepEqual(x.core.workerPlan(admin),{actions:false,maintenance:false});
   assert.deepEqual(x.core.capabilities(x.alice).available,{packs:false,directSales:false,trading:false,resale:false});
   assert.throws(()=>x.buy(),code('FEATURE_DISABLED'));
   assert.throws(()=>x.core.createShop({...x.alice,role:'admin'},{key:'shop',kind:'admin',name:'Shop'}),code('FEATURE_DISABLED'));
   assert.throws(()=>x.core.proposeTrade(x.alice,{key:'trade',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:1}]},receive:{copyIds:[],currencies:[]}}),code('FEATURE_DISABLED'));
   assert.deepEqual(store.read(s=>s),before);
  }finally{x.core.close();}
 });
 test(Store.name+': paid packs drain and exact purchase replay survives disable and re-enable',()=>{
  const x=fixture({store:new Store(),change:c=>{c.capabilities=profile('packs');}});
  try{
   const quote=x.core.quote(x.alice,{productId:'common'}),input={...quote,key:'original'},receipt=x.core.purchase(x.alice,input);
   disable(x);
   assert.deepEqual(x.core.capabilities(x.alice).draining,['packs']);
   assert.deepEqual(x.core.purchase(x.alice,input),receipt);
   assert.throws(()=>x.core.purchase(x.alice,{...input,key:'new'}),code('FEATURE_DISABLED'));
   const opened=x.core.openPack(x.alice,{key:'open',packId:receipt.packs[0].id});assert.equal(opened.cards.length,1);
   x.c.version++;x.c.capabilities=profile('packs');x.core.publishCatalog(admin,x.c);
   assert.deepEqual(x.core.purchase(x.alice,input),receipt);assert.equal(x.core.wallet(x.alice).credits,9990);
  }finally{x.core.close();}
 });
 test(Store.name+': direct card storefront works without packs, trade or resale',()=>{
  const x=fixture({store:new Store(),change:c=>{c.capabilities=profile('directSales');c.features.cardTrading=false;c.features.currencyTrading=false;}}),seller={...x.alice,role:'admin'};
  try{
   const shop=x.core.createShop(seller,{key:'shop',kind:'admin',name:'Cards'});
   const listing=x.core.createListing(seller,{key:'stock',shopId:shop.id,title:'Card',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:1}});
   const input={...x.core.quoteListing(x.bob,{listingId:listing.id}),key:'sale'},order=x.core.buyListing(x.bob,input);
   assert.equal(order.items.length,1);assert.throws(()=>x.buy(),code('FEATURE_DISABLED'));
   disable(x);assert.deepEqual(x.core.buyListing(x.bob,input),order);
   assert.equal(x.core.audit(admin).ok,true);
  }finally{x.core.close();}
 });
 test(Store.name+': legacy installed catalogs require explicit migration while reads remain available',()=>{
  const store=new Store(),x=fixture({store});
  try{
   store.transact(s=>{delete s.catalog.capabilities;});
   assert.equal(x.core.capabilities(x.alice).migrationRequired,true);assert.equal(x.core.inventory(x.alice).length,0);
   assert.throws(()=>x.buy(),code('CAPABILITY_MIGRATION_REQUIRED'));
   const implicit=structuredClone(x.c);implicit.version++;delete implicit.capabilities;
   assert.throws(()=>x.core.publishCatalog(admin,implicit),code('CAPABILITY_MIGRATION_REQUIRED'));
   assert.throws(()=>x.core.previewImport(admin,{source:{version:2},expectedVersion:1}),code('CAPABILITY_MIGRATION_REQUIRED'));
   const preview=x.core.previewImport(admin,{source:{capabilities:x.c.capabilities},expectedVersion:1});
   assert(preview.changes.some(change=>change.section==='capabilities'));
   x.core.commitImport(admin,{...preview,key:'migration'});assert.equal(x.core.capabilities(x.alice).migrationRequired,false);
   assert.equal(x.buy().packs.length,1);
  }finally{x.core.close();}
 });
 test(Store.name+': resale is independent and disabled listings release their original stock',()=>{
  const x=fixture({store:new Store()}),seller={...x.alice,role:'admin'};
  try{
   const cards=x.open('common',x.alice,2);
   x.c.version++;x.c.capabilities=profile('resale');x.c.features.cardTrading=false;x.c.features.currencyTrading=false;x.core.publishCatalog(admin,x.c);
   const shop=x.core.createShop(seller,{key:'shop',kind:'admin',name:'Resale'});
   const listing=x.core.createListing(seller,{key:'stock',shopId:shop.id,title:'Cards',price:{currencyId:'credits',amount:20},items:{kind:'copies',ids:cards.map(c=>c.id)}});
   const input={...x.core.quoteListing(x.bob,{listingId:listing.id}),key:'sale'},order=x.core.buyListing(x.bob,input);
   assert.equal(order.items.length,1);disable(x);
   assert.throws(()=>x.core.quoteListing(x.bob,{listingId:listing.id}),code('FEATURE_DISABLED'));
   assert.deepEqual(x.core.buyListing(x.bob,input),order);
   x.core.cancelListing(seller,{key:'cancel',listingId:listing.id});
   assert.equal(x.core.inventory(x.alice).find(c=>c.id===cards[1].id).lockedBy,undefined);
   assert.equal(x.core.audit(admin).ok,true);
  }finally{x.core.close();}
 });
 test(Store.name+': disabling admission preserves escrow and rejects provider removal atomically',()=>{
  const store=new Store(),x=fixture({store,change:c=>{c.capabilities=profile('trading');}});
  try{
   const trade=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:5}]},receive:{copyIds:[],currencies:[]}});
   assert.equal(x.core.workerPlan(admin).maintenance,true);
   const before=store.read(s=>s);x.c.version++;x.c.capabilities={version:1};
   assert.throws(()=>x.core.publishCatalog(admin,x.c),code('CAPABILITY_OBLIGATION'));assert.deepEqual(store.read(s=>s),before);
   x.c.capabilities={version:1,primitives};x.c.features.cardTrading=false;x.c.features.currencyTrading=false;x.core.publishCatalog(admin,x.c);
   assert.deepEqual(x.core.capabilities(x.bob).draining,['trading']);
   const input={key:'accept',tradeId:trade.id,expectedDigest:trade.digest},accepted=x.core.acceptTrade(x.bob,input);
   assert.equal(accepted.status,'accepted');assert.equal(x.core.wallet(x.bob).credits,10005);
   assert.deepEqual(x.core.acceptTrade(x.bob,input),accepted);assert.equal(x.core.audit(admin).ok,true);
   assert.equal(x.core.workerPlan(admin).maintenance,false);
  }finally{x.core.close();}
 });
}

test('collection-only reference mount omits optional queries, navigation and counters',async()=>{
 const x=fixture({change:c=>{delete c.capabilities;c.features={};}}),window=new Window({url:'http://localhost/'}),calls=[];
 globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
 try{
  const client={requestKey:()=>crypto.randomUUID()};
  for(const name of ['catalog','me','capabilities','inventory','wallet','packs','albums','trades','availability'])client[name]=async()=>{calls.push(name);return x.core[name](x.alice);};
  const root=document.createElement('main');document.body.append(root);const mounted=mountFramework(root,{client,navigation:'tabs'});await mounted.ready;
  assert.deepEqual(calls.sort(),['capabilities','catalog','inventory','me']);
  assert.deepEqual([...root.querySelectorAll('[data-view]')].map(node=>node.dataset.view),['collection']);
  assert.doesNotMatch(root.textContent,/sealed packs|Trade lounge|Marketplace|Account rewards/);mounted.dispose();
 }finally{x.core.close();window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}
});

test('accepted raffle rights drain after commerce and workflow disable',()=>{
 let now='2026-10-01T00:00:00Z';const x=fixture({clock:()=>now,raffleRandom:()=>0}),seller={...x.alice,role:'admin'};
 try{
  const shop=x.core.createShop(seller,{key:'shop',kind:'admin',name:'Cards'});
  const listing=x.core.createListing(seller,{key:'raffle',shopId:shop.id,title:'Raffle',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:1},raffle:{entryClosesAt:'2026-10-01T01:00:00Z',claimSeconds:60,winners:1}});
  x.core.enterRaffle(x.bob,{key:'entry',listingId:listing.id});disable(x);
  x.core.configureCommerce(admin,{key:'off',expectedRevision:0,settings:{enabled:false}});
  assert.throws(()=>x.core.enterRaffle(x.alice,{key:'late',listingId:listing.id}),code('FEATURE_DISABLED'));
  now='2026-10-01T01:00:00Z';x.core.drawRaffle(admin,{key:'draw',listingId:listing.id});
  const order=x.core.buyListing(x.bob,{...x.core.quoteListing(x.bob,{listingId:listing.id}),key:'claim'});
  assert.equal(order.items.length,1);assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}
});

test('owned code and delivery history remains discoverable after every admission is disabled',async()=>{
 const x=codesFixture({actionHandlers:{'example.reward':async()=>({ok:true})},change:c=>{c.variants.find(v=>v.id==='dawn.standard').onOpen=[{id:'reward',handler:'example.reward'}];}});
 const window=new Window({url:'http://localhost/'});globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
 try{
  x.openCode();disable(x);assert.equal(x.core.workerPlan(admin).actions,true);await x.core.dispatchActions(admin);assert.equal(x.core.workerPlan(admin).actions,false);
  assert.deepEqual(x.core.capabilities(x.alice).history,{codes:true,rewards:true});
  assert.deepEqual(x.core.capabilities(x.bob).history,{codes:false,rewards:false});
  assert.deepEqual(x.core.capabilities(x.alice).draining,[]);
  const client={requestKey:()=>crypto.randomUUID()};
  for(const name of ['catalog','me','capabilities','inventory','wallet','packs','albums','trades','availability'])client[name]=async()=>x.core[name](x.alice);
  const root=document.createElement('main');document.body.append(root);const mounted=mountFramework(root,{client,navigation:'tabs'});await mounted.ready;
  const navigation=[...root.querySelectorAll('[data-view]')].map(node=>node.dataset.view);assert(navigation.includes('codes'));assert(navigation.includes('rewards'));assert(!navigation.includes('shop'));
  assert.equal(x.core.codeHistory(x.alice).items.length,1);assert.equal(x.core.fulfillments(x.alice).items.length,2);mounted.dispose();
 }finally{x.core.close();window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}
});

test('issuance-only packs permit free primary listings while paid acquisition requires settlement',()=>{
 const x=fixture({change:c=>{c.capabilities={version:1,preset:'packCollection',primitives:{issuance:true}};}}),seller={...x.alice,role:'admin'};
 try{
  assert.throws(()=>x.buy(),code('CAPABILITY_UNAVAILABLE'));
  const shop=x.core.createShop(seller,{key:'shop',kind:'admin',name:'Free packs'});
  const terms={shopId:shop.id,title:'Pack',items:{kind:'mint-pack',productId:'common',quantity:1}};
  assert.throws(()=>x.core.createListing(seller,{...terms,key:'paid',price:{currencyId:'credits',amount:1}}),code('CAPABILITY_UNAVAILABLE'));
  const listing=x.core.createListing(seller,{...terms,key:'free',price:{currencyId:'credits',amount:0}});
  const order=x.core.buyListing(x.bob,{...x.core.quoteListing(x.bob,{listingId:listing.id}),key:'claim'});
  assert.equal(order.paid.amount,0);assert.equal(x.core.wallet(x.bob).credits,10000);assert.equal(x.core.packs(x.bob).length,1);
 }finally{x.core.close();}
});
