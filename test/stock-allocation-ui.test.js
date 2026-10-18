import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {fixture} from './helpers.js';
import {renderMarketplace} from '../src/marketplace-ui.js';
import {ApiError} from '../src/client.js';

const shopId='11111111-1111-4111-8111-111111111111',otherShopId='22222222-2222-4222-8222-222222222222';
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const find=(root,text)=>[...root.querySelectorAll('button')].find(button=>button.textContent===text);
const click=(root,text)=>{const button=find(root,text);assert(button,'Missing '+text);assert(!button.hidden&&!button.disabled,'Unavailable '+text);button.click();return button;};
const field=(root,text)=>{const label=[...root.querySelectorAll('label')].find(label=>label.querySelector('span')?.textContent===text);assert(label,'Missing '+text);return label.querySelector('input,textarea,select');};
const stable=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):Array.isArray(value)?value.map(stable):value;
function setup({version=1}={}){
  const window=new Window({url:'http://localhost/'});globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;const x=fixture(),catalog=structuredClone(x.core.catalog());
  catalog.products.find(product=>product.id==='common').allocationStrategy={algorithm:'weighted-deck@'+version,version,deckScope:'purchase-slot'};
  const model={me:{userId:'collector',role:'admin'},catalog,inventory:[{id:'owned-copy',definition:{name:'Owned card'}}],packs:[]};
  const calls={quotes:[],listings:[],statuses:[],acknowledgements:[]};let principal='collector',keys=0,digest='a'.repeat(64),attempt={state:'idle',attemptId:null,command:null,attemptShopId:null,errorCode:null};
  const client={principal:()=>principal,requestKey:()=> 'listing-'+(++keys),listings:async()=>({items:[],next:null,total:0}),shops:async()=>({items:[{id:shopId,name:'First shop',mine:true},{id:otherShopId,name:'Second shop',mine:true}]}),commerceSettings:async()=>({settings:{playerShops:true,packResale:true},revision:0}),
    createListing:async input=>{calls.listings.push(input);return {id:'listing'};},
    quoteMintPackStock:async input=>{calls.quotes.push(input);return {...input,allocationDigest:digest};},
    stockAllocationStatus:async input=>{calls.statuses.push(input);return {...input,...attempt};},
    acknowledgeAllocation:async input=>{calls.acknowledgements.push(input);attempt={...attempt,state:'acknowledged',errorCode:null};return {attemptId:input.attemptId,state:'acknowledged'};}
  };
  let view,root;
  const setField=(name,value)=>{const input=field(root,name);input.value=value;input.dispatchEvent(new window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));return input;};
  return {window,model,client,calls,get root(){return root;},setField,setPrincipal(value){principal=value;},setDigest(value){digest=value;},setAttempt(value){attempt=value;},async mount(){view=renderMarketplace(model,{client});root=view.node;document.body.append(root);await view.ready;setField('Stock source','mint-pack');setField('Stock item','common');setField('Listing title','Sealed stock');setField('Unit price','10');return view;},close(){view?.dispose();x.core.close();window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}};
}

test('stock review discloses deferred reward activation from the frozen stock quote',async()=>{
  const x=setup({version:3});try{const original=x.client.quoteMintPackStock,activation={maximum:2};x.client.quoteMintPackStock=async input=>({...await original(input),bindingActivation:activation});await x.mount();click(x.root,'Review stock allocation');await settle();assert.equal(x.calls.listings.length,0);assert.match(x.root.textContent,/Up to 2 attached rewards may require activation after stock creation/);assert.match(x.root.textContent,/affected packs cannot be sold until activation is confirmed/);activation.maximum=99;assert(!x.root.textContent.includes('Up to 99'));x.setField('Stock quantity (new stock)','2');assert(!x.root.textContent.includes('Up to 2 attached rewards'));assert.equal(x.calls.listings.length,0);}finally{x.close();}
});

