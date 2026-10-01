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
  if(!copy.definition.layers?.length) front.append(element('span','dc-art-label',copy.definition.name));
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
export function renderInspector(copy,{cardRenderer=renderCard,metadataRenderer,backRenderer,onClose}={}) {
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
    const fields={Line:copy.lineId,Rarity:copy.rarityId,Finish:copy.variant.finish??'standard',
      Edition:copy.serialNumber?copy.serialNumber+' of '+copy.editionTotal:'Open edition',
      'Opened by':copy.openedByName??copy.openedBy??'Not opened','Opened at':copy.openedAt??'Not opened','Copy ID':copy.id};
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
    node.append(element('h3','',state.phase==='complete'?'Pack revealed':'Open your pack'));
    if(state.phase==='loading')node.append(element('p','','Loading committed cards…'));
    if(state.error)node.append(element('p','dc-error',state.error.message));
    if(state.receipt) {
      const row=element('div','dc-row');
      row.append(button('Reveal next',()=>controller.reveal()),button('Reveal all',()=>controller.skip()),button('Replay',()=>controller.replay()));node.append(row);
      const cards=element('div','dc-grid');
      for(const copy of state.receipt.cards.slice(0,state.revealed))cards.append(cardRenderer(copy,{onSelect}));
      node.append(cards);
    }
    root.append(node);
  });
  return ()=>{unsubscribe();cleanup?.();root.replaceChildren();};
}
export function mountFramework(root,{client,theme={},css='',cardRenderer=renderCard,albumRenderer=renderAlbum,
  backRenderer,metadataRenderer,openerView,layouts={},sections=['wallet','shop','packs','collection','albums','trades']}={}) {
  const removeStyles=installStyles(root,{theme,css});
  const content=element('div'),status=element('div','dc-status'),inspector=element('div');status.setAttribute('role','status');
  root.append(status,inspector,content);
  let disposed=false, model=null, openerDispose=null, refreshGeneration=0, mutate=null;
  const renderer=(copy,options={})=>cardRenderer(copy,{backRenderer,...options});
  function inspect(copy) {inspector.replaceChildren(renderInspector(copy,{cardRenderer:renderer,metadataRenderer,backRenderer,onClose:()=>inspector.replaceChildren()}));inspector.scrollIntoView({behavior:'auto',block:'nearest'});}
  const controller=createRevealController({open:input=>mutate('openPack',{packId:input.packId}),key:client.requestKey});
  async function action(fn,{refreshAfter=true}={}) {
    status.className='dc-status';status.textContent='Working…';
    try {const value=await fn();if(!disposed){status.textContent='Saved.';if(refreshAfter)await refresh();}return value;}
    catch(error) {if(!disposed){status.className='dc-status dc-error';status.textContent=error.message;}return undefined;}
  }
  function field(parent,label,type='text',value='') {const wrap=element('label','',label),input=element('input');input.type=type;input.value=value;wrap.append(input);parent.append(wrap);return input;}
  function section(title) {const node=element('section','dc-section');node.append(element('h2','',title));return node;}
  function wallet() {
    const node=section('Wallet'),row=element('div','dc-row');
    for(const c of model.catalog.currencies)row.append(element('p','',c.name+': '+(model.wallet[c.id]??0)));
    node.append(row);
    if(model.catalog.features.conversion) {
      const form=element('div','dc-row'),from=element('select'),to=element('select');
      for(const c of model.catalog.currencies)for(const select of[from,to]){const option=element('option','',c.name);option.value=c.id;select.append(option);}
      from.setAttribute('aria-label','Currency to spend');to.setAttribute('aria-label','Currency to receive');
      if(to.options.length>1)to.selectedIndex=1;
      const amount=field(form,'Amount','number','100');amount.min='1';amount.step='1';
      form.append(from,to,button('Convert exactly',()=>action(()=>mutate('convert',{from:from.value,to:to.value,amount:Number(amount.value),catalogVersion:model.catalog.version}))));
      node.append(form,element('p','dc-muted','Conversions use the published values. Exact conversion protects fractional units.'));
    }
    return node;
  }
  function shop() {
    const node=section('Pack shop'),grid=element('div','dc-grid');
    for(const product of model.catalog.products.filter(p=>p.enabled!==false)) {
      const box=element('article');const line=model.catalog.lines.find(l=>l.id===product.lineId),currency=model.catalog.currencies.find(c=>c.id===product.price.currencyId);
      box.append(element('h3','',product.name),element('p','dc-muted',line.name+' · '+product.price.amount+' '+currency.name));
      const details=element('details'),summary=element('summary','','Pack rates');details.append(summary);
      for(const slot of product.slots) {
        const total=slot.pool.reduce((n,e)=>n+e.weight,0);
        details.append(element('p','',slot.count+' card(s): '+slot.pool.map(e=>{
          const v=model.catalog.variants.find(v=>v.id===e.variantId),c=model.catalog.cards.find(c=>c.id===v.cardId);
          return c.name+' ['+v.rarityId+'] '+(e.weight/total*100).toFixed(2)+'%';
        }).join(' · ')));
      }
      details.append(element('p','dc-muted','Base rates; finite availability and duplicate protection can change eligible outcomes.'));
      box.append(details);
      const quantity=field(box,'Quantity','number','1');quantity.min='1';quantity.max=String(product.maxQuantity);quantity.step='1';
      box.append(button('Buy pack',()=>action(async()=>{
        const quote=await client.quote({productId:product.id,quantity:Number(quantity.value)});
        return mutate('purchase',quote);
      })));grid.append(box);
    }
    node.append(grid);return node;
  }
  function packs() {
    const node=section('My packs'),row=element('div','dc-row'),opener=element('div');
    for(const pack of model.packs)row.append(button(pack.product.name+(pack.openedAt?' · Replay':' · Open'),async()=>{
      await controller.load(pack.id);if(!disposed)await refresh();
    }));
    if(!model.packs.length)row.append(element('p','dc-muted','Your purchased packs appear here.'));
    node.append(row,opener);openerDispose=mountOpener(opener,{controller,cardRenderer:renderer,view:openerView,onSelect:inspect});return node;
  }
  function collection() {
    const node=section('My collection'),grid=element('div','dc-grid');
    for(const copy of model.inventory)grid.append(renderer(copy,{onSelect:inspect}));
    if(!model.inventory.length)node.append(element('p','dc-muted','Open a pack to begin your collection.'));
    node.append(grid);
    if(model.catalog.features.tradeUps && model.catalog.recipes.length) {
      const form=element('div');form.append(element('h3','','Trade up duplicates'));
      const select=element('select');select.setAttribute('aria-label','Trade-up recipe');
      for(const recipe of model.catalog.recipes.filter(r=>r.enabled!==false)){const opt=element('option','',recipe.name+' · '+recipe.inputCount+' inputs');opt.value=recipe.id;select.append(opt);}
      const ids=field(form,'Input copy IDs, separated by commas');
      form.append(select,button('Trade up',()=>action(()=>mutate('tradeUp',{recipeId:select.value,copyIds:ids.value.split(',').map(x=>x.trim()).filter(Boolean)}))));
      node.append(form);
    }
    return node;
  }
  function albums() {
    const node=section('Albums');
    const name=field(node,'New album name','text','My collection');
    const visibility=element('select');visibility.setAttribute('aria-label','Album privacy');
    for(const value of(model.catalog.features.publicAlbums?['private','public']:['private'])){const opt=element('option','',value);opt.value=value;visibility.append(opt);}
    node.append(visibility,button('Create album from collection',()=>action(()=>mutate('saveAlbum',{name:name.value,visibility:visibility.value,layout:{columns:3},placements:model.inventory.map((copy,index)=>({copyId:copy.id,position:index}))}))));
    const target=element('div'),row=element('div','dc-row');
    for(const album of model.albums) {
      row.append(button(album.name+' · '+album.visibility,()=>action(async()=>{
        const full=await client.viewAlbum(album.id);target.replaceChildren(albumRenderer(full,{cardRenderer:renderer,onSelect:inspect,layouts}));return full;
      },{refreshAfter:false})));
      row.append(button('Update '+album.name,()=>action(()=>mutate('saveAlbum',{albumId:album.id,expectedVersion:album.version,name:album.name,visibility:album.visibility,layout:album.layout,placements:model.inventory.map((copy,index)=>({copyId:copy.id,position:index}))}))));
    }
    if(model.catalog.features.publicAlbums) {
      const publicId=field(node,'View another player’s public album ID');
      node.append(button('View public album',()=>action(async()=>{
        const full=await client.viewAlbum(publicId.value.trim());target.replaceChildren(albumRenderer(full,{cardRenderer:renderer,onSelect:inspect,layouts}));
      },{refreshAfter:false})));
    }
    node.append(row,target);return node;
  }
  function trades() {
    const node=section('Trading');
    if(!model.catalog.features.cardTrading&&!model.catalog.features.currencyTrading){
      node.append(element('p','dc-muted','Trading is disabled by this host.'));
      for(const trade of model.trades.filter(t=>t.status==='pending')){
        const box=element('div','dc-trade');
        box.append(element('p','',trade.status+' - '+trade.id),
          button('Cancel / decline',()=>action(()=>mutate('cancelTrade',{tradeId:trade.id}))));
        node.append(box);
      }
      return node;
    }
    const target=field(node,'Recipient user ID'),give=field(node,'Your card copy IDs, separated by commas'),receive=field(node,'Requested card copy IDs, separated by commas');
    let giveCurrency,receiveCurrency,giveAmount,receiveAmount;
    if(model.catalog.features.currencyTrading) {
      giveCurrency=field(node,'Currency you offer (ID)');giveAmount=field(node,'Amount you offer','number','0');
      receiveCurrency=field(node,'Currency you request (ID)');receiveAmount=field(node,'Amount you request','number','0');
    }
    const list=input=>input.value.split(',').map(x=>x.trim()).filter(Boolean);
    const money=(currency,amount)=>currency?.value.trim() && Number(amount.value)>0?[{currencyId:currency.value.trim(),amount:Number(amount.value)}]:[];
    node.append(button('Propose trade',()=>action(()=>mutate('proposeTrade',{toUserId:target.value.trim(),
      give:{copyIds:list(give),currencies:money(giveCurrency,giveAmount)},receive:{copyIds:list(receive),currencies:money(receiveCurrency,receiveAmount)}}))));
    for(const trade of model.trades) {
      const box=element('div','dc-trade');
      box.append(element('p','',trade.status+' · '+trade.id),element('p','dc-muted','Offer: '+trade.give.copyIds.length+' card(s), '+JSON.stringify(trade.give.currencies)+' / request: '+trade.receive.copyIds.length+' card(s), '+JSON.stringify(trade.receive.currencies)));
      if(trade.status==='pending') {
        if(trade.toUserId===model.me.userId)box.append(button('Accept',()=>action(()=>mutate('acceptTrade',{tradeId:trade.id}))));
        box.append(button('Cancel / decline',()=>action(()=>mutate('cancelTrade',{tradeId:trade.id}))));
      }
      node.append(box);
    }
    return node;
  }
  const views={wallet,shop,packs,collection,albums,trades};
  async function refresh() {
    const generation=++refreshGeneration;
    const [catalog,me,walletData,packData,inventory,albumData,tradeData]=await Promise.all([client.catalog(),client.me(),client.wallet(),client.packs(),client.inventory(),client.albums(),client.trades()]);
    if(disposed || generation!==refreshGeneration)return;
    mutate??=createCommandRunner({client,storage:globalThis.sessionStorage,namespace:me.userId});
    model={catalog,me,wallet:walletData,packs:packData,inventory,albums:albumData,trades:tradeData};
    openerDispose?.();content.replaceChildren();
    for(const name of sections){const view=typeof name==='function'?()=>name(model,{client,inspect,refresh}):views[name];if(view)content.append(view());}
  }
  const ready=refresh().catch(error=>{status.className='dc-status dc-error';status.textContent=error.message;throw error;});
  return {ready,refresh,inspect,dispose(){disposed=true;openerDispose?.();controller.dispose();removeStyles();root.replaceChildren();}};
}
