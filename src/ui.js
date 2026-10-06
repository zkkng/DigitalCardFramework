import {createCardRenderer} from './presentation/card-view.js';
const portableRenderers=new Map();
import {createRevealController,createCommandRunner} from './client.js';
import {defaultCSS} from './styles.js';
import {albumAppearance,applyAlbumAppearance} from './album-appearance.js';
export {albumAppearance,validateAlbumAppearance} from './album-appearance.js';
import {render3DInspector,renderComparison} from './inspector-ui.js';
import {renderCollection,renderAlbums} from './collection-ui.js';
import {renderTrading} from './trading-ui.js';
import {renderMarketplace,renderFulfillments,renderTradingControls} from './marketplace-ui.js';
import {renderCodeHistory} from './code-ui.js';
import {renderAdminPanel} from './admin-ui.js';
export {defaultCSS} from './styles.js';
export function element(tag,className,text) {
  const node=document.createElement(tag);
  if(className) node.className=className;
  if(text!==undefined) node.textContent=String(text);
  return node;
}
function button(label,action) {
  const node=element('button','dc-button',label); node.type='button'; node.addEventListener('click',action); return node;
}
function assetURL(src) {
  try {const u=new URL(src,document.baseURI); return ['http:','https:'].includes(u.protocol)?u.href:null;} catch {return null;}
}
const themes=['--dc-bg','--dc-panel','--dc-text','--dc-muted','--dc-accent','--dc-border','--dc-radius','--dc-card-ratio','--dc-font','--dc-button-text','--dc-card-text'];
export function installStyles(root,{theme={},css=''}={}) {
  root.classList.add('dc-root');
  for(const [name,value] of Object.entries(theme)) if(themes.includes(name)) root.style.setProperty(name,String(value));
  const style=element('style'); style.textContent=defaultCSS+'\n'+css; root.prepend(style);
  return ()=>{style.remove();root.classList.remove('dc-root');for(const name of Object.keys(theme)) if(themes.includes(name)) root.style.removeProperty(name);};
}
export function renderCard(copy,{onSelect,interactive=true,backRenderer,effects=true,presentationMode='poster'}={}) {
  if(copy.variant?.presentation||copy.definition.presentation){if(!portableRenderers.has(presentationMode))portableRenderers.set(presentationMode,createCardRenderer({mode:presentationMode}));return portableRenderers.get(presentationMode)(copy,{onSelect});}
  const node=element('button','dc-card'); node.type='button';
  node.setAttribute('aria-label',copy.definition.name+', '+copy.rarityId+(copy.serialNumber?' '+copy.serialNumber+' of '+copy.editionTotal:''));
  const inner=element('span','dc-card-inner'),front=element('span','dc-front'),back=element('span','dc-back');
  if(copy.definition.appearance?.background) front.style.background=copy.definition.appearance.background;
  node.dataset.rarity=copy.rarityId;
  if(!copy.definition.layers?.length) {
    const motif=element('span','dc-card-motif');motif.setAttribute('aria-hidden','true');
    motif.append(element('span','dc-orbit'),element('span','dc-orb'),element('span','dc-horizon'));
    front.append(motif);
  }
  for(const layer of copy.definition.layers??[]) {
    const src=assetURL(layer.src);if(!src)continue;
    const image=element('img','dc-layer'+(effects && layer.effect==='emissive'?' dc-emissive':''));
    image.src=src;image.alt='';image.loading='lazy';
    if(layer.crop){const p=layer.crop;Object.assign(image.style,{inset:'auto',width:100/p.width+'%',height:100/p.height+'%',left:-100*p.x/p.width+'%',top:-100*p.y/p.height+'%',objectFit:'fill'});}
    if(Number.isFinite(layer.opacity) && layer.opacity>=0 && layer.opacity<=1)image.style.opacity=String(layer.opacity);image.style.setProperty('--dc-depth',String(effects?layer.depth??0:0));
    if(['normal','screen','multiply','overlay'].includes(layer.blend))image.style.mixBlendMode=layer.blend;
    image.addEventListener('error',()=>image.remove(),{once:true}); front.append(image);
  }
  const title=element('span','dc-card-title');
  title.append(element('strong','',copy.definition.name),element('small','',copy.rarityId+(copy.serialNumber?' · '+copy.serialNumber+' / '+copy.editionTotal:'')));
  front.append(title);
  if(effects) {
    const overlay=element('span','dc-gloss'+(['holo','foil'].includes(copy.variant.finish)?' dc-holo':''));
    if(copy.variant.effectMask && assetURL(copy.variant.effectMask)) {
      overlay.style.maskImage='url("'+assetURL(copy.variant.effectMask).replaceAll('"','%22')+'")';
      overlay.style.maskSize='cover';
    }
    front.append(overlay);
  }
  const cardBack=copy.variant.back??copy.definition.back;
  if(backRenderer) {node.dataset.customBack='true';back.append(backRenderer(copy));}
  else if(cardBack && assetURL(cardBack)) {node.dataset.customBack='true';const image=element('img','dc-layer');image.src=assetURL(cardBack);image.alt='Card back';back.append(image);}
  else back.append(element('span','dc-back-mark','◇'));
  inner.append(front,back);node.append(inner);
  if(interactive) {
    node.addEventListener('pointermove',e=>{const r=node.getBoundingClientRect();node.style.setProperty('--dc-x',String((e.clientX-r.left)/r.width*2-1));node.style.setProperty('--dc-y',String((e.clientY-r.top)/r.height*2-1));});
    node.addEventListener('pointerleave',()=>{node.style.setProperty('--dc-x','0');node.style.setProperty('--dc-y','0');});
  }
  node.addEventListener('click',()=>onSelect?.(copy));
  return node;
}
export function renderInspector(copy,options={}) {return render3DInspector(copy,{cardRenderer:renderCard,...options});}
/** Compact legacy inspector remains available to hosts that prefer the earlier tilt interaction. */
export function renderTiltInspector(copy,{cardRenderer=renderCard,metadataRenderer,backRenderer,onClose,labels={}}={}) {
  const node=element('section','dc-inspector');node.setAttribute('aria-label','Card inspection');
  const grid=element('div','dc-inspector-grid'),card=cardRenderer(copy,{backRenderer}),details=element('div');
  let flipped=false;
  const flip=()=>{flipped=!flipped;card.style.setProperty('--dc-flip',flipped?'180deg':'0deg');card.dataset.flipped=String(flipped);};
  card.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight') {event.preventDefault();card.style.setProperty('--dc-x',event.key==='ArrowLeft'?'-0.8':'0.8');}
    if(event.key==='ArrowUp'||event.key==='ArrowDown') {event.preventDefault();card.style.setProperty('--dc-y',event.key==='ArrowUp'?'-0.8':'0.8');}
    if(event.key==='Escape') onClose?.();
  });
  details.append(element('h2','',copy.definition.name),element('p','dc-muted','Move across the card to inspect its depth. Arrow keys also tilt the card.'));
  const controls=element('div','dc-row');controls.append(button('Flip card',flip));if(onClose)controls.append(button('Close',onClose));details.append(controls);
  if(metadataRenderer) details.append(metadataRenderer(copy));
  else {
    const list=element('dl');
    const fields={Line:labels.line??copy.lineId,Rarity:labels.rarity??copy.rarityId,Finish:copy.variant.finish??'standard',
      Edition:copy.serialNumber?copy.serialNumber+' of '+copy.editionTotal:'Open edition',
      'Opened by':copy.openedByName??copy.openedBy??'Not opened','Opened at':copy.openedAt?new Date(copy.openedAt).toLocaleString():'Not opened','Copy ID':copy.id};
    for(const [name,value]of Object.entries(fields))list.append(element('dt','',name),element('dd','',value));
    for(const [name,value]of Object.entries({...copy.definition.metadata,...copy.variant.metadata,...copy.metadata}))
      list.append(element('dt','',name),element('dd','',typeof value==='object'?JSON.stringify(value):value));
    for(const [name,b]of Object.entries(copy.bindings))list.append(element('dt','',name+' · '+b.state),element('dd','',JSON.stringify(b.data)));
    details.append(list);
  }
  grid.append(card,details);node.append(grid);return node;
}
export function renderAlbum(model,{cardRenderer=renderCard,onSelect,layouts={}}={}) {
  const custom=Object.hasOwn(layouts,model.layout?.id)?layouts[model.layout.id]:null;
  if(custom) return custom(model,{cardRenderer,onSelect});
  const node=element('div','dc-album');if(model.layout?.id==='panorama')node.classList.add('dc-panorama');
  const columns=Number(model.layout?.columns??3);if(Number.isInteger(columns)&&columns>=1&&columns<=12)node.style.setProperty('--dc-album-columns',String(columns));
  const gap=Number(model.layout?.gap??18);if(Number.isFinite(gap)&&gap>=0&&gap<=100)node.style.setProperty('--dc-album-gap',gap+'px');
  for(const {copy} of model.cards)node.append(cardRenderer(copy,{onSelect}));
  const host=element('div','dc-album-host'),shadow=host.attachShadow({mode:'open'}),wrap=element('div','dc-root dc-album-isolated'),style=element('style');
  Object.assign(host.style,{position:'relative',contain:'layout paint',isolation:'isolate',overflow:'hidden',maxWidth:'100%',minWidth:'0'});
  style.textContent=defaultCSS+'\n.dc-root.dc-album-isolated{padding:0;border:0;background:transparent;'+themes.map(name=>name+':inherit').join(';')+'}';
  applyAlbumAppearance(node,albumAppearance(model.layout));wrap.append(node);shadow.append(style,wrap);return host;
}
export function mountOpener(root,{controller,cardRenderer=renderCard,view,onSelect}={}) {
  let cleanup;
  const unsubscribe=controller.subscribe(state=>{
    cleanup?.();root.replaceChildren();
    if(view) {const rendered=view(state,controller);if(rendered.node){root.append(rendered.node);cleanup=rendered.dispose;}else{root.append(rendered);cleanup=undefined;}return;}
    const node=element('div','dc-opener');
    node.append(element('h3','',state.phase==='complete'?'Your cards are revealed':'Reveal your cards'));
    if(state.phase==='idle')node.append(element('p','dc-muted','Choose a sealed pack above. After opening, its cards belong to your collection.'));
    if(state.phase==='loading')node.append(element('p','','Loading committed cards…'));
    if(state.error)node.append(element('p','dc-error',state.error.message));
    if(state.receipt) {
      const row=element('div','dc-row');
      node.append(element('p','dc-muted',state.revealed+' of '+state.receipt.cards.length+' revealed · Cards are already saved to your collection.'));
      const next=button('Reveal next',()=>controller.reveal()),all=button('Reveal all',()=>controller.skip());
      next.disabled=all.disabled=state.revealed===state.receipt.cards.length;
      row.append(next,all,button('Replay reveal',()=>controller.replay()));node.append(row);
      const cards=element('div','dc-grid');
      for(const copy of state.receipt.cards.slice(0,state.revealed)){
        const result=element('div','dc-result-card');result.append(cardRenderer(copy,{onSelect}),element('small','dc-result-label',copy.isNew?'New to your collection':'Duplicate at opening'));cards.append(result);
      }
      for(let i=state.revealed;i<state.receipt.cards.length;i++) {const back=element('div','dc-sealed-card');back.append(element('span','','◇'),element('small','','Card '+(i+1)));cards.append(back);}
      node.append(cards);
    }
    root.append(node);
  });
  return ()=>{unsubscribe();cleanup?.();root.replaceChildren();};
}
export function mountFramework(root,{client,theme={},css='',cardRenderer=renderCard,albumRenderer=renderAlbum,inspectorRenderer=render3DInspector,comparisonRenderer=renderComparison,codeRevealRenderer,listingRenderer,views:customViews={},viewLabels={},
  backRenderer,metadataRenderer,openerView,layouts={},participants=[],navigation='sections',
  sections=['wallet','shop','packs','collection','marketplace','rewards','codes','albums','trades']}={}) {
  const removeStyles=installStyles(root,{theme,css});
  const dashboard=element('div','dc-dashboard'),nav=element('nav','dc-nav'),content=element('div','dc-content');
  const status=element('div','dc-status'),inspector=element('dialog','dc-inspector-dialog');
  status.setAttribute('role','status');nav.setAttribute('aria-label','Framework features');inspector.setAttribute('aria-label','Card details');
  root.append(dashboard,nav,status,content,inspector);
  let disposed=false,model=null,openerDispose=null,viewDisposers=[],refreshGeneration=0,mutate=null,commandPrincipal=null,busy=false;
  let active=sections.includes('shop')?'shop':sections[0],viewLeave=null;
  let effectiveSections=sections;
  const renderer=(copy,options={})=>cardRenderer(copy,{backRenderer,...options});
  const currencyName=id=>model.catalog.currencies.find(c=>c.id===id)?.name??id;
  const lineName=id=>model.catalog.lines.find(l=>l.id===id)?.name??id;
  const userName=id=>participants.find(u=>u.id===id)?.name??(id===model.me.userId?'You':id);
  const num=n=>Number(n).toLocaleString();
  const closeInspector=()=>inspector.close();
  function inspect(copy) {
    if(disposed)return;
    inspector.replaceChildren(inspectorRenderer(copy,{cardRenderer:renderer,metadataRenderer,backRenderer,onClose:closeInspector,catalog:model.catalog,
      labels:{line:lineName(copy.lineId),rarity:model.catalog.rarities.find(r=>r.id===copy.rarityId)?.name}}));
    if(!inspector.open)inspector.showModal();
  }
  function inspectTogether(copies){if(disposed||!copies.length)return;inspector.replaceChildren(comparisonRenderer(copies,{cardRenderer:renderer,catalog:model.catalog,onClose:closeInspector}));if(!inspector.open)inspector.showModal();}
  inspector.addEventListener('click',event=>{if(event.target===inspector)inspector.close();});
  const controller=createRevealController({open:input=>mutate('openPack',{packId:input.packId}),key:client.requestKey});
  async function action(fn,{refreshAfter=true,message='Changes saved.'}={}) {
    if(busy || disposed)return;
    busy=true;status.className='dc-status is-working';status.textContent='Working…';
    root.setAttribute('aria-busy','true');const controls=[...root.querySelectorAll('.dc-content button')].map(b=>[b,b.disabled]);controls.forEach(([b])=>b.disabled=true);
    try {
      const value=await fn();
      if(!disposed){if(refreshAfter)await refresh();status.className='dc-status is-success';status.textContent=typeof message==='function'?message(value):message;}
      return value;
    } catch(error) {if(!disposed){status.className='dc-status dc-error';status.textContent=error.message;}return undefined;}
    finally {busy=false;root.removeAttribute('aria-busy');controls.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;});}
  }
  function field(parent,label,type='text',value='') {
    const wrap=element('label','dc-field'),caption=element('span','',label),input=element('input');
    caption.textContent=label;input.type=type;input.value=value;wrap.append(caption,input);parent.append(wrap);return input;
  }
  function selectField(parent,label,items) {
    const wrap=element('label','dc-field'),select=element('select');wrap.append(element('span','',label),select);
    select.setAttribute('aria-label',label);
    for(const item of items){const option=element('option','',item.name);option.value=item.id;select.append(option);}parent.append(wrap);return select;
  }
  function section(title,description) {const node=element('section','dc-section');node.append(element('h2','',title));if(description)node.append(element('p','dc-section-intro',description));return node;}
  function empty(node,title,description,cta,go) {const box=element('div','dc-empty');box.append(element('span','dc-empty-symbol','◇'),element('h3','',title),element('p','dc-muted',description));if(cta)box.append(button(cta,()=>navigate(go)));node.append(box);}
  function navigate(name,approved=false) {
    if(!effectiveSections.includes(name))return;
    if(active==='admin'&&name!==active&&viewLeave&&!approved){viewLeave(()=>navigate(name,true));return;}
    const refreshAfterAdmin=active==='admin' && name!=='admin';
    active=name;status.textContent='';renderView();
    if(refreshAfterAdmin)refresh().catch(error=>{if(!disposed){status.className='dc-status dc-error';status.textContent=error.message;}});
  }
  function wallet() {
    const node=section('Your wallet','Each account has its own balances. Pack purchases and conversions update these balances immediately.');
    const cards=element('div','dc-wallet-grid');
    for(const c of model.catalog.currencies){const box=element('article','dc-balance');box.append(element('span','dc-muted',c.name),element('strong','',num(model.wallet[c.id]??0)),element('small','dc-muted',(c.tradable?'Tradable':'Not tradable')+' · Value: '+(c.value.numerator/c.value.denominator)+' base units'));cards.append(box);}node.append(cards);
    if(model.catalog.features.conversion) {
      const form=element('div','dc-form-panel');form.append(element('h3','','Convert currencies'));
      const row=element('div','dc-form-row'),amount=field(row,'Amount to spend','number','100');amount.min='1';amount.step='1';
      const eligible=model.catalog.currencies.filter(c=>c.convertible!==false);
      const from=selectField(row,'From',eligible),to=selectField(row,'To',eligible);if(to.options.length>1)to.selectedIndex=1;
      const preview=element('p','dc-conversion-preview');
      function update(){const a=eligible.find(c=>c.id===from.value),b=eligible.find(c=>c.id===to.value);if(a&&b)preview.textContent=num(Number(amount.value))+' '+a.name+' → '+num(Number(amount.value)*a.value.numerator*b.value.denominator/(a.value.denominator*b.value.numerator))+' '+b.name;}
      [amount,from,to].forEach(x=>x.addEventListener('input',update));update();
      form.append(row,preview,button('Convert currencies',()=>action(()=>mutate('convert',{from:from.value,to:to.value,amount:Number(amount.value),catalogVersion:model.catalog.version}),{message:r=>'Converted '+r.amount+' '+currencyName(r.from)+' into '+r.received+' '+currencyName(r.to)+'.'})),element('p','dc-muted','Choose an amount that converts to a whole unit. Fractional results are rejected.'));node.append(form);
    }return node;
  }
  function packArt(product,small=false) {
    const art=element('div','dc-pack-art'+(small?' dc-pack-art-small':''));art.dataset.line=product.lineId;
    art.setAttribute('aria-hidden','true');art.append(element('span','dc-pack-orbit'),element('span','dc-pack-symbol',product.lineId==='garden'?'✳':'✦'),element('span','dc-pack-word',lineName(product.lineId)),element('small','','COLLECTIBLE CARDS'));
    const stack=element('div','dc-pack-preview');const pool=product.slots?.flatMap(s=>s.pool)??[];for(const entry of [...pool.slice(0,2),pool[0]].filter(Boolean)){const variant=model.catalog.variants.find(v=>v.id===entry.variantId),definition=model.catalog.cards.find(c=>c.id===variant?.cardId);if(!definition)continue;const card=renderer({id:'preview',definition,variant,rarityId:variant.rarityId,serialNumber:null,bindings:{}},{interactive:false});card.tabIndex=-1;stack.append(card);}art.append(stack);return art;
  }
  function shop() {
    const node=section('Find your next discovery','Choose a pack, check its contents and price, then open it in My packs.');
    const guide=element('div','dc-steps');
    for(const [n,title,description]of [['01','Buy a pack','Spend your account’s currency'],['02','Reveal your cards','Open the pack in My packs'],['03','Make it yours','Inspect cards and build an album']]){const step=element('div');step.append(element('span','dc-step-number',n),element('strong','',title),element('small','dc-muted',description));guide.append(step);}node.append(guide);
    const grid=element('div','dc-shop-grid');
    for(const product of model.catalog.products.filter(p=>p.enabled!==false)) {
      const box=element('article','dc-product');box.append(packArt(product));
      const info=element('div','dc-product-info'),count=product.slots.reduce((n,s)=>n+s.count,0);
    info.append(element('span','dc-eyebrow',lineName(product.lineId)),element('h3','',product.name.replace(/^.*? · /,'')),element('p','dc-muted',count+' card'+(count===1?'':'s')+' per pack'+(product.duplicatePolicy.scope!=='none'?' · Duplicate protection':'')));
    if(product.pity){const progress=model.pity[product.id]??0;info.append(element('p','dc-pity-note',(model.catalog.rarities.find(r=>r.id===product.pity.rarityId)?.name??product.pity.rarityId)+' or better by purchase '+product.pity.after+' since your last qualifying pack · '+progress+'/'+product.pity.after+' misses. Sealed packs count.'));}
    if(product.availableFrom||product.availableUntil)info.append(element('small','dc-muted',(product.availableFrom?'From '+new Date(product.availableFrom).toLocaleString():'')+(product.availableUntil?' · Until '+new Date(product.availableUntil).toLocaleString():'')));
      const details=element('details','dc-rates');details.append(element('summary','','See cards & drop rates'));
      for(const slot of product.slots) {
        const total=slot.pool.reduce((n,e)=>n+e.weight,0);details.append(element('p','dc-muted',slot.count+' draw'+(slot.count===1?'':'s')+' from this pool:'));
        for(const entry of slot.pool){const variant=model.catalog.variants.find(v=>v.id===entry.variantId),card=model.catalog.cards.find(c=>c.id===variant.cardId),row=element('div','dc-rate-row'),remaining=model.availability?.variants.find(v=>v.id===variant.id)?.remaining;row.append(element('span','',card.name+' · '+variant.rarityId+(remaining!==undefined&&remaining!==null?' · '+remaining+' remaining':'')),element('strong','',(entry.weight/total*100).toFixed(1)+'%'));details.append(row);}
      }
      details.append(element('p','dc-muted','Base rates. Remaining editions and duplicate protection affect eligible cards.'));info.append(details);
      const purchase=element('div','dc-purchase-row'),quantity=field(purchase,'Packs','number','1');quantity.min='1';quantity.max=String(product.maxQuantity);quantity.step='1';
      const pendingPurchase=mutate.pending('purchase'),recover=pendingPurchase&&!pendingPurchase._confirmed&&pendingPurchase.productId===product.id;
      if(recover){quantity.value=String(pendingPurchase.quantity);quantity.disabled=true;}
      const buy=button('',()=>action(async()=>{
        const quote=recover?pendingPurchase:await client.quote({productId:product.id,quantity:Number(quantity.value)});
        if(!recover&&(quote.price.currencyId!==product.price.currencyId||quote.price.amount!==product.price.amount*Number(quantity.value))){await refresh();throw new Error('The pack price changed. Review the updated price before buying.');}
        const original=mutate.pending('purchase');const receipt=await (!recover&&original?._confirmed?mutate.beginNew('purchase',quote):mutate('purchase',quote));active='packs';return receipt;
      },{message:r=>'Purchased '+r.packs.length+' pack'+(r.packs.length===1?'':'s')+'. Choose Open pack to reveal your cards.'}));
      function update(){
        const total=recover?pendingPurchase.price.amount:product.price.amount*Number(quantity.value),currency=recover?pendingPurchase.price.currencyId:product.price.currencyId,available=model.availability?.products.find(p=>p.id===product.id)?.available!==false;
        buy.textContent=recover?'Retry original purchase · '+num(total)+' '+currencyName(currency):available?'Buy · '+num(total)+' '+currencyName(currency):'Currently unavailable';
        buy.disabled=!recover&&(!available||!!pendingPurchase&&!pendingPurchase._confirmed||!Number.isInteger(Number(quantity.value))||Number(quantity.value)<1||Number(quantity.value)>product.maxQuantity||total>(model.wallet[currency]??0));
      }
      quantity.addEventListener('input',update);update();purchase.append(buy);info.append(purchase);box.append(info);grid.append(box);
    }node.append(grid);return node;
  }
  function packs() {
    const node=section('Your packs','Sealed packs are ready to open. Opened packs can be replayed without spending currency or receiving extra cards.');
    const sealed=model.packs.filter(p=>!p.openedAt),opened=model.packs.filter(p=>p.openedAt);
    const list=element('div','dc-pack-list');
    for(const pack of [...sealed,...opened.slice().reverse()]) {
      const box=element('article','dc-owned-pack');box.append(packArt(pack.product,true));
      const info=element('div');info.append(element('span','dc-badge'+(pack.openedAt?'':' is-sealed'),pack.openedAt?'Opened':'Sealed'),element('h3','',pack.product.name),element('small','dc-muted',new Date(pack.createdAt).toLocaleString()));
      box.append(info,button(pack.openedAt?'Replay pack':'Open pack',()=>action(async()=>{await controller.load(pack.id);const state=controller.getState();if(state.error)throw new Error(state.error.message);},{message:pack.openedAt?'Replaying saved cards. No additional charge.':'Pack opened. Reveal the cards below.'})));list.append(box);
    }
    if(!model.packs.length)empty(node,'No packs yet','Buy your first pack to start collecting.','Browse packs','shop');
    node.append(list);const opener=element('div');node.append(opener);openerDispose=mountOpener(opener,{controller,cardRenderer:renderer,view:openerView,onSelect:inspect});return node;
  }
  const viewState={};
  const context=()=>({client,inspect,inspectTogether,refresh,mutate,action,navigate,cardRenderer:renderer,albumRenderer,codeRevealRenderer,listingRenderer,layouts,state:viewState});
  const views={wallet,shop,packs,marketplace:()=>renderMarketplace(model,context()),rewards:()=>renderFulfillments(model,context()),tradingControls:()=>renderTradingControls(model,context()),codes:()=>renderCodeHistory(model,context()),collection:()=>renderCollection(model,context()),albums:()=>renderAlbums(model,context()),trades:()=>renderTrading(model,context()),...Object.fromEntries(Object.entries(customViews).map(([id,view])=>[id,()=>view(model,context())]))};
  if(!customViews.admin)views.admin=()=>renderAdminPanel(model,context());
  const labels={wallet:'Wallet',shop:'Discover',packs:'My packs',collection:'Collection',tradingControls:'Trading controls',admin:'Administration',marketplace:'Marketplace',rewards:'Account rewards',codes:'Code history',albums:'Albums',trades:'Trade lounge',...viewLabels};
  function renderView() {
    if(!model||disposed)return;viewLeave=null;openerDispose?.();openerDispose=null;viewDisposers.forEach(fn=>fn());viewDisposers=[];content.replaceChildren();nav.replaceChildren();dashboard.replaceChildren();
    root.classList.toggle('dc-with-nav',navigation==='tabs');
    if(navigation==='tabs'){
      const heading=element('div','dc-dashboard-heading');heading.append(element('span','dc-eyebrow','YOUR ACCOUNT'),element('strong','',model.me.displayName??userName(model.me.userId)));dashboard.append(heading);
      if(effectiveSections.includes('wallet')){const balances=element('div','dc-wallet-strip');for(const c of model.catalog.currencies){const balance=element('div');balance.append(element('strong','',num(model.wallet[c.id]??0)),element('span','dc-muted',c.name));balances.append(balance);}dashboard.append(balances);}
      const stats=element('div','dc-account-stats');stats.append(element('span','',model.inventory.length+' cards'));if(effectiveSections.includes('packs'))stats.append(element('span','',model.packs.filter(p=>!p.openedAt).length+' sealed packs'));dashboard.append(stats);
      for(const name of effectiveSections){if(typeof name!=='string'||!views[name])continue;const item=button(labels[name]??name,()=>navigate(name));item.className='dc-nav-item';item.dataset.view=name;item.setAttribute('aria-current',active===name?'page':'false');if(name==='packs'){const count=model.packs.filter(p=>!p.openedAt).length;if(count)item.append(element('span','dc-nav-count',count));}nav.append(item);}
    }
    if(model.recoverable?.length){
      const recovery=element('section','dc-panel');recovery.setAttribute('aria-label','Unconfirmed changes');recovery.append(element('h2','','Unconfirmed changes'),element('p','','Recover these previously reviewed changes before starting another. Recovery uses the original request.'));
      const names={purchase:'pack purchase',openPack:'pack opening',buyListing:'marketplace purchase',configureAdmin:'settings change',administerCards:'card administration',convert:'currency conversion',tradeUp:'trade-up',saveAlbum:'album change',proposeTrade:'trade offer',acceptTrade:'trade acceptance',cancelTrade:'trade cancellation',counterTrade:'counteroffer',preferences:'preferences',readNotifications:'notification update',commitImport:'catalog import',reportCodeUsage:'code usage report',createShop:'shop creation',createListing:'listing creation',cancelListing:'listing cancellation',enterRaffle:'raffle entry',openCard:'card opening',consumeBinding:'attached action'};
      for(const intent of model.recoverable){const label=names[intent.command]??'saved change',row=element('div');row.append(element('strong','',label));if(intent.input.productId)row.append(element('p','',String(intent.input.quantity??1)+' × '+(model.catalog.products.find(product=>product.id===intent.input.productId)?.name??intent.input.productId)));row.append(button('Recover '+label,()=>action(()=>mutate.resume(intent),{message:'Original result recovered.'})));recovery.append(row);}content.append(recovery);
    }
    for(const name of (navigation==='tabs'?[active]:effectiveSections)){const view=typeof name==='function'?()=>name(model,{client,inspect,inspectTogether,refresh,mutate,action,navigate,cardRenderer:renderer}):views[name];if(view){const result=view();content.append(result.node??result);if(result.dispose)viewDisposers.push(result.dispose);if(result.requestLeave)viewLeave=result.requestLeave;}}
  }
  async function refresh() {
    if(disposed)return;
    const generation=++refreshGeneration;
    const [catalog,me,capabilities]=await Promise.all([client.catalog(),client.me(),client.capabilities?.()??null]);
    if(disposed||generation!==refreshGeneration)return;
    const enabled=name=>!capabilities||capabilities.available[name]||capabilities.draining.includes(name);
    const commerce=enabled('directSales')||enabled('resale')||enabled('packs'),packsEnabled=enabled('packs'),trading=enabled('trading');
    const sectionEnabled={shop:!capabilities||capabilities.available.packs,packs:packsEnabled,marketplace:commerce,rewards:commerce||capabilities?.history?.rewards,codes:commerce||packsEnabled||capabilities?.history?.codes,trades:trading,tradingControls:trading,wallet:commerce||packsEnabled||trading,albums:!capabilities||catalog.features.publicAlbums};
    effectiveSections=sections.filter(name=>sectionEnabled[name]!==false);
    if(!effectiveSections.includes(active))active=effectiveSections.includes('collection')?'collection':effectiveSections[0];
    const [walletData,packData,inventory,albumData,tradeData,availability,pity]=await Promise.all([
      sectionEnabled.wallet?client.wallet():{},packsEnabled?client.packs():[],client.inventory(),sectionEnabled.albums?client.albums():[],trading?client.trades():[],
      packsEnabled?(client.availability?.()??null):null,packsEnabled?(client.pity?.()??{}):{}]);
    if(disposed||generation!==refreshGeneration)return;
    if(commandPrincipal!==me.userId){mutate?.dispose();commandPrincipal=me.userId;mutate=createCommandRunner({client,namespace:me.userId});}
    const recovery=await mutate.recoverable();if(disposed||generation!==refreshGeneration)return;
    const recoverable=recovery.items.filter(intent=>!(mutate.pending(intent.command)?._confirmed&&mutate.pending(intent.command)?.key===intent.input.key));
    model={catalog,me,capabilities,wallet:walletData,packs:packData,inventory,albums:albumData,trades:tradeData,availability,pity,recoverable};renderView();
  }
  const ready=refresh().catch(error=>{if(disposed)return;status.className='dc-status dc-error';status.textContent=error.message;throw error;});
  return {ready,refresh,inspect,inspectTogether,dispose(){disposed=true;mutate?.dispose();openerDispose?.();viewDisposers.forEach(fn=>fn());controller.dispose();inspector.close();removeStyles();root.replaceChildren();}};
}
