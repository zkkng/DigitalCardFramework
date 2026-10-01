import {hasPermission} from './access.js';
import {randomInt, randomUUID, createHash} from 'node:crypto';
import {check, integer, text, jsonObject, validateCatalog} from './catalog.js';
import {MemoryStore} from './store.js';
import {prepareImport,contentDigest} from './importer.js';
import {page} from './data.js';
import {auditState} from './audit.js';

const clone = value => structuredClone(value);
const id = () => randomUUID();
const lookup = (list,key) => list.find(x=>x.id===key);
const nowISO = () => new Date().toISOString();
function fingerprint(value) {
  const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x==='object'
    ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export class CardFramework {
  #store; #clock; #random; #bindings; #policies; #limits;
  constructor({store=new MemoryStore(), clock=nowISO, random=randomInt, bindings={}, policies={},limits={}}={}) {
    this.#store=store; this.#clock=clock; this.#random=random;
    const allowedLimits=['users','copies','packs','requests','albums','trades','copiesPerUser','packsPerUser'];
    check(limits&&typeof limits==='object'&&!Array.isArray(limits),'INVALID_INPUT','Limits must be an object');
    for(const [name,value]of Object.entries(limits)){check(allowedLimits.includes(name),'INVALID_INPUT','Unknown installation limit '+name);integer(value,'Installation limit '+name,1,10000000);}
    this.#bindings=bindings; this.#policies=policies;this.#limits={...limits};
  }
  close() { this.#store.close(); }
  audit(actor){this.#admin(actor,'audit.read');return this.#store.read(auditState);}
  #admin(actor,permission) { check(hasPermission(actor,permission),'FORBIDDEN','Operator authority required: '+permission,403); }
  #user(s,actor) {
    check(actor?.disabled!==true && actor?.userId && s.users[actor.userId],'UNAUTHENTICATED','A verified framework user is required',401);
    return s.users[actor.userId];
  }
  #catalog(s) {check(s.catalog,'NO_CATALOG','Publish a catalog first',409); return s.catalog;}
  #feature(s,name) {check(this.#catalog(s).features[name],'FEATURE_DISABLED',name+' is disabled',403);}
  #event(s,type,data) {s.events.push({id:id(),sequence:s.events.length+1,type,data,at:this.#clock()});}
  #notify(s,userId,type,data){s.notifications??=[];s.notifications.push({id:id(),userId,type,data,at:this.#clock(),read:false});const own=s.notifications.filter(n=>n.userId===userId);if(own.length>2000){const remove=new Set(own.slice(0,own.length-2000).map(n=>n.id));s.notifications=s.notifications.filter(n=>!remove.has(n.id));}}
  #preferences(user){return {inventoryVisibility:'traders',favoriteCopyIds:[],wishlistCardIds:[],blockedUserIds:[],...user.preferences};}
  me(actor){return this.#store.read(s=>{const u=this.#user(s,actor);return {userId:u.id,displayName:u.displayName,preferences:this.#preferences(u)};});}
  setPreferences(actor,{key,inventoryVisibility,favoriteCopyIds,wishlistCardIds,blockedUserIds}){
    return this.#command(actor,key,'preferences.updated',{inventoryVisibility,favoriteCopyIds,wishlistCardIds,blockedUserIds},(s,u)=>{
      const next=this.#preferences(u);
      if(inventoryVisibility!==undefined){check(['private','traders','public'].includes(inventoryVisibility),'INVALID_INPUT','Invalid inventory visibility');next.inventoryVisibility=inventoryVisibility;}
      for(const [field,value]of Object.entries({favoriteCopyIds,wishlistCardIds,blockedUserIds}))if(value!==undefined){check(Array.isArray(value)&&value.length<=1000&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'),'INVALID_INPUT','Invalid '+field);for(const id of value){if(field==='favoriteCopyIds')check(s.copies[id]?.ownerId===u.id&&s.copies[id]?.state==='owned','NOT_OWNED','Favorite must be owned',403);if(field==='wishlistCardIds')check(lookup(this.#catalog(s).cards,id),'INVALID_INPUT','Wishlist card not found');if(field==='blockedUserIds')check(s.users[id]&&id!==u.id,'INVALID_INPUT','Block requires another user');}next[field]=value;}
      u.preferences=next;return next;
    });
  }
  #blocked(s,a,b){return this.#preferences(s.users[a]).blockedUserIds.includes(b)||this.#preferences(s.users[b]).blockedUserIds.includes(a);}
  directory(actor,options={}){return this.#store.read(s=>{const viewer=this.#user(s,actor);return page(Object.values(s.users).filter(u=>u.id!==viewer.id&&!this.#blocked(s,viewer.id,u.id)).map(u=>({id:u.id,name:u.displayName,createdAt:u.createdAt,inventoryVisible:this.#catalog(s).features.inventoryBrowsing&&this.#preferences(u).inventoryVisibility!=='private'})),{...options,sort:'name'});});}
  #tradeReason(copy,userId){if(copy.lockedBy)return 'Reserved in another offer';if(Object.values(copy.bindings).some(b=>b.transfer==='block'))return 'Attached data blocks transfer';if(this.#policies.canTransfer&&this.#policies.canTransfer(clone(copy),userId)!==true)return 'Host policy blocks transfer';return null;}
  tradeInventory(actor,userId,options={}){return this.#store.read(s=>{
    const viewer=this.#user(s,actor),owner=s.users[userId];check(owner,'NOT_FOUND','Inventory not available',404);
    if(owner.id!==viewer.id){this.#feature(s,'inventoryBrowsing');check(!this.#blocked(s,viewer.id,owner.id)&&this.#preferences(owner).inventoryVisibility!=='private','NOT_FOUND','Inventory not available',404);if(this.#preferences(owner).inventoryVisibility==='traders')this.#feature(s,'cardTrading');}
    const cards=Object.values(s.copies).filter(c=>c.ownerId===owner.id&&c.state==='owned').map(c=>{const reason=this.#tradeReason(c,owner.id);return {...this.#copyView(s,c,viewer.id),tradable:!reason,untradableReason:reason};});
    return {owner:{id:owner.id,name:owner.displayName},...page(cards,options)};
  });}
  inventoryPage(actor,options={}){return page(this.inventory(actor),options);}
  notifications(actor,options={}){return this.#store.read(s=>{const u=this.#user(s,actor);return page((s.notifications??[]).filter(n=>n.userId===u.id),options);});}
  readNotifications(actor,{key,ids}){check(Array.isArray(ids)&&ids.length<=200,'INVALID_INPUT','Select at most 200 notifications');return this.#command(actor,key,'notifications.read',{ids},(s,u)=>{for(const n of s.notifications??[])if(n.userId===u.id&&ids.includes(n.id))n.read=true;return {ok:true};});}
  #command(actor,key,type,input,fn) {
    text(key,'idempotency key',128);
    return this.#store.transact(s=>{
      const user=this.#user(s,actor), token=user.id+':'+key, hash=fingerprint({type,input});
      const previous=s.requests[token];
      if (previous) {check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409); return previous.result;}
      const result=fn(s,user);
      for(const field of ['copies','packs','requests','albums','trades'])if(this.#limits[field]!==undefined)
        check(field==='requests'?Object.keys(s.requests).length+Object.keys(s.operatorRequests??{}).length+Object.keys(s.externalSettlements??{}).length<this.#limits.requests:Object.keys(s[field]).length<=this.#limits[field],'INSTALLATION_CAPACITY','Installation '+field+' capacity reached',507);
      if(this.#limits.copiesPerUser!==undefined){const counts={};for(const c of Object.values(s.copies))if(c.state!=='consumed')counts[c.ownerId]=(counts[c.ownerId]??0)+1;for(const count of Object.values(counts))check(count<=this.#limits.copiesPerUser,'INVENTORY_CAPACITY','Collector inventory capacity reached',507);}
      if(this.#limits.packsPerUser!==undefined)check(Object.values(s.packs).filter(p=>p.ownerId===user.id).length<=this.#limits.packsPerUser,'PACK_CAPACITY','Collector pack capacity reached',507);
      s.requests[token]={hash,result:clone(result)};
      this.#event(s,type,{userId:user.id});
      return result;
    });
  }
  #validateRevision(catalog,previous) {
      if (previous) {
        check(catalog.version>previous.version,'CATALOG_CONFLICT','Catalog version must increase',409);
        // Published IDs retain identity; retirement uses enabled:false. Old owned copies use snapshots.
        for (const section of ['currencies','lines','rarities','cards','variants','products','recipes']) {
          for (const old of previous[section]) {
            const next=lookup(catalog[section],old.id);
            check(next,'CATALOG_CONFLICT','Retain published '+section+' id '+old.id,409);
            if (section==='variants') check(next.cardId===old.cardId && next.rarityId===old.rarityId && next.supplyLimit===old.supplyLimit,'CATALOG_CONFLICT','Variant identity/edition limits are immutable',409);
            if (section==='cards') check(next.lineId===old.lineId,'CATALOG_CONFLICT','Card line identity is immutable',409);
            if (section==='products' && fingerprint(next)!==fingerprint(old)) check(next.revision>old.revision,'CATALOG_CONFLICT','Changed product needs a higher revision',409);
          }
        }
      }
  }
  publishCatalog(actor,manifest) {
    this.#admin(actor,'catalog.publish'); const catalog=validateCatalog(manifest);
    return this.#store.transact(s=>{
      this.#validateRevision(catalog,s.catalog);
      s.catalog=catalog; this.#event(s,'catalog.published',{version:catalog.version});
      return this.#publicCatalog(catalog);
    });
  }
  operatorCatalog(actor){this.#admin(actor,'catalog.read');return this.#store.read(s=>this.#catalog(s));}
  previewImport(actor,input){this.#admin(actor,'catalog.preview');return this.#store.read(s=>{const preview=prepareImport({...input,base:s.catalog});this.#validateRevision(preview.manifest,s.catalog);return preview;});}
  commitImport(actor,{key,manifest,digest,expectedVersion}) {
    this.#admin(actor,'catalog.publish');text(key,'import key',128);
    return this.#store.transact(s=>{
      s.operatorRequests??={};const token=(actor.userId??'operator')+':'+key,inputHash=contentDigest({manifest,digest,expectedVersion});
      if(s.operatorRequests[token]){check(s.operatorRequests[token].hash===inputHash,'IDEMPOTENCY_CONFLICT','Import key already used',409);return s.operatorRequests[token].result;}
      if(this.#limits.requests!==undefined)check(Object.keys(s.requests).length+Object.keys(s.operatorRequests).length+Object.keys(s.externalSettlements??{}).length<this.#limits.requests,'INSTALLATION_CAPACITY','Installation requests capacity reached',507);
      check((s.catalog?.version??0)===expectedVersion,'STALE_IMPORT','Catalog changed; preview again',409);
      const catalog=validateCatalog(manifest);check(contentDigest(catalog)===digest,'IMPORT_CHANGED','Preview differs from the submitted catalog',409);
      this.#validateRevision(catalog,s.catalog);s.catalog=catalog;
      this.#event(s,'catalog.imported',{version:catalog.version,userId:actor.userId??null,digest});
      const result={version:catalog.version,digest,importedAt:this.#clock()};s.operatorRequests[token]={hash:inputHash,result};return result;
    });
  }
  #publicCatalog(c) {
    const result=clone(c);
    for (const v of result.variants) for (const [name,b] of Object.entries(v.bindings)) {
      if (b.visibility==='owner') {delete b.data; delete b.factory;}
    }
    return result;
  }
  catalog() {return this.#store.read(s=>this.#publicCatalog(this.#catalog(s)));}
  registerUser(actor,{provider,subject,displayName}) {
    this.#admin(actor,'accounts.register'); text(provider,'identity provider',2048); text(subject,'identity subject',300); text(displayName,'display name',100);
    return this.#store.transact(s=>{
      const existing=Object.values(s.users).find(u=>u.provider===provider && u.subject===subject);
      if (existing) {existing.displayName=displayName; return existing;}
      if(this.#limits.users!==undefined)check(Object.keys(s.users).length<this.#limits.users,'INSTALLATION_CAPACITY','Installation user capacity reached',507);
      const user={id:id(),provider,subject,displayName,createdAt:this.#clock()};
      s.users[user.id]=user; s.balances[user.id]={};
      this.#event(s,'user.registered',{userId:user.id});
      return user;
    });
  }
  grantCurrency(actor,{userId,currencyId,amount,reason,key}) {
    this.#admin(actor,'currency.grant'); integer(amount,'grant amount'); text(reason,'grant reason');
    return this.#command({userId},key,'currency.granted',{currencyId,amount,reason},s=>{
      this.#currency(s,currencyId); this.#adjust(s,userId,currencyId,amount,'grant',reason);
      return {userId,currencyId,amount,balance:s.balances[userId][currencyId]};
    });
  }
  settleExternalCredit(actor, input) {
    this.#admin(actor, 'currency.settle');
    const {providerId,transactionId,userId,currencyId,amount,externalCurrency,externalUnits}=input;
    for(const [name,value] of Object.entries({providerId,transactionId,userId,currencyId,externalCurrency,externalUnits})) text(value,name,300);
    integer(amount,'external credit amount',1,Number.MAX_SAFE_INTEGER);
    check(/^[1-9][0-9]{0,39}$/.test(externalUnits),'INVALID_INPUT','Invalid external units');
    const token=fingerprint({providerId,transactionId}), hash=fingerprint({userId,currencyId,amount,externalCurrency,externalUnits});
    return this.#store.transact(s=>{
      this.#user(s,{userId});this.#currency(s,currencyId);s.externalSettlements??={};
      const old=s.externalSettlements[token];
      if(old){check(old.hash===hash,'SETTLEMENT_CONFLICT','External transaction already credited with different terms',409);return old.result;}
      if(this.#limits.requests!==undefined)check(Object.keys(s.requests).length+Object.keys(s.operatorRequests??{}).length+Object.keys(s.externalSettlements).length<this.#limits.requests,'INSTALLATION_CAPACITY','Settlement capacity reached',507);
      this.#adjust(s,userId,currencyId,amount,'external-credit',token);
      const result={providerId,transactionId,userId,currencyId,amount,balance:s.balances[userId][currencyId],at:this.#clock()};
      s.externalSettlements[token]={hash,result,externalCurrency,externalUnits};
      this.#event(s,'currency.external-settled',{providerId,transactionId,userId,currencyId,amount});
      return result;
    });
  }
  #currency(s,currencyId) {
    const currency=lookup(this.#catalog(s).currencies,currencyId);
    check(currency,'UNKNOWN_CURRENCY','Currency not found',404); return currency;
  }
  #adjust(s,userId,currencyId,delta,type,reference) {
    const old=s.balances[userId][currencyId]??0, next=old+delta;
    check(Number.isSafeInteger(next),'BALANCE_OVERFLOW','Balance exceeds integer range',409);
    check(next>=0,'INSUFFICIENT_FUNDS','Insufficient '+currencyId,409);
    s.balances[userId][currencyId]=next;
    s.ledger.push({id:id(),userId,currencyId,delta,balance:next,type,reference,at:this.#clock()});
  }
  wallet(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return clone(s.balances[u.id]);});}
  history(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return s.ledger.filter(e=>e.userId===u.id);});}
  #weighted(pool) {
    const sum=pool.reduce((n,x)=>n+x.weight,0), roll=this.#random(sum);
    check(Number.isInteger(roll) && roll>=0 && roll<sum,'INVALID_PROVIDER','Random provider returned invalid draw',500);
    let cursor=roll;
    for (const entry of pool) {cursor-=entry.weight; if(cursor<0) return entry.variantId;}
    throw new Error('Unreachable weighted draw');
  }
  #available(s,pool) {
    const c=this.#catalog(s);
    return pool.filter(e=>{
      const v=lookup(c.variants,e.variantId);
      return v.enabled!==false && (v.supplyLimit===undefined || (s.supply[v.id]??0)<v.supplyLimit);
    });
  }
  #mint(s,ownerId,variantId,source,state='owned') {
    const c=this.#catalog(s), variant=lookup(c.variants,variantId), card=lookup(c.cards,variant.cardId);
    const issued=(s.supply[variant.id]??0)+1;
    check(variant.supplyLimit===undefined || issued<=variant.supplyLimit,'SOLD_OUT','Edition exhausted',409);
    s.supply[variant.id]=issued;
    const copy={id:id(),ownerId,cardId:card.id,variantId,lineId:card.lineId,rarityId:variant.rarityId,
      state,serialNumber:variant.supplyLimit===undefined?null:issued,editionTotal:variant.supplyLimit??null,
      createdAt:this.#clock(),openedAt:null,openedBy:null,acquiredAt:this.#clock(),source,version:1,
      definition:clone(card),variant:clone({...variant,bindings:undefined}),bindings:{},metadata:{}};
    for (const [name,spec] of Object.entries(variant.bindings)) {
      const factory=spec.factory && Object.hasOwn(this.#bindings,spec.factory) && this.#bindings[spec.factory];
      check(!spec.factory || factory,'MISSING_PROVIDER','Binding factory unavailable: '+spec.factory,409);
      const data=factory ? factory({copy:clone(copy),user:clone(s.users[ownerId]),spec:clone(spec)}) : spec.data;
      check(!data?.then,'INVALID_PROVIDER','Binding factories must be synchronous',500);
      copy.bindings[name]={visibility:spec.visibility,transfer:spec.transfer,holderId:ownerId,state:'active',data:jsonObject(data)};
    }
    s.copies[copy.id]=copy; return copy;
  }
  quote(actor,{productId,quantity=1}) {
    integer(quantity,'quantity',1,100);
    return this.#store.read(s=>{
      this.#user(s,actor); const c=this.#catalog(s), product=lookup(c.products,productId);
      check(product && product.enabled!==false,'UNAVAILABLE','Pack product unavailable',404);
      this.#productTime(product);
      check(quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
      const total=product.price.amount*quantity; integer(total,'total price');
      return {productId,quantity,productRevision:product.revision,catalogVersion:c.version,price:{currencyId:product.price.currencyId,amount:total}};
    });
  }
  #productTime(product){const time=Date.parse(this.#clock());check(!product.availableFrom||time>=Date.parse(product.availableFrom),'NOT_RELEASED','This pack is not available yet',409);check(!product.availableUntil||time<Date.parse(product.availableUntil),'PRODUCT_ENDED','This pack is no longer available',409);}
  availability(){return this.#store.read(s=>{const c=this.#catalog(s);return {version:c.version,variants:c.variants.map(v=>({id:v.id,issued:s.supply[v.id]??0,remaining:v.supplyLimit===undefined?null:Math.max(0,v.supplyLimit-(s.supply[v.id]??0))})),products:c.products.map(p=>({id:p.id,available:p.enabled!==false&&(!p.availableFrom||Date.parse(this.#clock())>=Date.parse(p.availableFrom))&&(!p.availableUntil||Date.parse(this.#clock())<Date.parse(p.availableUntil)),pity:p.pity??null}))};});}
  pityProgress(actor){return this.#store.read(s=>{const u=this.#user(s,actor);return s.pity?.[u.id]??{};});}
  purchase(actor,{key,productId,quantity=1,productRevision,catalogVersion}) {
    integer(quantity,'quantity',1,100);
    return this.#command(actor,key,'packs.purchased',{productId,quantity,productRevision,catalogVersion},(s,user)=>{
      const c=this.#catalog(s), product=lookup(c.products,productId);
      check(product && product.enabled!==false,'UNAVAILABLE','Pack product unavailable',404);
      this.#productTime(product);
      check(product.revision===productRevision && c.version===catalogVersion,'STALE_QUOTE','Get a fresh quote before buying',409);
      check(quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
      const total=product.price.amount*quantity; integer(total,'total price');
      const purchaseId=id(); this.#adjust(s,user.id,product.price.currencyId,-total,'purchase',purchaseId);
      const packs=[];
      s.pity??={};s.pity[user.id]??={};
      for (let n=0;n<quantity;n++) {
        const pack={id:id(),ownerId:user.id,productId,productRevision,lineId:product.lineId,catalogVersion:c.version,
          product:clone(product),createdAt:this.#clock(),openedAt:null,copyIds:[],receipt:null};
        const excluded=new Set();
        if(product.duplicatePolicy.scope==='inventory') for(const copy of Object.values(s.copies))
          if(copy.ownerId===user.id && ['owned','sealed'].includes(copy.state)) excluded.add(copy.cardId);
        let qualified=false;const pityDue=product.pity&&(s.pity[user.id][product.id]??0)>=product.pity.after-1;
        for(const [slotIndex,slot]of product.slots.entries()) for(let i=0;i<slot.count;i++) {
          let available=this.#available(s,slot.pool);
          if(pityDue&&slotIndex===0&&i===0)available=available.filter(e=>lookup(c.rarities,lookup(c.variants,e.variantId).rarityId).rank>=lookup(c.rarities,product.pity.rarityId).rank);
          let pool=available;
          if(product.duplicatePolicy.scope!=='none') pool=pool.filter(e=>!excluded.has(lookup(c.variants,e.variantId).cardId));
          if(!pool.length && product.duplicatePolicy.fallback==='allow') pool=available;
          check(pool.length,'POOL_EXHAUSTED','No eligible card remains in this pack slot',409);
          const copy=this.#mint(s,user.id,this.#weighted(pool),{type:'pack',packId:pack.id,purchaseId},'sealed');
          if(product.pity&&lookup(c.rarities,copy.rarityId).rank>=lookup(c.rarities,product.pity.rarityId).rank)qualified=true;
          pack.copyIds.push(copy.id); excluded.add(copy.cardId);
        }
        if(product.pity)s.pity[user.id][product.id]=qualified?0:(s.pity[user.id][product.id]??0)+1;
        s.packs[pack.id]=pack; packs.push(this.#packView(pack));
      }
      return {id:purchaseId,packs,paid:{currencyId:product.price.currencyId,amount:total}};
    });
  }
  #packView(pack) {const {copyIds,receipt,...view}=clone(pack); return {...view,cardCount:copyIds.length};}
  packs(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.packs).filter(p=>p.ownerId===u.id).map(p=>this.#packView(p));});}
  #copyView(s,copy,viewerId) {
    const result=clone(copy); result.openedByName=copy.openedBy ? s.users[copy.openedBy]?.displayName??null:null;
    result.bindings=Object.fromEntries(Object.entries(result.bindings).filter(([,b])=>b.visibility==='public' || b.holderId===viewerId));
    return result;
  }
  openPack(actor,{key,packId}) {
    return this.#command(actor,key,'pack.opened',{packId},(s,user)=>{
      const pack=s.packs[packId]; check(pack && pack.ownerId===user.id,'NOT_FOUND','Pack not found',404);
      if(pack.receipt) return pack.receipt;
      const seen=new Set(Object.values(s.copies).filter(x=>x.ownerId===user.id && x.state==='owned').map(x=>x.cardId));
      const openedAt=this.#clock(), cards=[];
      for(const copyId of pack.copyIds) {
        const copy=s.copies[copyId]; copy.state='owned'; copy.openedAt=openedAt; copy.openedBy=user.id; copy.version++;
        cards.push({...this.#copyView(s,copy,user.id),isNew:!seen.has(copy.cardId)}); seen.add(copy.cardId);
      }
      pack.openedAt=openedAt; pack.receipt={id:pack.id,openedAt,cards};
      this.#notify(s,user.id,'pack.opened',{packId:pack.id,count:cards.length});
      return pack.receipt;
    });
  }
  inventory(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.copies).filter(x=>x.ownerId===u.id && x.state==='owned').map(x=>{const reason=this.#tradeReason(x,u.id);return {...this.#copyView(s,x,u.id),tradable:!reason,untradableReason:reason};});});}
  inspectCard(actor,copyId) {
    return this.#store.read(s=>{
      const user=this.#user(s,actor), copy=s.copies[copyId];
      check(copy && copy.ownerId===user.id && copy.state==='owned','NOT_FOUND','Owned card not found',404);
      return this.#copyView(s,copy,user.id);
    });
  }
  consumeBinding(actor,{key,copyId,namespace}) {
    return this.#command(actor,key,'binding.used',{copyId,namespace},(s,user)=>{
      const copy=s.copies[copyId], binding=copy?.bindings[namespace];
      check(copy && copy.state==='owned' && binding && binding.holderId===user.id,'NOT_FOUND','Binding not found',404);
      check(!copy.lockedBy,'CARD_LOCKED','Cancel the trade before using this card',409);
      check(binding.state==='active','ALREADY_USED','Binding already used',409);
      binding.state='used'; binding.usedAt=this.#clock(); copy.version++;
      return {copyId,namespace,state:binding.state,usedAt:binding.usedAt};
    });
  }
  convert(actor,{key,from,to,amount,rounding='exact',catalogVersion}) {
    integer(amount,'conversion amount'); check(from!==to,'INVALID_INPUT','Choose different currencies');
    check(['exact','floor'].includes(rounding),'INVALID_INPUT','Invalid conversion rounding');
    return this.#command(actor,key,'currency.converted',{from,to,amount,rounding,catalogVersion},(s,user)=>{
      this.#feature(s,'conversion');
      const c=this.#catalog(s); check(c.version===catalogVersion,'STALE_QUOTE','Conversion values changed; refresh',409);
      const a=this.#currency(s,from), b=this.#currency(s,to);
      check(a.convertible!==false && b.convertible!==false,'CONVERSION_DISABLED','Currency conversion disabled',403);
      const numerator=BigInt(amount)*BigInt(a.value.numerator)*BigInt(b.value.denominator);
      const denominator=BigInt(a.value.denominator)*BigInt(b.value.numerator);
      const remainder=numerator%denominator, output=Number(numerator/denominator);
      check(rounding==='floor' || remainder===0n,'INEXACT_CONVERSION','Amount cannot convert exactly; choose floor explicitly',409);
      integer(output,'converted amount');
      const conversionId=id(); this.#adjust(s,user.id,from,-amount,'conversion',conversionId); this.#adjust(s,user.id,to,output,'conversion',conversionId);
      return {id:conversionId,from,to,amount,received:output,remainderNumerator:String(remainder),remainderDenominator:String(denominator)};
    });
  }
  tradeUp(actor,{key,recipeId,copyIds}) {
    check(Array.isArray(copyIds),'INVALID_INPUT','copyIds required');
    return this.#command(actor,key,'cards.tradedUp',{recipeId,copyIds},(s,user)=>{
      this.#feature(s,'tradeUps'); const recipe=lookup(this.#catalog(s).recipes,recipeId);
      check(recipe && recipe.enabled!==false,'NOT_FOUND','Recipe unavailable',404);
      check(copyIds.length===recipe.inputCount && new Set(copyIds).size===copyIds.length,'INVALID_INPUT','Select exactly '+recipe.inputCount+' distinct copies');
      const inputs=copyIds.map(copyId=>s.copies[copyId]);
      for (const copy of inputs) {
        check(copy && copy.ownerId===user.id && copy.state==='owned','NOT_OWNED','Trade-up input is not owned',403);
        check(!copy.lockedBy,'CARD_LOCKED','Card is reserved by a trade',409);
        check(copy.lineId===recipe.lineId && copy.rarityId===recipe.inputRarityId,'RECIPE_MISMATCH','Input does not match recipe');
        check(Object.keys(copy.bindings).length===0,'BOUND_CARD','Bound cards require a dedicated trade-up policy',409);
      }
      if(recipe.duplicatesOnly) check(new Set(inputs.map(x=>x.variantId)).size===1,'RECIPE_MISMATCH','Recipe requires copies of the same variant');
      const pool=this.#available(s,recipe.outputPool); check(pool.length,'POOL_EXHAUSTED','Recipe outputs exhausted',409);
      const output=this.#mint(s,user.id,this.#weighted(pool),{type:'tradeUp',recipeId,inputIds:copyIds});
      output.openedAt=this.#clock(); output.openedBy=user.id;
      for(const copy of inputs) {copy.state='consumed'; copy.version++;}
      this.#removePlacements(s,new Set(copyIds));
      return this.#copyView(s,output,user.id);
    });
  }
  #offer(s,userId,offer) {
    check(offer && Array.isArray(offer.copyIds) && Array.isArray(offer.currencies),'INVALID_INPUT','Trade offers need copyIds and currencies arrays');
    check(offer.copyIds.length<=100 && offer.currencies.length<=20,'INVALID_INPUT','Trade offer too large');
    check(new Set(offer.copyIds).size===offer.copyIds.length,'INVALID_INPUT','Duplicate copy in offer');
    if(offer.copyIds.length) this.#feature(s,'cardTrading');
    if(offer.currencies.length) this.#feature(s,'currencyTrading');
    for(const copyId of offer.copyIds) {
      const copy=s.copies[copyId]; check(copy && copy.ownerId===userId && copy.state==='owned','NOT_OWNED','Trade card not owned',403);
      check(!copy.lockedBy,'CARD_LOCKED','Trade card already reserved',409);
      check(!Object.values(copy.bindings).some(b=>b.transfer==='block'),'TRANSFER_BLOCKED','Card has a nontransferable binding',409);
      if(this.#policies.canTransfer) check(this.#policies.canTransfer(clone(copy),userId)===true,'TRANSFER_BLOCKED','Host transfer policy rejected card',409);
    }
    const seen=new Set();
    for(const money of offer.currencies) {
      integer(money.amount,'trade currency amount');
      check(!seen.has(money.currencyId),'INVALID_INPUT','Duplicate currency in offer'); seen.add(money.currencyId);
      check(this.#currency(s,money.currencyId).tradable===true,'TRANSFER_BLOCKED','Currency is not tradable',403);
      check((s.balances[userId][money.currencyId]??0)>=money.amount,'INSUFFICIENT_FUNDS','Insufficient trade currency',409);
    }
    return clone(offer);
  }
  #tradeDigest(trade){return contentDigest({id:trade.id,fromUserId:trade.fromUserId,toUserId:trade.toUserId,give:trade.give,receive:trade.receive,createdAt:trade.createdAt,expiresAt:trade.expiresAt,message:trade.message??'',snapshots:trade.snapshots??null});}
  #createTrade(s,user,{toUserId,give,receive,expiresInSeconds=86400,message='',versions={},parentTradeId=null}){
    integer(expiresInSeconds,'expiry seconds',1,604800);
    check(typeof message==='string'&&message.length<=500,'INVALID_INPUT','Trade message must be at most 500 characters');jsonObject(versions,'card versions');
      check(toUserId!==user.id && s.users[toUserId],'INVALID_INPUT','Choose another registered user');
      check(!this.#blocked(s,user.id,toUserId),'TRADE_BLOCKED','Trading between these accounts is blocked',403);
      if(receive?.copyIds?.length)check(this.#preferences(s.users[toUserId]).inventoryVisibility!=='private','INVENTORY_PRIVATE','Recipient inventory is private',403);
      const given=this.#offer(s,user.id,give), requested=this.#offer(s,toUserId,receive);
      check(given.copyIds.length+given.currencies.length+requested.copyIds.length+requested.currencies.length>0,'INVALID_INPUT','Empty trade');
      const ids=[...given.copyIds,...requested.copyIds];for(const copyId of ids)if(versions[copyId]!==undefined)check(s.copies[copyId].version===versions[copyId],'STALE_INVENTORY','A card changed; reload the inventories',409);
      const snapshots=Object.fromEntries(ids.map(copyId=>[copyId,this.#copyView(s,s.copies[copyId],null)]));
      const trade={id:id(),fromUserId:user.id,toUserId,give:given,receive:requested,status:'pending',createdAt:this.#clock(),
        expiresAt:new Date(Date.parse(this.#clock())+expiresInSeconds*1000).toISOString(),message,snapshots,parentTradeId};
      trade.digest=this.#tradeDigest(trade);
      s.trades[trade.id]=trade;
      for(const copyId of given.copyIds) s.copies[copyId].lockedBy=trade.id;
      for(const money of given.currencies) this.#adjust(s,user.id,money.currencyId,-money.amount,'trade.escrow',trade.id);
      this.#notify(s,toUserId,'trade.received',{tradeId:trade.id,fromName:user.displayName});
      return trade;
  }
  proposeTrade(actor,{key,toUserId,give,receive,expiresInSeconds=86400,message='',versions={}}) {
    return this.#command(actor,key,'trade.proposed',{toUserId,give,receive,expiresInSeconds,message,versions},(s,user)=>this.#createTrade(s,user,{toUserId,give,receive,expiresInSeconds,message,versions}));
  }
  counterTrade(actor,{key,tradeId,give,receive,message='',expiresInSeconds=86400,expectedDigest}){
    return this.#command(actor,key,'trade.countered',{tradeId,give,receive,message,expiresInSeconds,expectedDigest},(s,u)=>{
      const old=s.trades[tradeId];check(old&&old.toUserId===u.id,'NOT_FOUND','Trade not found',404);check(old.status==='pending'&&Date.parse(old.expiresAt)>Date.parse(this.#clock()),'TRADE_CLOSED','Offer is no longer active',409);
      if(expectedDigest!==undefined)check(expectedDigest===this.#tradeDigest(old),'TRADE_CHANGED','Review the current offer',409);
      this.#release(s,old,'countered');const counter=this.#createTrade(s,u,{toUserId:old.fromUserId,give,receive,message,expiresInSeconds,parentTradeId:old.id});old.counterTradeId=counter.id;return counter;
    });
  }
  #release(s,trade,status) {
    for(const copyId of trade.give.copyIds) delete s.copies[copyId].lockedBy;
    for(const money of trade.give.currencies) this.#adjust(s,trade.fromUserId,money.currencyId,money.amount,'trade.refund',trade.id);
    trade.status=status; trade.completedAt=this.#clock();
    this.#event(s,'trade.'+status,{tradeId:trade.id});
    this.#notify(s,trade.fromUserId,'trade.'+status,{tradeId:trade.id});this.#notify(s,trade.toUserId,'trade.'+status,{tradeId:trade.id});
  }
  #expire(s) {
    for(const trade of Object.values(s.trades)) if(trade.status==='pending' && Date.parse(trade.expiresAt)<=Date.parse(this.#clock())) this.#release(s,trade,'expired');
  }
  sweepExpiredTrades(actor) {this.#admin(actor,'maintenance.run');if(!this.#store.read(s=>Object.values(s.trades).some(t=>t.status==='pending'&&Date.parse(t.expiresAt)<=Date.parse(this.#clock()))))return {ok:true};return this.#store.transact(s=>{this.#expire(s); return {ok:true};});}
  trades(actor) {
    const current=this.#store.read(s=>{const u=this.#user(s,actor);return {expired:Object.values(s.trades).some(t=>t.status==='pending'&&Date.parse(t.expiresAt)<=Date.parse(this.#clock())),items:Object.values(s.trades).filter(t=>t.fromUserId===u.id||t.toUserId===u.id).map(t=>({...t,digest:this.#tradeDigest(t),fromName:s.users[t.fromUserId].displayName,toName:s.users[t.toUserId].displayName}))};});if(!current.expired)return current.items;
    return this.#store.transact(s=>{const u=this.#user(s,actor); this.#expire(s); return Object.values(s.trades).filter(t=>t.fromUserId===u.id || t.toUserId===u.id).map(t=>({...t,digest:this.#tradeDigest(t),fromName:s.users[t.fromUserId].displayName,toName:s.users[t.toUserId].displayName}));});
  }
  #transfer(s,copyId,from,to,tradeId) {
    const copy=s.copies[copyId]; copy.ownerId=to; copy.acquiredAt=this.#clock(); copy.version++;
    delete copy.lockedBy;
    for(const b of Object.values(copy.bindings)) if(b.transfer==='follow') b.holderId=to;
    copy.metadata.transfers??=[]; copy.metadata.transfers.push({from,to,tradeId,at:this.#clock()});
  }
  acceptTrade(actor,{key,tradeId,expectedDigest}) {
    return this.#command(actor,key,'trade.accepted',{tradeId,expectedDigest},(s,user)=>{
      const trade=s.trades[tradeId];
      check(trade && trade.toUserId===user.id,'NOT_FOUND','Trade not found',404);
      check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);
      if(expectedDigest!==undefined)check(expectedDigest===this.#tradeDigest(trade),'TRADE_CHANGED','Review the current offer',409);
      if(Date.parse(trade.expiresAt)<=Date.parse(this.#clock())) {this.#release(s,trade,'expired'); return trade;}
      check(!this.#blocked(s,trade.fromUserId,trade.toUserId),'TRADE_BLOCKED','Trading between these accounts is blocked',403);
      for(const [copyId,snapshot]of Object.entries(trade.snapshots??{}))check(s.copies[copyId]?.version===snapshot.version,'STALE_INVENTORY','A card changed after this offer; request a new offer',409);
      // Current switches and policies apply even when an offer predates a catalog update.
      if(trade.give.copyIds.length) this.#feature(s,'cardTrading');
      if(trade.give.currencies.length) this.#feature(s,'currencyTrading');
      for(const copyId of trade.give.copyIds) {
        const copy=s.copies[copyId];
        check(copy.ownerId===trade.fromUserId && copy.state==='owned' && copy.lockedBy===trade.id,'TRADE_CONFLICT','Escrow changed',409);
        check(!Object.values(copy.bindings).some(b=>b.transfer==='block'),'TRANSFER_BLOCKED','Binding blocks transfer',409);
        if(this.#policies.canTransfer) check(this.#policies.canTransfer(clone(copy),trade.fromUserId)===true,'TRANSFER_BLOCKED','Host transfer policy rejected card',409);
      }
      for(const money of trade.give.currencies) check(this.#currency(s,money.currencyId).tradable===true,'TRANSFER_BLOCKED','Currency trading disabled',403);
      this.#offer(s,user.id,trade.receive);
      for(const money of trade.receive.currencies) {
        this.#adjust(s,user.id,money.currencyId,-money.amount,'trade',trade.id);
        this.#adjust(s,trade.fromUserId,money.currencyId,money.amount,'trade',trade.id);
      }
      for(const money of trade.give.currencies) this.#adjust(s,user.id,money.currencyId,money.amount,'trade',trade.id);
      for(const copyId of trade.give.copyIds) this.#transfer(s,copyId,trade.fromUserId,user.id,trade.id);
      for(const copyId of trade.receive.copyIds) this.#transfer(s,copyId,user.id,trade.fromUserId,trade.id);
      this.#removePlacements(s,new Set([...trade.give.copyIds,...trade.receive.copyIds]));
      trade.status='accepted'; trade.completedAt=this.#clock();this.#notify(s,trade.fromUserId,'trade.accepted',{tradeId});this.#notify(s,user.id,'trade.accepted',{tradeId});return trade;
    });
  }
  cancelTrade(actor,{key,tradeId}) {
    return this.#command(actor,key,'trade.cancelled',{tradeId},(s,user)=>{
      const trade=s.trades[tradeId]; check(trade && [trade.fromUserId,trade.toUserId].includes(user.id),'NOT_FOUND','Trade not found',404);
      check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);
      this.#release(s,trade,user.id===trade.fromUserId?'cancelled':'declined'); return trade;
    });
  }
  #removePlacements(s,ids) {for(const u of Object.values(s.users))if(u.preferences)u.preferences.favoriteCopyIds=(u.preferences.favoriteCopyIds??[]).filter(copyId=>!ids.has(copyId));for(const album of Object.values(s.albums)) {
    const filtered=album.placements.filter(x=>!ids.has(x.copyId));
    if(filtered.length!==album.placements.length) {album.placements=filtered; album.version++;}
  }}
  saveAlbum(actor,{key,albumId,name,visibility='private',layout={},placements=[],expectedVersion}) {
    text(name,'album name',100); check(['private','public'].includes(visibility),'INVALID_INPUT','Invalid album visibility');
    check(Array.isArray(placements) && placements.length<=1000,'INVALID_INPUT','Album placements must be an array of at most 1000 items');
    jsonObject(layout,'album layout');
    return this.#command(actor,key,'album.saved',{albumId,name,visibility,layout,placements,expectedVersion},(s,user)=>{
      if(visibility==='public') this.#feature(s,'publicAlbums');
      const existing=albumId?s.albums[albumId]:null;
      check(!albumId || existing?.ownerId===user.id,'NOT_FOUND','Album not found',404);
      if(existing) check(expectedVersion===existing.version,'VERSION_CONFLICT','Album changed; refresh before saving',409);
      check(new Set(placements.map(x=>x.copyId)).size===placements.length,'INVALID_INPUT','Each copy can appear once per album');
      const clean=placements.map((p,index)=>{
        const copy=s.copies[p.copyId];
        check(copy && copy.ownerId===user.id && copy.state==='owned','NOT_OWNED','Album card is not owned',403);
        return {copyId:p.copyId,position:p.position===undefined?index:integer(p.position,'position',0,100000),data:jsonObject(p.data??{},'placement data')};
      });
      const album={id:existing?.id??id(),ownerId:user.id,name,visibility,layout:clone(layout),placements:clean,version:(existing?.version??0)+1,updatedAt:this.#clock()};
      s.albums[album.id]=album; return album;
    });
  }
  albums(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.albums).filter(a=>a.ownerId===u.id);});}
  #albumView(s,album,viewerId) {
    return {...clone(album),ownerName:s.users[album.ownerId].displayName,cards:album.placements.slice().sort((a,b)=>a.position-b.position)
      .map(p=>({placement:clone(p),copy:this.#copyView(s,s.copies[p.copyId],viewerId)}))};
  }
  viewAlbum(actor,albumId) {
    return this.#store.read(s=>{
      const viewer=actor?.userId && s.users[actor.userId]?actor.userId:null, album=s.albums[albumId];
      const allowed=album && (album.ownerId===viewer || (album.visibility==='public' && this.#catalog(s).features.publicAlbums));
      check(allowed,'NOT_FOUND','Album not found',404); return this.#albumView(s,album,viewer);
    });
  }
  publicAlbums() {return this.#store.read(s=>{
    this.#feature(s,'publicAlbums'); return Object.values(s.albums).filter(a=>a.visibility==='public').map(a=>({id:a.id,name:a.name,ownerName:s.users[a.ownerId].displayName,cardCount:a.placements.length}));
  });}
  // Private retained bindings remain accessible to their original holder after transfer.
  bindings(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.copies).filter(c=>c.state==='owned')
    .flatMap(c=>Object.entries(c.bindings).filter(([,b])=>b.holderId===u.id).map(([namespace,b])=>({copyId:c.id,namespace,...clone(b)})));});}
  events(actor,{after=0,limit=100}={}) {
    this.#admin(actor,'events.read'); integer(after,'event cursor',0); integer(limit,'event limit',1,1000);
    return this.#store.read(s=>s.events.filter(e=>e.sequence>after).slice(0,limit));
  }
}
