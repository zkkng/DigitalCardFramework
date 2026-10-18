import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {fixture} from './helpers.js';
import {mountFramework} from '../src/ui.js';
import {ApiError} from '../src/client.js';

const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const find=(root,label)=>[...root.querySelectorAll('button')].find(button=>button.textContent.startsWith(label));
const click=(root,label)=>{const button=find(root,label);assert(button,'Missing '+label);assert(!button.hidden&&!button.disabled,'Unavailable '+label);button.click();return button;};
function setup({tickets=true,version=1}={}){
  const window=new Window({url:'http://localhost/'});globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
  const x=fixture(),catalog=structuredClone(x.core.catalog()),product=catalog.products.find(product=>product.id==='common');catalog.products=[product];
  if(tickets)product.allocationStrategy={algorithm:'weighted-deck@'+version,version,deckScope:'purchase-slot'};
  const calls={quotes:[],purchases:[],statuses:[],acknowledgements:[]};let principal='collector',keys=0,digest='a'.repeat(64),allocationState='idle';
  const client={principal:()=>principal,requestKey:()=> 'purchase-'+(++keys),catalog:async()=>catalog,me:async()=>({userId:principal,displayName:'Collector'}),wallet:async()=>({credits:1000000,gems:1000000}),inventory:async()=>[],packs:async()=>[],albums:async()=>[],trades:async()=>[],availability:async()=>({variants:[],products:[]}),pity:async()=>({}),
    quote:async input=>{calls.quotes.push(input);return {productId:product.id,quantity:input.quantity,productRevision:product.revision,catalogVersion:catalog.version,adminRevision:0,price:{currencyId:product.price.currencyId,amount:product.price.amount*input.quantity},...(tickets?{allocationDigest:digest}:{})};},
    purchase:async input=>{calls.purchases.push(input);return {id:'receipt',packs:[{id:'pack'}],paid:input.price};},
    allocationStatus:async input=>{calls.statuses.push(input);return {productId:product.id,attemptId:['idle','acknowledged'].includes(allocationState)?null:'attempt',state:allocationState,errorCode:allocationState==='stale'?'ALLOCATION_STALE':null};},
    acknowledgeAllocation:async input=>{calls.acknowledgements.push(input);allocationState='acknowledged';return {attemptId:input.attemptId,state:'acknowledged'};}
  };
  const root=document.createElement('main');document.body.append(root);let mounted;
  return {window,root,client,calls,product,catalog,async mount(){mounted=mountFramework(root,{client,sections:['shop']});await mounted.ready;return mounted;},setPrincipal(value){principal=value;},setDigest(value){digest=value;},setAllocation(value){allocationState=value;},close(){mounted?.dispose();x.core.close();window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}};
}

test('deferred activation is disclosed from the reviewed quote before payment and preserved on original retry',async()=>{
  const x=setup({version:3});try{
    const original=x.client.quote;let activation={maximum:2};x.client.quote=async input=>({...await original(input),bindingActivation:activation});let fail=true;
    x.client.purchase=async input=>{x.calls.purchases.push(input);if(fail)throw new Error('Response interrupted');return {packs:[{id:'pack'}],bindingActivation:{state:'pending',count:1}};};
    await x.mount();click(x.root,'Review purchase');await settle();assert.equal(x.calls.purchases.length,0);assert.match(x.root.textContent,/Up to 2 attached rewards may require activation after purchase/);assert.match(x.root.textContent,/Pack delivery does not confirm reward activation/);assert.match(x.root.textContent,/cannot be used until activation is confirmed/);
    activation.maximum=99;click(x.root,'Buy reviewed packs');await settle();assert.equal(x.calls.purchases[0].bindingActivation.maximum,2);assert.match(x.root.textContent,/Up to 2 attached rewards/);assert(find(x.root,'Retry original purchase'));
    fail=false;click(x.root,'Retry original purchase');await settle();assert.equal(x.calls.quotes.length,1);assert.deepEqual(x.calls.purchases[1],x.calls.purchases[0]);assert.match(x.root.textContent,/1 attached reward was pending activation at delivery/);assert.match(x.root.textContent,/Check current card details for activation status/);
  }finally{x.close();}
});

