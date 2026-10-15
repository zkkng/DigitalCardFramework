import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers.js';
import {renderCard,renderAlbum,renderInspector,renderTiltInspector,mountFramework,mountOpener,renderPack} from '../src/ui.js';
import {renderTrading} from '../src/trading-ui.js';
import {renderAlbums,renderCollection} from '../src/collection-ui.js';
import {renderStudio} from '../src/studio-ui.js';
import {mountCardPolicyAdmin} from '../src/card-policy-ui.js';
import {createLocalization,englishMessages} from '../src/localization.js';
import {createCommandRunner,createRevealController} from '../src/client.js';

const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};

for(const delayed of [false,true])test('account switch clears '+(delayed?'a late opening result':'a retained revealed receipt')+' from the shared opener',async()=>{
  const window=new Window(),x=fixture();globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
  let actor=x.alice,key=0,controller,release,started;const entered=new Promise(resolve=>started=resolve),seen=[];
  const client={requestKey:()=>`account-${++key}`,me:async()=>x.core.me(actor),catalog:async()=>x.core.catalog(actor)};
  for(const name of ['wallet','packs','inventory','albums','trades','commandIntents','registerCommandIntent','executeCommandIntent','acknowledgeCommandIntent'])client[name]=async input=>x.core[name](actor,input);
  const execute=client.executeCommandIntent;client.executeCommandIntent=async input=>{const result=await execute(input);if(delayed&&actor===x.alice){started();await new Promise(resolve=>release=resolve);}return result;};
  const pack=x.buy().packs[0],root=document.createElement('main');document.body.append(root);
  const app=mountFramework(root,{client,sections:['packs'],navigation:'tabs',openerView(state,value){controller=value;seen.push(structuredClone(state));return document.createElement('section');}});
  try{
    await app.ready;const previous=controller,pending=controller.load(pack.id);
    if(delayed)await entered;else{await pending;controller.skip();await app.refresh();assert.equal(controller,previous);assert.equal(controller.getState().revealed,1);controller.replay();controller.skip();}
    actor=x.bob;seen.length=0;await app.refresh();assert.notEqual(controller,previous);
    release?.();await pending;await settle();
    assert(seen.length>0);assert(seen.every(state=>state.receipt===null));assert.equal(controller.getState().phase,'idle');
    assert.equal(x.core.packs(x.bob).length,0);const before=seen.length;previous.skip();previous.replay();await previous.load(pack.id);assert.equal(seen.length,before);
  }finally{release?.();app.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}
});

for(const kind of ['inspector','comparison'])for(const closed of [false,true])test('account switch clears private '+kind+' data from '+(closed?'closed':'open')+' dialog and permits current inspection',async()=>{
  const window=new Window(),x=fixture();globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
  let actor=x.alice,restored=0;const first=x.open('unique')[0],second=x.open('common',x.bob)[0],root=document.createElement('main'),invoker=document.createElement('button');document.body.append(invoker,root);
  const client={requestKey:randomUUID,me:async()=>x.core.me(actor),catalog:async()=>x.core.catalog(actor)};
  for(const name of ['wallet','packs','inventory','albums','trades','commandIntents','registerCommandIntent','executeCommandIntent','acknowledgeCommandIntent'])client[name]=async input=>x.core[name](actor,input);
  const app=mountFramework(root,{client,sections:['packs'],comparisonRenderer(copies){const node=document.createElement('section');node.textContent=copies.map(copy=>copy.id+' '+JSON.stringify(copy.bindings)).join(' ');return node;}});
  const inspect=copy=>kind==='inspector'?app.inspect(copy):app.inspectTogether([copy]);
  try{
    await app.ready;invoker.focus();invoker.addEventListener('focus',()=>restored++);inspect(first);const dialog=root.querySelector('.dc-inspector-dialog');assert(dialog.open);assert(dialog.textContent.includes(first.id));assert(dialog.textContent.includes('PRIVATE-DEMO-CODE'));if(closed)dialog.close();await settle();restored=0;
    actor=x.bob;await app.refresh();await settle();assert.equal(dialog.open,false);assert.equal(dialog.childElementCount,0);assert(!dialog.textContent.includes(first.id));assert(!dialog.textContent.includes('PRIVATE-DEMO-CODE'));assert.equal(restored,0);
    inspect(second);assert(dialog.open);assert(dialog.textContent.includes(second.id));assert(!dialog.textContent.includes(first.id));
  }finally{app.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}
});

const studioMessages=()=>Object.fromEntries(Object.entries(englishMessages).filter(([key])=>key.startsWith('studioShell.')||key.startsWith('policyUI.')).map(([key,value])=>[key,typeof value==='string'?'['+value+']':Object.fromEntries(Object.entries(value).map(([category,text])=>[category,'['+text+']']))]));

test('localized studio previews preserve import inputs, authored rows and reviewed publishing',async()=>{
  const x=setup();let mounted;try{
    const localization=createLocalization({locale:'ar',messages:studioMessages()}),t=localization.text,
      base=x.core.previewImport({role:'admin'},{source:JSON.stringify({cards:[{...x.model.catalog.cards[0],description:'Authored description'}]}),expectedVersion:x.model.catalog.version});
    let input;x.client.previewImport=async request=>{input=structuredClone(request);return base;};
    mounted=renderStudio(x.model,{...x.context,localization});const view=x.mount(mounted);
    assert.equal(view.lang,'ar');assert.equal(view.dir,'rtl');
    assert(view.querySelector('[aria-label="'+t('studioShell.destinationCard')+'"]').textContent.includes(x.model.catalog.cards[0].name));
    click(view,t('studioShell.loadStarterRow'));const source=field(view,t('studioShell.importContent'));
    assert.equal(JSON.parse(source.value).cards[0].name,'Your first card');
    const authored=source.value;click(view,t('studioShell.validatePreview'));await settle();
    assert.equal(input.source,authored);assert.equal(input.format,'json');assert.equal(input.mode,'merge');
    assert(view.textContent.includes(t('studioShell.changeCounts',{added:0,updated:1,removed:0})));
    assert(view.textContent.includes(t('studioShell.validRevision',{version:base.manifest.version,digest:base.digest.slice(0,16)})));
    const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));
    click(view,t('studioShell.publishReviewedRevision'));await settle();
    assert.equal(x.calls[0][0],'commitImport');assert.deepEqual(x.calls[0][1],{manifest:base.manifest,digest:base.digest,expectedVersion:x.model.catalog.version,policyRevision:base.policyRevision});
    x.client.previewImport=async()=>{throw new Error('Provider-authored <failure>');};click(view,t('studioShell.validatePreview'));await settle();assert(view.textContent.includes('Provider-authored <failure>'));assert.equal(view.querySelector('failure'),null);
  }finally{mounted?.dispose();x.close();}
});