for(const version of [1,2,3])test('strategy v'+version+' stock requires a quote review and sends the digest at listing level',async()=>{
  const x=setup({version});try{await x.mount();assert(find(x.root,'Reserve stock and publish listing').disabled);assert.match(x.root.textContent,/stock batch is drawn from a limited ticket pool/);assert.match(x.root.textContent,/Each ticket can be used once/);assert.match(x.root.textContent,/remaining card supply/);click(x.root,'Review stock allocation');await settle();assert.equal(x.calls.listings.length,0);assert.deepEqual(x.calls.quotes,[{shopId,productId:'common',quantity:1}]);assert.match(x.root.textContent,/Review 1 sealed pack for First shop/);click(x.root,'Reserve stock and publish listing');await settle();assert.equal(x.calls.listings.length,1);assert.equal(x.calls.listings[0].allocationDigest,'a'.repeat(64));assert.deepEqual(x.calls.listings[0].items,{kind:'mint-pack',productId:'common',quantity:1});assert.equal(x.calls.listings[0].title,'Sealed stock');assert.deepEqual(x.calls.listings[0].price,{currencyId:'credits',amount:10});
  }finally{x.close();}
});

test('native mint-pack listings keep their existing creation path',async()=>{
  const x=setup();try{await x.mount();x.setField('Stock item','rare');assert(find(x.root,'Review stock allocation').hidden);assert(!find(x.root,'Reserve stock and publish listing').disabled);click(x.root,'Reserve stock and publish listing');await settle();assert.equal(x.calls.quotes.length,0);assert.equal(x.calls.listings.length,1);assert(!Object.hasOwn(x.calls.listings[0],'allocationDigest'));assert.equal(x.calls.listings[0].items.productId,'rare');
  }finally{x.close();}
});

for(const [name,value]of [['Listing title','Updated stock'],['Stock quantity (new stock)','2'],['Unit price','11'],['Shop',otherShopId],['Stock item','rare'],['Stock source','mint-card']])test('editing '+name+' discards a stock review',async()=>{
  const x=setup();try{await x.mount();click(x.root,'Review stock allocation');await settle();x.setField(name,value);assert.equal(x.calls.listings.length,0);if(['Stock source','Stock item'].includes(name))assert(find(x.root,'Review stock allocation').hidden);else assert(find(x.root,'Reserve stock and publish listing').disabled);
  }finally{x.close();}
});

for(const command of ['purchase','commitExternalPurchase'])test('shared '+command+' attempts leave listing uncertainty intact',async()=>{
  const x=setup();try{const original={shopId,title:'Original stock',price:{currencyId:'credits',amount:10},items:{kind:'mint-pack',productId:'common',quantity:1},allocationDigest:'a'.repeat(64)},purchase={productId:'common',quantity:1,allocationDigest:'b'.repeat(64),price:{currencyId:'credits',amount:20}};
    const journal={['createListing:'+JSON.stringify(stable(original))]:{...original,key:'original-listing'},['purchase:'+JSON.stringify(stable({productId:'common',quantity:1}))]:{...purchase,key:'original-purchase'}};sessionStorage.setItem('digital-card.commands.v1:collector',JSON.stringify(journal));const before=sessionStorage.getItem('digital-card.commands.v1:collector');
    x.setAttempt({state:'prepared',attemptId:'attempt',command,attemptShopId:null,errorCode:null});await x.mount();click(x.root,'Check stock allocation attempt');await settle();if(command==='purchase'){assert.match(x.root.textContent,/wallet purchase/);assert.match(x.root.textContent,/Return to Discover/);}else{assert.match(x.root.textContent,/payment-provider purchase/);assert.match(x.root.textContent,/original payment provider’s recovery flow/);const retry=find(x.root,'Retry original listing');assert(retry.hidden);retry.click();await settle();}assert(find(x.root,'Acknowledge stock allocation attempt').hidden);assert(find(x.root,'Review stock allocation').disabled);assert.equal(x.calls.quotes.length,0);assert.equal(x.calls.listings.length,0);assert.equal(x.calls.acknowledgements.length,0);assert.equal(sessionStorage.getItem('digital-card.commands.v1:collector'),before);
  }finally{x.close();}
});

