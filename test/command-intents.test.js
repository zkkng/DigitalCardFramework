import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/http.js';
import {createClient,createCommandRunner} from '../src/client.js';
import {createAdminController} from '../src/admin-client.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin,code} from './helpers.js';
import {FrameworkError} from '../src/catalog.js';
import {CardFramework} from '../src/core.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Window} from 'happy-dom';
import {mountFramework} from '../src/ui.js';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),clear:()=>values.clear()};};
async function live(t,Store){
 const x=fixture({store:new Store()}),actor={...x.alice,role:'admin'};let handler,lose=null,identity=actor,limited=false;
 const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const expose=enabled=>{handler=createApiHandler({framework:x.core,allowedOrigin:origin,resolveIdentity:()=>identity,requirePrincipal:true,exposeOperators:enabled,rateLimit:()=>!limited});};expose(true);
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});x.core.close();});
 const client=()=>createClient({baseUrl:origin+'/api',fetch:async(url,options)=>{const response=await fetch(url,{...options,headers:{...options.headers,Origin:origin}});if(lose&&url.endsWith(lose)){lose=null;await response.text();throw new Error('Response lost');}return response;}});
 return {...x,actor,client,expose,lose:path=>{lose=path;},identity:value=>{identity=value;},limit:value=>{limited=value;}};
}
for(const Store of [MemoryStore,SQLiteStore])for(const point of ['/command-intents','/command-intents/execute'])test(Store.name+' recovers after erased storage and lost '+point,async t=>{
 const x=await live(t,Store),storage=memory(),first=x.client();await first.me();const quote=await first.quote({productId:'common',quantity:1}),run=createCommandRunner({client:first,storage,namespace:x.alice.userId});
 x.lose(point);await assert.rejects(run('purchase',quote),/Response lost/);const committed=point.endsWith('/execute');assert.equal(x.core.wallet(x.alice).credits,committed?9990:10000);run.dispose();storage.clear();
 const next=x.client();await next.me();const recover=createCommandRunner({client:next,storage,namespace:x.alice.userId});
 await assert.rejects(recover.beginNew('purchase',quote),code('COMMAND_PENDING'));
 const pending=await recover.recoverable('purchase');assert.equal(pending.items.length,1);const original=pending.items[0];const receipt=await recover.resume(original);assert.equal(x.core.wallet(x.alice).credits,9990);assert.deepEqual(await recover.recover('purchase',quote),receipt);
 assert.equal(x.core.packs(x.alice).length,1);const repeated=await recover.beginNew('purchase',quote);assert.notEqual(repeated.id,receipt.id);assert.equal(x.core.wallet(x.alice).credits,9980);assert.equal(x.core.audit(admin).ok,true);
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' commit before intent-finalization failure replays the original receipt',()=>{
 const store=new Store(),x=fixture({store});try{
  const quote=x.core.quote(x.alice,{productId:'common',quantity:1}),intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:quote}),transact=store.transact.bind(store);let inject=true;
  store.transact=fn=>transact(s=>{const result=fn(s);if(inject&&s.commandIntents?.[intent.id]?.state==='completed'){inject=false;throw new FrameworkError('FINALIZATION_INTERRUPTED','Interrupted before finalization',503);}return result;});
  assert.throws(()=>x.core.executeCommandIntent(x.alice,{id:intent.id}),code('FINALIZATION_INTERRUPTED'));assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.commandIntents(x.alice).items[0].state,'pending');
  const result=x.core.executeCommandIntent(x.alice,{id:intent.id});assert.equal(result.intent.state,'completed');assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.packs(x.alice).length,1);assert.deepEqual(x.core.executeCommandIntent(x.alice,{id:intent.id}).result,result.result);
 }finally{x.core.close();}
});

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' async execution preserves receipt after finalization interruption',async()=>{
 const store=new Store(),x=fixture({store});try{
  const intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.core.quote(x.alice,{productId:'common',quantity:1})}),transact=store.transact.bind(store);let inject=true;
  store.transact=fn=>transact(s=>{const result=fn(s);if(inject&&s.commandIntents?.[intent.id]?.state==='completed'){inject=false;throw new FrameworkError('FINALIZATION_INTERRUPTED','Interrupted before finalization',503);}return result;});
  const records=store.transactRecords.bind(store);store.transactRecords=(fn,options)=>records(tx=>{const result=fn(tx);if(inject&&tx.get('commandIntents',intent.id)?.state==='completed'){inject=false;throw new FrameworkError('FINALIZATION_INTERRUPTED','Interrupted before finalization',503);}return result;},options);
  await assert.rejects(x.core.executeCommandIntentAsync(x.alice,{id:intent.id}),code('FINALIZATION_INTERRUPTED'));assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.commandIntents(x.alice).items[0].state,'pending');
  await assert.rejects(x.core.executeCommandIntentAsync(x.bob,{id:intent.id}),code('NOT_FOUND'));
  const result=await x.core.executeCommandIntentAsync(x.alice,{id:intent.id});assert.equal(result.intent.state,'completed');assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.packs(x.alice).length,1);assert.deepEqual(x.core.executeCommandIntent(x.alice,{id:intent.id}).result,result.result);
 }finally{x.core.close();}
});