test('localized policy administration preserves draft data and fences stale impact review',async()=>{
  const x=setup();let mounted;try{
    const localization=createLocalization({locale:'ar',messages:studioMessages()}),t=localization.text,root=document.createElement('div');root.lang='de';root.dir='ltr';document.body.append(root);
    const registry={revision:1000,documents:[],assignments:[],resources:[],history:[{revision:1000,type:'card-policy.saved',at:'2026-10-14T01:02:03Z'}]},calls=[];
    let finish;const client={cardPolicies:async()=>structuredClone(registry),saveCardPolicy:async input=>{calls.push(['save',structuredClone(input)]);registry.documents=[{document:input.document,state:'draft'}];},previewCardPolicy:input=>{calls.push(['preview',structuredClone(input)]);return new Promise(resolve=>finish=resolve);},activateCardPolicy:async input=>calls.push(['activate',structuredClone(input)])};
    mounted=mountCardPolicyAdmin(root,{client,localization});await mounted.ready;
    assert.equal(root.lang,'ar');assert(root.textContent.includes(t('policyUI.historyRevision',{revision:1000,type:t('policyUI.history.card-policy.saved'),date:localization.date(registry.history[0].at)})));
    const editor=root.querySelector('textarea[aria-label="'+t('policyUI.policyDocument')+'"]'),draft=JSON.parse(editor.value);
    assert.equal(draft.name,'Standard cards');assert.equal(draft.fields[0].label,'Value');
    click(root,t('policyUI.savePolicyDraft'));await settle();assert.deepEqual(calls[0][1].document,draft);assert.equal(calls[0][1].expectedRevision,1000);
    click(root,t('policyUI.previewPolicyImpact'));await settle();editor.dispatchEvent(new x.window.Event('input'));finish({affected:[]});await settle();
    assert(!root.textContent.includes(t('policyUI.affectedVariants',{count:0})));
    click(root,t('policyUI.previewPolicyImpact'));await settle();const preview={affected:[{cardId:'authored.card',variantId:'authored.variant',issues:[{path:'stats.authored',message:'Authored issue'}]}],digest:'review-digest'};finish(preview);await settle();
    assert(root.textContent.includes(t('policyUI.affectedVariants',{count:1})));assert(root.textContent.includes('Authored issue'));
    const review=root.querySelector('input[type="checkbox"]');review.checked=true;review.dispatchEvent(new x.window.Event('change'));click(root,t('policyUI.activateReviewedPolicy'));await settle();
    assert.deepEqual(calls.at(-1)[1],{...preview,key:calls.at(-1)[1].key,reason:'Activated after impact review'});
    mounted.dispose();assert.equal(root.lang,'de');assert.equal(root.dir,'ltr');mounted=undefined;
  }finally{mounted?.dispose();x.close();}
});

test('both card inspectors explain pending and failed activation without displaying unusable data',()=>{
  const x=setup();try{const original=x.core.inventory(x.alice)[0],copy={...original,bindings:{pending:{state:'activation-pending',data:{secret:'UNUSABLE-PENDING'}},failed:{state:'activation-failed',data:{secret:'UNUSABLE-FAILED'}},active:{state:'active',data:{reward:'Available reward'}},used:{state:'used',data:{reward:'Used reward'}}}};
    for(const render of [renderInspector,renderTiltInspector]){const node=render(copy);assert.match(node.textContent,/Reward activation pending/);assert.match(node.textContent,/cannot be used yet/);assert.match(node.textContent,/recover the original activation/);assert.match(node.textContent,/Reward activation failed/);assert.match(node.textContent,/This reward is unavailable/);assert(!node.textContent.includes('UNUSABLE-'));assert(node.textContent.includes('Available reward'));assert(node.textContent.includes('Used reward'));}
  }finally{x.close();}
});

test('pack artwork instances retain independent sides, fallback and terminal disposal',()=>{
  const x=setup();
  try {
    const product={id:'pack',name:'Sky pack',lineId:'sky',artwork:{front:'/front.png',back:'/back.png',alt:'Printed sky packaging'}},
      first=renderPack(product),second=renderPack(product),firstImage=first.node.querySelector('img'),secondImage=second.node.querySelector('img');
    firstImage.dispatchEvent(new x.window.Event('load'));assert.equal(first.node.dataset.artworkState,'ready');
    first.setSide('back');assert(firstImage.src.endsWith('/back.png'));assert(secondImage.src.endsWith('/front.png'));
    firstImage.dispatchEvent(new x.window.Event('error'));assert.equal(first.node.dataset.artworkState,'fallback');
    const retained=first.setSide;first.dispose();retained('front');firstImage.dispatchEvent(new x.window.Event('load'));
    assert.equal(first.node.childNodes.length,0);assert(second.node.childNodes.length>0);second.dispose();
    const invalid=renderPack({...product,artwork:{front:'javascript:alert(1)'}});assert.equal(invalid.node.dataset.artworkState,'fallback');assert.equal(invalid.node.querySelector('img').getAttribute('src'),null);invalid.dispose();
  }finally{x.close();}
});

test('pack renderer hooks dispose on refresh and independently across simultaneous frameworks',async()=>{
  const x=setup();
  try{
    const roots=[document.createElement('main'),document.createElement('main')],calls=[{mounts:0,disposes:0},{mounts:0,disposes:0}];roots.forEach(root=>document.body.append(root));
    const frameworks=roots.map((root,index)=>mountFramework(root,{client:x.client,sections:['shop'],packRenderer:product=>{calls[index].mounts++;const node=document.createElement('div');node.textContent='Custom '+product.name;return {node,dispose(){calls[index].disposes++;}};}}));
    await Promise.all(frameworks.map(framework=>framework.ready));const firstCount=calls[0].mounts,secondCount=calls[1].mounts;assert(firstCount>0&&secondCount>0);
    await frameworks[0].refresh();assert.equal(calls[0].disposes,firstCount);assert.equal(calls[1].disposes,0);
    frameworks[0].dispose();assert.equal(calls[0].disposes,calls[0].mounts);assert(roots[1].textContent.includes('Custom'));
    frameworks[1].dispose();assert.equal(calls[1].disposes,secondCount);
  }finally{x.close();}
});

test('opener resolves reveal artwork from the owned pack and cleans image work on disposal',async()=>{
  const x=setup();
  try{
    const owned=x.buy('sky.basic').packs[0],receipt=x.core.openPack(x.alice,{packId:owned.id,key:'snapshot-reveal'}),root=document.createElement('div');document.body.append(root);
    const controller=createRevealController({open:async()=>receipt}),dispose=mountOpener(root,{controller,packArtwork:id=>id===owned.id?owned.product.artwork:undefined});
    await controller.load(owned.id);const image=root.querySelector('.dc-reveal-artwork');assert(image.src.endsWith(owned.product.artwork.reveal));
    dispose();assert.equal(image.getAttribute('src'),null);assert.equal(root.childElementCount,0);controller.dispose();
  }finally{x.close();}
});

