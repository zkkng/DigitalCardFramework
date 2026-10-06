import {createWireTransport} from '@digital-card/framework/wire-client';
import type {Schemas} from '@digital-card/framework/wire-types';
const call=createWireTransport({principal:()=>null});
async function acquisition(){
  const quote=await call('quote',{productId:'sample',quantity:1});
  const price:number=quote.price.amount;
  const purchase=await call('purchase',{...quote,key:'consumer-key'});
  const packId:string=purchase.packs[0]!.id;
  const receipt=await call('openPack',{key:'open-key',packId});
  const state:'sealed'|'owned'|'consumed'=receipt.cards[0]!.state;
  return {price,state};
}
void acquisition;
// Deliberate contract drift must continue to fail the strict consumer check.
// @ts-expect-error quantity is an integer JSON number, not a string
void call('quote',{productId:'sample',quantity:'1'});
// @ts-expect-error missing the required reviewed product revision
void call('purchase',{key:'key',productId:'sample',quantity:1,catalogVersion:1});
// @ts-expect-error quote does not accept an injected principal
void call('quote',{productId:'sample',userId:'other'});
// @ts-expect-error operation names are pinned by the contract
void call('purchaseUnchecked',{key:'key'});
// @ts-expect-error error envelope always requires a message
const error:Schemas['Error']={code:'INVALID_INPUT'};
void error;
// @ts-expect-error production trade acceptance requires the reviewed digest
void call('acceptTrade',{key:'key',tradeId:'trade'});
void call('acceptTrade',{key:'key',tradeId:'trade',expectedDigest:'a'.repeat(64)});
async function collectionAndAdministration(){
  const overview=await call('adminOverview',undefined);
  const cards:number=overview.counts.cards;
  const discount:number=overview.lines[0]!.products[0]!.discountPercent;
  const users=await call('adminUsers',undefined);
  const restricted:boolean=users.items[0]!.restrictions.tradingBlocked;
  const detail=await call('adminUser',undefined,{query:{userId:'account'}});
  const version:number=detail.inventory.items[0]!.version;
  const inventory=await call('inventory',undefined,{query:{limit:50}});
  const copies=Array.isArray(inventory)?inventory:inventory.items;
  const transferable:boolean=copies[0]!.tradable;
  const name:string=copies[0]!.definition.name;
  const rarity:string=copies[0]!.variant.rarityId;
  const trade=await call('proposeTrade',{key:'key',toUserId:'account',give:{copyIds:[],currencies:[]},receive:{copyIds:[],currencies:[]}});
  const status:'pending'|'accepted'|'cancelled'|'declined'|'expired'|'countered'=trade.status;
  return {cards,discount,restricted,version,transferable,name,rarity,status};
}
void collectionAndAdministration;
void call('registerCommandIntent',{command:'purchase',input:{productId:'sample',quantity:1,productRevision:1,catalogVersion:1}});
void call('registerCommandIntent',{command:'configureAdmin',input:{expectedRevision:1,reason:'Configuration update',scope:'site',changes:{packPurchasesPaused:false}}});
// @ts-expect-error registered reviewed purchases retain their required catalog revision
void call('registerCommandIntent',{command:'purchase',input:{productId:'sample',quantity:1,productRevision:1}});
// @ts-expect-error an intent identifier cannot be replaced with caller-supplied command data
void call('executeCommandIntent',{command:'purchase',input:{}});