test('bounded encrypted intent lifecycle survives restart and full-capacity completion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bounded-intent-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core;
 try{
  let store=new SQLiteStore(path,{encryptionKey}),x=fixture({store});core=x.core;store.prepareRecordTransactions();const quote=core.quote(x.alice,{productId:'common',quantity:1});
  const before=store.diagnostics(),intent=core.registerCommandIntent(x.alice,{command:'purchase',input:quote});assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);
  const records=store.transactRecords.bind(store);let interrupted=false;store.transactRecords=(fn,options)=>records(tx=>{const result=fn(tx);if(!interrupted&&tx.get('commandIntents',intent.id)?.state==='completed'){interrupted=true;throw new FrameworkError('FINALIZATION_INTERRUPTED','Interrupted before finalization',503);}return result;},options);
  await assert.rejects(core.executeCommandIntentAsync(x.alice,{id:intent.id}),code('FINALIZATION_INTERRUPTED'));const receipt=await core.purchaseAsync(x.alice,intent.input);assert.equal(core.commandIntents(x.alice).items[0].state,'pending');assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);const cap=store.read(s=>store.measure(s).totalBytes);core.close();
  store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store});const restart=store.diagnostics(),recovered=await core.executeCommandIntentAsync(x.alice,{id:intent.id});assert.deepEqual(recovered.result,receipt);assert.equal(recovered.intent.state,'completed');core.acknowledgeCommandIntent(x.alice,{id:intent.id});assert.equal(store.diagnostics().compatibilityMaterializations,restart.compatibilityMaterializations);
  const open=core.registerCommandIntent(x.alice,{command:'openPack',input:{packId:receipt.packs[0].id}});assert.equal(open.state,'pending');await core.executeCommandIntentAsync(x.alice,{id:open.id});core.acknowledgeCommandIntent(x.alice,{id:open.id});assert.equal(core.audit(admin).ok,true);
  const state=store.read(s=>s);assert.throws(()=>core.registerCommandIntent(x.alice,{command:'purchase',input:quote}),code('STORAGE_CAPACITY'));assert.throws(()=>core.registerCommandIntent(x.alice,{command:'openPack',input:{packId:'__proto__'}}),code('STORAGE_CAPACITY'));assert.deepEqual(store.read(s=>s),state);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP direct and intent purchases await the asynchronous acquisition boundary',async t=>{
 const x=await live(t,SQLiteStore),client=x.client();await client.me();const quote=await client.quote({productId:'common',quantity:1}),purchase=x.core.purchaseAsync.bind(x.core);let calls=0,release,entered;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 x.core.purchaseAsync=async(...args)=>{calls++;const result=await purchase(...args);entered();await gate;return result;};
 let responded=false;const pending=client.purchase({...quote,key:'direct-async'}).then(result=>{responded=true;return result;});await started;assert.equal(responded,false);release();const receipt=await pending;assert.equal(receipt.packs.length,1);
 const intent=await client.registerCommandIntent({command:'purchase',input:quote}),result=await client.executeCommandIntent({id:intent.id});assert.equal(result.intent.state,'completed');assert.equal(result.result.packs.length,1);assert.equal(calls,2);assert.equal(x.core.wallet(x.alice).credits,9980);
});
test('encrypted restart retains recovery and acknowledgement at full storage capacity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'command-intent-restart-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core;
 try{
  let store=new SQLiteStore(path,{encryptionKey});const x=fixture({store});core=x.core;const quote=core.quote(x.alice,{productId:'common',quantity:1}),intent=core.registerCommandIntent(x.alice,{command:'purchase',input:quote}),receipt=core.executeCommandIntent(x.alice,{id:intent.id}).result;
  const cap=store.read(s=>store.measure(s).totalBytes);core.close();store=new SQLiteStore(path,{encryptionKey,maxStateBytes:cap});core=new CardFramework({store});
  assert.deepEqual(core.executeCommandIntent(x.alice,{id:intent.id}).result,receipt);assert.equal(core.commandIntents(x.alice).items.length,1);assert.deepEqual(core.acknowledgeCommandIntent(x.alice,{id:intent.id}),{id:intent.id,state:'acknowledged'});assert.deepEqual(core.acknowledgeCommandIntent(x.alice,{id:intent.id}),{id:intent.id,state:'acknowledged'});
  const before=store.read(s=>s);assert.throws(()=>core.registerCommandIntent(x.alice,{command:'purchase',input:quote}),code('STORAGE_CAPACITY'));assert.deepEqual(store.read(s=>s),before);assert.deepEqual(core.executeCommandIntent(x.alice,{id:intent.id}).result,receipt);assert.equal(core.audit(admin).ok,true);
 }finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});
