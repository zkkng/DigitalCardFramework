import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/http.js';
import {createClient} from '../src/client.js';
import {fixture} from './helpers.js';
import Ajv from 'ajv';
import {openapi} from '../src/contracts.js';

const ajv=new Ajv({strict:false,validateFormats:false});
ajv.addSchema({$id:'admin-contract',components:openapi.components});
function conforms(name,value){
  const validate=ajv.compile({$ref:'admin-contract#/components/schemas/'+name});
  assert(validate(value),JSON.stringify(validate.errors));
}

test('administration routes enforce host exposure, permissions, origin and account identity', async t => {
  const x=fixture();
  let actor={...x.alice,role:'admin'},exposeOperators=true,handler;
  const server=createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  const configure=()=>{handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators,requirePrincipal:true});};
  configure();
  const request=(path,body,headers={})=>fetch(origin+'/api'+path,{
    method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-DC-Principal':x.alice.userId,...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const reads=['/operator/admin','/operator/admin/users','/operator/admin/user?userId='+x.bob.userId,'/operator/admin/history'];
  for(const path of reads)assert.equal((await request(path)).status,200,path);
  actor=x.bob;
  for(const path of reads)assert.equal((await request(path)).status,403,path);
  actor={...x.alice,permissions:['admin.read']};
  assert.equal((await request('/operator/admin')).status,200);
  const change={key:'pause',expectedRevision:0,reason:'Scheduled maintenance',scope:'site',changes:{packPurchasesPaused:true}};
  assert.equal((await request('/operator/admin/settings',change)).status,403);
  assert.equal((await request('/operator/admin/cards',{key:'grant',expectedRevision:0,reason:'Event award',userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1})).status,403);
  actor={...x.alice,role:'admin'};
  assert.equal((await request('/operator/admin/settings',change,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request('/operator/admin/settings',change,{'X-DC-Principal':x.bob.userId})).status,409);
  assert.equal((await request('/operator/admin/settings',change)).status,200);
  assert.equal((await request('/quote',{productId:'common'})).status,409);
  assert.equal((await request('/operator/admin/settings',{...change,key:'stale'})).status,409);
  exposeOperators=false;configure();
  for(const path of reads)assert.equal((await request(path)).status,403,path);
});

test('public client supports named administrator workflows without leaking account secrets', async t => {
  const x=fixture(),actor={...x.alice,role:'admin'};
  let handler;
  const server=createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
  const client=createClient({baseUrl:origin+'/api',fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  await client.me();
  let overview=await client.adminOverview();
  conforms('AdminOverview',overview);
  const users=await client.adminUsers({search:'Bob'});
  assert.equal(users.items.length,1);
  assert.equal(users.items[0].id,x.bob.userId);
  assert(!JSON.stringify(users).includes('"subject"'));
  const receipt=await client.administerCards({key:'gift',expectedRevision:overview.revision,reason:'Community participation',userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1});
  const person=await client.adminUser({userId:x.bob.userId});
  conforms('AdminUserDetail',person);
  conforms('AdminMutation',receipt);
  assert.equal(person.inventory.items.length,1);
  assert(!JSON.stringify(person).includes('PRIVATE-DEMO-CODE'));
  overview=await client.adminOverview();
  assert.equal(overview.revision,receipt.revision);
  assert((await client.adminHistory()).items.length>0);
});
