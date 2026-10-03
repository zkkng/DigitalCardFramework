import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CardFramework,MemoryStore} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin,code} from './helpers.js';
let sequence=0;
const configure=(x,scope,changes,targetId)=>x.core.configureAdmin(admin,{key:'admin-'+(++sequence),expectedRevision:x.core.adminOverview(admin).revision,reason:'Configuration review',scope,targetId,changes});
const give=(x,userId,variantId='dawn.standard',quantity=1)=>x.core.administerCards(admin,{key:'cards-'+(++sequence),expectedRevision:x.core.adminOverview(admin).revision,reason:'Community award',action:'give',userId,variantId,quantity});
const remove=(x,userId,copyIds)=>x.core.administerCards(admin,{key:'cards-'+(++sequence),expectedRevision:x.core.adminOverview(admin).revision,reason:'Inventory correction',action:'remove',userId,copyIds});
const trade=(x,copyId)=>x.core.proposeTrade(x.alice,{key:'trade-'+(++sequence),toUserId:x.bob.userId,give:{copyIds:[copyId],currencies:[]},receive:{copyIds:[],currencies:[]}});
const listing=(x,copyId)=>{const shop=x.core.createShop(x.alice,{key:'shop-'+(++sequence),name:'Cards'});return x.core.createListing(x.alice,{key:'listing-'+(++sequence),shopId:shop.id,title:'Dawn',price:{currencyId:'credits',amount:5},items:{kind:'copies',ids:[copyId]}});};

