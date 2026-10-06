import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture,admin} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {createClient} from '../src/client.js';
import {validateWireResponse,WireContractError} from '../src/wire-contracts.js';
import {assetReference} from '../src/catalog.js';
import {validatePresentationReference} from '../src/presentation/integration.js';
const artwork={front:'/art/pack/front.png',back:'https://assets.example/pack/back.png',reveal:'./reveal.png',alt:'雪 pack',design:{contract:'digital-card@0.1',digest:'sha256:'+'a'.repeat(64),baseURL:'/art/pack/design/'}};
test('actual checked client receives catalog, allocated pack and retained artwork snapshot',async()=>{
  const x=fixture({change:catalog=>{catalog.products.find(product=>product.id==='common').artwork=artwork;}});let handler;
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true});
  const client=createClient({baseUrl:origin+'/api',fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  try{await client.me();assert.deepEqual((await client.catalog()).products.find(product=>product.id==='common').artwork,artwork);const quote=await client.quote({productId:'common',quantity:1});const purchase=await client.purchase({...quote,key:'artwork-purchase'});assert.deepEqual(purchase.packs[0].product.artwork,artwork);const next=x.core.operatorCatalog(admin);next.version++;const product=next.products.find(product=>product.id==='common');product.revision++;product.artwork={front:'/art/new-front.png'};x.core.publishCatalog(admin,next);assert.deepEqual((await client.packs())[0].product.artwork,artwork);assert.equal((await client.catalog()).products.find(product=>product.id==='common').artwork.front,'/art/new-front.png');assert.equal(x.core.audit(admin).ok,true);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
});
test('artwork wire formats match implemented URL, description and pinned reference boundaries',()=>{
  const x=fixture(),pack=x.buy().packs[0];try{
    for(const front of ['/front.png','./front.png','https://assets.example/front.png?revision=1#image','//assets.example/front.png']){assetReference(front);assert.doesNotThrow(()=>validateWireResponse('packs',200,[{...pack,product:{...pack.product,artwork:{front}}}]));}
    for(const patch of [{front:'javascript:alert(1)'},{front:'data:image/png;base64,a'},{front:Object.assign(new URL('https://assets.example/front.png'),{username:'test-user',password:'test-password'}).href},{front:'front image.png'},{alt:' '},{alt:'𝄞'.repeat(101)},{extra:true},{design:{...artwork.design,contract:'other'}},{design:{...artwork.design,digest:'sha256:bad'}},{design:{...artwork.design,baseURL:'https://assets.example/design?token=x'}},{design:{...artwork.design,extra:true}}])assert.throws(()=>validateWireResponse('packs',200,[{...pack,product:{...pack.product,artwork:{...artwork,...patch}}}]),error=>error instanceof WireContractError&&error.phase.startsWith('response'));
    for(const baseURL of ['/art/design/','https://assets.example/design/','']){const design={...artwork.design,baseURL};validatePresentationReference(design);assert.doesNotThrow(()=>validateWireResponse('packs',200,[{...pack,product:{...pack.product,artwork:{design}}}]));}
    const fractional={...pack,product:{...pack.product,slots:pack.product.slots.map(slot=>({...slot,pool:slot.pool.map(entry=>({...entry,weight:.5}))}))}};assert.doesNotThrow(()=>validateWireResponse('packs',200,[fractional]));
  }finally{x.core.close();}
});
