import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture,admin} from './helpers.js';
import {MemoryStore} from '../src/store.js';
import {createApiHandler} from '../src/http.js';
import {createWireTransport} from '../src/wire-client.js';
import {validateWireRequest,validateWireResponse,WireContractError} from '../src/wire-contracts.js';
import {resolveCapabilities} from '../src/capability-policy.js';
import {codesFixture} from './codes-fixtures.mjs';

const primitives={issuance:true,transfer:true,settlement:true};
test('actual capability HTTP responses distinguish configured, available, account draining and legacy migration',async t=>{
  const store=new MemoryStore(),x=codesFixture({store,change:catalog=>{catalog.variants.find(variant=>variant.id==='reward.standard').onOpen=[{id:'reward',handler:'example.reward'}];},actionHandlers:{'example.reward':async()=>({delivered:true})}});let actor={...x.alice,role:'admin'},handler;
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const first=await call('capabilities',undefined);assert.equal(first.configured.packs,true);assert.equal(first.available.packs,true);assert.deepEqual(first.draining,[]);
  const catalog=await call('catalog',undefined);assert.deepEqual(catalog.capabilities,resolveCapabilities(x.c.capabilities));
  const paid=x.buy('common');
  x.c.version++;x.c.capabilities={version:1,primitives};x.core.publishCatalog(admin,x.c);
  const draining=await call('capabilities',undefined);assert.equal(draining.configured.packs,false);assert.equal(draining.available.packs,false);assert.deepEqual(draining.draining,['packs']);
  actor=x.bob;assert.deepEqual((await call('capabilities',undefined)).draining,[]);
  actor={...x.alice,role:'admin'};x.core.openPack(x.alice,{key:'capability-drain-open',packId:paid.packs[0].id});assert.deepEqual((await call('capabilities',undefined)).draining,[]);
  x.c.version++;x.c.capabilities={version:1,preset:'demo',primitives};x.core.publishCatalog(admin,x.c);
  x.openCode();await x.core.dispatchActions(admin);
  const revision=x.core.adminOverview(actor).revision;
  await call('configureAdmin',{key:'capability-pause',expectedRevision:revision,reason:'Configuration update',scope:'site',changes:{packPurchasesPaused:true}});
  const paused=await call('capabilities',undefined);assert.equal(paused.configured.packs,true);assert.equal(paused.available.packs,false);
  x.c.version++;x.c.capabilities={version:1,primitives};x.core.publishCatalog(admin,x.c);
  const retained=await call('capabilities',undefined);assert.deepEqual(retained.draining,[]);assert.deepEqual(retained.history,{codes:true,rewards:true});
  assert.equal((await call('codeHistory',undefined)).total,1);assert.equal((await call('fulfillments',undefined)).total,1);
  actor=x.bob;assert.deepEqual((await call('capabilities',undefined)).history,{codes:false,rewards:false});actor={...x.alice,role:'admin'};
  store.transact(state=>{delete state.catalog.capabilities;});
  const legacy=await call('capabilities',undefined);assert.equal(legacy.migrationRequired,true);assert.equal(legacy.available.packs,false);
  assert.equal((await call('catalog',undefined)).capabilities,undefined);
  actor=null;await assert.rejects(()=>call('capabilities',undefined),error=>error.status===401);
});

test('capability authoring schemas agree with actual preset overrides and primitive dependency validation',()=>{
  const vectors=[{}, {version:1,preset:'minimal'}, {preset:'storefront',primitives:{issuance:true,settlement:true}}, {preset:'packCollection',primitives:{issuance:true}}, {preset:'demo',primitives}, {preset:'demo',workflows:{packs:false,directSales:false,trading:false,resale:false}}, {workflows:{trading:true},primitives:{transfer:true}}];
  for(const capabilities of vectors){validateWireRequest('previewImport',{source:{capabilities},expectedVersion:1});resolveCapabilities(capabilities);}
  for(const capabilities of [null,{version:2},{preset:'unknown'},{preset:'demo'},{workflows:{trading:true},primitives:{transfer:false}},{workflows:{packs:null}},{primitives:{unknown:true}},{workflows:{resale:true},primitives:{transfer:true}}]){
    assert.throws(()=>validateWireRequest('previewImport',{source:{capabilities},expectedVersion:1}),WireContractError);assert.throws(()=>resolveCapabilities(capabilities));
  }
});

test('negative availability fixtures reject missing/null/unknown fields and inconsistent configured flags',()=>{
  const x=fixture(),valid=x.core.capabilities(x.alice);
  for(const mutate of [value=>delete value.version,value=>value.available.packs=null,value=>value.configured.hidden=true,value=>value.draining=['packs','packs'],value=>value.draining=['unknown'],value=>value.version=1.1,value=>{value.configured.packs=false;value.available.packs=true;},value=>value.migrationRequired=null,value=>value.providerConfiguration={},value=>delete value.history,value=>value.history.codes=null,value=>value.history.hidden=true]){
    const invalid=structuredClone(valid);mutate(invalid);assert.throws(()=>validateWireResponse('capabilities',200,invalid),WireContractError);
  }
});