test('a price changed after rendering requires another purchase decision',async()=>{
  const x=setup();
  try {
    let purchased=0;
    x.client.quote=async input=>({...x.core.quote(x.alice,input),price:{currencyId:'credits',amount:999}});
    x.client.purchase=async()=>{purchased++;return {packs:[]};};
    const root=document.createElement('main');document.body.append(root);
    const mounted=mountFramework(root,{client:x.client,sections:['shop']});await mounted.ready;
    const buy=[...root.querySelectorAll('button')].find(button=>button.textContent.startsWith('Buy ·'));
    assert(buy);buy.click();await settle();
    assert.equal(purchased,0);
    assert.match(root.textContent,/price changed.*Review the updated price/);
    mounted.dispose();
  } finally {x.close();}
});
const click=(node,text)=>{const found=[...node.querySelectorAll('button')].find(b=>b.textContent===text);assert(found,'Missing button '+text);assert(!found.disabled,'Disabled button '+text);found.click();return found;};
const field=(node,text)=>{const label=[...node.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===text);assert(label,'Missing field '+text);return label.querySelector('input,textarea,select');};
test('album save preserves only its initiating keyboard focus across its own refresh',async()=>{
 for(const mode of ['restore','unfocused','other-control','other-control-then-blur','pointer','principal','view','refresh','dispose','missing-album','failure']){
  const x=setup();let mounted,release,restoreObservers=()=>{};try{
   let entered;const saved=new Promise(resolve=>entered=resolve);x.client.saveAlbum=async input=>{const result=mode==='failure'?null:x.core.saveAlbum(x.alice,input);entered();await new Promise(resolve=>release=resolve);if(mode==='failure')throw new Error('Album save rejected');return result;};
   const root=document.createElement('main');document.body.append(root);mounted=mountFramework(root,{client:x.client,sections:['albums','collection'],navigation:'tabs'});await mounted.ready;
   let observerCalls=0;
   if(mode==='dispose'){
    const add=document.addEventListener,remove=document.removeEventListener,wrapped=new Map();
    document.addEventListener=function(type,listener,options){if(['focusin','pointerdown'].includes(type)){const original=listener;listener=function(event){observerCalls++;return original.call(this,event);};wrapped.set(original,listener);}return add.call(this,type,listener,options);};
    document.removeEventListener=function(type,listener,options){return remove.call(this,type,wrapped.get(listener)??listener,options);};
    restoreObservers=()=>{document.addEventListener=add;document.removeEventListener=remove;};
   }
   const original=[...root.querySelectorAll('button')].find(button=>button.textContent==='Save album'),name=field(root,'Album name');name.value='Keyboard saved album';
   (mode==='unfocused'?name:original).focus();original.click();await settle();assert(release,root.querySelector('.dc-status').textContent);await saved;
   if(mode==='other-control'||mode==='other-control-then-blur')name.focus();
   if(mode==='other-control-then-blur')name.blur();
   if(mode==='pointer')name.dispatchEvent(new x.window.Event('pointerdown',{bubbles:true}));
   if(mode==='principal')x.setActor(x.bob);
   if(mode==='view')root.querySelector('[data-view="collection"]').click();
   if(mode==='refresh')await mounted.refresh();
   if(mode==='dispose'){mounted.dispose();const before=observerCalls;document.dispatchEvent(new x.window.Event('focusin'));document.dispatchEvent(new x.window.Event('pointerdown'));assert.equal(observerCalls,before,'Disposal removes document focus observers before the pending save resolves');}
   if(mode==='missing-album')x.client.albums=async()=>[];
   release();await settle();assert.equal(x.core.albums(x.alice).length,mode==='failure'?0:1,mode);
   if(mode==='failure'){assert(original.isConnected);assert.match(root.querySelector('.dc-status.dc-error').textContent,/Album save rejected/);continue;}
   assert.equal(original.isConnected,false,mode);
   const replacement=[...root.querySelectorAll('button')].find(button=>button.textContent==='Save album');
   if(mode==='restore'){assert(replacement);assert.notEqual(replacement,original);assert(document.activeElement===replacement,mode);assert.equal(field(root,'Album name').value,'Keyboard saved album');}
   else assert(document.activeElement!==replacement,mode);
  }finally{release?.();await settle();mounted?.dispose();restoreObservers();x.close();}
 }
});
function setup(){const window=new Window({url:'http://localhost/'});globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;const x=fixture();x.open('common');x.open('rare');x.open('common',x.bob);
  const calls=[],client={requestKey:randomUUID};let actor=x.alice;
  for(const name of ['catalog','me','wallet','packs','inventory','albums','trades','availability','pityProgress'])client[name==='pityProgress'?'pity':name]=async()=>x.core[name](actor);
  client.directory=async options=>x.core.directory(actor,options);client.tradeInventory=async(id,options)=>x.core.tradeInventory(actor,id,options);
  const model={catalog:x.core.catalog(),me:{...x.core.me(actor),role:'admin'},inventory:x.core.inventory(actor),albums:[],trades:[],wallet:x.core.wallet(actor),packs:[]};
  const context={client,cardRenderer:renderCard,albumRenderer:renderAlbum,layouts:{},inspect:()=>{},inspectTogether:copies=>calls.push(['compare',copies]),mutate:async(name,input)=>{calls.push([name,input]);return {ok:true};},action:async fn=>fn()};
  const mount=node=>{document.body.append(node.node??node);return node.node??node;};
  return {...x,window,model,context,calls,client,mount,setActor:value=>actor=value,close(){x.core.close();window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}};
}

test('trade desk restores recipient, enforces side and policy, keeps typed money in review and clears review on edits',async()=>{
  const x=setup();try{
    sessionStorage.setItem('digital-card.trade-draft.v1:'+x.alice.userId,JSON.stringify({toUserId:x.bob.userId,give:{copyIds:[],currencies:[]},receive:{copyIds:[],currencies:[]}}));
    const own=x.core.tradeInventory(x.alice,x.alice.userId).items[0],original=x.client.tradeInventory;
    x.client.tradeInventory=async(id,options)=>{const data=await original(id,options);if(id===x.alice.userId)data.items=data.items.map(c=>c.id===own.id?{...c,tradable:false,untradableReason:'Binding policy blocks this copy'}:c);return data;};
    const view=x.mount(renderTrading(x.model,x.context));await settle();
    assert.equal(view.querySelector('[aria-label="Trade with"]').value,x.bob.userId);
    const blocked=view.querySelector('[data-copy-id="'+own.id+'"]');assert.equal(blocked.draggable,false);assert(blocked.querySelectorAll('button')[1].disabled);
    const money=field(view,'Request Credits');money.focus();money.value='5';money.dispatchEvent(new x.window.Event('input',{bubbles:true}));assert.match(view.querySelector('.dc-trade-summary').textContent,/5 Credits/);
    const tray=view.querySelector('[aria-label="Cards you request"]');const event=new x.window.Event('drop',{bubbles:true,cancelable:true});event.dataTransfer={getData:()=>JSON.stringify({side:'give',id:own.id})};tray.dispatchEvent(event);assert.match(view.querySelector('.dc-error').textContent,/own inventory/);
    click(view,'Review trade in host');let confirm=view.querySelector('.dc-review-check input');confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));assert(![...view.querySelectorAll('button')].find(b=>b.textContent==='Send offer').disabled);
    money.value='6';money.dispatchEvent(new x.window.Event('input'));assert.equal(view.querySelector('dialog'),null);click(view,'Review trade in host');confirm=view.querySelector('.dc-review-check input');
    confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));click(view,'Send offer');await settle();
    assert.equal(x.calls[0][0],'proposeTrade');assert.deepEqual(x.calls[0][1].receive.currencies,[{currencyId:'credits',amount:6}]);
  }finally{x.close();}
});

