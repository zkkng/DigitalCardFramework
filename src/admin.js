import {randomUUID} from 'node:crypto';
import {check,integer,text} from './catalog.js';
import {hasPermission} from './access.js';
import {page,safeData} from './data.js';
import {commerceDefaults} from './commerce.js';

export const adminSiteDefaults=Object.freeze({packPurchasesPaused:false,tradingPaused:false,playerShopsPaused:false,playerShopsEnabled:null});
export const adminUserDefaults=Object.freeze({tradingBlocked:false,sellingBlocked:false,buyingBlocked:false});
const productDefaults=Object.freeze({priceAmount:null,discountPercent:0,rarityWeights:null});
const record=(rows,id)=>rows&&typeof id==='string'&&Object.hasOwn(rows,id)?rows[id]:undefined;
export const adminRevision=s=>s.adminControls?.revision??0;
export const adminSite=s=>({...adminSiteDefaults,...s.adminControls?.site});
export const adminRestrictions=(s,userId)=>({...adminUserDefaults,...record(s.adminControls?.users,userId)});
export const adminLine=(s,lineId)=>({salesPaused:false,...record(s.adminControls?.lines,lineId)});
const productSettings=(s,productId)=>({...productDefaults,...record(s.adminControls?.products,productId)});
const permission=(actor,name)=>check(hasPermission(actor,name),'FORBIDDEN','Operator authority required: '+name,403);

