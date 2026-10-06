import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createPluginHost,pluginProtocol,pluginCommands,validatePluginMessage} from '../src/plugin-host.js';
import {fixture} from './helpers.js';
const token='public-plugin-control-credential';
const handshake={protocol:pluginProtocol,pluginId:'example.reader',version:'1.0.0'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('malformed installed command configuration produces a bounded config error',()=>{
  for(const commands of [{purchase:true},[null],['purchase.execute']])assert.throws(()=>createPluginHost({framework:{inventoryPage:()=>({}),operatorCatalog:()=>({})},plugins:[{id:handshake.pluginId,version:handshake.version,token,commands,userIds:['owner']}],resolveActor:()=>null}),error=>error.code==='PLUGIN_CONFIG'&&error.status===400);
});
async function setup(options={}){
  const x=fixture();x.open();const actors=new Map([[x.a.id,x.alice],[x.b.id,x.bob]]);
  const framework={...Object.fromEntries(['inventoryPage','operatorCatalog','quote','commandIntents','registerCommandIntent','commandIntent','executeCommandIntentAsync','acknowledgeCommandIntent'].map(name=>[name,(...args)=>x.core[name](...args)])),...options.framework};
  const host=createPluginHost({framework,plugins:[{id:handshake.pluginId,version:handshake.version,token,commands:options.commands??['inventory.read','catalog.read'],userIds:[x.a.id,x.b.id]}],resolveActor:id=>actors.get(id)??null,...options.host});
  const server=createServer({maxHeaderSize:8192},async(request,response)=>{if(!await host.handle(request,response)){response.statusCode=404;response.end();}});
  server.headersTimeout=5000;server.requestTimeout=10000;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const post=async(path,value,headers={})=>{const response=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},body:typeof value==='string'?value:JSON.stringify(value)});const result=await response.json();validatePluginMessage(response.ok?path.endsWith('handshake')?'handshakeResponse':path.endsWith('close')?'closeResponse':'commandResponse':'error',result);return {status:response.status,result};};
  const ready=async()=>{const response=await post('/plugins/handshake',handshake);assert.equal(response.status,200);return response.result;};
  const delegate=(commands=['inventory.read'],actor=x.alice,ttlMs)=>host.issueDelegation({pluginId:handshake.pluginId,actor,commands,...(ttlMs?{ttlMs}:{})});
  const command=(session,delegation,options={})=>post('/plugins/commands',{protocol:pluginProtocol,sessionId:session.sessionId,requestId:'request-fixture',command:'inventory.read',input:{limit:1},...options},{'x-dc-delegation':delegation});
  return {...x,host,server,actors,url,post,ready,delegate,command,async close(){host.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}};
}
test('authenticated handshake and delegated command read actual owned inventory with two sessions',async()=>{
  const x=await setup();try{const first=await x.ready(),second=await x.ready(),delegation=x.delegate();assert.notEqual(first.sessionId,second.sessionId);assert.deepEqual(first.commands,['inventory.read','catalog.read']);for(const session of [first,second]){const response=await x.command(session,delegation);assert.equal(response.status,200);assert.equal(response.result.result.items[0].ownerId,x.a.id);assert.equal(response.result.result.items.length,1);assert(!JSON.stringify(response).includes(token));}const bob=await x.command(first,x.delegate(['inventory.read'],x.bob));assert.equal(bob.result.result.total,0);await x.post('/plugins/sessions/close',{protocol:pluginProtocol,sessionId:first.sessionId});assert.equal((await x.command(first,delegation)).status,403);assert.equal((await x.command(second,delegation)).status,200);}finally{await x.close();}
});
test('credential, installed identity, native actor and delegation scopes intersect',async()=>{
  const x=await setup();try{
    assert.equal((await x.post('/plugins/handshake',handshake,{authorization:'Bearer incorrect-service-credential'})).status,403);
    assert.equal((await x.post('/plugins/handshake',{...handshake,pluginId:'forged.plugin'})).status,403);
    assert.equal((await x.post('/plugins/handshake',{...handshake,version:'2.0.0'})).status,409);
    assert.equal((await x.post('/plugins/handshake',{...handshake,commands:['currency.grant']})).status,400);
    assert.equal((await x.post('/plugins/handshake',handshake,{cookie:'session=ambient'})).status,403);
    assert.equal((await x.post('/plugins/handshake',handshake,{origin:'https://other.example'})).status,403);
    const session=await x.ready(),delegation=x.delegate();
    for(const patch of [{actor:{userId:x.b.id,role:'admin'}},{userId:x.b.id},{command:'purchase',input:{}},{input:{userId:x.b.id}},{input:{limit:.5}},{input:{limit:201}},{input:null},{requestId:null}])assert.equal((await x.command(session,delegation,patch)).status,400);
    assert.equal((await x.command(session,'x'.repeat(43))).status,403);
    assert.equal((await x.command(session,delegation,{command:'catalog.read',input:{}})).status,403);
    const catalog=x.delegate(['catalog.read']);assert.equal((await x.command(session,catalog,{command:'catalog.read',input:{}})).status,403);
    x.actors.set(x.a.id,{...x.alice,permissions:['catalog.read']});assert.equal((await x.command(session,catalog,{command:'catalog.read',input:{}})).status,200);
    x.actors.set(x.a.id,{...x.alice,disabled:true});assert.equal((await x.command(session,delegation)).status,403);
    assert.throws(()=>x.delegate(['inventory.read'],{userId:'ungranted-user'}),error=>error.code==='PLUGIN_GRANT');
  }finally{await x.close();}
});
test('disable, grant change and credential rotation revoke old generations',async()=>{
  const x=await setup();try{const session=await x.ready(),delegation=x.delegate();x.host.setGrants(handshake.pluginId,['catalog.read']);assert.equal((await x.command(session,delegation)).status,403);x.host.disable(handshake.pluginId);assert.equal((await x.post('/plugins/handshake',handshake)).status,403);assert.throws(()=>x.host.enable(handshake.pluginId,{token}));const rotated='public-rotated-control-credential';x.host.enable(handshake.pluginId,{token:rotated,commands:['inventory.read']});assert.equal((await x.post('/plugins/handshake',handshake)).status,403);assert.equal((await x.post('/plugins/handshake',handshake,{authorization:'Bearer '+rotated})).status,200);}finally{await x.close();}
});
for(const withdrawal of ['disable','actor','delegation','session'])test('late read results are fenced after '+withdrawal,async()=>{
  const waiting=deferred(),started=deferred();const x=await setup({framework:{inventoryPage:async(...args)=>{started.resolve();await waiting.promise;return x.core.inventoryPage(...args);}}});
  try{const session=await x.ready(),delegation=x.delegate(),response=x.command(session,delegation);await started.promise;
    if(withdrawal==='disable')x.host.disable(handshake.pluginId);if(withdrawal==='actor')x.actors.set(x.a.id,{...x.alice,disabled:true});if(withdrawal==='delegation')x.host.revokeDelegation(delegation);if(withdrawal==='session')await x.post('/plugins/sessions/close',{protocol:pluginProtocol,sessionId:session.sessionId});
    waiting.resolve();const result=await response;assert([403,504].includes(result.status));assert.equal(result.result.result,undefined);
  }finally{waiting.resolve();await x.close();}
});
test('expiry is enforced after awaited work and expired read cannot expose data',async()=>{
  let now=Date.now();const waiting=deferred(),started=deferred();const x=await setup({host:{clock:()=>now,sessionTTL:50},framework:{inventoryPage:async(...args)=>{started.resolve();await waiting.promise;return x.core.inventoryPage(...args);}}});
  try{const session=await x.ready(),delegation=x.delegate(),response=x.command(session,delegation);await started.promise;now+=51;waiting.resolve();assert.equal((await response).status,403);assert.equal((await x.command(session,delegation)).status,403);}finally{waiting.resolve();await x.close();}
});
test('timeouts retain admission for a noncooperative authority adapter and never enter a query',async()=>{
  const waiting=deferred(),started=deferred();let hold=true,queries=0;const x=await setup({host:{timeoutMs:50,concurrency:1,resolveActor:async()=>{if(hold){started.resolve();await waiting.promise;}return x.alice;}},framework:{inventoryPage:(...args)=>{queries++;return x.core.inventoryPage(...args);}}});
  try{const session=await x.ready(),delegation=x.delegate(),first=x.command(session,delegation);await started.promise;assert.equal((await first).status,504);assert.equal((await x.command(session,delegation)).status,429);assert.equal(queries,0);hold=false;waiting.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(queries,0);assert.equal((await x.command(session,delegation)).status,200);assert.equal(queries,1);}finally{waiting.resolve();await x.close();}
});
test('session, delegation and output capacity refuse new work without evicting valid grants',async()=>{
  const x=await setup({host:{maxSessions:1,maxDelegations:1,maxResponseBytes:512}});try{const session=await x.ready(),delegation=x.delegate();assert.equal((await x.post('/plugins/handshake',handshake)).status,507);assert.throws(()=>x.delegate(),error=>error.code==='PLUGIN_CAPACITY');const response=await x.command(session,delegation);assert.equal(response.status,413);assert.equal(response.result.result,undefined);x.host.revokeDelegation(delegation);assert.equal(typeof x.delegate(),'string');}finally{await x.close();}
});
test('malformed framework output fails its actual response contract',async()=>{
  const x=await setup({framework:{inventoryPage:()=>({items:[{id:'unvalidated'}],total:1,next:null})}});try{const response=await x.command(await x.ready(),x.delegate());assert.equal(response.status,502);assert.equal(response.result.error.code,'PLUGIN_CONTRACT');}finally{await x.close();}
});

