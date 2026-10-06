import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createClient,createCommandRunner,ApiError} from '../src/client.js';
import {WireContractError} from '../src/wire-contracts.js';
import {createApiHandler} from '../src/http.js';
import {fixture} from './helpers.js';
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('the public client rejects invalid JSON requests before sending and checks successful responses',async()=>{
  const x=fixture();let calls=0;
  const quote=x.core.quote(x.alice,{productId:'common'});
  const client=createClient({fetch:async()=>{calls++;return new Response(JSON.stringify({...quote,price:{currencyId:'credits',amount:null}}));}});
  await assert.rejects(()=>client.quote({productId:'common',quantity:1.5}),error=>error instanceof ApiError&&error.status===400&&error.code==='INVALID_INPUT');assert.equal(calls,0);
  await assert.rejects(()=>client.quote({productId:'common'}),WireContractError);assert.equal(calls,1);
});

test('command invocation preserves custom adapter receiver binding',async()=>{
  const client={calls:0,requestKey:()=> 'receiver-key',purchase(input){this.calls++;assert.equal(input.key,'receiver-key');return Promise.resolve({id:'receipt'});}};
  const run=createCommandRunner({client,storage:storage(),namespace:'account'});
  assert.equal((await run('purchase',{productId:'product',quantity:1,catalogVersion:1,productRevision:1})).id,'receipt');assert.equal(client.calls,1);
});

test('mismatched recovery responses keep original intent and a never-sent invalid registration can be corrected',async t=>{
  const x=fixture();let handler,tamper=true,originalId;
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const client=createClient({baseUrl:origin+'/api',fetch:async(url,options)=>{
    const response=await fetch(url,{...options,headers:{...options.headers,Origin:origin}});
    if(tamper&&url.endsWith('/command-intents/execute')){tamper=false;const value=await response.json();originalId=value.result.id;value.intent.input.key='different-key';return new Response(JSON.stringify(value),{status:response.status});}
    return response;
  }});
  await client.me();const run=createCommandRunner({client,storage:storage(),namespace:x.alice.userId}),quote=await client.quote({productId:'common'});
  await assert.rejects(()=>run('purchase',{...quote,catalogVersion:0}),error=>error.code==='INVALID_INPUT'&&error.status===400);
  assert.equal(run.pending('purchase'),null);assert.deepEqual((await client.commandIntents({command:'purchase'})).items,[]);
  await assert.rejects(()=>run('purchase',quote),error=>error.code==='COMMAND_RECOVERY_MISMATCH'&&error.status===502);
  const key=run.pending('purchase').key;assert.equal(x.core.wallet(x.alice).credits,9990);
  const recovered=await run.recover('purchase',quote);assert.equal(recovered.id,originalId);assert.equal(run.pending('purchase').key,key);assert.equal(x.core.wallet(x.alice).credits,9990);
});

test('custom recovery adapters cannot substitute malformed results or pending intents for a completed command',async()=>{
  for(const fault of ['result','state']){
    const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'}),recovery={
      requestKey:()=> 'validated-result-key',principal:()=>x.alice.userId,
      commandIntents:input=>Promise.resolve(x.core.commandIntents(x.alice,input)),
      registerCommandIntent:input=>Promise.resolve(x.core.registerCommandIntent(x.alice,input)),
      acknowledgeCommandIntent:input=>Promise.resolve(x.core.acknowledgeCommandIntent(x.alice,input)),
      executeCommandIntent:async input=>{const actual=x.core.executeCommandIntent(x.alice,input);if(fault==='result')return {...actual,result:{id:'malformed'}};return {...actual,intent:{...actual.intent,state:'pending'}};}
    };
    const run=createCommandRunner({client:recovery,storage:storage(),namespace:x.alice.userId});
    await assert.rejects(()=>run('purchase',quote),error=>fault==='result'?error instanceof WireContractError:error.code==='COMMAND_RECOVERY_MISMATCH');
    const original=run.pending('purchase');assert.equal(original.key,'validated-result-key');assert.equal(original._confirmed,undefined);assert.equal(x.core.wallet(x.alice).credits,9990);
    recovery.executeCommandIntent=async input=>x.core.executeCommandIntent(x.alice,input);
    const recovered=await run.recover('purchase',quote);assert.equal(recovered.paid.amount,10);assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(run.pending('purchase').key,original.key);
  }
});