export function effectiveProduct(s,product){
  if(!product)return product;
  const settings=productSettings(s,product.id),result=structuredClone(product);
  const baseAmount=settings.priceAmount??product.price.amount;
  result.price.amount=Math.max(1,Number(BigInt(baseAmount)*BigInt(100-settings.discountPercent)/100n));
  result.enabled=product.enabled!==false&&!adminSite(s).packPurchasesPaused&&!adminLine(s,product.lineId).salesPaused;
  result.adminRevision=adminRevision(s);
  for(const slot of result.slots){
    slot.pool=slot.pool.map(entry=>({...entry,weight:entry.weight*(settings.rarityWeights?.[s.catalog.variants.find(v=>v.id===entry.variantId)?.rarityId]??1)})).filter(entry=>entry.weight>0);
    check(slot.pool.length>0&&slot.pool.reduce((sum,x)=>sum+x.weight,0)<=2147483647,'INVALID_INPUT','Rarity weights must leave each slot with positive, bounded total weight');
  }
  if(result.pity){const rank=s.catalog.rarities.find(r=>r.id===result.pity.rarityId).rank;const slot=result.slots.find(x=>(x.role??'card')==='card');check(slot.pool.some(e=>s.catalog.rarities.find(r=>r.id===s.catalog.variants.find(v=>v.id===e.variantId).rarityId).rank>=rank),'INVALID_INPUT','Keep at least one outcome eligible for the pack guarantee');}
  return result;
}
export function adminTransferReason(s,userId,toUserId,channel='trade'){
  const from=adminRestrictions(s,userId),to=adminRestrictions(s,toUserId);
  if(channel==='sale'){
    if(from.sellingBlocked)return 'This account cannot sell';
    if(to.buyingBlocked)return 'This account cannot buy';
  }else{
    if(adminSite(s).tradingPaused)return 'Direct trading is paused';
    if(from.tradingBlocked||to.tradingBlocked)return 'Trading is blocked for this account';
  }
  return null;
}
export function assertAdminPurchase(s,userId,product){
  check(!adminRestrictions(s,userId).buyingBlocked,'ACCOUNT_RESTRICTED','This account cannot buy',403);
  check(!adminSite(s).packPurchasesPaused,'ADMIN_PAUSED','Pack purchases are paused',409);
  check(!adminLine(s,product.lineId).salesPaused,'ADMIN_PAUSED','Sales for this card line are paused',409);
}
export function assertAdminShop(s,shop,userId=null,listing=null){
  const site=adminSite(s);
  if(userId)check(!adminRestrictions(s,userId).buyingBlocked,'ACCOUNT_RESTRICTED','This account cannot buy',403);
  check(!adminRestrictions(s,shop.ownerId).sellingBlocked,'ACCOUNT_RESTRICTED','This seller cannot sell',403);
  if(shop.kind==='player')check(!site.playerShopsPaused,'ADMIN_PAUSED','User shops are paused',409);
  for(const unit of listing?.units??[]){
    if(unit.status!=='available')continue;
    const item=unit.kind==='copy'?s.copies[unit.copyId]:unit.kind==='pack'?s.packs[unit.packId]:null;
    if(unit.kind==='pack')check(!site.packPurchasesPaused,'ADMIN_PAUSED','Pack purchases are paused',409);
    if(item)check(!adminLine(s,item.lineId).salesPaused,'ADMIN_PAUSED','Sales for this card line are paused',409);
  }
}
function object(input,keys){
  const value=safeData(input,{maxBytes:32000,maxNodes:2000});
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0&&Object.keys(value).every(k=>keys.includes(k)),'INVALID_INPUT','Choose supported settings');return value;
}
function userSummary(s,user){return {id:user.id,name:user.displayName,displayName:user.displayName,createdAt:user.createdAt,restrictions:adminRestrictions(s,user.id),cardCount:Object.values(s.copies).filter(c=>c.ownerId===user.id&&c.state==='owned').length,packCount:Object.values(s.packs).filter(p=>p.ownerId===user.id&&!p.openedAt).length};}
function copySummary(copy){
  const blockedReason=copy.state!=='owned'?'Open this pack before removing cards':copy.lockedBy?'Cancel the reservation first':copy.codeIds?.length||Object.keys(copy.bindings??{}).length||copy.actionJobIds?.length||copy.variant.onOpen?.length?'Codes, bindings and opening actions require a dedicated revocation workflow':null;
  return {id:copy.id,copyId:copy.id,name:copy.definition.name,cardId:copy.cardId,variantId:copy.variantId,lineId:copy.lineId,rarityId:copy.rarityId,state:copy.state,createdAt:copy.createdAt,version:copy.version,serialNumber:copy.serialNumber,locked:!!copy.lockedBy,removable:!blockedReason,canRemove:!blockedReason,blockedReason};
}
function initialize(s){return s.adminControls??={revision:0,site:{...adminSiteDefaults},lines:{},products:{},users:{},history:[]};}
export function invalidateAdminReview(s){initialize(s).revision++;}
function receipt(s,actor,scope,targetId,reason,before,after,now){
  const control=initialize(s),change={id:randomUUID(),at:now,createdAt:now,actorId:actor.userId??actor.id??'operator',scope,targetId:targetId??null,reason,before:structuredClone(before),after:structuredClone(after)};
  control.revision++;control.history.push(change);return {revision:control.revision,change};
}
export class AdminService{
  #b;
  constructor(bridge){this.#b=bridge;}
  overview(actor){
    permission(actor,'admin.read');
    return this.#b.read(s=>{
      const c=s.catalog;check(c,'NO_CATALOG','Publish a catalog first',409);
      const site=adminSite(s),commerce=s.commerceSettings?.settings??commerceDefaults;
      return {revision:adminRevision(s),permissions:{read:hasPermission(actor,'admin.read'),manage:hasPermission(actor,'admin.manage'),cards:hasPermission(actor,'admin.cards')},site,baseFeatures:structuredClone(c.features),effective:{directTrading:!site.tradingPaused&&(s.tradingPolicy?.policy.enabled??true)&&(c.features.cardTrading||c.features.currencyTrading),playerShops:!site.playerShopsPaused&&(site.playerShopsEnabled??commerce.playerShops)&&commerce.enabled,commerceEnabled:commerce.enabled,tradingPolicyEnabled:s.tradingPolicy?.policy.enabled??true},lines:c.lines.map(line=>({...line,...adminLine(s,line.id),products:c.products.filter(p=>p.lineId===line.id).map(product=>{
        const effective=effectiveProduct(s,product),settings=productSettings(s,product.id);
        const slotOdds=effective.slots.map((slot,index)=>{const weights={};for(const e of slot.pool){const rarity=c.variants.find(v=>v.id===e.variantId).rarityId;weights[rarity]=(weights[rarity]??0)+e.weight;}const total=Object.values(weights).reduce((a,b)=>a+b,0);return {slotId:slot.id??'slot-'+index,count:slot.count,rarities:Object.entries(weights).map(([rarityId,weight])=>({rarityId,weight,percent:weight/total*100}))};});
        return {...effective,...settings,basePrice:structuredClone(product.price),baseSlots:structuredClone(product.slots),catalogEnabled:product.enabled!==false,slotOdds};
      })})),variants:c.variants.map(v=>({id:v.id,cardId:v.cardId,name:c.cards.find(card=>card.id===v.cardId).name,lineId:c.cards.find(card=>card.id===v.cardId).lineId,rarityId:v.rarityId,enabled:v.enabled!==false,remaining:v.supplyLimit===undefined?null:Math.max(0,v.supplyLimit-(s.supply[v.id]??0))})),rarities:c.rarities,currencies:c.currencies,counts:{users:Object.keys(s.users).length,cards:Object.values(s.copies).filter(x=>x.state==='owned').length,packs:Object.values(s.packs).filter(x=>!x.openedAt).length,activeTrades:Object.values(s.trades).filter(x=>x.status==='pending').length,activeListings:Object.values(s.listings??{}).filter(x=>x.status==='active').length}};
    });
  }
  users(actor,options={}){permission(actor,'admin.read');return this.#b.read(s=>page(Object.values(s.users).map(u=>userSummary(s,u)),{...options,sort:'name'}));}
  user(actor,{userId,...options}){
    permission(actor,'admin.read');return this.#b.read(s=>{const user=record(s.users,userId);check(user,'NOT_FOUND','Account not found',404);return {revision:adminRevision(s),user:userSummary(s,user),inventory:page(Object.values(s.copies).filter(c=>c.ownerId===userId&&c.state!=='consumed').map(copySummary),options)};});
  }
  history(actor,options={}){permission(actor,'admin.read');return this.#b.read(s=>page((s.adminControls?.history??[]).map(change=>({...change,actorName:s.users[change.actorId]?.displayName??'Administrator',targetName:change.scope==='site'?'Website':['user','cards'].includes(change.scope)?s.users[change.targetId]?.displayName??'Account':s.catalog?.[change.scope==='line'?'lines':'products']?.find(x=>x.id===change.targetId)?.name??'Catalog item'})),options));}
  configure(actor,{key,expectedRevision,reason,scope,targetId,changes}){
    text(reason,'change reason',500);check(reason.trim().length>0,'INVALID_INPUT','A reason is required');integer(expectedRevision,'expected revision',0);
    check(['site','line','product','user'].includes(scope),'INVALID_INPUT','Unknown admin scope');
    if(scope!=='site')text(targetId,'target ID',100);
    const keys=scope==='site'?Object.keys(adminSiteDefaults):scope==='line'?['salesPaused']:scope==='user'?Object.keys(adminUserDefaults):Object.keys(productDefaults);
    const clean=object(changes,keys);
    if(scope!=='product')for(const [name,value]of Object.entries(clean))check(typeof value==='boolean'||scope==='site'&&name==='playerShopsEnabled'&&value===null,'INVALID_INPUT','Controls must be true or false');
    else{
      if(clean.priceAmount!==undefined&&clean.priceAmount!==null)integer(clean.priceAmount,'pack price',1,1000000000);
      if(clean.discountPercent!==undefined)integer(clean.discountPercent,'discount percentage',0,99);
      if(clean.rarityWeights!==undefined&&clean.rarityWeights!==null){const weights=object(clean.rarityWeights,Object.keys(clean.rarityWeights));check(Object.keys(weights).length<=100,'INVALID_INPUT','At most 100 rarity multipliers');for(const value of Object.values(weights))integer(value,'rarity multiplier',0,1000);}
    }
    return this.#b.operate(actor,key,'admin.manage','admin.configured',{expectedRevision,reason,scope,targetId,changes:clean},s=>{
      check(adminRevision(s)===expectedRevision,'ADMIN_CHANGED','Settings changed; reload before saving',409);
      const control=initialize(s);let before,after;
      if(scope==='site'){before=adminSite(s);after={...before,...clean};control.site=after;}
      if(scope==='line'){check(s.catalog.lines.some(x=>x.id===targetId),'NOT_FOUND','Card line not found',404);before=adminLine(s,targetId);after={...before,...clean};control.lines[targetId]=after;}
      if(scope==='user'){check(record(s.users,targetId),'NOT_FOUND','Account not found',404);before=adminRestrictions(s,targetId);after={...before,...clean};control.users[targetId]=after;}
      if(scope==='product'){
        const product=s.catalog.products.find(x=>x.id===targetId);check(product,'NOT_FOUND','Pack product not found',404);
        for(const rarityId of Object.keys(clean.rarityWeights??{}))check(s.catalog.rarities.some(x=>x.id===rarityId),'INVALID_INPUT','Unknown rarity');
        before=productSettings(s,targetId);after={...before,...clean};control.products[targetId]=after;effectiveProduct(s,product);
      }
      return receipt(s,actor,scope,targetId,reason,before,after,this.#b.now());
    });
  }
  cards(actor,{key,expectedRevision,reason,userId,action,variantId,quantity=1,copyIds=[]}){
    text(reason,'change reason',500);check(reason.trim().length>0,'INVALID_INPUT','A reason is required');text(userId,'account ID',100);integer(expectedRevision,'expected revision',0);
    check(['give','remove'].includes(action),'INVALID_INPUT','Choose give or remove');
    if(action==='give'){text(variantId,'variant ID',100);integer(quantity,'card quantity',1,100);}
    else check(Array.isArray(copyIds)&&copyIds.length>0&&copyIds.length<=100&&new Set(copyIds).size===copyIds.length&&copyIds.every(x=>typeof x==='string'),'INVALID_INPUT','Choose 1 to 100 different cards');
    return this.#b.operate(actor,key,'admin.cards','admin.cards.'+action,{expectedRevision,reason,userId,action,variantId,quantity,copyIds},s=>{
      check(adminRevision(s)===expectedRevision,'ADMIN_CHANGED','Settings changed; reload before saving',409);
      check(record(s.users,userId),'NOT_FOUND','Account not found',404);const cards=[];
      if(action==='give'){
        const variant=s.catalog.variants.find(x=>x.id===variantId);check(variant&&variant.enabled!==false,'UNAVAILABLE','Card variant is unavailable',409);
        for(let i=0;i<quantity;i++){const copy=this.#b.mint(s,userId,variantId,{type:'admin-grant'});this.#b.open(s,copy,userId);cards.push(copySummary(copy));}
      }else{
        const copies=copyIds.map(copyId=>{const copy=record(s.copies,copyId);check(copy?.ownerId===userId&&copy.state==='owned','NOT_OWNED','Only opened owned cards can be removed',409);check(!copy.lockedBy,'CARD_LOCKED','Cancel the reservation before removing this card',409);check(!(copy.codeIds?.length)&&Object.keys(copy.bindings??{}).length===0&&!(copy.actionJobIds?.length)&&!(copy.variant.onOpen?.length),'ATTACHED_ENTITLEMENT','Cards with codes, bindings or opening actions require their dedicated revocation workflow',409);return copy;});
        for(const copy of copies){copy.state='consumed';copy.version++;copy.metadata.revocation={at:this.#b.now()};cards.push(copySummary(copy));}
        this.#b.removePlacements(s,new Set(copyIds));
      }
      const result=receipt(s,actor,'cards',userId,reason,{action,quantity:action==='give'?quantity:copyIds.length},{action,copyIds:cards.map(c=>c.id),variantId:variantId??null},this.#b.now());
      return {...result,cards};
    });
  }
}
