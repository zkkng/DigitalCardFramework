import {randomInt, randomUUID, createHash} from 'node:crypto';
import {check, integer, text, jsonObject, validateCatalog} from './catalog.js';
import {MemoryStore} from './store.js';

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
  #store; #clock; #random; #bindings; #policies;
  constructor({store=new MemoryStore(), clock=nowISO, random=randomInt, bindings={}, policies={}}={}) {
    this.#store=store; this.#clock=clock; this.#random=random;
    this.#bindings=bindings; this.#policies=policies;
  }
  close() { this.#store.close(); }
  #admin(actor) { check(actor?.role==='admin','FORBIDDEN','Operator authority required',403); }
  #user(s,actor) {
    check(actor?.userId && s.users[actor.userId],'UNAUTHENTICATED','A verified framework user is required',401);
    return s.users[actor.userId];
  }
  #catalog(s) {check(s.catalog,'NO_CATALOG','Publish a catalog first',409); return s.catalog;}
  #feature(s,name) {check(this.#catalog(s).features[name],'FEATURE_DISABLED',name+' is disabled',403);}
  #event(s,type,data) {s.events.push({id:id(),sequence:s.events.length+1,type,data,at:this.#clock()});}
  #command(actor,key,type,input,fn) {
    text(key,'idempotency key',128);
    return this.#store.transact(s=>{
      const user=this.#user(s,actor), token=user.id+':'+key, hash=fingerprint({type,input});
      const previous=s.requests[token];
      if (previous) {check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409); return previous.result;}
      const result=fn(s,user);
      s.requests[token]={hash,result:clone(result)};
      this.#event(s,type,{userId:user.id});
      return result;
    });
  }
  publishCatalog(actor,manifest) {
    this.#admin(actor); const catalog=validateCatalog(manifest);
    return this.#store.transact(s=>{
      if (s.catalog) {
        check(catalog.version>s.catalog.version,'CATALOG_CONFLICT','Catalog version must increase',409);
        // Published IDs retain identity; retirement uses enabled:false. Old owned copies use snapshots.
        for (const section of ['currencies','lines','rarities','cards','variants','products','recipes']) {
          for (const old of s.catalog[section]) {
            const next=lookup(catalog[section],old.id);
            check(next,'CATALOG_CONFLICT','Retain published '+section+' id '+old.id,409);
            if (section==='variants') check(next.cardId===old.cardId && next.rarityId===old.rarityId && next.supplyLimit===old.supplyLimit,'CATALOG_CONFLICT','Variant identity/edition limits are immutable',409);
            if (section==='cards') check(next.lineId===old.lineId,'CATALOG_CONFLICT','Card line identity is immutable',409);
            if (section==='products' && fingerprint(next)!==fingerprint(old)) check(next.revision>old.revision,'CATALOG_CONFLICT','Changed product needs a higher revision',409);
          }
        }
      }
      s.catalog=catalog; this.#event(s,'catalog.published',{version:catalog.version});
      return this.#publicCatalog(catalog);
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
    this.#admin(actor); text(provider,'identity provider',100); text(subject,'identity subject',300); text(displayName,'display name',100);
    return this.#store.transact(s=>{
      const existing=Object.values(s.users).find(u=>u.provider===provider && u.subject===subject);
      if (existing) {existing.displayName=displayName; return existing;}
      const user={id:id(),provider,subject,displayName,createdAt:this.#clock()};
      s.users[user.id]=user; s.balances[user.id]={};
      this.#event(s,'user.registered',{userId:user.id});
      return user;
    });
  }
  grantCurrency(actor,{userId,currencyId,amount,reason,key}) {
    this.#admin(actor); integer(amount,'grant amount'); text(reason,'grant reason');
    return this.#command({userId},key,'currency.granted',{currencyId,amount,reason},s=>{
      this.#currency(s,currencyId); this.#adjust(s,userId,currencyId,amount,'grant',reason);
      return {userId,currencyId,amount,balance:s.balances[userId][currencyId]};
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
      const factory=spec.factory && this.#bindings[spec.factory];
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
      check(quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
      const total=product.price.amount*quantity; integer(total,'total price');
      return {productId,quantity,productRevision:product.revision,catalogVersion:c.version,price:{currencyId:product.price.currencyId,amount:total}};
    });
  }
  purchase(actor,{key,productId,quantity=1,productRevision,catalogVersion}) {
    integer(quantity,'quantity',1,100);
    return this.#command(actor,key,'packs.purchased',{productId,quantity,productRevision,catalogVersion},(s,user)=>{
      const c=this.#catalog(s), product=lookup(c.products,productId);
      check(product && product.enabled!==false,'UNAVAILABLE','Pack product unavailable',404);
      check(product.revision===productRevision && c.version===catalogVersion,'STALE_QUOTE','Get a fresh quote before buying',409);
      check(quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
      const total=product.price.amount*quantity; integer(total,'total price');
      const purchaseId=id(); this.#adjust(s,user.id,product.price.currencyId,-total,'purchase',purchaseId);
      const packs=[];
      for (let n=0;n<quantity;n++) {
        const pack={id:id(),ownerId:user.id,productId,productRevision,lineId:product.lineId,catalogVersion:c.version,
          product:clone(product),createdAt:this.#clock(),openedAt:null,copyIds:[],receipt:null};
        const excluded=new Set();
        if(product.duplicatePolicy.scope==='inventory') for(const copy of Object.values(s.copies))
          if(copy.ownerId===user.id && ['owned','sealed'].includes(copy.state)) excluded.add(copy.cardId);
        for(const slot of product.slots) for(let i=0;i<slot.count;i++) {
          const available=this.#available(s,slot.pool);
          let pool=available;
          if(product.duplicatePolicy.scope!=='none') pool=pool.filter(e=>!excluded.has(lookup(c.variants,e.variantId).cardId));
          if(!pool.length && product.duplicatePolicy.fallback==='allow') pool=available;
          check(pool.length,'POOL_EXHAUSTED','No eligible card remains in this pack slot',409);
          const copy=this.#mint(s,user.id,this.#weighted(pool),{type:'pack',packId:pack.id,purchaseId},'sealed');
          pack.copyIds.push(copy.id); excluded.add(copy.cardId);
        }
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
      return pack.receipt;
    });
  }
  inventory(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.copies).filter(x=>x.ownerId===u.id && x.state==='owned').map(x=>this.#copyView(s,x,u.id));});}
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
  proposeTrade(actor,{key,toUserId,give,receive,expiresInSeconds=86400}) {
    integer(expiresInSeconds,'expiry seconds',1,604800);
    return this.#command(actor,key,'trade.proposed',{toUserId,give,receive,expiresInSeconds},(s,user)=>{
      check(toUserId!==user.id && s.users[toUserId],'INVALID_INPUT','Choose another registered user');
      const given=this.#offer(s,user.id,give), requested=this.#offer(s,toUserId,receive);
      check(given.copyIds.length+given.currencies.length+requested.copyIds.length+requested.currencies.length>0,'INVALID_INPUT','Empty trade');
      const trade={id:id(),fromUserId:user.id,toUserId,give:given,receive:requested,status:'pending',createdAt:this.#clock(),
        expiresAt:new Date(Date.parse(this.#clock())+expiresInSeconds*1000).toISOString()};
      s.trades[trade.id]=trade;
      for(const copyId of given.copyIds) s.copies[copyId].lockedBy=trade.id;
      for(const money of given.currencies) this.#adjust(s,user.id,money.currencyId,-money.amount,'trade.escrow',trade.id);
      return trade;
    });
  }
  #release(s,trade,status) {
    for(const copyId of trade.give.copyIds) delete s.copies[copyId].lockedBy;
    for(const money of trade.give.currencies) this.#adjust(s,trade.fromUserId,money.currencyId,money.amount,'trade.refund',trade.id);
    trade.status=status; trade.completedAt=this.#clock();
    this.#event(s,'trade.'+status,{tradeId:trade.id});
  }
  #expire(s) {
    for(const trade of Object.values(s.trades)) if(trade.status==='pending' && Date.parse(trade.expiresAt)<=Date.parse(this.#clock())) this.#release(s,trade,'expired');
  }
  sweepExpiredTrades(actor) {this.#admin(actor); return this.#store.transact(s=>{this.#expire(s); return {ok:true};});}
  trades(actor) {
    return this.#store.transact(s=>{const u=this.#user(s,actor); this.#expire(s); return Object.values(s.trades).filter(t=>t.fromUserId===u.id || t.toUserId===u.id);});
  }
  #transfer(s,copyId,from,to,tradeId) {
    const copy=s.copies[copyId]; copy.ownerId=to; copy.acquiredAt=this.#clock(); copy.version++;
    delete copy.lockedBy;
    for(const b of Object.values(copy.bindings)) if(b.transfer==='follow') b.holderId=to;
    copy.metadata.transfers??=[]; copy.metadata.transfers.push({from,to,tradeId,at:this.#clock()});
  }
  acceptTrade(actor,{key,tradeId}) {
    return this.#command(actor,key,'trade.accepted',{tradeId},(s,user)=>{
      const trade=s.trades[tradeId];
      check(trade && trade.toUserId===user.id,'NOT_FOUND','Trade not found',404);
      check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);
      if(Date.parse(trade.expiresAt)<=Date.parse(this.#clock())) {this.#release(s,trade,'expired'); return trade;}
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
      trade.status='accepted'; trade.completedAt=this.#clock(); return trade;
    });
  }
  cancelTrade(actor,{key,tradeId}) {
    return this.#command(actor,key,'trade.cancelled',{tradeId},(s,user)=>{
      const trade=s.trades[tradeId]; check(trade && [trade.fromUserId,trade.toUserId].includes(user.id),'NOT_FOUND','Trade not found',404);
      check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);
      this.#release(s,trade,user.id===trade.fromUserId?'cancelled':'declined'); return trade;
    });
  }
  #removePlacements(s,ids) {for(const album of Object.values(s.albums)) {
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
    this.#admin(actor); integer(after,'event cursor',0); integer(limit,'event limit',1,1000);
    return this.#store.read(s=>s.events.filter(e=>e.sequence>after).slice(0,limit));
  }
}