test('intent operator routes enforce current permission and host exposure',async t=>{
 const x=await live(t,SQLiteStore),client=x.client();await client.me();const intent=await client.registerCommandIntent({command:'administerCards',input:{userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1,reason:'Replacement',expectedRevision:x.core.adminOverview(x.actor).revision}});
 x.identity(x.alice);assert.deepEqual(await client.commandIntents(),{items:[]});await assert.rejects(client.executeCommandIntent({id:intent.id}),code('FORBIDDEN'));await assert.rejects(client.acknowledgeCommandIntent({id:intent.id}),code('FORBIDDEN'));
 x.identity(x.actor);x.expose(false);assert.deepEqual(await client.commandIntents(),{items:[]});await assert.rejects(client.executeCommandIntent({id:intent.id}),code('FORBIDDEN'));x.expose(true);await client.executeCommandIntent({id:intent.id});assert.equal(x.core.inventory(x.bob).length,1);
 assert.throws(()=>x.core.acknowledgeCommandIntent(x.bob,{id:intent.id}),code('NOT_FOUND'));
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' concurrent tabs share one server intent and keep failures recoverable',async t=>{
 const x=await live(t,Store),a=x.client(),b=x.client();await a.me();await b.me();const quote=await a.quote({productId:'common',quantity:1}),one=createCommandRunner({client:a,storage:memory(),namespace:x.alice.userId}),two=createCommandRunner({client:b,storage:memory(),namespace:x.alice.userId});
 const results=await Promise.all([one('purchase',quote),two('purchase',quote)]);assert.deepEqual(results[0],results[1]);assert.equal(x.core.wallet(x.alice).credits,9990);
 x.limit(true);await assert.rejects(one.recover('purchase',quote),code('RATE_LIMITED'));x.limit(false);assert.deepEqual(await one.recover('purchase',quote),results[0]);
 x.identity(x.bob);await assert.rejects(two.recover('purchase',quote),code('PRINCIPAL_CHANGED'));x.identity(x.actor);assert.deepEqual(await two.recover('purchase',quote),results[0]);
 const other=x.core.commandIntents(x.bob);assert.equal(other.items.length,0);const intent=x.core.commandIntents(x.alice).items[0];assert.throws(()=>x.core.executeCommandIntent(x.bob,{id:intent.id}),code('NOT_FOUND'));
});
for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' admin remount discovers and replays issuance through the shared runner',async t=>{
 const x=await live(t,Store),storage=memory(),client=x.client();await client.me();let controller=createAdminController({client,storage,namespace:x.alice.userId});await controller.load();
 controller.stage({command:'administerCards',input:{userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1,reason:'Replacement'},title:'Give card',changes:[{label:'Cards',before:'0',after:'1'}]});x.lose('/command-intents/execute');await controller.confirm();assert.equal(x.core.inventory(x.bob).length,1);controller.dispose();storage.clear();
 const next=x.client();await next.me();controller=createAdminController({client:next,storage,namespace:x.alice.userId});await controller.load();assert.equal(controller.getState().pending,true);assert.equal(controller.getState().review.command,'administerCards');await controller.confirm();assert.equal(x.core.inventory(x.bob).length,1);assert.equal(controller.getState().pending,false);controller.dispose();
});
test('lost acknowledgement response permits one deliberate subsequent purchase',async t=>{
 const x=await live(t,SQLiteStore),client=x.client();await client.me();const quote=await client.quote({productId:'common',quantity:1}),runner=createCommandRunner({client,storage:memory(),namespace:x.alice.userId});await runner('purchase',quote);
 x.lose('/command-intents/acknowledge');await assert.rejects(runner.beginNew('purchase',quote),/Response lost/);assert.equal(x.core.wallet(x.alice).credits,9990);await runner.beginNew('purchase',quote);assert.equal(x.core.wallet(x.alice).credits,9980);
});
test('a different proposed purchase cannot hide the server-held original from recovery',async t=>{
 const x=await live(t,MemoryStore),client=x.client();await client.me();const original=await client.registerCommandIntent({command:'purchase',input:await client.quote({productId:'common',quantity:1})}),runner=createCommandRunner({client,storage:memory(),namespace:x.alice.userId});await assert.rejects(runner('purchase',await client.quote({productId:'rare',quantity:1})),code('COMMAND_PENDING'));const receipt=await runner.resume(original);assert.equal(receipt.packs[0].productId,'common');assert.equal(x.core.wallet(x.alice).credits,9990);
});
test('registered quote remains immutable and must be acknowledged after rejection',async t=>{
 const x=await live(t,MemoryStore),client=x.client();await client.me();const quote=await client.quote({productId:'common',quantity:1}),runner=createCommandRunner({client,storage:memory(),namespace:x.alice.userId});x.lose('/command-intents');await assert.rejects(runner('purchase',quote));
 const catalog=x.core.operatorCatalog(admin);catalog.version++;catalog.products.find(p=>p.id==='common').revision++;catalog.products.find(p=>p.id==='common').price.amount=20;x.core.publishCatalog(admin,catalog);
 await assert.rejects(runner.recover('purchase',quote),code('STALE_QUOTE'));assert.equal(x.core.wallet(x.alice).credits,10000);assert.equal(x.core.commandIntents(x.alice).items[0].state,'failed');await runner.beginNew('purchase',await client.quote({productId:'common',quantity:1}));assert.equal(x.core.wallet(x.alice).credits,9980);
});
test('disposal after registration prevents mutation and leaves server recovery available',async t=>{
 const x=await live(t,MemoryStore),client=x.client();await client.me();let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;}),original=client.registerCommandIntent;
 client.registerCommandIntent=async input=>{const result=await original(input);entered();await gate;return result;};const runner=createCommandRunner({client,storage:memory(),namespace:x.alice.userId}),quote=await client.quote({productId:'common',quantity:1}),task=runner('purchase',quote);await started;runner.dispose();release();await assert.rejects(task,code('COMMAND_DISPOSED'));assert.equal(x.core.wallet(x.alice).credits,10000);assert.equal(x.core.commandIntents(x.alice).items[0].state,'pending');
});
test('acknowledged failed commands never execute later when funds become available',()=>{
 const x=fixture();try{const actor={userId:x.core.registerUser(admin,{provider:'test',subject:'unfunded',displayName:'Unfunded'}).id},intent=x.core.registerCommandIntent(actor,{command:'purchase',input:x.core.quote(actor,{productId:'common',quantity:1})});assert.throws(()=>x.core.executeCommandIntent(actor,{id:intent.id}),code('INSUFFICIENT_FUNDS'));x.core.acknowledgeCommandIntent(actor,{id:intent.id});x.core.grantCurrency(admin,{key:'fund-later',userId:actor.userId,currencyId:'credits',amount:10,reason:'Funding'});assert.throws(()=>x.core.executeCommandIntent(actor,{id:intent.id}),code('INSUFFICIENT_FUNDS'));assert.equal(x.core.wallet(actor).credits,10);assert.equal(x.core.packs(actor).length,0);}finally{x.core.close();}
});
test('fresh reference UI displays server recovery after browser storage is erased',async t=>{
 const x=await live(t,SQLiteStore),client=x.client();await client.me();const quote=await client.quote({productId:'common',quantity:1}),intent=await client.registerCommandIntent({command:'purchase',input:quote});await client.executeCommandIntent({id:intent.id});
 const window=new Window({url:'http://localhost/'}),priorDocument=globalThis.document,priorStorage=globalThis.sessionStorage;globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;let mounted;
 try{
  const root=document.createElement('main');document.body.append(root);mounted=mountFramework(root,{client,sections:['packs']});await mounted.ready;const recovery=root.querySelector('[aria-label="Unconfirmed changes"]');assert(recovery);const button=[...recovery.querySelectorAll('button')].find(node=>node.textContent==='Recover pack purchase');assert(button);button.click();
  for(let i=0;i<100&&root.querySelector('[aria-label="Unconfirmed changes"]');i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(root.querySelector('[aria-label="Unconfirmed changes"]'),null);assert.match(root.textContent,/Original result recovered/);assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.packs(x.alice).length,1);
 }finally{mounted?.dispose();await window.happyDOM.abort();if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;if(priorStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=priorStorage;}
});

test('retained intent lookup validates owner and exact command after acknowledgement',()=>{
 const x=fixture();try{
  const intent=x.core.registerCommandIntent(x.alice,{command:'preferences',input:{inventoryVisibility:'public'}});x.core.executeCommandIntent(x.alice,{id:intent.id});x.core.acknowledgeCommandIntent(x.alice,{id:intent.id});
  assert.equal(x.core.commandIntents(x.alice,{command:'preferences'}).items.length,0);
  assert.deepEqual(x.core.commandIntent(x.alice,{id:intent.id,command:'preferences'}),{id:intent.id,userId:x.alice.userId,command:'preferences',state:'acknowledged'});
  assert.throws(()=>x.core.commandIntent(x.bob,{id:intent.id,command:'preferences'}),error=>error.code==='NOT_FOUND');
  assert.throws(()=>x.core.commandIntent(x.alice,{id:intent.id,command:'purchase'}),error=>error.code==='NOT_FOUND');
  assert.throws(()=>x.core.commandIntent(x.alice,{id:intent.id,command:'configureAdmin'},{operators:false}),error=>error.code==='FORBIDDEN');
 }finally{x.core.close();}
});
