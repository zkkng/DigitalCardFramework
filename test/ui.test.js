import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers.js';
import {renderCard,renderAlbum,renderInspector,mountFramework,mountOpener,renderPack} from '../src/ui.js';
import {renderTrading} from '../src/trading-ui.js';
import {renderAlbums,renderCollection} from '../src/collection-ui.js';
import {renderStudio} from '../src/studio-ui.js';
import {createCommandRunner,createRevealController} from '../src/client.js';

const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};

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
    const confirm=view.querySelector('.dc-review-check input');confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));assert(![...view.querySelectorAll('button')].find(b=>b.textContent==='Send offer').disabled);
    money.value='6';money.dispatchEvent(new x.window.Event('input'));assert.equal(confirm.checked,false);
    confirm.checked=true;confirm.dispatchEvent(new x.window.Event('change'));click(view,'Send offer');await settle();
    assert.equal(x.calls[0][0],'proposeTrade');assert.deepEqual(x.calls[0][1].receive.currencies,[{currencyId:'credits',amount:6}]);
  }finally{x.close();}
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
