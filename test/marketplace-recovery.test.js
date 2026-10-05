import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {fixture,admin} from './helpers.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {renderMarketplace} from '../src/marketplace-ui.js';
import {createCommandRunner} from '../src/client.js';
const memory=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const settle=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));};
const click=(root,label)=>{const button=[...root.querySelectorAll('button')].find(node=>node.textContent===label);assert(button,'Missing '+label);assert(!button.disabled);button.click();};
for(const Store of [MemoryStore,SQLiteStore])test('marketplace remount recovers the original committed purchase after stock cancellation on '+Store.name,async()=>{
  const window=new Window({url:'http://localhost/'});globalThis.document=window.document;
  const storage=memory(),x=fixture({store:new Store()}),seller={...x.alice,role:'admin'};let view;
  try{
    const shop=x.core.createShop(seller,{key:'shop',name:'Stock',kind:'admin'});
    const listing=x.core.createListing(seller,{key:'stock',shopId:shop.id,title:'Card',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:3}});
    let keys=0,quotes=0,lost=true;const inputs=[];
    const client={requestKey:()=>String(++keys),commerceSettings:async()=>x.core.commerceSettings()};
    for(const name of ['shops','listings','orders'])client[name]=async input=>x.core[name](x.bob,input);
    client.quoteListing=async input=>{quotes++;const quote=x.core.quoteListing(x.bob,input);quote.items[0].secretFixture='DO-NOT-PERSIST-ITEMS';return quote;};
    client.buyListing=async input=>{inputs.push(structuredClone(input));const order=x.core.buyListing(x.bob,input);if(lost){lost=false;throw new Error('Lost committed response');}return order;};
    const model={me:x.core.me(x.bob),catalog:x.core.catalog(),inventory:[],packs:[]};
    const mount=async()=>{view=renderMarketplace(model,{client,storage,listingRenderer:(item,{purchase})=>{const button=document.createElement('button');button.textContent='Buy';button.onclick=()=>purchase(item);return button;}});document.body.append(view.node);await view.ready;};
    const before=x.core.wallet(x.bob).credits;await mount();click(view.node,'Buy');await settle();click(view.node,'Confirm purchase');await settle();assert.equal(x.core.orders(x.bob).total,1);assert.equal(before-x.core.wallet(x.bob).credits,20);
    assert(![...storage.values.values()].join('').includes('DO-NOT-PERSIST-ITEMS'));view.dispose();view.node.remove();
    x.core.cancelListing(seller,{key:'cancel-stock',listingId:listing.id});await mount();click(view.node,'Retry original purchase');await settle();click(view.node,'Confirm purchase');await settle();
    assert.equal(x.core.orders(x.bob).total,1);assert.equal(before-x.core.wallet(x.bob).credits,20);assert.deepEqual(inputs[0],inputs[1]);assert.equal(quotes,1);assert.equal(keys,1);assert(x.core.audit(admin).ok);
  }finally{view?.dispose();view?.node.remove();x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});

test('a pending purchase blocks changed intentions and a changed principal cannot dispatch it',async()=>{
  const storage=memory();let principal='alice',calls=0;
  const client={principal:()=>principal,requestKey:()=> 'original',purchase:async()=>{calls++;throw new Error('Unknown outcome');}};
  const run=createCommandRunner({client,storage,namespace:'alice'});await assert.rejects(run('purchase',{productId:'one',quantity:1}));
  await assert.rejects(run('purchase',{productId:'two',quantity:1}),e=>e.code==='COMMAND_PENDING');principal='bob';await assert.rejects(run('purchase',{productId:'one',quantity:1}),e=>e.code==='PRINCIPAL_CHANGED');assert.equal(calls,1);assert.equal(run.pending('purchase').productId,'one');
});

test('disposal before dispatch and after response loss preserves original recovery without late cleanup',async()=>{
  const storage=memory();let calls=0,resolve;
  const client={requestKey:()=> 'original',purchase:()=>{calls++;return new Promise(done=>resolve=done);}};
  const first=createCommandRunner({client,storage,namespace:'alice'}),task=first('purchase',{productId:'one',quantity:1});first.dispose();await assert.rejects(task,e=>e.code==='COMMAND_DISPOSED');assert.equal(calls,0);
  const second=createCommandRunner({client,storage,namespace:'alice'}),pending=second('purchase',{productId:'one',quantity:1});await Promise.resolve();second.dispose();resolve({id:'receipt'});await assert.rejects(pending,e=>e.code==='COMMAND_DISPOSED');const next=createCommandRunner({client,storage,namespace:'alice'});assert.equal(next.pending('purchase').key,'original');
});

test('persistence readback failure rejects before dispatch and corrupt state is retained',async()=>{
  let calls=0,raw='{broken';const client={requestKey:()=> 'original',purchase:async()=>{calls++;}};
  for(const storage of [{getItem:()=>raw,setItem:(_,v)=>raw=v},{getItem:()=>null,setItem(){}}]){const run=createCommandRunner({client,storage,namespace:'alice'});await assert.rejects(run('purchase',{productId:'one',quantity:1}),e=>e.code==='COMMAND_STORAGE_UNAVAILABLE');}
  assert.equal(raw,'{broken');assert.equal(calls,0);
});