test('trade lounge batches flagged cards, keeps native denial disabled and ignores review after an edit',async()=>{
  const x=setup();let mounted;try{
    sessionStorage.setItem('digital-card.trade-draft.v1:'+x.alice.userId,JSON.stringify({toUserId:x.bob.userId}));
    const own=x.core.tradeInventory(x.alice,x.alice.userId).items,original=x.client.tradeInventory,reviews=[];
    x.client.tradeInventory=async(id,options)=>{const result=await original(id,options);if(id===x.alice.userId)result.items=result.items.map(copy=>({...copy,tradable:false,...(copy.id===own[0].id?{remoteReviewRequired:true,untradableReason:'Remote review required'}:{untradableReason:'Binding blocks transfer'})}));return result;};
    x.client.reviewTransfer=(input,{signal})=>new Promise((resolve,reject)=>reviews.push({input,signal,resolve,reject}));
    mounted=renderTrading(x.model,x.context);const view=x.mount(mounted);await settle();
    const flagged=view.querySelector('[data-copy-id="'+own[0].id+'"]'),blocked=view.querySelector('[data-copy-id="'+own[1].id+'"]');assert(flagged.draggable);assert(!blocked.draggable);assert(blocked.querySelectorAll('button')[1].disabled);
    click(flagged,'Add to offer');click(view,'Review trade in host');let confirm=view.querySelector('.dc-review-check input'),send=[...view.querySelectorAll('button')].find(button=>button.textContent==='Send offer');confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));
    assert(confirm.disabled);assert(send.disabled);assert.match(view.querySelector('.dc-error').textContent,/Checking/);assert.deepEqual(reviews[0].input.give.copyIds,[own[0].id]);assert.deepEqual(reviews[0].input.versions,{[own[0].id]:own[0].version});
    const note=field(view,'Message to the other collector');note.value='Updated offer';note.dispatchEvent(new x.window.Event('input'));assert(reviews[0].signal.aborted);assert.equal(view.querySelector('dialog'),null);
    const allow=row=>({status:'allowed',inputDigest:'a'.repeat(64),snapshotDigest:'b'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),copyIds:[...row.input.give.copyIds,...row.input.receive.copyIds]});reviews[0].resolve(allow(reviews[0]));await settle();assert.equal(view.querySelector('dialog'),null);click(view,'Review trade in host');confirm=view.querySelector('.dc-review-check input');send=[...view.querySelectorAll('button')].find(button=>button.textContent==='Send offer');assert(send.disabled);
    confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));reviews[1].reject(new Error('Exchange is blocked'));await settle();assert.match(view.querySelector('.dc-error').textContent,/Exchange is blocked/);assert(send.disabled);assert(!confirm.checked);
    confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));reviews[2].resolve(allow(reviews[2]));await settle();assert(confirm.checked);assert(!send.disabled);click(view,'Send offer');await settle();assert.equal(x.calls[0][0],'proposeTrade');assert.deepEqual(x.calls[0][1].give.copyIds,[own[0].id]);assert.equal(x.calls[0][1].message,'Updated offer');
  }finally{mounted?.dispose();x.close();}
});

test('currency-only trade lounge reviews before sending and disposal ignores a pending reply',async()=>{
  const x=setup();let mounted;try{
    x.model.catalog.features.cardTrading=false;sessionStorage.setItem('digital-card.trade-draft.v1:'+x.alice.userId,JSON.stringify({toUserId:x.bob.userId}));let review;
    x.client.reviewTransfer=(input,{signal})=>new Promise(resolve=>review={input,signal,resolve});mounted=renderTrading(x.model,x.context);const view=x.mount(mounted);await settle();const money=field(view,'Offer Credits');money.value='5';money.dispatchEvent(new x.window.Event('input'));click(view,'Review trade in host');let confirm=view.querySelector('.dc-review-check input');confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));
    assert.deepEqual(review.input.give.currencies,[{currencyId:'credits',amount:5}]);assert(confirm.disabled);assert([...view.querySelectorAll('button')].find(button=>button.textContent==='Send offer').disabled);mounted.dispose();const before=view.textContent;assert(review.signal.aborted);review.resolve({status:'allowed',inputDigest:'a'.repeat(64),snapshotDigest:'b'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),copyIds:[]});await settle();assert.equal(view.textContent,before);assert.equal(x.calls.length,0);
  }finally{mounted?.dispose();x.close();}
});

test('counteroffer lounge reviews parent escrow and sends both inventory versions',async()=>{
  const x=setup();let mounted;try{
    const own=x.core.tradeInventory(x.alice,x.alice.userId).items[0],partner=x.core.tradeInventory(x.alice,x.bob.userId).items[0],digest='c'.repeat(64),trade={id:'parent',digest,status:'pending',fromUserId:x.bob.userId,toUserId:x.alice.userId,fromName:'Bob',toName:'Alice',give:{copyIds:[partner.id],currencies:[]},receive:{copyIds:[own.id],currencies:[]},snapshots:{[own.id]:own,[partner.id]:partner},createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
    x.model.trades=[trade];const original=x.client.tradeInventory;let request;x.client.tradeInventory=async(id,options)=>{const page=await original(id,options);if(id===x.bob.userId)page.items=page.items.map(copy=>copy.id===partner.id?{...copy,tradable:false,lockedBy:trade.id,untradableReason:'Reserved by another transaction'}:copy);return page;};
    x.client.reviewTransfer=async input=>{request=input;return {status:'allowed',inputDigest:'a'.repeat(64),snapshotDigest:'b'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),copyIds:[own.id,partner.id]};};
    mounted=renderTrading(x.model,x.context);const view=x.mount(mounted);await settle();click(view,'Make counteroffer');await settle();click(view,'Review trade in host');const confirm=view.querySelector('dialog .dc-review-check input');confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));await settle();assert.equal(request.parentTradeId,trade.id);assert.equal(request.expectedDigest,digest);assert.equal(request.toUserId,x.bob.userId);assert.deepEqual(request.give.copyIds,[own.id]);assert.deepEqual(request.receive.copyIds,[partner.id]);click(view,'Send counteroffer');await settle();assert.equal(x.calls[0][0],'counterTrade');assert.deepEqual(x.calls[0][1].versions,{[own.id]:own.version,[partner.id]:partner.version});assert.equal(x.calls[0][1].expectedDigest,digest);
  }finally{mounted?.dispose();x.close();}
});

