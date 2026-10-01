import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameworkServer} from '../src/http.js';
import {fixture} from './helpers.js';

test('HTTP identity, origin, public privacy and command recovery at the service boundary',async t=>{
  const x=fixture();
  let origin;
  const {createApiHandler}=await import('../src/http.js'),{createServer}=await import('node:http');
  let handler;
  const live=createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>live.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+live.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:req=>req.headers.authorization==='test-alice'?x.alice:null,allowedOrigin:origin});
  t.after(()=>new Promise(resolve=>{live.close(resolve);live.closeAllConnections();}));
  const call=(path,{body,auth=true,requestOrigin=origin}={})=>fetch(origin+'/api'+path,{
    method:body===undefined?'GET':'POST',headers:{...(auth?{Authorization:'test-alice'}:{}),
      ...(body===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await call('/inventory',{auth:false})).status,401);
  assert.equal((await call('/catalog',{auth:false})).status,200);
  const quote=await (await call('/quote',{body:{productId:'unique'}})).json();
  assert.equal((await call('/purchase',{body:{...quote,key:'origin'},requestOrigin:'https://evil.example'})).status,403);
  const a=await (await call('/purchase',{body:{...quote,key:'buy'}})).json();
  const b=await (await call('/purchase',{body:{...quote,key:'buy'}})).json();assert.deepEqual(a,b);
  const opened=await (await call('/open',{body:{key:'open',packId:a.packs[0].id}})).json();
  assert.equal(opened.cards[0].bindings['demo.code'].data.code,'PRIVATE-DEMO-CODE');
  const album=await (await call('/albums',{body:{key:'album',name:'Public',visibility:'public',placements:[{copyId:opened.cards[0].id}]}})).json();
  const publicAlbum=await (await call('/albums/'+album.id,{auth:false})).json();
  assert(!JSON.stringify(publicAlbum).includes('PRIVATE-DEMO-CODE'));
  assert.equal((await call('/cards/'+opened.cards[0].id,{auth:false})).status,401);
  assert.equal(x.core.wallet(x.alice).credits,9990);
});
test('HTTP server refuses construction without host identity verification',()=>{
  const x=fixture();assert.throws(()=>createFrameworkServer({framework:x.core}),/identity resolver/);
});
