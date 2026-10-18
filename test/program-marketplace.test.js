import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers.js';
import {createMarketplaceSession} from '../src/marketplace-session.js';
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(){const window=new Window({url:'http://localhost/'});globalThis.document=window.document;const x=fixture(),actor={...x.alice,role:'admin'},shop=x.core.createShop(actor,{key:'shop',name:'Shop',kind:'admin'}),listing=x.core.createListing(actor,{key:'stock',shopId:shop.id,title:'Two cards',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:3}});let principal=x.bob.userId;const client={requestKey:()=>crypto.randomUUID(),principal:()=>principal,commerceSettings:async()=>x.core.commerceSettings()};for(const name of ['shops','listings','orders','quoteListing','buyListing'])client[name]=async input=>x.core[name](x.bob,input);const model={me:x.core.me(x.bob),catalog:x.core.catalog(),inventory:[],packs:[]},root=document.createElement('main');document.body.append(root);const session=createMarketplaceSession(model,{client});return {window,x,actor,shop,listing,client,model,root,session,setPrincipal(value){principal=value;},close(){session.dispose();x.core.close();window.happyDOM.abort();delete globalThis.document;}};}
test('portable purchase request only quotes; close and principal changes fence delayed review',async()=>{const x=setup();try{await x.session.ready;let finish;x.client.quoteListing=()=>new Promise(resolve=>finish=resolve);const task=x.session.purchase(x.root,x.listing);assert.equal(x.x.core.orders(x.x.bob).total,0);x.session.closeReview();finish(x.x.core.quoteListing(x.x.bob,{listingId:x.listing.id}));await task;assert.equal(x.root.querySelectorAll('dialog').length,0);const late=x.session.purchase(x.root,x.listing);x.setPrincipal('other');finish(x.x.core.quoteListing(x.x.bob,{listingId:x.listing.id}));await late;assert.equal(x.root.querySelectorAll('dialog').length,0);assert.equal(x.x.core.orders(x.x.bob).total,0);}finally{x.close();}});

test('marketplace modal restores its live invoker without stealing outside or obsolete focus',async()=>{
 for(const mode of ['close','outside','principal','dispose','detached']){
  const x=setup();try{
   await x.session.ready;const invoker=document.createElement('button'),outside=document.createElement('button');x.root.append(invoker,outside);invoker.focus();await x.session.purchase(x.root,x.listing);
   assert(x.root.querySelector('dialog').contains(document.activeElement));let restored=0;const focus=invoker.focus.bind(invoker);invoker.focus=(...args)=>{restored++;focus(...args);};
   if(mode==='outside')outside.focus();if(mode==='principal')x.setPrincipal('different');if(mode==='detached')invoker.remove();
   if(mode==='dispose')x.session.dispose();else x.session.closeReview();
   assert.equal(restored,mode==='close'?1:0,mode);if(mode==='close')assert.equal(document.activeElement,invoker);if(mode==='outside')assert.equal(document.activeElement,outside);
   x.session.closeReview();assert.equal(restored,mode==='close'?1:0,mode);assert.equal(x.root.querySelectorAll('dialog').length,0);assert.equal(x.x.core.orders(x.x.bob).total,0);
  }finally{x.close();}
 }
});
test('confirmed original recovery and deliberate new purchase remain separate native controls',async()=>{const x=setup();try{await x.session.ready;const before=x.x.core.wallet(x.x.bob).credits;await x.session.purchase(x.root,x.listing);x.root.querySelector('dialog button:last-child').click();await settle();assert.equal(x.x.core.orders(x.x.bob).total,1);assert.equal(x.root.querySelectorAll('dialog').length,0);assert(x.root.querySelector('.dc-marketplace-result').textContent.includes('Purchase complete'));assert([...x.root.querySelectorAll('.dc-marketplace-result button')].some(button=>button.textContent==='New purchase'));x.session.closeReview();await x.session.purchase(x.root,x.listing);const buttons=[...x.root.querySelectorAll('dialog button')];assert(buttons.some(button=>button.textContent==='New purchase'));buttons.find(button=>button.textContent==='New purchase').click();await settle();[...x.root.querySelectorAll('dialog button')].find(button=>button.textContent==='Confirm purchase').click();await settle();assert.equal(x.x.core.orders(x.x.bob).total,2);assert.equal(before-x.x.core.wallet(x.x.bob).credits,40);assert(x.x.core.audit({role:'admin'}).ok);}finally{x.close();}});
test('seller gating rejects forged stock kind and option selection without commands',async()=>{const x=setup();try{await x.session.ready;x.session.edit('kind','mint-card');x.session.edit('shop',x.shop.id);assert(!x.session.canList);assert.equal(x.session.state.draft.kind,'copies');await x.session.createListing();assert.equal(x.x.core.listings(x.x.bob).total,1);}finally{x.close();}});
test('a confirmed original cannot authorize a deliberately new purchase under a disabled capability',async()=>{const x=setup();try{await x.session.ready;await x.session.purchase(x.root,x.listing);[...x.root.querySelectorAll('dialog button')].find(button=>button.textContent==='Confirm purchase').click();await settle();x.session.closeReview();let quotes=0;const quote=x.client.quoteListing;x.client.quoteListing=async input=>{quotes++;return quote(input);};x.model.capabilities={available:{resale:true,packs:true,directSales:false}};await x.session.purchase(x.root,x.listing,{newPurchase:true});assert.equal(quotes,0);assert.equal(x.root.querySelectorAll('dialog').length,0);await x.session.purchase(x.root,x.listing);assert.equal(quotes,0);assert(x.root.querySelector('dialog'));assert.equal(x.x.core.orders(x.x.bob).total,1);}finally{x.close();}});