test('album layout imports preserve custom placement data, preview CSS is isolated and saves use optimistic versions',async()=>{
  const x=setup();try{const copy=x.model.inventory[0],doc={id:'album-1',version:3,name:'Private scene',visibility:'private',layout:{id:'grid',columns:2,gap:8,css:'.dc-album{padding:9px}',custom:{scene:'alpha'}},placements:[{copyId:copy.id,position:0,data:{crop:'left'}}]};
    x.model.albums=[doc];const view=x.mount(renderAlbums(x.model,x.context)),picker=view.querySelector('[aria-label="Your albums"]');picker.value=doc.id;picker.dispatchEvent(new x.window.Event('change'));
    const host=view.querySelector('.dc-album-host');assert(host.shadowRoot.querySelector('.dc-album'));assert(!document.querySelector('.dc-album-isolated'));
    const imported={...doc,name:'Imported local scene',placements:[{copyId:copy.id,position:0,data:{crop:'right',custom:{offset:4}}}]};field(view,'Album document JSON').value=JSON.stringify(imported);click(view,'Load layout into editor');assert.equal(x.calls.length,0);
    click(view,'Save album');await settle();const [,saved]=x.calls[0];assert.equal(saved.expectedVersion,3);assert.equal(saved.visibility,'private');assert.equal(saved.name,'Imported local scene');assert.deepEqual(saved.placements[0].data,imported.placements[0].data);assert.deepEqual(saved.layout.custom,{scene:'alpha'});
  }finally{x.close();}
});

test('collection selection inspects actual copies together and supports stat search',()=>{const x=setup();try{const view=x.mount(renderCollection(x.model,x.context)),checks=[...view.querySelectorAll('input[type="checkbox"]')];checks.forEach(c=>{c.checked=true;c.dispatchEvent(new x.window.Event('change'));});click(view,'Inspect together');assert.equal(x.calls[0][1].length,2);assert(x.calls[0][1].every(c=>c.ownerId===x.alice.userId));const search=field(view,'Search collection');search.value='NO_MATCH';search.dispatchEvent(new x.window.Event('input'));assert.match(view.textContent,/0 matching copies/);}finally{x.close();}});

test('album page reorder preserves card assignments and invalid imports leave the draft intact',async()=>{
  const x=setup();try{
    const copies=x.model.inventory,doc={name:'Book',layout:{pageSize:1,artwork:{pages:[{id:'a',title:'First'},{id:'b',title:'Second'}]}},placements:copies.map((c,position)=>({copyId:c.id,position,data:{custom:position}}))};
    const mounted=renderAlbums(x.model,x.context),view=x.mount(mounted),input=field(view,'Album document JSON');input.value=JSON.stringify(doc);click(view,'Load layout into editor');click(view,'Move page 1 later');
    click(view,'Remove page 1');assert.match(view.querySelector('.dc-error').textContent,/Move the 1 cards/);
    input.value=JSON.stringify({...doc,name:'Invalid',placements:[{copyId:copies[0].id,data:{pageId:'missing'}}]});click(view,'Load layout into editor');assert.match(view.querySelector('.dc-error').textContent,/unknown page/);assert.equal(field(view,'Album name').value,'Book');
    click(view,'Save album');await settle();const saved=x.calls[0][1];assert.deepEqual(saved.layout.artwork.pages.map(p=>p.id),['b','a']);assert.deepEqual(saved.placements.map(p=>p.data),[{custom:0,pageId:'a'},{custom:1,pageId:'b'}]);mounted.dispose();
  }finally{x.close();}
});

test('public and draft album previews dispose custom renderers exactly once',async()=>{
  const x=setup();try{
    let renders=0,disposes=0;x.client.publicAlbums=async()=>[{id:'public',name:'Shared',ownerName:'Artist'}];x.client.viewAlbum=async()=>({name:'Shared',ownerName:'Artist',cards:[],layout:{}});
    const mounted=renderAlbums(x.model,{...x.context,albumRenderer:()=>{renders++;return {node:document.createElement('div'),dispose(){disposes++;}};}}),view=x.mount(mounted);
    click(view,'Preview album');click(view,'Explore');await settle();click(view,'Shared · Artist');await settle();assert.equal(disposes,1);click(view,'Preview album');assert.equal(disposes,2);mounted.dispose();assert.equal(disposes,renders);click(view,'Preview album');assert.equal(disposes,renders);
  }finally{x.close();}
});

test('studio ignores stale previews and invalidates review when content changes',async()=>{const x=setup();try{let finish;const base=x.core.previewImport({role:'admin'},{source:JSON.stringify({cards:[{...x.model.catalog.cards[0],description:'Changed description'}]}),expectedVersion:x.model.catalog.version});x.client.previewImport=()=>new Promise(r=>finish=r);const mounted=renderStudio(x.model,x.context),view=x.mount(mounted);click(view,'Validate & preview');const source=field(view,'Import content');source.value='changed';source.dispatchEvent(new x.window.Event('input'));finish(base);await settle();assert(!view.querySelector('.dc-import-preview').children.length);assert([...view.querySelectorAll('button')].find(b=>b.textContent==='Publish reviewed revision').disabled);
    x.client.previewImport=async()=>base;click(view,'Validate & preview');await settle();assert.match(view.querySelector('.dc-change-grid').textContent,/1 updated/);const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));assert(![...view.querySelectorAll('button')].find(b=>b.textContent==='Publish reviewed revision').disabled);source.dispatchEvent(new x.window.Event('input'));assert.equal(review.checked,false);mounted.dispose();
  }finally{x.close();}});

test('custom views dispose across refresh, navigation and unmount; public inspector supports full orbit',async()=>{const x=setup();try{let disposed=0;const root=document.createElement('main');document.body.append(root);const mounted=mountFramework(root,{client:x.client,navigation:'tabs',sections:['one','two'],views:{one:()=>({node:document.createElement('section'),dispose:()=>disposed++}),two:()=>document.createElement('section')}});await mounted.ready;await mounted.refresh();assert.equal(disposed,1);root.querySelector('[data-view="two"]').click();assert.equal(disposed,2);root.querySelector('[data-view="one"]').click();mounted.dispose();assert.equal(disposed,3);
    const inspector=x.mount(renderInspector(x.model.inventory[0]));const stage=inspector.querySelector('.dc-3d-stage');stage.dispatchEvent(new x.window.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.equal(stage.dataset.yaw,'15');click(inspector,'Flip');assert.equal(stage.dataset.yaw,'195');
  }finally{x.close();}});

test('blocked or corrupted browser storage rejects mutations before any dispatch',async()=>{for(const storage of [{getItem:()=>'{bad',setItem:()=>{throw new Error('quota');}},{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}},undefined]){let calls=0;const runner=createCommandRunner({storage,namespace:'collector',client:{requestKey:randomUUID,purchase:async()=>{calls++;return {ok:true};}}});await assert.rejects(runner('purchase',{productId:'pack',quantity:1}),error=>error.code==='COMMAND_STORAGE_UNAVAILABLE');assert.equal(calls,0);}});

