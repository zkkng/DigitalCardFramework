import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,code} from './helpers.js';

test('trading inventory is paginated, respects private/block switches and never reveals someone else’s code',()=>{
  const x=fixture();x.open('unique',x.bob);x.open('common',x.bob,3);
  const result=x.core.tradeInventory(x.alice,x.b.id,{limit:2});assert.equal(result.total,4);assert(result.next);assert(!JSON.stringify(result).includes('PRIVATE-DEMO-CODE'));
  const second=x.core.tradeInventory(x.alice,x.b.id,{limit:2,after:result.next});assert.equal(second.items.length,2);assert(!second.items.some(c=>result.items.some(p=>p.id===c.id)));
  x.core.setPreferences(x.bob,{key:'private',inventoryVisibility:'private'});assert.throws(()=>x.core.tradeInventory(x.alice,x.b.id),code('NOT_FOUND'));
  assert(x.core.tradeInventory(x.bob,x.b.id).items.some(c=>c.bindings['demo.code']));
  x.core.setPreferences(x.bob,{key:'block',blockedUserIds:[x.a.id]});assert.equal(x.core.directory(x.alice).items.length,0);
  assert.throws(()=>x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.b.id,give:{copyIds:[],currencies:[{currencyId:'credits',amount:1}]},receive:{copyIds:[],currencies:[]}}),code('TRADE_BLOCKED'));
});
test('immutable trade snapshots bind review digest and versions; acceptance creates recipient notifications',()=>{
  const x=fixture(),a=x.open()[0],b=x.open('rare',x.bob)[0];
  const offer=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.b.id,give:{copyIds:[a.id],currencies:[]},receive:{copyIds:[b.id],currencies:[]},versions:{[a.id]:a.version,[b.id]:b.version},message:'Sky swap'});
  assert.equal(offer.snapshots[a.id].definition.name,'Dawn');assert(x.core.notifications(x.bob).items.some(n=>n.type==='trade.received'));
  assert.throws(()=>x.core.acceptTrade(x.bob,{key:'wrong',tradeId:offer.id,expectedDigest:'wrong'}),code('TRADE_CHANGED'));
  const accepted=x.core.acceptTrade(x.bob,{key:'accept',tradeId:offer.id,expectedDigest:offer.digest});assert.equal(accepted.status,'accepted');assert.equal(x.core.inventory(x.bob)[0].id,a.id);
  const notifications=x.core.notifications(x.bob);x.core.readNotifications(x.bob,{key:'read',ids:notifications.items.map(n=>n.id)});assert(x.core.notifications(x.bob).items.every(n=>n.read));
});
test('counter offers atomically refund the original escrow and reverse the negotiating sides',()=>{
  const x=fixture(),a=x.open()[0],b=x.open('rare',x.bob)[0];const give={copyIds:[a.id],currencies:[{currencyId:'credits',amount:100}]},receive={copyIds:[b.id],currencies:[]};
  const offer=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.b.id,give,receive});
  assert.throws(()=>x.core.counterTrade(x.bob,{key:'bad',tradeId:offer.id,give:{copyIds:[b.id],currencies:[]},receive:{copyIds:[a.id],currencies:[{currencyId:'credits',amount:999999}]}}),code('INSUFFICIENT_FUNDS'));
  assert.equal(x.core.wallet(x.alice).credits,9890);assert.equal(x.core.trades(x.alice)[0].status,'pending');
  const counter=x.core.counterTrade(x.bob,{key:'counter',tradeId:offer.id,give:{copyIds:[b.id],currencies:[]},receive:{copyIds:[a.id],currencies:[{currencyId:'credits',amount:50}]},expectedDigest:offer.digest});
  assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(counter.parentTradeId,offer.id);assert.equal(x.core.trades(x.alice).find(t=>t.id===offer.id).status,'countered');
  x.core.acceptTrade(x.alice,{key:'accept-counter',tradeId:counter.id,expectedDigest:counter.digest});assert.equal(x.core.wallet(x.bob).credits,10040);
});
test('favorites are owned copies, wishlists are definitions, and transfers clear prior favorite placements',()=>{
  const x=fixture(),a=x.open()[0];x.core.setPreferences(x.alice,{key:'prefs',favoriteCopyIds:[a.id],wishlistCardIds:['aurora']});
  assert.equal(x.core.me(x.alice).preferences.favoriteCopyIds.length,1);assert.throws(()=>x.core.setPreferences(x.bob,{key:'bad',favoriteCopyIds:[a.id]}),code('NOT_OWNED'));
  const offer=x.core.proposeTrade(x.alice,{key:'gift',toUserId:x.b.id,give:{copyIds:[a.id],currencies:[]},receive:{copyIds:[],currencies:[]}});x.core.acceptTrade(x.bob,{key:'accept',tradeId:offer.id});
  assert.deepEqual(x.core.me(x.alice).preferences.favoriteCopyIds,[]);assert.deepEqual(x.core.me(x.alice).preferences.wishlistCardIds,['aurora']);
});
test('pity guarantees a qualifying draw without exceeding supply and retries do not advance progress twice',()=>{
  const x=fixture({change:c=>{c.products.find(p=>p.id==='sky.basic').pity={rarityId:'rare',after:2};c.products.find(p=>p.id==='sky.basic').duplicatePolicy.scope='none';}});
  const first=x.buy('sky.basic',x.alice,1,'first');assert.equal(x.core.pityProgress(x.alice)['sky.basic'],1);
  x.core.purchase(x.alice,{...x.core.quote(x.alice,{productId:'sky.basic'}),key:'first'});assert.equal(x.core.pityProgress(x.alice)['sky.basic'],1);
  const second=x.buy('sky.basic');const cards=x.core.openPack(x.alice,{key:'open',packId:second.packs[0].id}).cards;assert(cards.some(c=>c.rarityId==='rare'));assert.equal(x.core.pityProgress(x.alice)['sky.basic'],0);
  assert.equal(x.core.availability().variants.find(v=>v.id==='aurora.holo').remaining,99);
});

