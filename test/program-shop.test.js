import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {fixture} from './helpers.js';
import {renderShop,shopProductInformation} from '../src/shop-ui.js';
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(){
 const window=new Window({url:'http://localhost/'});globalThis.document=window.document;const x=fixture(),catalog=x.core.catalog(),product=catalog.products.find(product=>product.id==='common'),model={catalog,me:{userId:'collector'},wallet:{credits:100000},pity:{},availability:{products:[],variants:[]}},calls={quotes:[],purchases:[],errors:[],refresh:0,mounts:0,disposals:0};let pending=null,current=true;
 const client={principal:()=>model.me.userId,quote:async input=>{calls.quotes.push(input);return {productId:product.id,quantity:input.quantity,productRevision:1,catalogVersion:1,price:{currencyId:'credits',amount:input.quantity*product.price.amount}};}};
 const mutate=async(command,input)=>{calls.purchases.push(structuredClone(input));return {packs:[{id:'pack'}]};};mutate.pending=()=>pending;mutate.beginNew=mutate;mutate.recover=mutate;
 const context={client,mutate,isCurrentModel:()=>current,getPrincipal:()=>model.me.userId,refresh:async()=>{calls.refresh++;},packArt(product,small,select,rendered,own){calls.mounts++;own(()=>calls.disposals++);return document.createElement('div');},async action(fn,options){try{const result=await fn();if(options.refreshAfter)await context.refresh();return result;}catch(error){calls.errors.push(error);}}};
 const root=document.createElement('main');document.body.append(root);let panel;
 return {window,x,product,model,client,context,calls,root,mount(options={}){panel=renderShop(model,context,{productId:product.id,...options});root.append(panel.node);return panel;},setPending(value){pending=value;},invalidate(){current=false;},close(){panel?.dispose();x.core.close();window.happyDOM.abort();delete globalThis.document;}};
}
const buy=root=>root.querySelector('.dc-purchase-row button');
test('portable ordinary shop review displays exact quote and activation before an explicit native commit',async()=>{
 const x=setup();try{const quote=x.client.quote;x.client.quote=async input=>({...await quote(input),bindingActivation:{maximum:2}});x.mount({quantity:2,forceReview:true});assert.equal(x.calls.quotes.length,0);assert.match(buy(x.root).textContent,/Review purchase/);buy(x.root).click();await settle();assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.purchases.length,0);assert.equal(x.calls.refresh,0);assert.match(x.root.textContent,/Review 2 packs/);assert.match(x.root.textContent,/Up to 2 attached rewards/);assert.match(buy(x.root).textContent,/Buy reviewed packs/);buy(x.root).click();await settle();assert.equal(x.calls.purchases.length,1);assert.equal(x.calls.purchases[0].quantity,2);assert.equal(x.calls.purchases[0].bindingActivation.maximum,2);assert.equal(x.calls.refresh,1);}finally{x.close();}
});
test('closing a native review disposes its own renderers and refuses late quotes and detached commit buttons',async()=>{
 const x=setup();try{let resolve;x.client.quote=()=>new Promise(done=>resolve=done);const panel=x.mount({forceReview:true}),button=buy(x.root);button.click();await settle();panel.dispose();assert.equal(x.calls.mounts,x.calls.disposals);resolve({productId:x.product.id,quantity:1,price:{currencyId:'credits',amount:10}});await settle();button.click();await settle();assert.equal(x.calls.purchases.length,0);assert(x.calls.errors.length>=1);}finally{x.close();}
});
test('reviewed quote restores only its original live focused button after temporary disablement',async()=>{
 for(const mode of ['restore','unfocused','other-control','other-control-then-blur','pointer','quantity','principal','client-principal','model','closed','disposed']){
  const x=setup();try{
   let release,ready,button;const waiting=new Promise(resolve=>ready=resolve);
   x.context.action=async fn=>{button.blur();button.disabled=true;const result=await fn();ready();await new Promise(resolve=>release=resolve);button.disabled=false;return result;};
   const panel=x.mount({forceReview:true}),dialog=document.createElement('dialog'),other=document.createElement('input');button=buy(x.root);dialog.open=true;dialog.append(panel.node,other);x.root.append(dialog);
   (mode==='unfocused'?other:button).focus();button.click();await waiting;
   assert.equal(x.calls.purchases.length,0);assert.notEqual(document.activeElement,button);assert.match(button.textContent,/Review purchase/);
   if(mode==='other-control'||mode==='other-control-then-blur')other.focus();
   if(mode==='other-control-then-blur')other.blur();
   if(mode==='pointer')other.dispatchEvent(new x.window.Event('pointerdown',{bubbles:true}));
   if(mode==='quantity'){const input=panel.node.querySelector('.dc-purchase-row input');input.value='2';input.dispatchEvent(new x.window.Event('input',{bubbles:true}));}
   if(mode==='principal')x.context.getPrincipal=()=> 'another-collector';
   if(mode==='client-principal')x.client.principal=()=> 'another-collector';
   if(mode==='model')x.invalidate();
   if(mode==='closed')dialog.open=false;
   if(mode==='disposed')panel.dispose();
   release();await settle();assert.equal(document.activeElement===button,mode==='restore',mode);assert.equal(x.calls.purchases.length,0,mode);
   if(mode==='other-control'||mode==='unfocused')assert.equal(document.activeElement,other,mode);
  }finally{x.close();}
 }
});
test('portable recovery uses the original reviewed input and never prepares a fresh quote',async()=>{
 const x=setup();try{const original={productId:x.product.id,quantity:2,key:'retained-key',price:{currencyId:'credits',amount:20},bindingActivation:{maximum:1}};x.setPending(original);x.mount({forceReview:true,quantity:9});assert.equal(x.root.querySelector('.dc-purchase-row input').value,'2');assert(x.root.querySelector('.dc-purchase-row input').disabled);buy(x.root).click();await settle();assert.equal(x.calls.quotes.length,0);assert.deepEqual(x.calls.purchases,[original]);}finally{x.close();}
});
test('ordinary forced review refuses a changed price at commit and asks for a fresh model',async()=>{
 const x=setup();try{const quote=x.client.quote;x.client.quote=async input=>({...await quote(input),price:{currencyId:'credits',amount:30}});x.mount({forceReview:true});buy(x.root).click();await settle();assert.match(buy(x.root).textContent,/Buy reviewed packs · 30 Credits/);assert.equal(x.calls.purchases.length,0);buy(x.root).click();await settle();assert.equal(x.calls.purchases.length,0);assert.equal(x.calls.refresh,1);assert.match(x.calls.errors[0].message,/price changed/i);}finally{x.close();}
});
test('shared disclosure distinguishes base rates and v4 conditional finite tickets without changing their meaning',()=>{
 const x=setup();try{const base=shopProductInformation(x.model,x.product);assert(base.ratesGroups[0].rows[0].value.includes('%'));x.product.allocationStrategy={algorithm:'weighted-deck@4',version:4,deckScope:'purchase-slot'};x.product.duplicatePolicy={scope:'inventory',fallback:'allow'};x.product.pity={rarityId:'holo',after:5};const info=shopProductInformation(x.model,x.product);assert.equal(info.deckVersion,4);assert(info.explanation.includes('every required slot'));assert(info.duplicateNote.includes('cards you own'));assert(info.ratesGroups[0].rows[0].value.includes('ticket'));assert.equal(info.ratesGroups[0].rows[0].weight,info.ratesGroups[0].rows[0].totalWeight);}finally{x.close();}
});
