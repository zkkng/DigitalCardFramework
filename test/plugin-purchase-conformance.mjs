import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createPluginHost,pluginCommands} from '../src/plugin-host.js';
import {fixture,admin} from './helpers.js';

const binary=process.argv[2],python=process.argv[3]??'python3';
if(!binary)throw Error('Pass Go plugin-client executable or --python-only, then Python interpreter');
const clients=[['Python',python,[fileURLToPath(new URL('../examples/plugins/python-plugin-client.py',import.meta.url)),'--command-json']],...(binary==='--python-only'?[]:[['Go',binary,[]]])];
for(const [language,executable,args]of clients)test(language+' durable purchase recovery over authenticated plugin HTTP',async()=>{
  const x=fixture(),credential='public-purchase-control-credential';let lose;
  const adapters=Object.fromEntries(['inventoryPage','operatorCatalog','quote','commandIntents','registerCommandIntent','commandIntent','executeCommandIntentAsync','acknowledgeCommandIntent'].map(name=>[name,(...args)=>x.core[name](...args)]));
  for(const [method,command]of [['registerCommandIntent','purchase.register'],['executeCommandIntentAsync','purchase.execute'],['acknowledgeCommandIntent','purchase.acknowledge']]){const original=adapters[method];adapters[method]=async(...args)=>{const result=await original(...args);if(lose===command){lose='drop';}return result;};}
  const host=createPluginHost({framework:adapters,plugins:[{id:'example.reader',version:'1.0.0',token:credential,commands:[...pluginCommands],userIds:[x.a.id,x.b.id]}],resolveActor:id=>id===x.a.id?x.alice:id===x.b.id?x.bob:null});
  const server=createServer(async(req,res)=>{const end=res.end.bind(res);res.end=(...args)=>{if(lose==='drop'){lose=undefined;res.destroy();return res;}return end(...args);};if(!await host.handle(req,res)){res.statusCode=404;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const delegation=host.issueDelegation({pluginId:'example.reader',actor:x.alice,commands:[...pluginCommands]}),url='http://127.0.0.1:'+server.address().port;
  const call=async(command,input={},options={})=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PLUGIN_CONTROL_URL:url,PLUGIN_TOKEN:credential,PLUGIN_DELEGATION:options.delegation??delegation}});
    let out='',errors='';child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>errors+=value);child.stdin.end(JSON.stringify({command,input}));const [code]=await once(child,'exit');assert(!out.includes(credential)&&!errors.includes(credential));assert(!out.includes(delegation)&&!errors.includes(delegation));
    if(options.reject){assert.notEqual(code,0);assert.equal(out,'');return;}
    assert.equal(code,0,errors);return JSON.parse(out);
  };
  try{
    const start=x.core.wallet(x.alice).credits,quote=await call('purchase.quote',{productId:'common',quantity:1});
    lose='purchase.register';await call('purchase.register',quote,{reject:true});let heads=await call('purchase.pending');assert.equal(heads.items.length,1);const intent=heads.items[0];assert.equal(intent.command,'purchase');assert.equal(typeof intent.input.key,'string');assert.equal(x.core.wallet(x.alice).credits,start);
    const other=await call('purchase.quote',{productId:'rare',quantity:1});assert.deepEqual(await call('purchase.register',other),intent);
    lose='purchase.execute';await call('purchase.execute',{id:intent.id},{reject:true});assert.equal(x.core.wallet(x.alice).credits,start-10);heads=await call('purchase.pending');assert.equal(heads.items[0].state,'completed');
    const recovered=await call('purchase.execute',{id:intent.id});assert.equal(recovered.result.packs.length,1);assert.deepEqual(await call('purchase.execute',{id:intent.id}),recovered);assert.equal(x.core.wallet(x.alice).credits,start-10);
    const bob=host.issueDelegation({pluginId:'example.reader',actor:x.bob,commands:['purchase.execute']});await call('purchase.execute',{id:intent.id},{delegation:bob,reject:true});
    const foreign=x.core.registerCommandIntent(x.alice,{command:'preferences',input:{}});await call('purchase.execute',{id:foreign.id},{reject:true});
    lose='purchase.acknowledge';await call('purchase.acknowledge',{id:intent.id},{reject:true});assert.deepEqual(await call('purchase.pending'),{items:[]});assert.deepEqual(await call('purchase.acknowledge',{id:intent.id}),{id:intent.id,state:'acknowledged'});
    await call('purchase.register',{...quote,key:'caller-selected-key'},{reject:true});await call('purchase.register',{...quote,adminRevision:undefined},{reject:true});
    const stale=await call('purchase.register',{...quote,catalogVersion:quote.catalogVersion+1});await call('purchase.execute',{id:stale.id},{reject:true});assert.equal((await call('purchase.pending')).items[0].state,'failed');await call('purchase.execute',{id:stale.id},{reject:true});await call('purchase.acknowledge',{id:stale.id});
    assert.equal(x.core.wallet(x.alice).credits,start-10);assert.equal(x.core.audit(admin).ok,true);
  }finally{host.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
});