test('the reference conversion control executes a deliberate repeated amount twice',async()=>{
  const x=setup();let mounted;
  try{
    x.client.convert=async input=>x.core.convert(x.alice,input);const before=x.core.wallet(x.alice).credits,root=document.createElement('main');document.body.append(root);mounted=mountFramework(root,{client:x.client,sections:['wallet']});await mounted.ready;
    for(let n=0;n<2;n++){field(root,'Amount to spend').value='300';root.querySelector('[aria-label="From"]').value='credits';root.querySelector('[aria-label="To"]').value='gems';click(root,'Convert currencies');await settle();}
    assert.equal(before-x.core.wallet(x.alice).credits,600);assert.equal(x.core.wallet(x.alice).gems,6);
  }finally{mounted?.dispose();x.close();}
});

for(const boundary of ['remount','account switch'])for(const lostReply of [false,true])test('native conversion distinguishes '+(lostReply?'uncertain recovery':'confirmed repetition')+' after '+boundary,async()=>{
  const window=new Window({url:'http://localhost/'}),x=fixture();globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
  let actor=x.alice,key=0,lose=lostReply,app;const executions=[],root=document.createElement('main');document.body.append(root);
  const client={requestKey:()=>`conversion-${++key}`,principal:()=>actor.userId,me:async()=>x.core.me(actor),catalog:async()=>x.core.catalog(actor)};
  for(const name of ['wallet','packs','inventory','albums','trades','commandIntents','registerCommandIntent','acknowledgeCommandIntent'])client[name]=async input=>x.core[name](actor,input);
  client.executeCommandIntent=async input=>{const response=x.core.executeCommandIntent(actor,input);executions.push(structuredClone(response));if(lose){lose=false;throw new Error('Committed conversion response lost');}return response;};
  const mount=async()=>{app=mountFramework(root,{client,sections:['wallet']});await app.ready;};
  const submit=async()=>{field(root,'Amount to spend').value='300';field(root,'From').value='credits';field(root,'To').value='gems';click(root,'Convert currencies');await settle();};
  try{
    await mount();await submit();assert.equal(x.core.wallet(x.alice).credits,9700);assert.equal(x.core.wallet(x.alice).gems,3);const original=executions[0];assert(original);
    if(lostReply)assert(root.querySelector('.dc-status.dc-error'));else assert(root.querySelector('.dc-status.is-success'));
    if(boundary==='remount'){app.dispose();await mount();}
    else{actor=x.bob;await app.refresh();assert.equal(root.querySelector('.dc-balance strong').textContent,'10,000');actor=x.alice;await app.refresh();}
    if(lostReply){
      await submit();assert.equal(x.core.wallet(x.alice).credits,9700);assert.equal(x.core.wallet(x.alice).gems,3);assert.equal(executions.at(-1).intent.input.key,original.intent.input.key);assert.deepEqual(executions.at(-1).result,original.result);
    }
    await submit();assert.equal(x.core.wallet(x.alice).credits,9400);assert.equal(x.core.wallet(x.alice).gems,6);assert.notEqual(executions.at(-1).intent.input.key,original.intent.input.key);assert.notEqual(executions.at(-1).result.id,original.result.id);
    assert.equal(x.core.events({role:'admin'}).filter(event=>event.type==='currency.converted').length,2);assert.equal(x.core.wallet(x.bob).credits,10000);
  }finally{app?.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}
});

test('new card form previews without mutation and publishes a selectable artwork destination',async()=>{
 const x=setup();let mounted;try{
  let previews=0,commits=0;const actor={role:'admin'},before=x.core.catalog().cards.length;
  x.client.previewImport=async input=>{previews++;return x.core.previewImport(actor,input);};
  mounted=renderStudio(x.model,{...x.context,mutate:async(name,input)=>{commits++;return x.core.commitImport(actor,{...input,key:'new-card-test'});}});
  const view=x.mount(mounted),form=view.querySelector('.dc-new-card'),name=field(form,'Card name'),submit=()=>form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));
  submit();await settle();assert.equal(previews,0);
  name.value='  ';submit();await settle();assert.equal(previews,0);
  name.value='New artwork';name.dispatchEvent(new x.window.Event('input',{bubbles:true}));
  const line=form.querySelector('[aria-label="Card line"]'),saved=line.value;line.value='';submit();await settle();assert.equal(previews,0);line.value=saved;
  submit();await settle();assert.equal(previews,1);assert.equal(commits,0);assert.equal(x.core.catalog().cards.length,before);assert.equal(field(view,'Import content').value,'');
  const publish=[...view.querySelectorAll('button')].find(b=>b.textContent==='Publish reviewed revision');assert(publish.disabled);
  name.value='Reviewed artwork';name.dispatchEvent(new x.window.Event('input',{bubbles:true}));assert(publish.disabled);assert.equal(view.querySelector('.dc-import-preview').children.length,0);
  submit();await settle();const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));assert(!publish.disabled,view.textContent);
  publish.click();publish.click();await settle();assert.equal(commits,1);
  const card=x.core.catalog().cards.find(c=>c.name==='Reviewed artwork');assert(card);assert.equal(x.core.catalog().cards.length,before+1);
  assert(x.core.catalog().variants.some(v=>v.cardId===card.id&&v.id===card.id+'.standard'));
  assert.equal(view.querySelector('[aria-label="Destination card"]').value,card.id);assert(publish.disabled);
 }finally{mounted?.dispose();x.close();}
});
test('new card form explains missing line or rarity prerequisites',async()=>{
 for(const section of ['lines','rarities']){const x=setup();let mounted;try{
  x.model.catalog[section]=[];mounted=renderStudio(x.model,x.context);const view=x.mount(mounted),form=view.querySelector('.dc-new-card');
  assert(form.textContent.includes('A card line and rarity are required'));assert(form.querySelector('button').disabled);
 }finally{mounted?.dispose();x.close();}}
});


