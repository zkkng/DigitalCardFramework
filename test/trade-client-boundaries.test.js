import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradeDraft} from '../src/trade-client.js';

const catalog={features:{cardTrading:true,currencyTrading:true},currencies:[{id:'credits',tradable:true}]};
const card=()=>({id:'copy',version:1,tradable:true,definition:{name:'Card'}});
const page=copy=>({items:[copy],owner:{id:'account',name:'Collector'},next:null});
test('malformed used inventory fields fail before a trade draft becomes ready',async()=>{
  for(const malformed of [{...card(),version:null},{...card(),version:1.1},{...card(),version:Number.MAX_SAFE_INTEGER+1},{...card(),tradable:null},{...card(),lockedBy:1},{...card(),definition:{name:1}}]){
    const draft=createTradeDraft({client:{tradeInventory:async()=>page(malformed)},userId:'account',catalog});
    await draft.load('partner');assert.equal(draft.getState().phase,'error');assert.deepEqual(draft.getState().inventory,[]);assert.throws(()=>draft.review(),/Load both inventories/);draft.dispose();
  }
});

test('invalid persisted drafts are discarded and card-only initial selections remain supported',async()=>{
  for(const initial of [{toUserId:'partner',give:{copyIds:['copy'],currencies:[{currencyId:'credits',amount:1.5}]}},{toUserId:'partner',give:{copyIds:null,currencies:[]}},{toUserId:'partner',message:'x'.repeat(501)},{toUserId:'partner',receive:{copyIds:[],currencies:[{currencyId:'credits',amount:Number.MAX_SAFE_INTEGER+1}]}}]){
    const draft=createTradeDraft({client:{tradeInventory:async()=>page(card())},userId:'account',catalog,storage:{getItem:()=>JSON.stringify(initial),setItem(){},removeItem(){}}});
    await draft.load('partner');assert.deepEqual(draft.getState().give,[]);assert.deepEqual(draft.getState().giveCurrencies,[]);draft.dispose();
  }
  const valid=createTradeDraft({client:{tradeInventory:async()=>page(card())},userId:'account',catalog,initial:{toUserId:'partner',give:{copyIds:['copy']}}});
  await valid.load('partner');valid.review();assert.deepEqual(valid.buildOffer().give,{copyIds:['copy'],currencies:[]});
});

test('exact safe copy versions and special identifier keys survive detached offer construction',async()=>{
  const copy={...card(),id:'__proto__',version:Number.MAX_SAFE_INTEGER};
  const draft=createTradeDraft({client:{tradeInventory:async()=>page(copy)},userId:'account',catalog});
  await draft.load('partner');draft.add('give','__proto__');draft.review();
  const offer=draft.buildOffer();assert.equal(Object.getPrototypeOf(offer.versions),Object.prototype);assert.equal(Object.hasOwn(offer.versions,'__proto__'),true);assert.equal(offer.versions['__proto__'],Number.MAX_SAFE_INTEGER);
  copy.version=0;assert.equal(draft.buildOffer().versions['__proto__'],Number.MAX_SAFE_INTEGER);
});

test('malformed later inventory pages do not publish or mutate selected copies',async()=>{
  let reads=0;
  const draft=createTradeDraft({client:{tradeInventory:async(id,options)=>{reads++;return options.after?{...page({...card(),version:null}),next:null}:{...page(card()),next:'next'};}},userId:'account',catalog});
  await draft.load('partner');draft.add('give','copy');const before=draft.getState();
  await assert.rejects(()=>draft.more('give'),/Invalid trade copy/);assert.deepEqual(draft.getState(),before);assert.equal(reads,3);
});
