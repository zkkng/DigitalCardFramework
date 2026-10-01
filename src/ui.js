import {createRevealController,createCommandRunner} from './client.js';
import {defaultCSS} from './styles.js';
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
const themes=['--dc-bg','--dc-panel','--dc-text','--dc-muted','--dc-accent','--dc-border','--dc-radius','--dc-card-ratio','--dc-font'];
export function installStyles(root,{theme={},css=''}={}) {
  root.classList.add('dc-root');
  for(const [name,value] of Object.entries(theme)) if(themes.includes(name)) root.style.setProperty(name,String(value));
  const style=element('style'); style.textContent=defaultCSS+'\n'+css; root.prepend(style);
  return ()=>{style.remove();root.classList.remove('dc-root');for(const name of Object.keys(theme)) if(themes.includes(name)) root.style.removeProperty(name);};
}
export function renderCard(copy,{onSelect,interactive=true,backRenderer,effects=true}={}) {
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
  if(backRenderer) back.append(backRenderer(copy));
  else if(cardBack && assetURL(cardBack)) {const image=element('img','dc-layer');image.src=assetURL(cardBack);image.alt='Card back';back.append(image);}
  else back.append(element('span','dc-back-mark','◇'));
  inner.append(front,back);node.append(inner);
  if(interactive) {
    node.addEventListener('pointermove',e=>{const r=node.getBoundingClientRect();node.style.setProperty('--dc-x',String((e.clientX-r.left)/r.width*2-1));node.style.setProperty('--dc-y',String((e.clientY-r.top)/r.height*2-1));});
    node.addEventListener('pointerleave',()=>{node.style.setProperty('--dc-x','0');node.style.setProperty('--dc-y','0');});
  }
  node.addEventListener('click',()=>onSelect?.(copy));
  return node;
}
export function renderInspector(copy,{cardRenderer=renderCard,metadataRenderer,backRenderer,onClose,labels={}}={}) {
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
  const custom=layouts[model.layout?.id];
  if(custom) return custom(model,{cardRenderer,onSelect});
  const node=element('div','dc-album');
  const columns=Number(model.layout?.columns??3);if(Number.isInteger(columns)&&columns>=1&&columns<=12)node.style.setProperty('--dc-album-columns',String(columns));
  const gap=Number(model.layout?.gap??18);if(Number.isFinite(gap)&&gap>=0&&gap<=100)node.style.setProperty('--dc-album-gap',gap+'px');
  for(const {copy} of model.cards)node.append(cardRenderer(copy,{onSelect}));
  return node;
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
export function mountFramework(root,{client,theme={},css='',cardRenderer=renderCard,albumRenderer=renderAlbum,
  backRenderer,metadataRenderer,openerView,layouts={},participants=[],navigation='sections',
  sections=['wallet','shop','packs','collection','albums','trades']}={}) {
  const removeStyles=installStyles(root,{theme,css});
  const dashboard=element('div','dc-dashboard'),nav=element('nav','dc-nav'),content=element('div','dc-content');
  const status=element('div','dc-status'),inspector=element('dialog','dc-inspector-dialog');
  status.setAttribute('role','status');nav.setAttribute('aria-label','Framework features');inspector.setAttribute('aria-label','Card details');
  root.append(dashboard,nav,status,content,inspector);
  let disposed=false,model=null,openerDispose=null,refreshGeneration=0,mutate=null,busy=false;
  let active=sections.includes('shop')?'shop':sections[0],selectedAlbum=null;
  const renderer=(copy,options={})=>cardRenderer(copy,{backRenderer,...options});
  const currencyName=id=>model.catalog.currencies.find(c=>c.id===id)?.name??id;
  const lineName=id=>model.catalog.lines.find(l=>l.id===id)?.name??id;
  const userName=id=>participants.find(u=>u.id===id)?.name??(id===model.me.userId?'You':id);
  const num=n=>Number(n).toLocaleString();
  const closeInspector=()=>inspector.close();
  function inspect(copy) {
    inspector.replaceChildren(renderInspector(copy,{cardRenderer:renderer,metadataRenderer,backRenderer,onClose:closeInspector,
      labels:{line:lineName(copy.lineId),rarity:model.catalog.rarities.find(r=>r.id===copy.rarityId)?.name}}));
    if(!inspector.open)inspector.showModal();
  }
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
    for(const item of items){const option=element('option','',item.name);option.value=item.id;select.append(option);}parent.append(wrap);return select;
  }
  function section(title,description) {const node=element('section','dc-section');node.append(element('h2','',title));if(description)node.append(element('p','dc-section-intro',description));return node;}
  function empty(node,title,description,cta,go) {const box=element('div','dc-empty');box.append(element('span','dc-empty-symbol','◇'),element('h3','',title),element('p','dc-muted',description));if(cta)box.append(button(cta,()=>navigate(go)));node.append(box);}
  function navigate(name) {active=name;status.textContent='';renderView();}
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
    art.setAttribute('aria-hidden','true');art.append(element('span','dc-pack-orbit'),element('span','dc-pack-symbol',product.lineId==='garden'?'✳':'✦'),element('span','dc-pack-word',lineName(product.lineId)),element('small','','COLLECTIBLE CARDS'));return art;
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
      const details=element('details','dc-rates');details.append(element('summary','','See cards & drop rates'));
      for(const slot of product.slots) {
        const total=slot.pool.reduce((n,e)=>n+e.weight,0);details.append(element('p','dc-muted',slot.count+' draw'+(slot.count===1?'':'s')+' from this pool:'));
        for(const entry of slot.pool){const variant=model.catalog.variants.find(v=>v.id===entry.variantId),card=model.catalog.cards.find(c=>c.id===variant.cardId),row=element('div','dc-rate-row');row.append(element('span','',card.name+' · '+variant.rarityId),element('strong','',(entry.weight/total*100).toFixed(1)+'%'));details.append(row);}
      }
      details.append(element('p','dc-muted','Base rates. Remaining editions and duplicate protection affect eligible cards.'));info.append(details);
      const purchase=element('div','dc-purchase-row'),quantity=field(purchase,'Packs','number','1');quantity.min='1';quantity.max=String(product.maxQuantity);quantity.step='1';
      const buy=button('',()=>action(async()=>{const quote=await client.quote({productId:product.id,quantity:Number(quantity.value)});const receipt=await mutate('purchase',quote);active='packs';return receipt;},{message:r=>'Purchased '+r.packs.length+' pack'+(r.packs.length===1?'':'s')+'. Choose Open pack to reveal your cards.'}));
      function update(){const total=product.price.amount*Number(quantity.value);buy.textContent='Buy · '+num(total)+' '+currencyName(product.price.currencyId);buy.disabled=!Number.isInteger(Number(quantity.value))||Number(quantity.value)<1||Number(quantity.value)>product.maxQuantity||total>(model.wallet[product.price.currencyId]??0);}
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
  function collection() {
    const node=section('Your collection',model.inventory.length+' owned cards. Select any card to inspect its front, back, edition and opening details.');
    const filters=element('div','dc-form-row');const line=selectField(filters,'Card line',[{id:'',name:'All lines'},...model.catalog.lines]);const rarity=selectField(filters,'Rarity',[{id:'',name:'All rarities'},...model.catalog.rarities]);node.append(filters);
    const grid=element('div','dc-grid');function draw(){grid.replaceChildren();for(const copy of model.inventory.filter(c=>(!line.value||c.lineId===line.value)&&(!rarity.value||c.rarityId===rarity.value))){const cell=element('div','dc-collection-cell');cell.append(renderer(copy,{onSelect:inspect}),element('small','dc-muted',copy.lockedBy?'Reserved in a trade':copy.variant.finish??'standard'));grid.append(cell);}if(!grid.children.length)empty(grid,'No matching cards','Try another filter or open a pack.');}line.addEventListener('change',draw);rarity.addEventListener('change',draw);draw();node.append(grid);
    if(model.catalog.features.tradeUps && model.catalog.recipes.some(r=>r.enabled!==false)) {
      const form=element('details','dc-form-panel');form.append(element('summary','','Trade up duplicates'));
      const recipe=selectField(form,'Recipe',model.catalog.recipes.filter(r=>r.enabled!==false));
      const help=element('p','dc-muted'),choices=element('div','dc-copy-choices'),progress=element('p','dc-muted');let selected=new Set();
      const submit=button('Trade up selected cards',()=>action(()=>mutate('tradeUp',{recipeId:recipe.value,copyIds:[...selected]}),{message:copy=>'Trade-up complete. Added '+copy.definition.name+' to your collection.'}));
      function update(){const r=model.catalog.recipes.find(r=>r.id===recipe.value),copies=model.inventory.filter(c=>selected.has(c.id));progress.textContent=selected.size+' / '+r.inputCount+' selected';submit.disabled=selected.size!==r.inputCount||(r.duplicatesOnly&&new Set(copies.map(c=>c.variantId)).size!==1);}
      function drawChoices(){selected=new Set();choices.replaceChildren();const r=model.catalog.recipes.find(r=>r.id===recipe.value);help.textContent='Consume '+r.inputCount+' '+r.inputRarityId+' '+lineName(r.lineId)+' cards'+(r.duplicatesOnly?' of the same variant':'')+' to receive a higher rarity card. Selected copies are permanently used.';for(const c of model.inventory.filter(c=>c.lineId===r.lineId&&c.rarityId===r.inputRarityId&&!c.lockedBy&&!Object.keys(c.bindings).length)){const label=element('label','dc-copy-choice'),input=element('input');input.type='checkbox';input.setAttribute('aria-label','Trade up '+c.definition.name+' '+c.id.slice(0,8));input.addEventListener('change',()=>{if(input.checked)selected.add(c.id);else selected.delete(c.id);update();});label.append(input,element('span','',c.definition.name),element('small','dc-muted',c.id.slice(0,8)));choices.append(label);}if(!choices.children.length)choices.append(element('p','dc-muted','No eligible copies yet. Open more packs from this line.'));update();}
      recipe.addEventListener('change',drawChoices);drawChoices();form.append(help,choices,progress,submit);node.append(form);
    }return node;
  }
  function albums() {
    const node=section('Your albums','Arrange your collection into a display. Private albums are visible only to you; public albums can be viewed by other players.');
    const form=element('details','dc-form-panel');form.open=!model.albums.length;form.append(element('summary','','Create an album'));
    const row=element('div','dc-form-row'),name=field(row,'Album name','text','My collection'),visibility=selectField(row,'Visibility',(model.catalog.features.publicAlbums?['private','public']:['private']).map(v=>({id:v,name:v==='private'?'Private · only you':'Public · all players'})));
    const create=button('Create from my collection',()=>action(async()=>{const album=await mutate('saveAlbum',{name:name.value,visibility:visibility.value,layout:{columns:3},placements:model.inventory.map((copy,index)=>({copyId:copy.id,position:index}))});selectedAlbum=album.id;return album;},{message:'Album created from your current collection.'}));form.append(row,element('p','dc-muted',model.inventory.length+' cards will be included. You can sync the album after collecting more.'),create);node.append(form);
    const list=element('div','dc-album-list'),target=element('div','dc-album-display');
    async function display(id){const full=await client.viewAlbum(id);if(disposed||!target.isConnected)return;target.replaceChildren(element('h3','',full.name),albumRenderer(full,{cardRenderer:renderer,onSelect:inspect,layouts}));}
    for(const album of model.albums){const box=element('article','dc-album-tile');box.append(element('span','dc-album-icon','▦'),element('h3','',album.name),element('small','dc-muted',album.visibility+' · '+album.placements.length+' cards'));const controls=element('div','dc-row');controls.append(button('View album',()=>action(async()=>{selectedAlbum=album.id;await display(album.id);},{refreshAfter:false,message:'Viewing '+album.name+'.'})),button('Sync collection',()=>action(()=>mutate('saveAlbum',{albumId:album.id,expectedVersion:album.version,name:album.name,visibility:album.visibility,layout:album.layout,placements:model.inventory.map((copy,index)=>({copyId:copy.id,position:index}))}),{message:'Album updated with your current collection.'})));box.append(controls);list.append(box);}node.append(list,target);
    if(!model.albums.length)empty(node,'Your collection deserves a home','Create an album above to display your cards.');
    if(selectedAlbum)queueMicrotask(()=>display(selectedAlbum).catch(error=>{if(!disposed)status.textContent=error.message;}));
    if(model.catalog.features.publicAlbums){const publicBox=element('details','dc-form-panel');publicBox.append(element('summary','','Explore public albums'));publicBox.append(button('Load public albums',()=>action(async()=>{const publicAlbums=await client.publicAlbums();publicBox.querySelector('.dc-public-list')?.remove();const list=element('div','dc-public-list');for(const album of publicAlbums)list.append(button(album.name+' · '+album.ownerName+' · '+album.cardCount+' cards',()=>action(async()=>{selectedAlbum=album.id;await display(album.id);},{refreshAfter:false,message:'Viewing public album.'})));if(!publicAlbums.length)list.append(element('p','dc-muted','No public albums yet. Create one above.'));publicBox.append(list);},{refreshAfter:false,message:'Public albums loaded.'})));node.append(publicBox);}return node;
  }
  function trades() {
    const node=section('Trade with another player','Offer cards or currency. Your offered assets are reserved until the recipient accepts or either player cancels. Switch demo accounts to test the other side.');
    const enabled=model.catalog.features.cardTrading||model.catalog.features.currencyTrading;
    if(enabled){const form=element('details','dc-form-panel');form.open=true;form.append(element('summary','','Create a trade offer'));
      const others=participants.filter(u=>u.id!==model.me.userId);
      const target=others.length?selectField(form,'Trade with',others):field(form,'Recipient user ID');
      const columns=element('div','dc-trade-columns'),giveBox=element('div'),receiveBox=element('div');giveBox.append(element('h3','','You offer'));receiveBox.append(element('h3','','You request'));const selected=new Set();
      if(model.catalog.features.cardTrading){for(const copy of model.inventory.filter(c=>!c.lockedBy)){const label=element('label','dc-copy-choice'),input=element('input');input.type='checkbox';input.addEventListener('change',()=>{if(input.checked)selected.add(copy.id);else selected.delete(copy.id);});label.append(input,element('span','',copy.definition.name),element('small','dc-muted',copy.rarityId+' · '+copy.id.slice(0,8)));giveBox.append(label);}if(!model.inventory.length)giveBox.append(element('p','dc-muted','Open packs to get cards to offer.'));}
      const receive=model.catalog.features.cardTrading?field(receiveBox,'Requested card copy IDs (optional)'):null;
      if(receive)receiveBox.append(element('p','dc-muted','Copy IDs are available in the card inspector. Leave blank for a gift or currency-only trade.'));
      let giveCurrency,receiveCurrency,giveAmount,receiveAmount;
      if(model.catalog.features.currencyTrading){const money=[{id:'',name:'No currency'},...model.catalog.currencies.filter(c=>c.tradable)];giveCurrency=selectField(giveBox,'Currency to offer',money);giveAmount=field(giveBox,'Amount to offer','number','0');receiveCurrency=selectField(receiveBox,'Currency to request',money);receiveAmount=field(receiveBox,'Amount to request','number','0');giveAmount.min=receiveAmount.min='0';}
      const money=(currency,amount)=>currency?.value&&Number(amount.value)>0?[{currencyId:currency.value,amount:Number(amount.value)}]:[];
      columns.append(giveBox,receiveBox);form.append(columns,button('Send trade offer',()=>action(()=>mutate('proposeTrade',{toUserId:target.value.trim(),give:{copyIds:[...selected],currencies:money(giveCurrency,giveAmount)},receive:{copyIds:receive?receive.value.split(',').map(x=>x.trim()).filter(Boolean):[],currencies:money(receiveCurrency,receiveAmount)}}),{message:'Trade offered. Switch to the recipient account to accept it.'})));node.append(form);
    }else node.append(element('p','dc-muted','Trading is disabled by this host. Pending offers can still be cancelled.'));
    const describe=side=>[side.copyIds.length+' card'+(side.copyIds.length===1?'':'s'),...side.currencies.map(c=>num(c.amount)+' '+currencyName(c.currencyId))].join(' + ');
    if(!model.trades.length)empty(node,'No trades yet','Create an offer above to test exchanges between accounts.');
    for(const trade of model.trades.slice().reverse()){const box=element('article','dc-trade');box.append(element('span','dc-badge',trade.status),element('h3','',userName(trade.fromUserId)+' → '+userName(trade.toUserId)),element('p','','Offer: '+describe(trade.give)),element('p','dc-muted','Request: '+describe(trade.receive)));if(trade.status==='pending'){const row=element('div','dc-row');if(enabled&&trade.toUserId===model.me.userId)row.append(button('Accept trade',()=>action(()=>mutate('acceptTrade',{tradeId:trade.id}),{message:'Trade accepted. Ownership and balances updated.'})));row.append(button(trade.fromUserId===model.me.userId?'Cancel offer':'Decline offer',()=>action(()=>mutate('cancelTrade',{tradeId:trade.id}),{message:'Offer cancelled. Reserved assets returned.'})));box.append(row);}node.append(box);}return node;
  }
  const views={wallet,shop,packs,collection,albums,trades};
  const labels={wallet:'Wallet',shop:'Pack shop',packs:'My packs',collection:'Collection',albums:'Albums',trades:'Trading'};
  function renderView() {
    if(!model||disposed)return;openerDispose?.();openerDispose=null;content.replaceChildren();nav.replaceChildren();dashboard.replaceChildren();
    root.classList.toggle('dc-with-nav',navigation==='tabs');
    if(navigation==='tabs'){
      const heading=element('div','dc-dashboard-heading');heading.append(element('span','dc-eyebrow','YOUR ACCOUNT'),element('strong','',model.me.displayName??userName(model.me.userId)));dashboard.append(heading);
      const balances=element('div','dc-wallet-strip');for(const c of model.catalog.currencies){const balance=element('div');balance.append(element('strong','',num(model.wallet[c.id]??0)),element('span','dc-muted',c.name));balances.append(balance);}dashboard.append(balances);
      const stats=element('div','dc-account-stats');stats.append(element('span','',model.inventory.length+' cards'),element('span','',model.packs.filter(p=>!p.openedAt).length+' sealed packs'));dashboard.append(stats);
      for(const name of sections){if(typeof name!=='string'||!views[name])continue;const item=button(labels[name]??name,()=>navigate(name));item.className='dc-nav-item';item.setAttribute('aria-current',active===name?'page':'false');if(name==='packs'){const count=model.packs.filter(p=>!p.openedAt).length;if(count)item.append(element('span','dc-nav-count',count));}nav.append(item);}
    }
    for(const name of (navigation==='tabs'?[active]:sections)){const view=typeof name==='function'?()=>name(model,{client,inspect,refresh}):views[name];if(view)content.append(view());}
  }
  async function refresh() {
    const generation=++refreshGeneration;
    const [catalog,me,walletData,packData,inventory,albumData,tradeData]=await Promise.all([client.catalog(),client.me(),client.wallet(),client.packs(),client.inventory(),client.albums(),client.trades()]);
    if(disposed||generation!==refreshGeneration)return;
    mutate??=createCommandRunner({client,storage:globalThis.sessionStorage,namespace:me.userId});
    model={catalog,me,wallet:walletData,packs:packData,inventory,albums:albumData,trades:tradeData};renderView();
  }
  const ready=refresh().catch(error=>{status.className='dc-status dc-error';status.textContent=error.message;throw error;});
  return {ready,refresh,inspect,dispose(){disposed=true;openerDispose?.();controller.dispose();inspector.close();removeStyles();root.replaceChildren();}};
}
