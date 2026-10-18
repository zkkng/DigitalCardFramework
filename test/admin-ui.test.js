import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {ApiError} from '../src/client.js';
import {createAdminController} from '../src/admin-client.js';
import {mountAdminPanel,renderAdminPanel} from '../src/admin-ui.js';
import {createLocalization} from '../src/localization.js';
import {fixture} from './helpers.js';
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};

for (const failure of ['missing','read','write','discard','corrupt']) test('admin saves require durable storage: '+failure,async()=>{
  const x=setup(),good=memory();let calls=0;
  const original=x.client.administerCards;x.client.administerCards=async input=>{calls++;return original(input);};
  const storage=failure==='missing'?undefined:{...good,
    ...(failure==='read'?{getItem(){throw new Error('Unavailable');}}:{}),
    ...(failure==='write'?{setItem(){throw new Error('Unavailable');}}:{}),
    ...(failure==='discard'?{setItem(){}}:{})};
  if(failure==='corrupt')good.setItem('digital-card.admin-command.v1:'+x.alice.userId,'{broken');
  const controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});
  try {
    await controller.load();controller.stage({command:'administerCards',input:{userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1,reason:'Replacement'},title:'Give Dawn',changes:[{label:'Dawn',before:'0',after:'1'}]});
    await controller.confirm();assert.equal(calls,0);assert.equal(x.core.inventory(x.bob).length,0);assert.equal(controller.getState().error.code,'COMMAND_STORAGE_UNAVAILABLE');
    if(failure==='write'||failure==='discard'){
      Object.assign(storage,good);await controller.confirm();assert.equal(calls,1);assert.equal(x.core.inventory(x.bob).length,1);assert.equal(controller.getState().pending,false);
    }
  } finally {controller.dispose();x.core.close();}
});

test('admin retry restores the original journal after storage is erased while mounted',async()=>{
  const x=setup(),storage=memory(),inputs=[],real=x.client.administerCards;
  x.client.administerCards=async input=>{inputs.push(input);const result=await real(input);if(inputs.length===1)throw new Error('Response lost');return result;};
  const controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});
  try {
    await controller.load();controller.stage({command:'administerCards',input:{userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1,reason:'Replacement'},title:'Give Dawn',changes:[{label:'Dawn',before:'0',after:'1'}]});
    await controller.confirm();storage.removeItem('digital-card.admin-command.v1:'+x.alice.userId);await controller.confirm();
    assert.deepEqual(inputs[0],inputs[1]);assert.equal(x.core.inventory(x.bob).length,1);assert.equal(controller.getState().pending,false);
  } finally {controller.dispose();x.core.close();}
});
function setup(){const x=fixture(),actor={...x.alice,role:'admin'};let key=0;const client={requestKey:()=>`admin-${++key}`,me:async()=>({...x.core.me(actor),role:'admin'})};for(const name of ['adminOverview','adminUsers','adminUser','adminHistory','configureAdmin','administerCards'])client[name]=async input=>x.core[name](actor,input);return {...x,actor,client};}
function click(root,label){const button=[...root.querySelectorAll('button')].find(node=>node.textContent===label||node.getAttribute('aria-label')===label);assert(button,'Missing button '+label);assert(!button.disabled,'Disabled button '+label);button.click();return button;}
function input(root,label,value,window){const node=root.querySelector(`[aria-label="${label}"]`);assert(node,'Missing field '+label);if(node.type==='checkbox')node.checked=value;else node.value=value;node.dispatchEvent(new window.Event('input',{bubbles:true}));node.dispatchEvent(new window.Event('change',{bubbles:true}));return node;}
async function mounted(run){const window=new Window(),x=setup();globalThis.document=window.document;const root=document.createElement('div');document.body.append(root);const panel=mountAdminPanel(root,{client:x.client,namespace:x.alice.userId,storage:memory()});try{await panel.ready;await run({...x,root,panel,window});}finally{panel.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;}}