test('administration separates permissions and validates scope, reason, revision and retry identity',()=>{
  const x=fixture(),reader={permissions:['admin.read']};
  assert.throws(()=>x.core.adminOverview(x.alice),code('FORBIDDEN'));assert.equal(x.core.adminOverview(reader).revision,0);
  const input={key:'settings',expectedRevision:0,reason:'Maintenance',scope:'site',changes:{packPurchasesPaused:true}};
  assert.throws(()=>x.core.configureAdmin(reader,input),code('FORBIDDEN'));
  assert.throws(()=>x.core.administerCards(reader,{key:'cards',expectedRevision:0,reason:'Award',action:'give',userId:x.a.id,variantId:'dawn.standard'}),code('FORBIDDEN'));
  for(const bad of [{reason:' '},{changes:{unexpected:true}},{expectedRevision:-1},{scope:'unknown'}])assert.throws(()=>x.core.configureAdmin(admin,{...input,...bad}),code('INVALID_INPUT'));
  const receipt=x.core.configureAdmin(admin,input);assert.equal(receipt.revision,1);assert.deepEqual(x.core.configureAdmin(admin,input),receipt);
  assert.throws(()=>x.core.configureAdmin(admin,{...input,reason:'Different'}),code('IDEMPOTENCY_CONFLICT'));
  assert.throws(()=>x.core.configureAdmin(admin,{...input,key:'new-key'}),code('ADMIN_CHANGED'));assert.equal(x.core.adminHistory(admin).total,1);
});
test('price and rarity overrides preserve catalog and paid allocations while invalidating old quotes',()=>{
  const x=fixture(),old=x.core.quote(x.alice,{productId:'sky.basic'}),base=x.core.operatorCatalog(admin);
  configure(x,'product',{priceAmount:200,discountPercent:25,rarityWeights:{common:0,rare:2,unique:0}},'sky.basic');
  assert.throws(()=>x.core.purchase(x.alice,{...old,key:'stale'}),code('STALE_QUOTE'));
  const quote=x.core.quote(x.alice,{productId:'sky.basic'});assert.equal(quote.price.amount,150);
  const purchased=x.core.purchase(x.alice,{...quote,key:'purchase'});assert.equal(purchased.paid.amount,150);
  const cards=x.core.openPack(x.alice,{key:'open',packId:purchased.packs[0].id}).cards;assert(cards.every(c=>c.rarityId==='rare'));
  assert.deepEqual(x.core.operatorCatalog(admin),base);
  const product=x.core.adminOverview(admin).lines.find(l=>l.id==='sky').products.find(p=>p.id==='sky.basic');assert.equal(product.slotOdds[0].rarities[0].percent,100);
  configure(x,'product',{priceAmount:null,discountPercent:0,rarityWeights:null},'sky.basic');assert.equal(x.core.quote(x.alice,{productId:'sky.basic'}).price.amount,100);
  assert.equal(x.core.packs(x.alice)[0].product.price.amount,150);assert.deepEqual(x.core.purchase(x.alice,{...quote,key:'purchase'}),purchased);assert.equal(x.core.audit(admin).ok,true);
});
test('invalid odds cannot empty pools, exceed bounds or make guarantees impossible',()=>{
  const x=fixture();for(const [productId,changes]of [['common',{rarityWeights:{common:0}}],['common',{rarityWeights:{common:1001}}],['common',{rarityWeights:{unknown:2}}],['sky.night',{rarityWeights:{rare:0}}]])assert.throws(()=>configure(x,'product',changes,productId),code('INVALID_INPUT'));
  assert.equal(x.core.adminOverview(admin).revision,0);
});
test('pack and line pauses block new charges while already paid packs open',()=>{
  const x=fixture(),pack=x.buy().packs[0];configure(x,'site',{packPurchasesPaused:true});assert.throws(()=>x.core.quote(x.alice,{productId:'common'}),code('ADMIN_PAUSED'));
  assert.equal(x.core.catalog().products.find(p=>p.id==='common').enabled,false);assert.equal(x.core.openPack(x.alice,{key:'open-paid',packId:pack.id}).cards.length,1);
  configure(x,'site',{packPurchasesPaused:false});configure(x,'line',{salesPaused:true},'sky');assert.throws(()=>x.core.quote(x.alice,{productId:'common'}),code('ADMIN_PAUSED'));assert(x.core.quote(x.alice,{productId:'garden.basic'}));
  configure(x,'site',{packPurchasesPaused:false});assert.throws(()=>x.core.quote(x.alice,{productId:'common'}),code('ADMIN_PAUSED'));assert.equal(x.core.audit(admin).ok,true);
});
test('direct trading restrictions stop pending acceptance but allow cancellation and release',()=>{
  const x=fixture(),copy=x.open()[0],offer=trade(x,copy.id);configure(x,'site',{tradingPaused:true});assert.throws(()=>x.core.acceptTrade(x.bob,{key:'accept',tradeId:offer.id}),code('TRANSFER_BLOCKED'));assert.equal(x.core.cancelTrade(x.alice,{key:'cancel',tradeId:offer.id}).status,'cancelled');
  configure(x,'site',{tradingPaused:false});const next=trade(x,copy.id);configure(x,'user',{tradingBlocked:true},x.b.id);assert.throws(()=>x.core.acceptTrade(x.bob,{key:'accept-two',tradeId:next.id}),code('TRANSFER_BLOCKED'));x.core.cancelTrade(x.alice,{key:'cancel-two',tradeId:next.id});assert.throws(()=>trade(x,copy.id),code('TRANSFER_BLOCKED'));assert.equal(x.core.audit(admin).ok,true);
});
test('shop opt-in is independent from trading; seller and buyer restrictions gate existing listings',()=>{
  const x=fixture(),copy=x.open()[0];configure(x,'site',{playerShopsEnabled:true,tradingPaused:true});const first=listing(x,copy.id),quote=x.core.quoteListing(x.bob,{listingId:first.id});configure(x,'user',{sellingBlocked:true},x.a.id);assert.throws(()=>x.core.buyListing(x.bob,{...quote,key:'buy'}),code('ACCOUNT_RESTRICTED'));
  configure(x,'user',{sellingBlocked:false},x.a.id);configure(x,'site',{playerShopsPaused:true});assert.throws(()=>x.core.quoteListing(x.bob,{listingId:first.id}),code('ADMIN_PAUSED'));x.core.cancelListing(x.alice,{key:'cancel-listing',listingId:first.id});assert.equal(x.core.inspectCard(x.alice,copy.id).lockedBy,undefined);
  configure(x,'site',{playerShopsPaused:false});const next=listing(x,copy.id);configure(x,'user',{buyingBlocked:true},x.b.id);assert.throws(()=>x.core.quoteListing(x.bob,{listingId:next.id}),code('ACCOUNT_RESTRICTED'));assert.throws(()=>x.core.quote(x.bob,{productId:'common'}),code('ACCOUNT_RESTRICTED'));configure(x,'user',{buyingBlocked:false},x.b.id);
  const result=x.core.buyListing(x.bob,{...x.core.quoteListing(x.bob,{listingId:next.id}),key:'valid-buy'});assert.equal(result.items[0].copyId,copy.id);assert.equal(x.core.audit(admin).ok,true);
});
test('removal clears albums and favorites without recycling finite supply or serial numbers',()=>{
  const x=fixture({change:c=>{c.variants.find(v=>v.id==='aurora.holo').supplyLimit=1;}}),copy=give(x,x.a.id,'aurora.holo').cards[0];assert.equal(copy.serialNumber,1);
  x.core.saveAlbum(x.alice,{key:'album',name:'Collection',placements:[{copyId:copy.id}]});x.core.setPreferences(x.alice,{key:'favorite',favoriteCopyIds:[copy.id]});assert.throws(()=>give(x,x.a.id,'aurora.holo'),code('SOLD_OUT'));remove(x,x.a.id,[copy.id]);
  assert.equal(x.core.inventory(x.alice).length,0);assert.deepEqual(x.core.albums(x.alice)[0].placements,[]);assert.deepEqual(x.core.me(x.alice).preferences.favoriteCopyIds,[]);assert.throws(()=>give(x,x.a.id,'aurora.holo'),code('SOLD_OUT'));assert.equal(x.core.availability().variants.find(v=>v.id==='aurora.holo').issued,1);assert.equal(x.core.audit(admin).ok,true);
});
test('sealed, reserved and attached-benefit copies cannot be removed; projections omit secrets',()=>{
  const x=fixture(),pack=x.buy().packs[0],sealed=x.core.adminUser(admin,{userId:x.a.id}).inventory.items[0];assert.equal(sealed.canRemove,false);assert.throws(()=>remove(x,x.a.id,[sealed.id]),code('NOT_OWNED'));
  const copy=x.core.openPack(x.alice,{key:'open',packId:pack.id}).cards[0],offer=trade(x,copy.id);assert.throws(()=>remove(x,x.a.id,[copy.id]),code('CARD_LOCKED'));x.core.cancelTrade(x.alice,{key:'cancel',tradeId:offer.id});const benefit=give(x,x.a.id,'solstice.unique').cards[0];assert.throws(()=>remove(x,x.a.id,[benefit.id]),code('ATTACHED_ENTITLEMENT'));
  const user=x.core.adminUser(admin,{userId:x.a.id});assert(!JSON.stringify(user).includes('PRIVATE-DEMO-CODE'));assert(!JSON.stringify(user).includes('"subject"'));assert.equal(x.core.audit(admin).ok,true);
});
test('pagination is bounded and capacity failure rolls back complete grants',()=>{
  const store=new MemoryStore(),x=fixture({store}),first=x.core.adminUsers(admin,{limit:1}),second=x.core.adminUsers(admin,{limit:1,after:first.next});assert.equal(first.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);assert.equal(x.core.adminUsers(admin,{search:'Bob'}).items[0].id,x.b.id);assert.throws(()=>x.core.adminUsers(admin,{limit:201}),code('INVALID_INPUT'));
  x.core=new CardFramework({store,limits:{copiesPerUser:1}});assert.throws(()=>give(x,x.a.id,'dawn.standard',2),code('INVENTORY_CAPACITY'));assert.equal(x.core.adminHistory(admin).total,0);assert.equal(x.core.availability().variants.find(v=>v.id==='dawn.standard').issued,0);assert.equal(x.core.adminOverview(admin).revision,0);
});
test('catalog updates invalidate reviews and cannot be overridden by resume controls',()=>{
  const x=fixture(),review=x.core.adminOverview(admin),next=x.core.operatorCatalog(admin);next.version++;const product=next.products.find(p=>p.id==='common');product.revision++;product.enabled=false;x.core.publishCatalog(admin,next);
  assert.throws(()=>x.core.configureAdmin(admin,{key:'stale-review',expectedRevision:review.revision,reason:'Discount',scope:'product',targetId:'common',changes:{discountPercent:20}}),code('ADMIN_CHANGED'));configure(x,'site',{packPurchasesPaused:false});assert.equal(x.core.catalog().products.find(p=>p.id==='common').enabled,false);assert.throws(()=>x.core.quote(x.alice,{productId:'common'}),code('UNAVAILABLE'));
});
test('history, settings and card-grant receipts survive SQLite restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'dc-admin-')),path=join(directory,'state.db');let core;
  try{const x=fixture({store:new SQLiteStore(path)});core=x.core;const input={key:'durable-grant',expectedRevision:0,reason:'Launch award',userId:x.a.id,action:'give',variantId:'dawn.standard',quantity:2},receipt=core.administerCards(admin,input);configure(x,'product',{discountPercent:20},'common');core.close();core=new CardFramework({store:new SQLiteStore(path)});assert.deepEqual(core.administerCards(admin,input),receipt);assert.throws(()=>core.administerCards(admin,{...input,quantity:1}),code('IDEMPOTENCY_CONFLICT'));assert.equal(core.adminHistory(admin).total,2);assert.equal(core.inventory(x.alice).length,2);assert.equal(core.quote(x.alice,{productId:'common'}).price.amount,8);assert.equal(core.audit(admin).ok,true);}finally{core?.close();rmSync(directory,{recursive:true,force:true});}
});
test('pre-administration purchase receipts still replay after settings change',()=>{
  const store=new MemoryStore(),x=fixture({store}),quote=x.core.quote(x.alice,{productId:'common'});delete quote.adminRevision;const input={productId:quote.productId,quantity:quote.quantity,productRevision:quote.productRevision,catalogVersion:quote.catalogVersion},receipt=x.core.purchase(x.alice,{...quote,key:'legacy'});
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
  const oldHash=createHash('sha256').update(JSON.stringify(stable({type:'packs.purchased',input}))).digest('hex');
  store.transact(s=>{const entry=Object.entries(s.requests).find(([key])=>key.endsWith(':legacy'));assert(entry);entry[1].hash=oldHash;});configure(x,'site',{packPurchasesPaused:true});assert.deepEqual(x.core.purchase(x.alice,{...quote,key:'legacy'}),receipt);assert.equal(x.core.packs(x.alice).length,1);
});
