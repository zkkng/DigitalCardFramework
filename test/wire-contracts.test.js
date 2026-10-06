import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {validateWireRequest,validateWireResponse,WireContractError} from '../src/wire-contracts.js';
import {createWireTransport,WireApiError} from '../src/wire-client.js';
import {openapi} from '../src/contracts.js';
import {createApiHandler} from '../src/http.js';
import {createServer} from 'node:http';

test('acquisition request and real detached responses validate, including immutable replay',()=>{
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});
  validateWireRequest('quote',{productId:'common'});
  validateWireResponse('quote',200,quote);
  const input={...quote,key:'contract-purchase'};
  validateWireRequest('purchase',input);
  const result=x.core.purchase(x.alice,input);
  validateWireResponse('purchase',200,result);
  assert.deepEqual(x.core.purchase(x.alice,input),result);
  const open={key:'contract-open',packId:result.packs[0].id};
  validateWireRequest('openPack',open);
  validateWireResponse('openPack',200,x.core.openPack(x.alice,open));
  const leaked=structuredClone(result);leaked.packs[0].copyIds=['sealed'];
  assert.throws(()=>validateWireResponse('purchase',200,leaked),WireContractError);
  for(const openedAt of ['2026-02-30T12:00:00Z','2026-01-01T25:00:00Z','2026-01-01T12:00:00+24:00']){
    const invalid=structuredClone(result);invalid.packs[0].openedAt=openedAt;assert.throws(()=>validateWireResponse('purchase',200,invalid),WireContractError);
  }
});

test('negative acquisition fixtures reject missing, null, unknown and inexact integers',()=>{
  for(const input of [{},{productId:null},{productId:'common',userId:'injected'},{productId:'common',quantity:0},{productId:'common',quantity:101},{productId:'common',quantity:1.5}])
    assert.throws(()=>validateWireRequest('quote',input),WireContractError);
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});
  for(const mutate of [value=>delete value.catalogVersion,value=>value.productRevision=null,value=>value.adminRevision=Number.MAX_SAFE_INTEGER+1,value=>value.price.amount=Number.MAX_SAFE_INTEGER+1,value=>value.price.amount=1.1,value=>value.unexpected=true]){
    const value=structuredClone(quote);mutate(value);assert.throws(()=>validateWireResponse('quote',200,value),WireContractError);
  }
  validateWireResponse('quote',200,{...quote,price:{currencyId:'credits',amount:Number.MAX_SAFE_INTEGER}});
  validateWireResponse('quote',400,{code:'INVALID_INPUT',message:'Invalid product'});
  for(const error of [{code:'X'},{code:null,message:'Invalid'},{code:'X',message:'Invalid',secret:'hidden'}])assert.throws(()=>validateWireResponse('quote',400,error),WireContractError);
});

test('every published error status carries the JSON error envelope',()=>{
  for(const item of Object.values(openapi.paths))for(const operation of Object.values(item))for(const [status,response]of Object.entries(operation.responses)){
    if(Number(status)>=400)assert.equal(response.content['application/json'].schema.$ref,'#/components/schemas/Error');
  }
});

test('production review requests reject omitted and malformed trade digests',()=>{
  for(const expectedDigest of [undefined,null,'unchecked'])assert.throws(()=>validateWireRequest('acceptTrade',{key:'accept',tradeId:'trade',expectedDigest}),WireContractError);
  validateWireRequest('acceptTrade',{key:'accept',tradeId:'trade',expectedDigest:'a'.repeat(64)});
});

test('checked transport validates actual HTTP acquisition and error responses',async t=>{
  const x=fixture();let handler;
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipalBinding:true,requireTradeReview:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>x.alice.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const quote=await call('quote',{productId:'common'});
  const purchase=await call('purchase',{...quote,key:'http-wire-purchase'});
  const replay=await call('purchase',{...quote,key:'http-wire-purchase'});assert.deepEqual(replay,purchase);
  const receipt=await call('openPack',{key:'http-wire-open',packId:purchase.packs[0].id});assert.equal(receipt.cards.length,1);
  await assert.rejects(()=>call('quote',{productId:'missing'}),error=>error instanceof WireApiError&&error.status===404&&error.code==='UNAVAILABLE');
});

test('checked transport preserves session and principal binding and fails before sending malformed commands',async()=>{
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});let calls=0;
  const call=createWireTransport({principal:()=>x.alice.userId,fetch:async(url,options)=>{
    calls++;assert.equal(url,'/api/quote');assert.equal(options.credentials,'same-origin');
    assert.equal(options.headers['X-DC-Principal'],x.alice.userId);assert.equal(options.headers['Content-Type'],'application/json');
    return new Response(JSON.stringify(quote),{status:200});
  }});
  assert.deepEqual(await call('quote',{productId:'common'}),quote);
  await assert.rejects(()=>call('quote',{productId:'common',quantity:101}),WireContractError);assert.equal(calls,1);
  const fail=createWireTransport({principal:()=>null,fetch:async()=>new Response(JSON.stringify({code:'UNAUTHENTICATED',message:'Sign in'}),{status:401})});
  await assert.rejects(()=>fail('quote',{productId:'common'}),error=>error instanceof WireApiError&&error.code==='UNAUTHENTICATED'&&error.status===401);
  const malformed=createWireTransport({principal:()=>null,fetch:async()=>new Response('{}',{status:200})});
  await assert.rejects(()=>malformed('quote',{productId:'common'}),WireContractError);
});