test('new card form fences late previews, supports cancellation and supplied translations',async()=>{
 const x=setup();let mounted;try{
  let finish,request;const localization=createLocalization({locale:'es',messages:{'studioShell.newCard':'Nueva tarjeta','studioShell.newCardName':'Nombre de tarjeta','studioShell.previewNewCard':'Revisar tarjeta','studioShell.cancelNewCard':'Cancelar tarjeta'}});
  x.client.previewImport=input=>{request=input;return new Promise(resolve=>finish=resolve);};
  mounted=renderStudio(x.model,{...x.context,localization});const view=x.mount(mounted),form=view.querySelector('.dc-new-card'),name=field(form,'Nombre de tarjeta');assert(form.textContent.includes('Nueva tarjeta'));assert.equal(view.lang,'es');
  name.value='First';form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));
  const firstId=request.source.cards[0].id;name.value='Changed';name.dispatchEvent(new x.window.Event('input',{bubbles:true}));finish(x.core.previewImport({role:'admin'},request));await settle();assert.equal(view.querySelector('.dc-import-preview').children.length,0);
  form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));assert.equal(request.source.cards[0].id,firstId);
  click(form,'Cancelar tarjeta');finish(x.core.previewImport({role:'admin'},request));await settle();assert.equal(name.value,'');assert.equal(view.querySelector('.dc-import-preview').children.length,0);
  name.value='Second';form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));assert.notEqual(request.source.cards[0].id,firstId);finish(x.core.previewImport({role:'admin'},request));await settle();
 }finally{mounted?.dispose();x.close();}
});

test('new card review cannot publish without catalog publication permission',async()=>{
 const x=setup();let mounted;try{
  x.model.me={...x.model.me,role:'player',permissions:['catalog.read','catalog.preview']};
  x.client.previewImport=async input=>x.core.previewImport({role:'admin'},input);
  mounted=renderStudio(x.model,x.context);const view=x.mount(mounted),form=view.querySelector('.dc-new-card');
  field(form,'Card name').value='Review only';form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(view.querySelector('.dc-import-preview .dc-collection-grid').children.length,1);
  const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));
  const publish=[...view.querySelectorAll('button')].find(button=>button.textContent==='Publish reviewed revision');assert(publish.disabled);
  publish.dispatchEvent(new x.window.Event('click'));await settle();assert.equal(x.calls.length,0);
 }finally{mounted?.dispose();x.close();}
});

test('new line form publishes into an empty catalog and refreshes card prerequisites',async()=>{
 for(const withRarity of [false,true]){const x=setup(),core=new x.core.constructor();let mounted;try{
  const actor={role:'admin'};core.publishCatalog(actor,{version:1,currencies:[],lines:[],rarities:withRarity?[{id:'common',name:'Common',rank:0}]:[],cards:[],variants:[],products:[]});
  let previews=0,commits=0;const client={...x.client,previewImport:async input=>{previews++;return core.previewImport(actor,input);}};
  mounted=renderStudio({...x.model,catalog:core.catalog()},{...x.context,client,mutate:async(name,input)=>{commits++;return core.commitImport(actor,{...input,key:'create-line'});}});
  const view=x.mount(mounted),form=view.querySelector('.dc-new-line'),name=field(form,'Line name'),submit=()=>form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));
  submit();await settle();assert.equal(previews,0);name.value='  ';submit();await settle();assert.equal(previews,0);
  name.value='  Moon garden  ';name.dispatchEvent(new x.window.Event('input',{bubbles:true}));field(form,'Line description (optional)').value='A quiet collection';submit();await settle();
  assert.equal(previews,1);assert.equal(commits,0);assert.equal(core.catalog().lines.length,0);assert.equal(field(view,'Import content').value,'');
  const publish=[...view.querySelectorAll('button')].find(button=>button.textContent==='Publish reviewed revision');assert(publish.disabled);
  const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));publish.click();publish.click();await settle();
  assert.equal(commits,1);const line=core.catalog().lines[0];assert.equal(line.name,'Moon garden');assert.equal(line.description,'A quiet collection');
  const cardForm=view.querySelector('.dc-new-card');assert.equal(cardForm.querySelector('[aria-label="Card line"]').value,line.id);
  assert.equal(cardForm.querySelector('button').disabled,!withRarity);assert.equal(cardForm.querySelector('.dc-muted').hidden,withRarity);assert(publish.disabled);
 }finally{mounted?.dispose();core.close();x.close();}}
});

test('new line form preserves draft IDs and fences edited and cancelled previews with translated labels',async()=>{
 const x=setup();let mounted;try{
  let finish,request;const localization=createLocalization({locale:'es',messages:{'studioShell.newLine':'Nueva colección','studioShell.newLineName':'Nombre de colección','studioShell.cancelNewLine':'Cancelar colección','studioShell.newLineNameRequired':'Escribe un nombre.'}});
  x.client.previewImport=input=>{request=input;return new Promise(resolve=>finish=resolve);};
  mounted=renderStudio(x.model,{...x.context,localization});const view=x.mount(mounted),form=view.querySelector('.dc-new-line'),name=field(form,'Nombre de colección'),submit=()=>form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));
  assert(form.textContent.includes('Nueva colección'));submit();assert.equal(name.validationMessage,'Escribe un nombre.');
  name.value='First';submit();const firstId=request.source.lines[0].id;assert(!Object.hasOwn(request.source.lines[0],'description'));
  name.value='Changed';name.dispatchEvent(new x.window.Event('input',{bubbles:true}));finish(x.core.previewImport({role:'admin'},request));await settle();assert.equal(view.querySelector('.dc-import-preview').children.length,0);
  submit();assert.equal(request.source.lines[0].id,firstId);click(form,'Cancelar colección');finish(x.core.previewImport({role:'admin'},request));await settle();assert.equal(view.querySelector('.dc-import-preview').children.length,0);assert.equal(name.value,'');
  name.value='Second';submit();assert.notEqual(request.source.lines[0].id,firstId);finish(x.core.previewImport({role:'admin'},request));await settle();
 }finally{mounted?.dispose();x.close();}
});

test('new line form respects preview and publication permissions',async()=>{
 for(const canPreview of [false,true]){const x=setup();let mounted;try{
  x.model.me={...x.model.me,role:'player',permissions:['catalog.read',...(canPreview?['catalog.preview']:[])]};let previews=0;
  x.client.previewImport=async input=>{previews++;return x.core.previewImport({role:'admin'},input);};
  mounted=renderStudio(x.model,x.context);const view=x.mount(mounted),form=view.querySelector('.dc-new-line');assert.equal(form.querySelector('button').disabled,!canPreview);
  field(form,'Line name').value='Review only';form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));await settle();assert.equal(previews,canPreview?1:0);
  const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));
  const publish=[...view.querySelectorAll('button')].find(button=>button.textContent==='Publish reviewed revision');assert(publish.disabled);publish.dispatchEvent(new x.window.Event('click'));await settle();assert.equal(x.calls.length,0);
 }finally{mounted?.dispose();x.close();}}
});

