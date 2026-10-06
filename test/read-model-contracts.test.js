import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {createWireTransport} from '../src/wire-client.js';
import {validateWireResponse,WireContractError} from '../src/wire-contracts.js';
import {durableCommands} from '../src/command-intents.js';
import {openapi} from '../src/contracts.js';

test('actual HTTP administration, inventory and immutable trade responses use checked field contracts',async t=>{
  const x=fixture();let actor={...x.alice,role:'admin'},handler;
  x.open('common',x.alice);x.open('common',x.bob);
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true,requireTradeReview:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  let overview=await call('adminOverview',undefined);assert.equal(typeof overview.counts.cards,'number');
  const users=await call('adminUsers',undefined,{query:{search:'Bob'}});assert.equal(users.items[0].id,x.bob.userId);
  const person=await call('adminUser',undefined,{query:{userId:x.bob.userId}});assert.equal(person.inventory.items[0].version,2);
  const mutations=[{scope:'site',changes:{packPurchasesPaused:false}},{scope:'line',targetId:'sky',changes:{salesPaused:false}},{scope:'product',targetId:'common',changes:{discountPercent:10}},{scope:'user',targetId:x.bob.userId,changes:{tradingBlocked:false}}];
  for(const [index,mutation]of mutations.entries()){
    const receipt=await call('configureAdmin',{...mutation,key:'model-admin-'+index,expectedRevision:overview.revision,reason:'Configuration update'});
    assert.equal(receipt.change.scope,mutation.scope);overview=await call('adminOverview',undefined);
  }
  const grant=await call('administerCards',{key:'model-grant',expectedRevision:overview.revision,reason:'Collection award',userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1});
  await call('administerCards',{key:'model-remove',expectedRevision:grant.revision,reason:'Award correction',userId:x.bob.userId,action:'remove',copyIds:[grant.cards[0].id]});
  const history=await call('adminHistory',undefined);assert.equal(history.items.length,6);assert.equal(typeof history.items[0].actorName,'string');
  const inventory=await call('inventory',undefined,{query:{limit:50}});assert.equal(inventory.items[0].tradable,true);
  const other=await call('tradeInventory',undefined,{path:{userId:x.bob.userId},query:{limit:50}});assert.equal(other.owner.id,x.bob.userId);
  const trade=await call('proposeTrade',{key:'model-trade',toUserId:x.bob.userId,give:{copyIds:[inventory.items[0].id],currencies:[]},receive:{copyIds:[other.items[0].id],currencies:[]}});
  assert.equal(trade.status,'pending');assert.equal(Object.keys(trade.snapshots).length,2);
  actor=x.bob;
  const reviewed=(await call('trades',undefined))[0];assert.equal(reviewed.digest,trade.digest);
  const accepted=await call('acceptTrade',{key:'model-accept',tradeId:trade.id,expectedDigest:reviewed.digest});assert.equal(accepted.status,'accepted');assert.equal(typeof accepted.completedAt,'string');
});

test('read-model negatives reject omitted fields, null scalars, leaked identities and unsafe counts',()=>{
  const x=fixture(),admin={...x.alice,role:'admin'},overview=x.core.adminOverview(admin);
  for(const mutate of [value=>delete value.permissions.cards,value=>value.counts.cards=null,value=>value.counts.users=Number.MAX_SAFE_INTEGER+1,value=>value.lines[0].products[0].slotOdds[0].rarities[0].percent=101]){
    const value=structuredClone(overview);mutate(value);assert.throws(()=>validateWireResponse('adminOverview',200,value),WireContractError);
  }
  const users=x.core.adminUsers(admin),leaked=structuredClone(users);leaked.items[0].subject='provider-subject';assert.throws(()=>validateWireResponse('adminUsers',200,leaked),WireContractError);
  x.open('common');const inventory=x.core.inventoryPage(x.alice,{limit:50});
  for(const mutate of [value=>delete value.items[0].tradable,value=>value.items[0].version=0,value=>value.items[0].untradableReason=1]){
    const value=structuredClone(inventory);mutate(value);assert.throws(()=>validateWireResponse('inventory',200,value),WireContractError);
  }
  const trade=x.core.proposeTrade(x.alice,{key:'model-negative-trade',toUserId:x.bob.userId,give:{copyIds:[],currencies:[{currencyId:'credits',amount:1}]},receive:{copyIds:[],currencies:[]}});
  for(const mutate of [value=>delete value.digest,value=>value.status='unknown',value=>value.give.currencies[0].amount=1.1,value=>value.snapshots=null,value=>value.fromUserId=null]){
    const value=structuredClone(trade);mutate(value);assert.throws(()=>validateWireResponse('proposeTrade',200,value),WireContractError);
  }
});

test('implemented command recovery routes validate real registered inputs and command-specific results',async t=>{
  assert.deepEqual(openapi.components.schemas.CommandIntent.properties.command.enum,durableCommands);
  const x=fixture();let actor={...x.alice,role:'admin'},handler;
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true,requireTradeReview:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const quote=await call('quote',{productId:'common'});
  const original=await call('registerCommandIntent',{command:'purchase',input:quote});assert.equal(original.state,'pending');assert.equal(typeof original.input.key,'string');
  const repeated=await call('registerCommandIntent',{command:'purchase',input:{...quote,quantity:2}});assert.deepEqual(repeated,original);
  actor=x.bob;
  await assert.rejects(()=>call('executeCommandIntent',{id:original.id}),error=>error.status===404);
  actor={...x.alice,role:'admin'};
  const executed=await call('executeCommandIntent',{id:original.id});assert.equal(executed.intent.state,'completed');assert.equal(executed.result.packs.length,1);
  assert.deepEqual(await call('executeCommandIntent',{id:original.id}),executed);
  const wrongResult=structuredClone(executed);wrongResult.result={revision:1,change:{}};assert.throws(()=>validateWireResponse('executeCommandIntent',200,wrongResult),WireContractError);
  await call('acknowledgeCommandIntent',{id:original.id});assert.equal((await call('commandIntents',undefined)).items.length,0);
  const admin=await call('registerCommandIntent',{command:'configureAdmin',input:{expectedRevision:0,reason:'Configuration update',scope:'site',changes:{packPurchasesPaused:false}}});
  const mutation=await call('executeCommandIntent',{id:admin.id});assert.equal(mutation.result.change.scope,'site');await call('acknowledgeCommandIntent',{id:admin.id});
  const cards=await call('registerCommandIntent',{command:'administerCards',input:{expectedRevision:mutation.result.revision,reason:'Collection award',userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1}});
  const gift=await call('executeCommandIntent',{id:cards.id});assert.equal(gift.result.cards.length,1);
  const stale=await call('registerCommandIntent',{command:'purchase',input:{...quote,productRevision:999}});
  await assert.rejects(()=>call('executeCommandIntent',{id:stale.id}),error=>error.code==='STALE_QUOTE');
  const heads=await call('commandIntents',undefined,{query:{command:'purchase'}});assert.equal(heads.items[0].state,'failed');assert.equal(heads.items[0].error.code,'STALE_QUOTE');
});