test('other-shop attempts are identified and explicit retry preserves the original listing',async()=>{
  const x=setup();try{x.client.createListing=async input=>{x.calls.listings.push(input);throw new Error('Listing response interrupted');};await x.mount();click(x.root,'Review stock allocation');await settle();click(x.root,'Reserve stock and publish listing');await settle();const original=x.calls.listings[0];x.setField('Shop',otherShopId);x.setField('Listing title','Different stock');x.setAttempt({state:'prepared',attemptId:'attempt',command:'createListing',attemptShopId:shopId,errorCode:null});click(x.root,'Check stock allocation attempt');await settle();assert.match(x.root.textContent,/belongs to First shop/);assert(find(x.root,'Acknowledge stock allocation attempt').hidden);assert(find(x.root,'Review stock allocation').disabled);assert.equal(x.calls.listings.length,1);click(x.root,'Retry original listing');await settle();assert.deepEqual(x.calls.listings[1],original);assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.acknowledgements.length,0);
  }finally{x.close();}
});

for(const version of [1,2,3])test('same-shop stale v'+version+' acknowledgement does not create stock and requires a fresh review',async()=>{
  const x=setup({version});try{let fail=true;const create=x.client.createListing;x.client.createListing=async input=>{if(fail){x.calls.listings.push(input);x.setAttempt({state:'stale',attemptId:'attempt',command:'createListing',attemptShopId:shopId,errorCode:'ALLOCATION_STALE'});throw new ApiError('ALLOCATION_STALE','Stock allocation changed',409);}return create(input);};await x.mount();click(x.root,'Review stock allocation');await settle();click(x.root,'Reserve stock and publish listing');await settle();click(x.root,'Check stock allocation attempt');await settle();assert.match(x.root.textContent,/stock allocation is stale/);click(x.root,'Acknowledge stock allocation attempt');await settle();assert.equal(x.calls.acknowledgements.length,1);assert.equal(x.calls.listings.length,1);assert.equal(x.calls.quotes.length,1);assert(find(x.root,'Reserve stock and publish listing').disabled);fail=false;x.setDigest('b'.repeat(64));click(x.root,'Review stock allocation');await settle();assert.equal(x.calls.listings.length,1);click(x.root,'Reserve stock and publish listing');await settle();assert.equal(x.calls.listings.length,2);assert.equal(x.calls.listings[1].allocationDigest,'b'.repeat(64));
  }finally{x.close();}
});

for(const version of [2,3])for(const fallback of ['allow','reject'])test('v'+version+' stock explains nonpersonalized within-pack protection with '+fallback+' fallback',async()=>{
  const x=setup({version});try{const product=x.model.catalog.products.find(product=>product.id==='common');product.duplicatePolicy={scope:'inventory',fallback};product.pity={rarityId:'rare',after:5};await x.mount();assert.match(x.root.textContent,/Stock ignores personal inventory and pity/);assert.match(x.root.textContent,/do not repeat a card within one pack/);assert.match(x.root.textContent,/Special inserts can repeat/);assert.match(x.root.textContent,fallback==='allow'?/fallback allows a repeat/:/Stock creation fails/);click(x.root,'Review stock allocation');await settle();assert.match(x.root.textContent,/Stock ignores personal inventory and pity/);assert.equal(x.calls.listings.length,0);
  }finally{x.close();}
});

test('v3 stock review explains imported-code supply without exposing code data',async()=>{
  const x=setup({version:3});try{const product=x.model.catalog.products.find(product=>product.id==='common');product.metadata={poolId:'internal-pool',privatePrefix:'internal-prefix',codeMaterial:'sample-code-material'};await x.mount();assert.match(x.root.textContent,/Imported-code supply also limits eligible stock/);assert.match(x.root.textContent,/Shared code pools may change before stock is reserved/);click(x.root,'Review stock allocation');await settle();assert.match(x.root.textContent,/Availability depends on current imported-code supply/);for(const hidden of Object.values(product.metadata))assert(!x.root.textContent.includes(hidden));assert.equal(x.calls.listings.length,0);
  }finally{x.close();}
});