test('ambiguous inventory response preserves exact intent across remount and prevents duplicate issuance',async()=>{
  const x=setup(),storage=memory(),real=x.client.administerCards,attempts=[];
  x.client.administerCards=async payload=>{attempts.push(payload);const receipt=await real(payload);if(attempts.length===1)throw new Error('Response lost');return receipt;};
  let controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});await controller.load();controller.stage({command:'administerCards',input:{userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1,reason:'Replacement'},title:'Give Dawn',changes:[{label:'Dawn',before:'0',after:'1'}]});await controller.confirm();assert(controller.getState().pending);assert.equal(controller.cancel(),false);controller.dispose();
  controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});await controller.load();await controller.confirm();assert.deepEqual(attempts[0],attempts[1]);assert.equal(x.core.inventory(x.bob).length,1);assert.equal(controller.getState().pending,false);controller.dispose();
});
test('late overview responses and disposed callbacks cannot replace current state',async()=>{
  const x=setup(),resolvers=[];x.client.adminOverview=()=>new Promise(resolve=>resolvers.push(resolve));const controller=createAdminController({client:x.client,namespace:'operator'});let events=0;controller.subscribe(()=>events++);const first=controller.load(),second=controller.load();resolvers[1]({revision:9});await second;resolvers[0]({revision:2});await first;assert.equal(controller.getState().overview.revision,9);const last=controller.load();controller.dispose();const before=events;resolvers[2]({revision:10});await last;assert.equal(events,before);
});
test('a disposed controller cannot erase a newer pending command from shared storage',async()=>{
  const x=setup(),storage=memory(),resolvers=[];x.client.configureAdmin=()=>new Promise(resolve=>resolvers.push(resolve));
  const stage=(c,value)=>c.stage({input:{scope:'site',changes:{packPurchasesPaused:value},reason:'Maintenance'},title:'Purchases',changes:[{label:'Purchases',before:'Allowed',after:'Paused'}]});
  const a=createAdminController({client:x.client,storage,namespace:'operator'});await a.load();stage(a,true);const first=a.confirm();await settle();a.dispose();const b=createAdminController({client:x.client,storage,namespace:'operator'});await b.load();const recovery=b.confirm();await settle();resolvers[1]({ok:true});await recovery;stage(b,false);const next=b.confirm();await settle();const key='digital-card.admin-command.v1:operator',newPayload=storage.getItem(key);resolvers[0]({ok:true});await first;assert.equal(storage.getItem(key),newPayload);resolvers[2]({ok:true});await next;assert.equal(storage.getItem(key),null);b.dispose();
});
test('Basic website edits review before saving and cancel restores saved state',()=>mounted(async x=>{
  assert.equal(x.root.querySelector('[data-admin-mode="false"]').getAttribute('aria-pressed'),'true');x.root.querySelector('[data-admin-tab="website"]').click();input(x.root,'Pack purchases',false,x.window);click(x.root,'Review changes');assert.equal(x.core.adminOverview(x.actor).site.packPurchasesPaused,false);assert.match(x.root.querySelector('.da-review').textContent,/Allowed.*Paused/s);click(x.root,'Cancel');assert.equal(x.root.querySelector('[aria-label="Pack purchases"]').checked,true);
  input(x.root,'Pack purchases',false,x.window);click(x.root,'Review changes');click(x.root,'Save changes');await settle();assert.equal(x.core.adminOverview(x.actor).site.packPurchasesPaused,true);assert.equal(x.root.querySelector('[aria-label="Pack purchases"]').checked,false);
}));
test('administration review keeps owned focus through saving, retry, and refresh without taking outside focus',async()=>{
  const window=new Window(),x=setup(),storage=memory(),pending=[],original=x.client.configureAdmin;
  globalThis.document=window.document;const root=document.createElement('div'),outside=document.createElement('button');document.body.append(root,outside);
  x.client.configureAdmin=input=>new Promise((resolve,reject)=>pending.push({input,resolve,reject}));
  const panel=mountAdminPanel(root,{client:x.client,namespace:x.alice.userId,storage});
  const stage=paused=>panel.controller.stage({title:'Trading',input:{scope:'site',changes:{tradingPaused:paused},reason:'Maintenance'},changes:[{label:'Trading',before:'Allowed',after:'Paused'}]});
  try{
    await panel.ready;stage(true);const save=[...root.querySelectorAll('.da-review button')].find(button=>button.textContent==='Save changes');assert(save);save.focus();save.click();assert.equal(panel.controller.getState().phase,'saving');assert(document.activeElement===root.querySelector('.da-review h3'),'Saving should focus the review heading');
    await settle();pending[0].reject(new Error('Response lost'));await settle();const retry=[...root.querySelectorAll('.da-review button')].find(button=>button.textContent==='Retry same change');assert(retry);assert(document.activeElement===retry,'The original retry should receive focus');assert.equal(retry.tabIndex,0);
    retry.click();assert(document.activeElement===root.querySelector('.da-review h3'),'Retry should focus the review heading while saving');await settle();pending[1].resolve(original(pending[1].input));await settle();assert(document.activeElement===root.querySelector('.da-heading h2'),'Successful review should focus the resulting view heading');assert.equal(x.core.adminOverview(x.actor).revision,1);
    stage(false);outside.focus();panel.controller.confirm();assert(document.activeElement===outside,'Outside focus should remain while saving');await settle();pending[2].reject(new Error('Response lost'));await settle();assert(document.activeElement===outside,'Outside focus should remain after a failed save');
  }finally{panel.dispose();for(const request of pending)request.resolve({});x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});
test('administration review focuses a definite save error after its focused action is replaced',async()=>{
  const window=new Window(),x=setup();globalThis.document=window.document;
  x.client.configureAdmin=async()=>{throw new ApiError('ADMIN_CHANGED','Settings changed',409);};
  const root=document.createElement('div');document.body.append(root);const panel=mountAdminPanel(root,{client:x.client,namespace:x.alice.userId,storage:memory()});
  try{
    await panel.ready;panel.controller.stage({title:'Trading',input:{scope:'site',changes:{tradingPaused:true},reason:'Maintenance'},changes:[{label:'Trading',before:'Allowed',after:'Paused'}]});
    const save=[...root.querySelectorAll('.da-review button')].find(button=>button.textContent==='Save changes');assert(save);save.focus();save.click();await settle();
    const error=root.querySelector('.da-status[data-kind="error"]');assert(error);assert(document.activeElement===error);assert.equal(error.tabIndex,-1);
  }finally{panel.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});
test('unsaved forms stay intact until explicit discard, including leaving the host route',()=>mounted(async x=>{
  x.root.querySelector('[data-admin-tab="lines"]').click();click(x.root,'Manage Sky Atlas');click(x.root,'Edit common');input(x.root,'Regular price','125',x.window);let left=false;x.panel.requestLeave(()=>{left=true;});assert(x.root.querySelector('.da-leave'));assert.equal(left,false);click(x.root,'Keep editing');assert.equal(x.root.querySelector('[aria-label="Regular price"]').value,'125');x.root.querySelector('[data-admin-tab="people"]').click();click(x.root,'Discard draft and continue');await settle();assert.match(x.root.textContent,/Alice/);assert.equal(x.core.adminOverview(x.actor).revision,0);
}));
test('inventory changes require a reason and exact-copy review; safe names reach Activity',()=>mounted(async x=>{
  x.core.administerCards(x.actor,{key:'setup',expectedRevision:0,reason:'Test award',userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1});await x.panel.refresh();x.root.querySelector('[data-admin-tab="people"]').click();await settle();click(x.root,'Manage Bob');await settle();click(x.root,'Remove cards');const check=x.root.querySelector('.da-checkbox-row input');check.checked=true;check.dispatchEvent(new x.window.Event('change',{bubbles:true}));input(x.root,'Reason for this inventory change','Duplicate correction',x.window);click(x.root,'Review changes');assert.match(x.root.querySelector('.da-review').textContent,/Dawn.*Copy.*Retired/s);assert.equal(x.core.inventory(x.bob).length,1);click(x.root,'Save changes');await settle();assert.equal(x.core.inventory(x.bob).length,0);x.root.querySelector('[data-admin-tab="activity"]').click();await settle();assert.match(x.root.textContent,/Bob/);assert.match(x.root.textContent,/Changed by Alice/);
}));
test('read-only operators see saved controls without editable actions',async()=>{
  const window=new Window(),x=setup();globalThis.document=window.document;x.client.adminOverview=async()=>x.core.adminOverview({...x.alice,permissions:['admin.read']});const root=document.createElement('div'),panel=mountAdminPanel(root,{client:x.client,namespace:'read-only'});try{await panel.ready;root.querySelector('[data-admin-tab="website"]').click();assert(root.querySelector('[aria-label="Pack purchases"]').disabled);assert.match(root.textContent,/Additional administrator permission/);}finally{panel.dispose();await window.happyDOM.abort();delete globalThis.document;}
});


for(const retryStatus of [401,429])test('admin original issuance survives a retry rejection '+retryStatus,async()=>{
  const x=setup(),storage=memory(),real=x.client.administerCards,inputs=[];let attempts=0;
  x.client.administerCards=async input=>{inputs.push(input);attempts++;if(attempts===2)throw new ApiError('RETRY_REJECTED','Retry unavailable',retryStatus);const result=await real(input);if(attempts===1)throw new Error('Committed response lost');return result;};
  let controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});
  try{
    await controller.load();controller.stage({command:'administerCards',input:{userId:x.bob.userId,action:'give',variantId:'dawn.standard',quantity:1,reason:'Replacement'},title:'Give Dawn',changes:[{label:'Dawn',before:'0',after:'1'}]});await controller.confirm();controller.dispose();
    controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});await controller.confirm();assert.equal(controller.getState().pending,true);controller.dispose();
    controller=createAdminController({client:x.client,storage,namespace:x.alice.userId});await controller.confirm();assert.equal(controller.getState().pending,false);assert.deepEqual(inputs[0],inputs[2]);assert.equal(x.core.inventory(x.bob).length,1);
  }finally{controller.dispose();x.core.close();}
});