test('quantity changes discard deferred activation disclosure with its reviewed quote',async()=>{
  const x=setup({version:3});try{const original=x.client.quote;let disclosed=true;x.client.quote=async input=>({...await original(input),...(disclosed?{bindingActivation:{maximum:2}}:{})});await x.mount();click(x.root,'Review purchase');await settle();assert.match(x.root.textContent,/Up to 2 attached rewards/);const quantity=x.root.querySelector('.dc-purchase-row input');quantity.value='2';quantity.dispatchEvent(new x.window.Event('input'));assert(!x.root.textContent.includes('Up to 2 attached rewards'));disclosed=false;click(x.root,'Review purchase');await settle();assert(!x.root.textContent.includes('activation after purchase'));assert.equal(x.calls.purchases.length,0);}finally{x.close();}
});

for(const version of [1,2,3])test('ticket packs v'+version+' explain changing batch draws and preserve the whole reviewed quote',async()=>{
  const x=setup({version});try{await x.mount();const rates=x.root.querySelector('.dc-rates');assert.match(rates.textContent,/configured tickets/);assert.match(rates.textContent,/Each ticket can be used once in that purchase/);assert.match(rates.textContent,/chances change between draws/);assert.match(rates.textContent,/Limited remaining card supply can reduce eligible tickets/);assert.match(rates.textContent,/review checks what is currently available/);assert(!rates.textContent.includes('%'));assert(!rates.textContent.includes('duplicate protection'));
    click(x.root,'Review purchase');await settle();assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.purchases.length,0);assert.match(x.root.textContent,/Review 1 pack/);click(x.root,'Buy reviewed packs');await settle();assert.equal(x.calls.purchases.length,1);assert.equal(x.calls.purchases[0].allocationDigest,'a'.repeat(64));assert.equal(x.calls.purchases[0].key,'purchase-1');assert.equal(x.calls.purchases[0].productRevision,x.product.revision);assert.equal(x.calls.purchases[0].catalogVersion,x.catalog.version);
  }finally{x.close();}
});

test('ordinary packs keep independent base-rate display and the existing purchase action',async()=>{
  const x=setup({tickets:false});try{await x.mount();assert.match(x.root.querySelector('.dc-rates').textContent,/%/);assert.match(x.root.querySelector('.dc-rates').textContent,/Base rates/);assert(!find(x.root,'Check allocation attempt'));click(x.root,'Buy ·');await settle();assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.purchases.length,1);assert(!Object.hasOwn(x.calls.purchases[0],'allocationDigest'));
  }finally{x.close();}
});

for(const version of [1,2,3])test('quantity edits discard the prior reviewed v'+version+' allocation quote',async()=>{
  const x=setup({version});try{await x.mount();click(x.root,'Review purchase');await settle();const quantity=x.root.querySelector('.dc-purchase-row input');quantity.value='2';quantity.dispatchEvent(new x.window.Event('input'));assert(find(x.root,'Review purchase'));assert(!find(x.root,'Buy reviewed packs'));x.setDigest('b'.repeat(64));click(x.root,'Review purchase');await settle();assert.equal(x.calls.purchases.length,0);click(x.root,'Buy reviewed packs');await settle();assert.equal(x.calls.purchases[0].quantity,2);assert.equal(x.calls.purchases[0].allocationDigest,'b'.repeat(64));
  }finally{x.close();}
});

for(const version of [1,2,3])test('stale v'+version+' allocation recovery inspects and acknowledges without buying, then requires a new review',async()=>{
  const x=setup({version});try{let fail=true;const purchase=x.client.purchase;x.client.purchase=async input=>{if(fail){x.calls.purchases.push(input);x.setAllocation('stale');throw new ApiError('ALLOCATION_STALE','Allocation changed',409);}return purchase(input);};await x.mount();click(x.root,'Review purchase');await settle();click(x.root,'Buy reviewed packs');await settle();assert.equal(x.calls.purchases.length,1);assert.match(x.root.textContent,/pack purchase needs review/);
    click(x.root,'Check allocation attempt');await settle();assert.equal(x.calls.statuses.length,1);assert.equal(x.calls.purchases.length,1);assert.match(x.root.textContent,/allocation is stale/);assert(find(x.root,'Review purchase').disabled);click(x.root,'Acknowledge allocation attempt');await settle();assert.deepEqual(x.calls.acknowledgements,[{attemptId:'attempt'}]);assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.purchases.length,1);
    fail=false;x.setDigest('b'.repeat(64));click(x.root,'Review purchase');await settle();assert.equal(x.calls.quotes.length,2);assert.equal(x.calls.purchases.length,1);click(x.root,'Buy reviewed packs');await settle();assert.equal(x.calls.purchases.length,2);assert.equal(x.calls.purchases[1].allocationDigest,'b'.repeat(64));assert.notEqual(x.calls.purchases[0].key,x.calls.purchases[1].key);
  }finally{x.close();}
});