test('stock review requires an exact supported strategy selector',async()=>{
  const x=setup();try{x.model.catalog.products.find(product=>product.id==='common').allocationStrategy={algorithm:'weighted-deck@2',version:1,deckScope:'purchase-slot'};await x.mount();assert(find(x.root,'Review stock allocation').hidden);assert(!find(x.root,'Reserve stock and publish listing').disabled);assert.equal(x.calls.quotes.length,0);
  }finally{x.close();}
});

for(const lostAck of [false,true])test('exact failed listing confirmation unlocks new review after ack '+(lostAck?'response lost':'received'),async()=>{
  const x=setup();try{let intent,executions=0;const acknowledge=x.client.acknowledgeAllocation;
    x.client.commandIntents=async()=>({items:intent&&intent.state!=='acknowledged'?[structuredClone(intent)]:[]});x.client.registerCommandIntent=async({command,input})=>{intent??={id:'intent',userId:'collector',command,input:structuredClone(input),state:'pending'};return structuredClone(intent);};x.client.executeCommandIntent=async()=>{executions++;throw new Error('Execution response interrupted');};x.client.acknowledgeCommandIntent=async()=>{intent.state='acknowledged';return {intent:structuredClone(intent)};};x.client.acknowledgeAllocation=async input=>{const result=await acknowledge(input);intent.state='failed';if(lostAck)throw new Error('Acknowledgement response interrupted');return result;};
    await x.mount();click(x.root,'Review stock allocation');await settle();click(x.root,'Reserve stock and publish listing');await settle();x.setAttempt({state:'prepared',attemptId:'attempt',command:'createListing',attemptShopId:shopId,errorCode:null});click(x.root,'Check stock allocation attempt');await settle();click(x.root,'Acknowledge stock allocation attempt');await settle();if(lostAck){assert(!find(x.root,'Retry original listing').hidden);click(x.root,'Check stock allocation attempt');await settle();}assert(find(x.root,'Retry original listing').hidden);assert(!find(x.root,'Review stock allocation').disabled);assert.equal(executions,1);assert.equal(x.calls.quotes.length,1);const journal=JSON.parse(sessionStorage.getItem('digital-card.commands.v1:collector'));assert(Object.values(journal)[0]._confirmed);click(x.root,'Review stock allocation');await settle();assert.equal(executions,1);assert.equal(x.calls.quotes.length,2);assert(!find(x.root,'Reserve stock and publish listing').disabled);
  }finally{x.close();}
});

for(const change of ['dispose','account','quantity','shop','refresh'])test('late stock quote cannot confirm after '+change,async()=>{
  const x=setup();try{let finish;x.client.quoteMintPackStock=input=>new Promise(resolve=>finish=()=>resolve({...input,allocationDigest:'a'.repeat(64)}));const view=await x.mount();click(x.root,'Review stock allocation');if(change==='dispose')view.dispose();else if(change==='account')x.setPrincipal('other');else if(change==='refresh')click(x.root,'Refresh marketplace');else x.setField(change==='shop'?'Shop':'Stock quantity (new stock)',change==='shop'?otherShopId:'2');finish();await settle();assert.equal(x.calls.listings.length,0);if(change!=='dispose')assert(find(x.root,'Reserve stock and publish listing').disabled);else assert.equal(x.root.childElementCount,0);
  }finally{x.close();}
});

test('detached listing form callbacks cannot create stock',async()=>{
  const x=setup();try{await x.mount();click(x.root,'Review stock allocation');await settle();const create=find(x.root,'Reserve stock and publish listing'),form=create.closest('details');form.remove();create.click();await settle();assert.equal(x.calls.listings.length,0);
  }finally{x.close();}
});

test('late shared status after shop change cannot expose acknowledgement for the new shop',async()=>{
  const x=setup();try{let finish;x.client.stockAllocationStatus=input=>new Promise(resolve=>finish=()=>resolve({...input,state:'stale',attemptId:'attempt',command:'createListing',attemptShopId:shopId,errorCode:'ALLOCATION_STALE'}));await x.mount();click(x.root,'Check stock allocation attempt');x.setField('Shop',otherShopId);finish();await settle();assert(find(x.root,'Acknowledge stock allocation attempt').hidden);assert.equal(x.calls.acknowledgements.length,0);assert.equal(x.calls.listings.length,0);
  }finally{x.close();}
});
