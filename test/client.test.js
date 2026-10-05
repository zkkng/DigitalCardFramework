import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevealController,createCommandRunner,ApiError} from '../src/client.js';
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};

test('headless reveal can skip/replay without another opening or changing result',async()=>{
  let calls=0;
  const controller=createRevealController({open:async()=>{calls++;return {id:'pack',cards:[{id:'a'},{id:'b'}]};},key:()=> 'key'});
  const observed=[];const unsub=controller.subscribe(s=>observed.push(s.phase));
  await controller.load('pack');controller.reveal();assert.equal(controller.getState().revealed,1);
  controller.skip();assert.equal(controller.getState().phase,'complete');
  controller.replay();assert.equal(controller.getState().revealed,0);assert.equal(calls,1);
  assert(observed.includes('loading'));unsub();controller.dispose();
});
test('controller retries an interrupted open with the same key and ignores obsolete completion',async()=>{
  const inputs=[];let fail=true;
  const controller=createRevealController({key:()=> 'same-key',open:async input=>{inputs.push(input);if(fail){fail=false;throw new Error('interrupted');}return {id:'pack',cards:[]};}});
  await controller.load('pack');assert.equal(controller.getState().phase,'error');await controller.load('pack');
  assert.deepEqual(inputs[0],inputs[1]);controller.dispose();
  let resolve;
  const late=createRevealController({open:()=>new Promise(r=>resolve=r)});const task=late.load('late');late.dispose();
  resolve({id:'late',cards:[]});await task;assert.equal(late.getState().receipt,null);
});
test('durable command survives client recreation and keeps the original purchase quote',async()=>{
  const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const inputs=[];let failed=true,keys=0;
  const client={requestKey:()=>String(++keys),purchase:async input=>{inputs.push(structuredClone(input));if(failed){failed=false;throw new Error('response lost');}return {id:'receipt'};}};
  const first=createCommandRunner({client,storage,namespace:'alice'});
  await assert.rejects(first('purchase',{productId:'a',quantity:1,catalogVersion:1,productRevision:1}));
  const second=createCommandRunner({client,storage,namespace:'alice'});
  assert.equal((await second('purchase',{productId:'a',quantity:1,catalogVersion:2,productRevision:2})).id,'receipt');
  assert.deepEqual(inputs[0],inputs[1]);assert.equal(keys,1);
});
test('durable runner coalesces double clicks and releases keys after definitive rejection',async()=>{
  let resolve,calls=0,keys=0;
  const client={requestKey:()=>String(++keys),convert:input=>{calls++;return new Promise(r=>resolve=r);}};
  const run=createCommandRunner({client,storage:memory(),namespace:'collector'});
  const a=run('convert',{from:'a',to:'b',amount:2}),b=run('convert',{from:'a',to:'b',amount:2});
  assert.equal(a,b);await Promise.resolve();resolve({ok:true});await a;assert.equal(calls,1);
  client.convert=async()=>{throw new ApiError('INSUFFICIENT_FUNDS','no funds',409);};
  await assert.rejects(run.beginNew('convert',{from:'a',to:'b',amount:2}));
  await assert.rejects(run('convert',{from:'a',to:'b',amount:2}));assert.equal(keys,3);
});

test('durable runner handles synchronous provider errors without retaining a dead active promise',async()=>{
  let count=0;
  const run=createCommandRunner({storage:memory(),namespace:'collector',client:{requestKey:()=> 'fixed',convert:()=>{count++;throw new Error('offline');}}});
  await assert.rejects(run('convert',{amount:1}));
  await assert.rejects(run('convert',{amount:1}));
  assert.equal(count,2);
});
test('storage cleanup failure after a committed command cannot turn success into a duplicate debit',async()=>{
  let stored=null,calls=0,failClear=true;
  const storage={getItem:()=>stored,setItem:(key,value)=>{if(value.includes('"_confirmed":true')&&failClear)throw new Error('storage unavailable');stored=value;}};
  const inputs=[];
  const run=createCommandRunner({storage,namespace:'collector',client:{requestKey:()=> 'stable',purchase:async input=>{calls++;inputs.push(input);return {id:'same-receipt'};}}});
  assert.equal((await run('purchase',{productId:'a',quantity:1})).id,'same-receipt');
  failClear=false;
  assert.equal((await run('purchase',{productId:'a',quantity:1})).id,'same-receipt');
  assert.equal(inputs[0].key,inputs[1].key);
  assert.equal(Object.values(JSON.parse(stored))[0]._confirmed,true);
});
