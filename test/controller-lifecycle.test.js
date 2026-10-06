import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevealController} from '../src/client.js';
import {createTradeDraft} from '../src/trade-client.js';
import {createAdminController} from '../src/admin-client.js';
import {Window} from 'happy-dom';
import {renderTradingControls} from '../src/marketplace-ui.js';
import {fixture} from './helpers.js';

test('reveal disposal is terminal before dispatch and after a ready receipt', async () => {
  for (const loaded of [false,true]) {
    let calls=0, keys=0, published=0;
    const controller=createRevealController({open:async()=>{calls++;return {cards:[{id:'one'}]};},key:()=>String(++keys)});
    if(loaded)await controller.load('one');
    controller.dispose();const before=controller.getState();
    controller.subscribe(()=>published++);await controller.load('two');controller.reveal();controller.skip();controller.replay();controller.dispose();
    assert.equal(calls,Number(loaded));assert.equal(keys,Number(loaded));assert.equal(published,0);assert.deepEqual(controller.getState(),before);
  }
});

test('disposed trade drafts cannot read, restore listeners, clear storage or build commands',async()=>{
  let reads=0,removed=0,published=0;
  const draft=createTradeDraft({client:{tradeInventory:async()=>{reads++;return {items:[],owner:null,next:'next'};}},userId:'collector',catalog:{features:{cardTrading:true,currencyTrading:true},currencies:[]},storage:{getItem:()=>null,setItem(){},removeItem(){removed++;}}});
  draft.dispose();const before=draft.getState();draft.subscribe(()=>published++);
  await draft.load('partner');await draft.more('give');draft.clear();draft.add('give','copy');draft.remove('give','copy');draft.setCurrency('give','missing',2);draft.setMessage('changed');draft.review();
  assert.throws(()=>draft.buildOffer(),/disposed/);assert.equal(reads,0);assert.equal(removed,0);assert.equal(published,0);assert.deepEqual(draft.getState(),before);
});

test('disposed admin controllers cannot issue subsequent queries or mutations',async()=>{
  let calls=0,published=0;
  const client=Object.fromEntries(['adminOverview','adminUsers','adminUser','adminHistory','configureAdmin','administerCards'].map(name=>[name,async()=>{calls++;throw new Error('Unexpected dispatch');}]));
  const controller=createAdminController({client,namespace:'operator'});controller.dispose();const before=controller.getState();controller.subscribe(()=>published++);
  await controller.load();await controller.users();await controller.person('collector');await controller.history();await controller.confirm();assert.equal(controller.stage({}),false);assert.equal(controller.cancel(),false);
  assert.equal(calls,0);assert.equal(published,0);assert.deepEqual(controller.getState(),before);
});

test('late reveal failures cannot publish into a disposed controller',async()=>{
  let reject,published=0;const controller=createRevealController({open:()=>new Promise((_,fail)=>reject=fail)});controller.subscribe(()=>published++);const task=controller.load('one');controller.dispose();const before=controller.getState(),count=published;reject(new Error('Late failure'));await task;assert.deepEqual(controller.getState(),before);assert.equal(published,count);
});

test('an admin confirmation disposed before its dispatch microtask remains recoverable without mutation',async()=>{
  const x=fixture(),actor={...x.alice,role:'admin'},values=new Map();let mutations=0;
  try{
    const controller=createAdminController({namespace:actor.userId,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},client:{requestKey:()=> 'pending-confirmation',adminOverview:async()=>x.core.adminOverview(actor),configureAdmin:async input=>{mutations++;return x.core.configureAdmin(actor,input);}}});
    await controller.load();controller.stage({input:{scope:'site',changes:{packPurchasesPaused:true},reason:'Synthetic lifecycle check'},title:'Pause',changes:[{name:'Pause',before:false,after:true}]});const task=controller.confirm();controller.dispose();await task;
    assert.equal(mutations,0);assert([...values.values()].join('').includes('pending-confirmation'));assert.equal(x.core.adminOverview(actor).revision,0);
  }finally{x.core.close();}
});

test('a detached trading-policy control cannot dispatch after view disposal',async()=>{
  const window=new Window();globalThis.document=window.document;let calls=0;
  try{const view=renderTradingControls({inventory:[]},{client:{tradingPolicy:async()=>({revision:0,policy:{}}),configureTrading:async()=>{calls++;return {revision:1};}}});document.body.append(view.node);await view.ready;const button=[...view.node.querySelectorAll('button')].find(node=>node.textContent==='Apply trading policy');assert(button);view.dispose();button.click();await Promise.resolve();assert.equal(calls,0);}
  finally{await window.happyDOM.abort();delete globalThis.document;}
});


test('synchronous loading subscribers cannot dispatch after controller disposal',async()=>{
  let calls=0;const reveal=createRevealController({open:async()=>{calls++;return {cards:[]};},key:()=> 'key'});
  reveal.subscribe(state=>{if(state.phase==='loading')reveal.dispose();});await reveal.load('one');assert.equal(calls,0);
  for(const [method,flag]of [['load','phase'],['users','loadingUsers'],['person','loadingPerson'],['history','loadingHistory']]){
    const client=Object.fromEntries(['adminOverview','adminUsers','adminUser','adminHistory'].map(name=>[name,async()=>{calls++;return {items:[]};}]));
    const controller=createAdminController({client,namespace:'one'});controller.subscribe(state=>{if(flag==='phase'?state.phase==='loading':state[flag])controller.dispose();});await controller[method]('one');assert.equal(calls,0);
  }
  const trade=createTradeDraft({client:{tradeInventory:async()=>{calls++;return {items:[],owner:null,next:null};}},userId:'one',catalog:{features:{cardTrading:true},currencies:[]}});
  trade.subscribe(state=>{if(state.phase==='loading')trade.dispose();});await trade.load('two');assert.equal(calls,0);
});
test('nested loading replaces obsolete dispatch and notification for reveal and trade',async()=>{
  const calls=[],states=[];let redirected=false;
  const reveal=createRevealController({open:async input=>{calls.push(input.packId);return {cards:[]};},key:()=> 'key'});
  reveal.subscribe(state=>{if(state.phase==='loading'&&!redirected){redirected=true;void reveal.load('new');}});reveal.subscribe(state=>states.push(state.phase));
  await reveal.load('old');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['new']);assert.deepEqual(states,['idle','loading','ready']);
  const reads=[];redirected=false;const trade=createTradeDraft({client:{tradeInventory:async id=>{reads.push(id);return {items:[],owner:null,next:null};}},userId:'one',catalog:{features:{cardTrading:true},currencies:[]}});
  trade.subscribe(state=>{if(state.phase==='loading'&&!redirected){redirected=true;void trade.load('new');}});await trade.load('old');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(reads,['one','new']);
});
test('nested admin loading supersedes the older generation before any read',async()=>{
  for(const [method,flag]of [['load','phase'],['users','loadingUsers'],['person','loadingPerson'],['history','loadingHistory']]){
    let calls=0,redirected=false;const client={adminOverview:async()=>{calls++;return {};},adminUsers:async()=>{calls++;return {items:[]};},adminUser:async()=>{calls++;return {user:{id:'new'},inventory:{items:[]}};},adminHistory:async()=>{calls++;return {items:[]};}};
    const controller=createAdminController({client,namespace:'one'});controller.subscribe(state=>{if((flag==='phase'?state.phase==='loading':state[flag])&&!redirected){redirected=true;void controller[method]('new');}});await controller[method]('old');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);controller.dispose();
  }
});