for(const version of [2,3])test('v'+version+' inventory protection explains conditional eligibility, inserts and permissive fallback',async()=>{
  const x=setup({version});try{x.product.duplicatePolicy={scope:'inventory',fallback:'allow'};await x.mount();assert.match(x.root.textContent,/cards you own/);assert.match(x.root.textContent,/earlier packs in this purchase, including special inserts/);assert.match(x.root.textContent,/repeating a regular card within the current pack/);assert.match(x.root.textContent,/Special inserts bypass duplicate filtering/);assert.match(x.root.textContent,/fallback allows a repeat/);assert.match(x.root.querySelector('.dc-rates').textContent,/Duplicate protection and your rarity guarantee/);assert(!x.root.querySelector('.dc-rates').textContent.includes('%'));
  }finally{x.close();}
});

for(const version of [2,3])test('v'+version+' pack protection and pity explain resets and qualifying ordinary cards',async()=>{
  const x=setup({version});try{x.product.duplicatePolicy={scope:'pack',fallback:'reject'};x.product.pity={rarityId:'rare',after:5};await x.mount();assert.match(x.root.textContent,/new pack starts a new check/);assert.match(x.root.textContent,/protected draw, the purchase fails/);const pity=x.root.querySelector('.dc-pity-note');assert.match(pity.textContent,/qualifying regular card resets this count; special inserts do not/);assert.match(pity.textContent,/first draw in the first regular-card slot/);assert.doesNotMatch(pity.textContent,/optional slot/);assert.match(pity.textContent,/Sealed packs count/);
  }finally{x.close();}
});

test('allocation review recognizes only matching version and purchase-slot selectors',async()=>{
  for(const strategy of [{algorithm:'weighted-deck@2',version:1,deckScope:'purchase-slot'},{algorithm:'weighted-deck@2',version:2,deckScope:'pack'},{algorithm:'weighted-deck@2',version:2,deckScope:'purchase-slot',extra:true},{algorithm:'weighted-deck@3',version:2,deckScope:'purchase-slot'},{algorithm:'weighted-deck@3',version:3,deckScope:'pack'}]){const x=setup();try{x.product.allocationStrategy=strategy;await x.mount();assert(!find(x.root,'Review purchase'));assert(!find(x.root,'Check allocation attempt'));assert(find(x.root,'Buy ·'));}finally{x.close();}}
});

test('v3 purchase review explains shared imported-code supply without exposing code data',async()=>{
  const x=setup({version:3});try{x.product.metadata={poolId:'internal-pool',privatePrefix:'internal-prefix',codeMaterial:'sample-code-material'};await x.mount();assert.match(x.root.querySelector('.dc-rates').textContent,/Imported-code supply also limits eligible tickets/);assert.match(x.root.querySelector('.dc-rates').textContent,/Shared code pools may change before purchase/);click(x.root,'Review purchase');await settle();assert.match(x.root.textContent,/Availability depends on current imported-code supply/);for(const hidden of Object.values(x.product.metadata))assert(!x.root.textContent.includes(hidden));assert.equal(x.calls.purchases.length,0);assert(!x.root.querySelector('.dc-rates').textContent.includes('%'));
  }finally{x.close();}
});

test('acknowledging a prepared attempt preserves an ambiguous purchase and its original key',async()=>{
  const x=setup();try{x.client.purchase=async input=>{x.calls.purchases.push(input);throw new Error('Purchase response interrupted');};await x.mount();click(x.root,'Review purchase');await settle();click(x.root,'Buy reviewed packs');await settle();const original=x.calls.purchases[0];x.setAllocation('prepared');click(x.root,'Check allocation attempt');await settle();assert.equal(x.calls.purchases.length,1);click(x.root,'Acknowledge allocation attempt');await settle();assert.equal(x.calls.purchases.length,1);assert.match(x.root.textContent,/Retry the original purchase/);assert(!find(x.root,'Review purchase'));assert.equal(x.calls.quotes.length,1);
    x.client.purchase=async input=>{x.calls.purchases.push(input);throw new ApiError('ALLOCATION_STALE','Original attempt is stale',409);};click(x.root,'Retry original purchase');await settle();assert.deepEqual(x.calls.purchases[1],original);assert(find(x.root,'Retry original purchase'));assert.equal(x.calls.quotes.length,1);const journal=JSON.parse(sessionStorage.getItem('digital-card.commands.v1:collector'));assert.equal(Object.values(journal)[0].key,original.key);assert(!Object.values(journal)[0]._confirmed);
  }finally{x.close();}
});