const adminSpanish={
  'admin.adminControlPanel':'<b>Control privado</b>','admin.overview':'Resumen','admin.website':'Sitio',
  'admin.allowed':'Permitido','admin.paused':'Pausado','admin.packPurchases':'Compra de paquetes',
  'admin.reviewChanges':'Revisar cambios','admin.saveChanges':'Guardar cambios','admin.retrySameChange':'Reintentar el mismo cambio',
  'admin.reasonOptional':'Motivo (opcional)','admin.changesSaved':'Cambios guardados.',
  'admin.pendingPrevious':'Confirma el cambio anterior.','admin.unconfirmedResult':'Reintenta el cambio original.',
  'admin.keepEditing':'Seguir editando','admin.discardDraftAndContinue':'Descartar borrador',
  'admin.regularPrice':'Precio habitual','admin.buyerPaysPerPack':'Precio por paquete',
  'admin.cardCount':{one:'{count} tarjeta',other:'{count} tarjetas'},'admin.packCount':{one:'{count} paquete',other:'{count} paquetes'}
};
test('standalone administration localizes each instance while keeping authored values and reviewed inputs exact',async()=>{
  const window=new Window(),x=setup();globalThis.document=window.document;
  const actualOverview=x.client.adminOverview,actualConfigure=x.client.configureAdmin,commands=[];
  x.client.adminOverview=async()=>{const value=await actualOverview();value.counts.users=1000;return value;};
  x.client.configureAdmin=async input=>{commands.push(structuredClone(input));return actualConfigure(input);};
  const es=createLocalization({locale:'es',messages:adminSpanish}),root=document.createElement('div'),other=document.createElement('div');document.body.append(root,other);
  const panel=renderAdminPanel({me:{userId:x.alice.userId}},{client:x.client,localization:es}),english=mountAdminPanel(other,{client:x.client,namespace:x.alice.userId,storage:memory()});root.append(panel.node);
  try{
    await Promise.all([panel.ready,english.ready]);assert.equal(root.querySelector('.dc-admin').lang,'es');assert.equal(other.querySelector('.dc-admin').lang,'en');
    assert.equal(root.querySelector('.da-brand strong').textContent,'<b>Control privado</b>');assert.equal(root.querySelector('.da-brand b'),null);assert.match(root.textContent,new RegExp(es.number(1000)));assert.match(other.textContent,/Admin control panel/);
    root.querySelector('[data-admin-tab="website"]').click();input(root,'Compra de paquetes',false,window);const reason='0007 <audit> é';input(root,'Motivo (opcional)',reason,window);click(root,'Revisar cambios');assert.equal(commands.length,0);assert.match(root.querySelector('.da-review').textContent,/Permitido.*Pausado/s);assert.equal(root.querySelector('.da-review audit'),null);
    // This wrapper uses the platform storage; provide a durable store explicitly on its owned controller before saving.
    panel.dispose();const saved=memory(),mounted=mountAdminPanel(root,{client:x.client,namespace:x.alice.userId,storage:saved,locale:'es',messages:adminSpanish});await mounted.ready;
    try{root.querySelector('[data-admin-tab="website"]').click();input(root,'Compra de paquetes',false,window);input(root,'Motivo (opcional)',reason,window);click(root,'Revisar cambios');click(root,'Guardar cambios');await settle();assert.equal(commands.length,1);assert.deepEqual(commands[0].changes,{packPurchasesPaused:true});assert.equal(commands[0].reason,reason);assert.equal(commands[0].expectedRevision,0);assert.match(root.textContent,/Cambios guardados/);
      root.querySelector('[data-admin-tab="activity"]').click();await settle();const event=x.core.adminHistory(x.actor,{limit:1}).items[0];assert.match(root.textContent,new RegExp(es.date(event.at).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(root.textContent,/0007 <audit> é/);
    }finally{mounted.dispose();}
    assert.match(other.textContent,/Admin control panel/);assert(!other.textContent.includes('Control privado'));
  }finally{panel.dispose();english.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});

test('localized recovery across a different locale preserves the originally reviewed text and command identity',async()=>{
  const window=new Window(),x=setup(),storage=memory(),inputs=[],actual=x.client.configureAdmin;globalThis.document=window.document;
  x.client.configureAdmin=async input=>{inputs.push(structuredClone(input));const receipt=await actual(input);if(inputs.length===1)throw new Error('<provider response lost>');return receipt;};
  const root=document.createElement('div');document.body.append(root);let panel=mountAdminPanel(root,{client:x.client,namespace:x.alice.userId,storage,locale:'es',messages:adminSpanish});
  try{
    await panel.ready;root.querySelector('[data-admin-tab="website"]').click();input(root,'Compra de paquetes',false,window);input(root,'Motivo (opcional)','Exact <reason>',window);click(root,'Revisar cambios');const reviewed=panel.controller.getState().review;click(root,'Guardar cambios');await settle();assert.equal(panel.controller.getState().pending,true);assert.match(root.textContent,/Reintenta el cambio original/);assert(root.textContent.includes(createLocalization({locale:'es',messages:adminSpanish}).text('diagnostic.network')));assert.equal(panel.controller.getState().error.message,'<provider response lost>');assert.equal(root.querySelector('provider'),null);panel.dispose();
    panel=mountAdminPanel(root,{client:x.client,namespace:x.alice.userId,storage,locale:'ar',messages:{'admin.retrySameChange':'إعادة المحاولة الأصلية','admin.pendingPrevious':'تأكيد التغيير السابق'}});await panel.ready;assert.equal(root.querySelector('.dc-admin').dir,'rtl');assert.deepEqual(panel.controller.getState().review,{...reviewed,input:{...reviewed.input,key:inputs[0].key}});assert.match(root.textContent,/Permitido.*Pausado/s);click(root,'إعادة المحاولة الأصلية');await settle();assert.equal(panel.controller.getState().pending,false);assert.deepEqual(inputs[0],inputs[1]);assert.equal(x.core.adminOverview(x.actor).revision,1);
  }finally{panel.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});

test('a supplied controller retains its message language and lifecycle ownership',async()=>{
  const window=new Window(),x=setup();globalThis.document=window.document;const controller=createAdminController({client:x.client,namespace:x.alice.userId,storage:memory()}),root=document.createElement('div'),panel=mountAdminPanel(root,{controller,locale:'es',messages:adminSpanish});
  try{await panel.ready;controller.cancel();assert.match(root.textContent,/Draft discarded\. Saved settings are unchanged/);assert.equal(root.querySelector('.dc-admin').lang,'es');panel.dispose();assert.equal(controller.stage({title:'Authored <title>',input:{scope:'site',changes:{tradingPaused:true},reason:'User reason'},changes:[{label:'Authored field',before:'Original',after:'Updated'}]}),true);
  }finally{panel.dispose();controller.dispose();x.core.close();await window.happyDOM.abort();delete globalThis.document;}
});