test('embedded marketplace focus return waits for a nonbusy display without reviving abandoned invokers',async()=>{
 const source=(await readFile(new URL('../src/presentation/program-marketplace-bootstrap.js',import.meta.url),'utf8')).replace("import {connectProgram} from './program.js';",'').replace('export function disposeMarketplaceBootstrap','function disposeMarketplaceBootstrap');
 for(const mode of ['normal','delayed','host-away','outside','detached','unavailable','disposed']){
  const window=new Window({url:'http://localhost/'}),document=window.document;let display,focused=true;
  document.hasFocus=()=>focused;
  document.body.innerHTML='<section data-dc-marketplace-listings></section><template data-dc-marketplace-listing-template><article><button type="button" data-dc-listing-action="purchase">Review purchase</button></article></template><button id="outside">Outside</button>';
  const connectProgram=callbacks=>{display=callbacks.onMarketplaceDisplay;return Promise.resolve({marketplaceIntent(){},dispose(){}});};
  const dispose=new Function('connectProgram','window','document','AbortController',source+'\nreturn disposeMarketplaceBootstrap;')(connectProgram,window,document,window.AbortController);
  const snapshot=(busy,{position=0,reviewable=true}={})=>({snapshotId:'snapshot',locale:'en',dir:'ltr',busy,labels:{},status:'',previews:[],listings:{items:[{handle:'stock-'+position,position,reviewable}],hasMore:false,hasPrevious:false},orders:{items:[]},seller:{draft:null,kinds:[],stock:{disclosure:'',review:'',attempt:''},shops:{items:[]},targets:{items:[]},currencies:{items:[]}}});
  try{
   await Promise.resolve();display(snapshot(false));const button=document.querySelector('[data-dc-listing-action="purchase"]');button.click();assert.equal(document.activeElement,button,mode);
   focused=false;window.dispatchEvent(new window.Event('blur'));button.blur();assert.equal(document.activeElement,document.body,mode);
   if(mode!=='normal')display(snapshot(true));
   if(mode==='host-away'){
    display(snapshot(false));await settle();assert.equal(document.activeElement,document.body,'A display cannot take focus from the host modal');
   }
   focused=true;window.dispatchEvent(new window.Event('focus'));await settle();
   if(mode!=='normal'&&mode!=='host-away')assert.equal(document.activeElement,document.body,mode);
   if(mode==='outside'){const outside=document.querySelector('#outside');outside.focus();outside.blur();}
   if(mode==='disposed')dispose();
   display(snapshot(false,mode==='detached'?{position:1}:mode==='unavailable'?{reviewable:false}:{}));await settle();
   const restored=['normal','delayed','host-away'].includes(mode);assert.equal(document.activeElement===button,restored,mode);
   if(!restored){assert.equal(document.activeElement,document.body,mode);display(snapshot(false));window.dispatchEvent(new window.Event('focus'));await settle();assert.equal(document.activeElement,document.body,'Abandoned '+mode+' invoker must stay abandoned');}
  }finally{dispose();await window.happyDOM.abort();}
 }
});