test('deadline remains enforced while preparing a validated response',async()=>{
  let now=Date.now();const x=await setup({host:{clock:()=>now,timeoutMs:100},framework:{inventoryPage:(...args)=>{const page=x.core.inventoryPage(...args);return {...page,get total(){now+=101;return page.total;}};}}});
  try{const response=await x.command(await x.ready(),x.delegate());assert.equal(response.status,504);assert.equal(response.result.result,undefined);}finally{await x.close();}
});
test('native catalog permission is rechecked after an awaited read',async()=>{
  const waiting=deferred(),started=deferred();const x=await setup({framework:{operatorCatalog:async(...args)=>{const result=x.core.operatorCatalog(...args);started.resolve();await waiting.promise;return result;}}});
  try{x.actors.set(x.a.id,{...x.alice,permissions:['catalog.read']});const task=x.command(await x.ready(),x.delegate(['catalog.read']),{command:'catalog.read',input:{}});await started.promise;x.actors.set(x.a.id,x.alice);waiting.resolve();assert.equal((await task).status,403);}finally{waiting.resolve();await x.close();}
});

test('a purchase committed before revocation remains recoverable without another debit',async()=>{
  const waiting=deferred(),started=deferred();const x=await setup({commands:[...pluginCommands],framework:{executeCommandIntentAsync:async(...args)=>{const result=await x.core.executeCommandIntentAsync(...args);started.resolve();await waiting.promise;return result;}}});
  try{const session=await x.ready(),delegation=x.delegate([...pluginCommands]),quote=x.core.quote(x.alice,{productId:'common',quantity:1}),intent=(await x.command(session,delegation,{command:'purchase.register',input:quote})).result.result,start=x.core.wallet(x.alice).credits;
    const pending=x.command(session,delegation,{command:'purchase.execute',input:{id:intent.id}});await started.promise;x.actors.set(x.a.id,{...x.alice,disabled:true});waiting.resolve();assert.equal((await pending).status,403);assert.equal(x.core.wallet(x.alice).credits,start-10);
    x.actors.set(x.a.id,x.alice);const recovered=await x.command(session,delegation,{command:'purchase.execute',input:{id:intent.id}});assert.equal(recovered.status,200);assert.equal(recovered.result.result.intent.state,'completed');assert.equal(x.core.wallet(x.alice).credits,start-10);
  }finally{waiting.resolve();await x.close();}
});