test('multiple runners retain a confirmed original for remount and require deliberate second purchase',async()=>{
  const storage=memory(),x=fixture();let keys=0,lost=true;const inputs=[];
  try{
    const client={requestKey:()=>String(++keys),purchase:async input=>{inputs.push(structuredClone(input));const result=x.core.purchase(x.alice,input);if(lost){lost=false;throw new Error('Lost response');}return result;}};
    const quote=x.core.quote(x.alice,{productId:'common'}),first=createCommandRunner({client,storage,namespace:x.alice.userId}),second=createCommandRunner({client,storage,namespace:x.alice.userId}),before=x.core.wallet(x.alice).credits;
    await assert.rejects(first('purchase',quote));const receipt=await second('purchase',quote);assert.equal(before-x.core.wallet(x.alice).credits,10);
    const remounted=createCommandRunner({client,storage,namespace:x.alice.userId});assert.deepEqual(await remounted('purchase',quote),receipt);assert.deepEqual(await first('purchase',quote),receipt);assert.equal(keys,1);
    const next=await remounted.beginNew('purchase',quote);assert.notEqual(next.id,receipt.id);assert.equal(before-x.core.wallet(x.alice).credits,20);assert.equal(keys,2);assert.equal(inputs[0].key,inputs[1].key);assert.equal(inputs[1].key,inputs[2].key);assert(x.core.audit(admin).ok);
  }finally{x.core.close();}
});

test('acknowledged recurring conversions and A to B to A preference edits perform new commands',async()=>{
  const x=fixture(),storage=memory();let keys=0;
  try{
    const client={requestKey:()=>String(++keys),convert:async input=>x.core.convert(x.alice,input),preferences:async input=>x.core.setPreferences(x.alice,input)},run=createCommandRunner({client,storage,namespace:x.alice.userId});
    const conversion={from:'credits',to:'gems',amount:300,catalogVersion:1},before=x.core.wallet(x.alice).credits;
    await run('convert',conversion);await run('convert',conversion);assert.equal(before-x.core.wallet(x.alice).credits,600);assert.equal(keys,2);
    await run('preferences',{inventoryVisibility:'private'});await run('preferences',{inventoryVisibility:'public'});await run('preferences',{inventoryVisibility:'private'});assert.equal(x.core.me(x.alice).preferences.inventoryVisibility,'private');assert.equal(keys,5);assert(x.core.audit(admin).ok);
  }finally{x.core.close();}
});

test('unresolved listing B takes priority over confirmed listing A during actual remount recovery',async()=>{
  const window=new Window({url:'http://localhost/'});globalThis.document=window.document;const x=fixture(),storage=memory(),seller={...x.alice,role:'admin'};let view,keys=0,lost=false;
  try{
    const shop=x.core.createShop(seller,{key:'shop',name:'Stock',kind:'admin'}),listings=['A','B'].map(title=>x.core.createListing(seller,{key:'stock-'+title,shopId:shop.id,title,price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2}}));
    const client={requestKey:()=>String(++keys),commerceSettings:async()=>x.core.commerceSettings()};for(const name of ['shops','listings','orders','quoteListing'])client[name]=async input=>x.core[name](x.bob,input);client.buyListing=async input=>{const order=x.core.buyListing(x.bob,input);if(lost&&input.listingId===listings[1].id){lost=false;throw new Error('Lost B response');}return order;};
    const run=createCommandRunner({client,storage,namespace:x.bob.userId});await run('buyListing',x.core.quoteListing(x.bob,{listingId:listings[0].id}));lost=true;await assert.rejects(run('buyListing',x.core.quoteListing(x.bob,{listingId:listings[1].id})));assert.equal(run.pending('buyListing').listingId,listings[1].id);
    view=renderMarketplace({me:x.core.me(x.bob),catalog:x.core.catalog(),inventory:[],packs:[]},{client,storage});document.body.append(view.node);await view.ready;click(view.node,'Retry original purchase');await settle();click(view.node,'Confirm purchase');await settle();assert.equal(x.core.orders(x.bob).total,2);assert.equal(x.core.wallet(x.bob).credits,9960);assert.equal(keys,2);assert(x.core.audit(admin).ok);
  }finally{view?.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});

test('terminal history stays bounded across runners without discarding unresolved purchases',async()=>{
  const storage=memory();let keys=0,calls=0;
  const client={requestKey:()=>String(++keys),purchase:async()=>{throw new Error('Unknown purchase outcome');},preferences:async()=>{calls++;return {ok:true};}};
  const first=createCommandRunner({client,storage,namespace:'collector'}),second=createCommandRunner({client,storage,namespace:'collector'});await assert.rejects(first('purchase',{productId:'one',quantity:1}));
  for(let n=0;n<1001;n++)await (n%2?first:second)('preferences',{fixtureValue:n});
  const saved=JSON.parse([...storage.values.values()][0]);assert(Object.keys(saved).length<=257);assert.equal(calls,1001);const remounted=createCommandRunner({client,storage,namespace:'collector'});assert.equal(remounted.pending('purchase').key,'1');await assert.rejects(remounted.beginNew('purchase',{productId:'two',quantity:1}),e=>e.code==='COMMAND_PENDING');await remounted('preferences',{fixtureValue:1002});assert.equal(calls,1002);
});

test('a full unresolved record budget refuses admission without writing record 1001 or dispatching',async()=>{
  const values=Object.fromEntries(Array.from({length:1000},(_,n)=>['preferences:fixture-'+n,{key:'pending-'+n,fixtureValue:n}]));const storage=memory();storage.setItem('digital-card.commands.v1:collector',JSON.stringify(values));let calls=0;
  const run=createCommandRunner({client:{requestKey:()=> 'new',convert:async()=>calls++},storage,namespace:'collector'});await assert.rejects(run('convert',{amount:1}),e=>e.code==='COMMAND_STORAGE_UNAVAILABLE');assert.equal(calls,0);assert.equal(Object.keys(JSON.parse([...storage.values.values()][0])).length,1000);assert(run.pending('preferences'));
});
