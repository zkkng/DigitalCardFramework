import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/http.js';
import {fixture} from './helpers.js';

test('production API enforces principal binding, review, operator boundaries, bounded input and privacy',async t=>{
  const x=fixture();let origin,handler;const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const identity=req=>req.headers.authorization==='operator'?{...x.alice,role:'admin'}:req.headers.authorization==='alice'?x.alice:req.headers.authorization==='bob'?x.bob:null;
  handler=createApiHandler({framework:x.core,resolveIdentity:identity,allowedOrigin:origin,exposeOperators:true,requireTradeReview:true,requirePrincipal:true});t.after(()=>new Promise(r=>server.close(r)));
  const call=(path,{auth='alice',body,principal=auth==='bob'?x.b.id:x.a.id,raw}={})=>fetch(origin+'/api'+path,{method:body===undefined&&raw===undefined?'GET':'POST',headers:{authorization:auth,origin,'Content-Type':'application/json','X-DC-Principal':principal},body:raw??(body!==undefined?JSON.stringify(body):undefined)});
  assert.equal((await call('/operator/catalog')).status,403);assert.equal((await call('/operator/catalog',{auth:'operator'})).status,200);
  assert.equal((await call('/operator/import/preview',{body:{role:'admin',source:'{}',expectedVersion:1}})).status,403);
  const quote=x.core.quote(x.alice,{productId:'common'});assert.equal((await call('/purchase',{body:{key:'stale-account',...quote},principal:x.b.id})).status,409);assert.equal(x.core.wallet(x.alice).credits,10000);
  assert.equal((await call('/preferences',{raw:'{"key":"unsafe","constructor":{}}'})).status,400);assert.equal((await call('/preferences',{raw:'[]'})).status,400);
  assert.equal((await call('/preferences',{raw:JSON.stringify({key:'oversize',pad:'x'.repeat(1048576)})})).status,413);
  assert.equal((await call('/users?limit=201')).status,400);
  const a=x.open('unique')[0],b=x.open('rare',x.bob)[0],offer=x.core.proposeTrade(x.alice,{key:'offer',toUserId:x.b.id,give:{copyIds:[a.id],currencies:[]},receive:{copyIds:[b.id],currencies:[]}});
  const offers=await (await call('/trades',{auth:'bob'})).json();assert(!JSON.stringify(offers).includes('PRIVATE-DEMO-CODE'));
  assert.equal((await call('/trades/accept',{auth:'bob',body:{key:'unreviewed',tradeId:offer.id}})).status,409);
  assert.equal((await call('/trades/accept',{auth:'bob',body:{key:'reviewed',tradeId:offer.id,expectedDigest:offer.digest}})).status,200);
  assert.equal((await call('/operator/audit',{auth:'operator'})).status,200);
});

test('rate limiter denial returns Retry-After and operator routes remain closed unless opted in',async t=>{
  const x=fixture();let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(r=>server.close(r)));
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>({...x.alice,role:'admin'}),allowedOrigin:origin});assert.equal((await fetch(origin+'/api/operator/catalog')).status,403);
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,rateLimit:()=>false});const response=await fetch(origin+'/api/catalog');assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');assert(response.headers.get('X-Request-ID'));
});