test('completed allocations offer receipt recovery and cannot be acknowledged',async()=>{
  const x=setup();try{x.setAllocation('completed');await x.mount();click(x.root,'Check allocation attempt');await settle();assert.match(x.root.textContent,/allocation completed/);assert(find(x.root,'Acknowledge allocation attempt').hidden);assert.equal(x.calls.acknowledgements.length,0);assert.equal(x.calls.purchases.length,0);assert.equal(x.calls.quotes.length,0);
  }finally{x.close();}
});

for(const lostAcknowledgement of [false,true])test('matching server failure resolves allocation recovery after acknowledgement response '+(lostAcknowledgement?'lost':'received'),async()=>{
  const x=setup();try{let intent,executions=0;const acknowledge=x.client.acknowledgeAllocation;
    x.client.commandIntents=async()=>({items:intent&&intent.state!=='acknowledged'?[structuredClone(intent)]:[]});
    x.client.registerCommandIntent=async({command,input})=>{intent??={id:'intent',userId:'collector',command,input:structuredClone(input),state:'pending'};return structuredClone(intent);};
    x.client.executeCommandIntent=async()=>{executions++;throw new Error('Execution response interrupted');};
    x.client.acknowledgeCommandIntent=async()=>{intent.state='acknowledged';return {intent:structuredClone(intent)};};
    x.client.acknowledgeAllocation=async input=>{const result=await acknowledge(input);intent.state='failed';if(lostAcknowledgement)throw new Error('Acknowledgement response interrupted');return result;};
    await x.mount();click(x.root,'Review purchase');await settle();click(x.root,'Buy reviewed packs');await settle();assert.equal(executions,1);const key=intent.input.key;x.setAllocation('prepared');click(x.root,'Check allocation attempt');await settle();click(x.root,'Acknowledge allocation attempt');await settle();if(lostAcknowledgement){assert(find(x.root,'Retry original purchase'));click(x.root,'Check allocation attempt');await settle();}assert.equal(executions,1);assert.equal(x.calls.quotes.length,1);assert(find(x.root,'Review purchase'));assert(!find(x.root,'Retry original purchase'));const journal=JSON.parse(sessionStorage.getItem('digital-card.commands.v1:collector'));assert.equal(Object.values(journal)[0].key,key);assert.equal(Object.values(journal)[0]._confirmed,true);
    click(x.root,'Review purchase');await settle();assert.equal(x.calls.quotes.length,2);assert.equal(executions,1);assert(find(x.root,'Buy reviewed packs'));
  }finally{x.close();}
});

for(const change of ['dispose','account','quantity'])test('late allocation quotes cannot purchase or confirm after '+change,async()=>{
  const x=setup();try{let finish;x.client.quote=()=>new Promise(resolve=>finish=resolve);const mounted=await x.mount();click(x.root,'Review purchase');const quantity=x.root.querySelector('.dc-purchase-row input');if(change==='dispose')mounted.dispose();else if(change==='account')x.setPrincipal('other');else{quantity.value='2';quantity.dispatchEvent(new x.window.Event('input'));}finish({productId:x.product.id,quantity:1,price:x.product.price,allocationDigest:'a'.repeat(64)});await settle();assert.equal(x.calls.purchases.length,0);assert(!find(x.root,'Buy reviewed packs'));
  }finally{x.close();}
});

test('disposal after allocation status dispatch ignores its late reply and detached actions',async()=>{
  const x=setup();try{let finish;x.client.allocationStatus=()=>new Promise(resolve=>finish=resolve);const mounted=await x.mount(),check=click(x.root,'Check allocation attempt');mounted.dispose();finish({productId:x.product.id,attemptId:'attempt',state:'stale',errorCode:'ALLOCATION_STALE'});await settle();assert.equal(x.root.childElementCount,0);check.click();await settle();assert.equal(x.calls.acknowledgements.length,0);assert.equal(x.calls.purchases.length,0);
  }finally{x.close();}
});