test('new pack form publishes a buyable pack with the reviewed variants and count',async()=>{
 const x=setup();let mounted;try{
  const actor={role:'admin'},before=x.core.catalog(),balance=x.core.wallet(x.alice).credits;let commits=0;
  x.client.previewImport=async input=>x.core.previewImport(actor,input);
  mounted=renderStudio(x.model,{...x.context,mutate:async(name,input)=>{commits++;return x.core.commitImport(actor,{...input,key:'new-pack-test'});}});
  const view=x.mount(mounted),form=view.querySelector('.dc-new-pack');field(form,'Pack name').value='Morning pair';field(form,'Cards per pack').value='2';field(form,'Price per pack (currency units)').value='7';
  const selected=['dawn.standard','cloud.standard'];for(const id of selected)form.querySelector('input[value="'+id+'"]').checked=true;
  form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(x.core.catalog().products.length,before.products.length);assert.equal(commits,0);assert.equal(field(view,'Import content').value,'');
  assert(view.querySelector('.dc-import-preview').textContent.includes('2 cards per pack · 7 Credits per pack'));
  const publish=[...view.querySelectorAll('button')].find(button=>button.textContent==='Publish reviewed revision');assert(publish.disabled);
  const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));publish.click();publish.click();await settle();assert.equal(commits,1);
  const product=x.core.catalog().products.find(row=>row.name==='Morning pair');assert(product);assert.equal(product.revision,1);assert.deepEqual(product.slots[0].pool,selected.map(variantId=>({variantId,weight:1})));assert.deepEqual(product.duplicatePolicy,{scope:'none',fallback:'allow'});
  assert.deepEqual(x.core.catalog().variants,before.variants);assert.equal(view.querySelector('[aria-label="Destination pack"]').value,product.id);
  const quote=x.core.quote(x.alice,{productId:product.id,quantity:1}),purchased=x.core.purchase(x.alice,{...quote,key:'buy-new-pack'});
  assert.equal(x.core.wallet(x.alice).credits,balance-7);const opened=x.core.openPack(x.alice,{packId:purchased.packs[0].id,key:'open-new-pack'});assert.equal(opened.cards.length,2);assert(opened.cards.every(card=>selected.includes(card.variantId)));
 }finally{mounted?.dispose();x.close();}
});

test('new pack form rejects missing fields, invalid numbers and unavailable prerequisites',async()=>{
 const x=setup();let mounted;try{
  let previews=0;x.client.previewImport=async input=>{previews++;return x.core.previewImport({role:'admin'},input);};
  mounted=renderStudio(x.model,x.context);const view=x.mount(mounted),form=view.querySelector('.dc-new-pack'),submit=async()=>{form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));await settle();};
  await submit();assert.equal(previews,0);field(form,'Pack name').value='  ';await submit();assert.equal(previews,0);field(form,'Pack name').value='Valid';await submit();assert.equal(previews,0);assert(form.textContent.includes('Select at least one included variant'));
  form.querySelector('input[type="checkbox"]').checked=true;
  for(const [label,values]of [['Price per pack (currency units)',['0','-1','1.5','9007199254740992','']],['Cards per pack',['0','101','1.5','']]]){const input=field(form,label);for(const value of values){input.value=value;await submit();assert.equal(previews,0);}input.value='1';}
  const currency=form.querySelector('[aria-label="Pack currency"]');currency.value='';await submit();assert.equal(previews,0);
 }finally{mounted?.dispose();x.close();}
 for(const missing of ['lines','currencies','variants']){const x=setup();let mounted;try{
  x.model.catalog[missing]=[];mounted=renderStudio(x.model,x.context);const view=x.mount(mounted),form=view.querySelector('.dc-new-pack');assert(form.querySelector('button').disabled);
  assert(form.textContent.includes(missing==='lines'?'Create a card line':missing==='currencies'?'Add a currency':'no enabled variants'));
 }finally{mounted?.dispose();x.close();}}
});

test('new pack form filters lines, fences late previews and preserves draft identity until cancellation',async()=>{
 const x=setup();let mounted;try{
  let request,finish;x.model.catalog.variants.find(row=>row.id==='dawn.standard').enabled=false;
  x.client.previewImport=input=>{request=input;return new Promise(resolve=>finish=resolve);};
  const localization=createLocalization({locale:'es',messages:{'studioShell.newPack':'Nuevo sobre','studioShell.newPackName':'Nombre del sobre','studioShell.cancelNewPack':'Cancelar sobre'}});
  mounted=renderStudio(x.model,{...x.context,localization});const view=x.mount(mounted),form=view.querySelector('.dc-new-pack'),name=field(form,'Nombre del sobre'),line=form.querySelector('[aria-label="Pack card line"]');assert(form.textContent.includes('Nuevo sobre'));assert(!form.querySelector('input[value="dawn.standard"]'));
  name.value='First';form.querySelector('input[value="cloud.standard"]').checked=true;const submit=()=>form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));submit();const id=request.source.products[0].id;
  line.value='garden';line.dispatchEvent(new x.window.Event('change',{bubbles:true}));assert(!form.querySelector('input[value="cloud.standard"]'));assert.equal(form.querySelectorAll('input:checked').length,0);finish(x.core.previewImport({role:'admin'},request));await settle();assert.equal(view.querySelector('.dc-import-preview').children.length,0);
  form.querySelector('input[value="fern.standard"]').checked=true;submit();assert.equal(request.source.products[0].id,id);assert.deepEqual(request.source.products[0].slots[0].pool,[{variantId:'fern.standard',weight:1}]);
  click(form,'Cancelar sobre');finish(x.core.previewImport({role:'admin'},request));await settle();assert.equal(view.querySelector('.dc-import-preview').children.length,0);assert.equal(name.value,'');
  name.value='Second';form.querySelector('input[type="checkbox"]').checked=true;submit();assert.notEqual(request.source.products[0].id,id);finish(x.core.previewImport({role:'admin'},request));await settle();
 }finally{mounted?.dispose();x.close();}
});

test('new pack form respects preview and publication permissions',async()=>{
 for(const canPreview of [false,true]){const x=setup();let mounted;try{
  x.model.me={...x.model.me,role:'player',permissions:['catalog.read',...(canPreview?['catalog.preview']:[])]};let previews=0;
  x.client.previewImport=async input=>{previews++;return x.core.previewImport({role:'admin'},input);};
  mounted=renderStudio(x.model,x.context);const view=x.mount(mounted),form=view.querySelector('.dc-new-pack');assert.equal(form.querySelector('button').disabled,!canPreview);field(form,'Pack name').value='Review only';form.querySelector('input[type="checkbox"]').checked=true;
  form.dispatchEvent(new x.window.Event('submit',{cancelable:true}));await settle();assert.equal(previews,canPreview?1:0);
  const review=view.querySelector('.dc-review-check input');review.checked=true;review.dispatchEvent(new x.window.Event('change'));const publish=[...view.querySelectorAll('button')].find(button=>button.textContent==='Publish reviewed revision');assert(publish.disabled);publish.dispatchEvent(new x.window.Event('click'));await settle();assert.equal(x.calls.length,0);
 }finally{mounted?.dispose();x.close();}}
});
