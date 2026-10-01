import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Window } from 'happy-dom';
import { codesFixture } from './codes-fixtures.mjs';
import { admin, code } from './helpers.js';
import { createApiHandler } from '../src/http.js';
import { createClient } from '../src/client.js';
import { createCodeRevealController, renderCodeReveal, renderCodeHistory } from '../src/code-ui.js';

test('HTTP code boundaries: private no-store, hostile origins, forged roles and narrow operator permissions', async t => {
  const x=codesFixture(), codeId=x.openCode().codes[0].id;
  let handler; const server=createServer((req,res)=>handler(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const identities={alice:x.alice,bob:x.bob,operator:{...x.alice,permissions:['codes.import']},manager:{...x.alice,permissions:['codes.manage']}};
  handler=createApiHandler({framework:x.core,allowedOrigin:origin,exposeOperators:true,resolveIdentity:r=>identities[r.headers.authorization]});
  t.after(()=>{server.closeAllConnections();server.close();x.core.close();});
  const call=(path,body,auth='alice',requestOrigin=origin)=>fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:auth,Origin:requestOrigin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.equal((await call('/codes',undefined,'missing')).status,401);
  const history=await call('/codes');assert.equal(history.headers.get('cache-control'),'no-store');assert(!(await history.text()).includes('SECRET-REWARD'));
  assert.equal((await call('/codes/reveal',{key:'bad',codeId,userId:x.alice.userId,role:'admin'},'bob')).status,404);
  assert.equal((await call('/codes/reveal',{key:'bad',codeId},'alice','https://evil.example')).status,403);
  assert.equal((await call('/operator/codes/import',{key:'fake',poolId:'rewards',codes:[{code:'FAKE'}],role:'admin'})).status,403);
  assert.equal((await call('/operator/code-pools',undefined,'operator')).status,403);
  assert.equal((await call('/operator/codes',undefined,'operator')).status,403);
  const client=createClient({baseUrl:origin+'/api',fetch:(url,init)=>fetch(url,{...init,headers:{...init.headers,Authorization:'manager'}})});
  const stock=await client.codeInventory({search:'ext-0',limit:1});assert.equal(stock.total,1);assert.equal(stock.items[0].externalId,'ext-0');assert.equal(stock.items[0].secret,undefined);assert.equal(stock.items[0].fingerprint,undefined);
  assert.equal((await call('/operator/codes/import',{key:'authorized',poolId:'rewards',codes:[{code:'NEW-PRIVATE'}]},'operator')).status,200);
  assert.equal((await call('/operator/codes/confirm',{providerId:'example.game',eventId:'fake',codeId,status:'redeemed',occurredAt:new Date().toISOString()},'operator')).status,403);
  const revealed=await call('/codes/reveal',{key:'good',codeId});assert.equal(revealed.headers.get('cache-control'),'no-store');assert.equal((await revealed.json()).code,'SECRET-REWARD-0');
  assert.equal((await call('/codes/reconcile',{codeId})).status,404);
  assert.equal((await call('/codes/lookup',{codeId})).status,404);
});

test('reveal controller coalesces requests, retries with the same key and erases disposed secrets', async()=>{
  let attempts=0,resolve;const keys=[];
  const view=createCodeRevealController({codeId:'a',key:()=> 'stable',reveal:async input=>{keys.push(input.key);if(++attempts===1)throw Error('offline');return new Promise(r=>resolve=r);}});
  await view.open();assert.equal(view.getState().phase,'error');
  const first=view.open(),second=view.open();assert.equal(first,second);await Promise.resolve();
  view.dispose();resolve({code:'DO-NOT-RETAIN'});assert.equal(await first,undefined);
  assert.deepEqual(keys,['stable','stable']);assert.equal(view.getState().code,null);
});

test('scratch and peel hold secrets on the server; open mode and keyboard button use the same contract', async()=>{
  const window=new Window();globalThis.document=window.document;
  try{
    for(const mode of ['scratch','peel','open']){
      let calls=0;const view=renderCodeReveal({codeId:'a',mode},{reveal:async()=>{calls++;return {code:'<img src=x onerror=alert(1)>'};},key:()=>mode});
      document.body.append(view.node);assert(!view.node.textContent.includes('<img'));
      if(mode!=='open'){await Promise.resolve();assert.equal(calls,0);view.node.querySelector('button').click();}
      await new Promise(r=>setTimeout(r,5));assert.equal(calls,1);assert(view.node.textContent.includes('<img'));assert.equal(view.node.querySelector('img'),null);
      view.dispose();assert.equal(view.node.textContent,'');
    }
  }finally{window.happyDOM.abort();delete globalThis.document;}
});

test('history accepts a completely replaced reveal renderer and disposes it',async()=>{
  const x=codesFixture();x.openCode();const window=new Window();globalThis.document=window.document;
  let cleaned=0;try{
    const view=renderCodeHistory({}, {client:{codeHistory:async()=>x.core.codeHistory(x.alice)},codeRevealRenderer:()=>({node:document.createElement('aside'),dispose(){cleaned++;}})});
    document.body.append(view.node);await view.ready;assert.equal(view.node.querySelectorAll('aside').length,1);assert.match(view.node.textContent,/Origin and code history/);
    assert(!view.node.textContent.includes('SECRET-REWARD'));view.dispose();assert.equal(cleaned,1);
  }finally{x.core.close();window.happyDOM.abort();delete globalThis.document;}
});

test('legacy provenance backfill preserves evidence without inventing missing fields and is idempotent',()=>{
  const x=codesFixture();const copy=x.openCode();
  x.store.transact(s=>{const c=s.copies[copy.id];delete c.provenance;c.source={type:'pack',packId:copy.source.packId};delete s.packs[c.source.packId].purchaseId;});
  assert.throws(()=>x.core.backfillProvenance(x.alice),code('FORBIDDEN'));
  assert.equal(x.core.backfillProvenance(admin).count,1);assert.equal(x.core.backfillProvenance(admin).count,0);
  const p=x.core.inspectCard(x.alice,copy.id).provenance;assert.equal(p.reconstructed,true);assert.equal(p.purchaseId,null);assert.equal(p.slotId,undefined);assert.equal(p.packId,copy.source.packId);assert.equal(x.core.audit(admin).ok,true);x.core.close();
});

test('audit detects code reassignment, duplicate fingerprints and damaged origin links',()=>{
  const x=codesFixture();const copy=x.openCode();x.store.transact(s=>{const rows=Object.values(s.codes);rows[1].fingerprint=rows[0].fingerprint;s.copies[copy.id].provenance.packId='missing';s.codes[copy.codes[0].id].holderId='missing';});
  const report=x.core.audit(admin);assert.equal(report.ok,false);assert(report.issues.length>=3);assert(!JSON.stringify(report).includes('SECRET-REWARD'));x.core.close();
});

test('catalog rejects malformed probability and catalog-embedded secrets',()=>{
  for(const probability of [null,false,0,{numerator:1,denominator:2,unknown:true}])assert.throws(()=>codesFixture({change(c){c.products.at(-1).slots[1].probability=probability;}}));
  assert.throws(()=>codesFixture({change(c){c.variants.at(-1).codes[0].code='plaintext';}}),code('INVALID_CATALOG'));
});

test('operator inventory is private and authenticated envelopes match their lookup fingerprints',()=>{
  const x=codesFixture();assert.throws(()=>x.core.codeInventory(x.alice),code('FORBIDDEN'));
  const result=x.core.codeInventory(admin,{limit:2});assert.equal(result.items.length,2);assert.equal(result.total,8);assert(result.next);assert(!JSON.stringify(result).includes('SECRET-REWARD'));
  x.store.transact(s=>{Object.values(s.codes)[0].fingerprint='modified';});
  assert.throws(()=>x.core.verifyCodeVault(admin),code('CODE_INTEGRITY'));x.core.close();
});