test('authority is rechecked after intent lookup before entering the purchase mutation',async()=>{
  const waiting=deferred(),started=deferred();let executes=0;const x=await setup({commands:[...pluginCommands],framework:{commandIntent:async(...args)=>{const result=x.core.commandIntent(...args);started.resolve();await waiting.promise;return result;},executeCommandIntentAsync:(...args)=>{executes++;return x.core.executeCommandIntentAsync(...args);}}});
  try{const session=await x.ready(),delegation=x.delegate([...pluginCommands]),intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.core.quote(x.alice,{productId:'common',quantity:1})}),start=x.core.wallet(x.alice).credits;
    const pending=x.command(session,delegation,{command:'purchase.execute',input:{id:intent.id}});await started.promise;x.actors.set(x.a.id,{...x.alice,disabled:true});waiting.resolve();assert.equal((await pending).status,403);assert.equal(executes,0);assert.equal(x.core.wallet(x.alice).credits,start);
  }finally{waiting.resolve();await x.close();}
});
test('Python plugin performs authenticated handshake, actual scoped read and session cleanup',{skip:!process.env.DC_TEST_PYTHON_PLUGIN,timeout:15000},async()=>{
  const x=await setup();try{
    const delegation=x.delegate(),child=spawn(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[fileURLToPath(new URL('../examples/plugins/python-plugin-client.py',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PLUGIN_CONTROL_URL:x.url,PLUGIN_TOKEN:token,PLUGIN_DELEGATION:delegation,PYTHONDONTWRITEBYTECODE:'1'}});
    let output='',errors='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
    assert.equal((await once(child,'exit'))[0],0,errors);const page=JSON.parse(output);assert.equal(page.total,1);assert.equal(page.items[0].ownerId,x.a.id);assert.equal(x.host.status()[0].sessions,0);assert(!output.includes(token));assert(!output.includes(delegation));
  }finally{await x.close();}
});
