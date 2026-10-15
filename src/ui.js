import {renderShop} from './shop-ui.js';
import {createCardRenderer} from './presentation/card-view.js';
const portableRenderers=new Map();
import {createRevealController,createCommandRunner} from './client.js';
import {defaultCSS} from './styles.js';
import {createApplicationShell} from './application-shell.js';
import {localizeDiagnostic,createLocalization} from './localization.js';
import {albumAppearance,applyAlbumAppearance,albumArtwork,validateAlbumPageSize} from './album-appearance.js';
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
  if(typeof src!=='string'||!src)return null;
  try {const u=new URL(src,document.baseURI); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;} catch {return null;}
}
export function renderPack(product,{small=false,lineName=product.lineId,previewCards=[],side='front',locale='en',messages={},localization=createLocalization({locale,messages})}={}) {
  const t=localization.text;
  const node=element('div','dc-pack-art'+(small?' dc-pack-art-small':'')),fallback=element('div'),image=element('img'),toggle=button(t('artwork.back'),()=>setSide(side==='front'?'back':'front')),
    artwork=product.artwork??{},abort=new AbortController();
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);
  let disposed=false;
  Object.assign(fallback.style,{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',width:'100%',height:'100%',zIndex:'1'});
  node.dataset.line=product.lineId;
  const subtitle=element('small','',t('artwork.subtitle'));Object.assign(subtitle.style,{fontSize:'6px',letterSpacing:'.2em',marginTop:'5px',transform:'rotate(-9deg)',color:'#c3b5d3'});subtitle.hidden=small;
  fallback.append(element('span','dc-pack-orbit'),element('span','dc-pack-symbol',product.lineId==='garden'?'✳':'✦'),element('span','dc-pack-word',lineName),subtitle);
  if(previewCards.length){const stack=element('div','dc-pack-preview');stack.append(...previewCards);fallback.append(stack);}
  image.alt=artwork.alt??product.name;image.hidden=true;
  Object.assign(image.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'});
  toggle.style.position='absolute';toggle.style.bottom='8px';toggle.style.right='8px';toggle.style.zIndex='2';
  const showFallback=show=>{fallback.hidden=!show;fallback.style.display=show?'flex':'none';};
  image.addEventListener('load',()=>{if(!disposed){image.hidden=false;showFallback(false);node.dataset.artworkState='ready';}},{signal:abort.signal});
  image.addEventListener('error',()=>{if(!disposed){image.hidden=true;showFallback(true);node.dataset.artworkState='fallback';}},{signal:abort.signal});
  function setSide(value){
    if(disposed)return;
    side=value==='back'?'back':'front';image.hidden=true;showFallback(true);
    const url=assetURL(artwork[side]);
    if(url){image.src=url;node.dataset.artworkState='loading';}else{image.removeAttribute('src');node.dataset.artworkState='fallback';}
    toggle.textContent=t(side==='front'?'artwork.back':'artwork.front');toggle.hidden=small||!artwork.back;
  }
  node.append(fallback,image,toggle);setSide(side);
  return {node,setSide,dispose(){if(disposed)return;disposed=true;abort.abort();image.removeAttribute('src');node.replaceChildren();}};
}
const themes=['--dc-bg','--dc-panel','--dc-text','--dc-muted','--dc-accent','--dc-border','--dc-radius','--dc-card-ratio','--dc-font','--dc-button-text','--dc-card-text'];
export function installStyles(root,{theme={},css=''}={}) {
  root.classList.add('dc-root');
  for(const [name,value] of Object.entries(theme)) if(themes.includes(name)) root.style.setProperty(name,String(value));
  const style=element('style'); style.textContent=defaultCSS+'\n'+css; root.prepend(style);
  return ()=>{style.remove();root.classList.remove('dc-root');for(const name of Object.keys(theme)) if(themes.includes(name)) root.style.removeProperty(name);};
}
export function renderCard(copy,{onSelect,interactive=true,backRenderer,effects=true,presentationMode='poster',localization}={}) {
  const label=localization?.text(copy.serialNumber?'card.serialLabel':'card.label',{name:copy.definition.name,rarity:copy.rarityId,serial:copy.serialNumber,total:copy.editionTotal});
  if(copy.variant?.presentation||copy.definition.presentation){if(!portableRenderers.has(presentationMode))portableRenderers.set(presentationMode,createCardRenderer({mode:presentationMode}));const node=portableRenderers.get(presentationMode)(copy,{onSelect});if(label)node.setAttribute('aria-label',label);return node;}
  const node=element('button','dc-card'); node.type='button';
  node.setAttribute('aria-label',label??copy.definition.name+', '+copy.rarityId+(copy.serialNumber?' '+copy.serialNumber+' of '+copy.editionTotal:''));
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
export function renderTiltInspector(copy,{cardRenderer=renderCard,metadataRenderer,backRenderer,onClose,labels={},locale='en',messages={},localization=createLocalization({locale,messages})}={}) {
  const t=localization.text;
  const node=element('section','dc-inspector');node.setAttribute('aria-label',t('inspector.label'));node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);
  const grid=element('div','dc-inspector-grid'),card=cardRenderer(copy,{backRenderer,localization}),details=element('div');
  let flipped=false;
  const flip=()=>{flipped=!flipped;card.style.setProperty('--dc-flip',flipped?'180deg':'0deg');card.dataset.flipped=String(flipped);};
  card.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight') {event.preventDefault();card.style.setProperty('--dc-x',event.key==='ArrowLeft'?'-0.8':'0.8');}
    if(event.key==='ArrowUp'||event.key==='ArrowDown') {event.preventDefault();card.style.setProperty('--dc-y',event.key==='ArrowUp'?'-0.8':'0.8');}
    if(event.key==='Escape') onClose?.();
  });
  details.append(element('h2','',copy.definition.name),element('p','dc-muted',t('inspector.tiltHint')));
  const controls=element('div','dc-row');controls.append(button(t('inspector.flipCard'),flip));if(onClose)controls.append(button(t('inspector.closeLegacy'),onClose));details.append(controls);
  if(metadataRenderer) details.append(metadataRenderer(copy,{localization}));
  else {
    const list=element('dl');
    const finish=copy.variant.finish??'standard',fieldLabels={Line:'line',Rarity:'rarity',Finish:'finish',Edition:'edition','Opened by':'openedBy','Opened at':'openedAt','Copy ID':'copyId'},fields={Line:labels.line??copy.lineId,Rarity:labels.rarity??copy.rarityId,Finish:['standard','gloss','holo','foil'].includes(finish)?t('finish.'+finish):finish,
      Edition:copy.serialNumber?t('inspector.serial',{serial:copy.serialNumber,total:copy.editionTotal}):t('inspector.openEdition'),
      'Opened by':copy.openedByName??copy.openedBy??t('inspector.notOpened'),'Opened at':copy.openedAt?localization.date(copy.openedAt):t('inspector.notOpened'),'Copy ID':copy.id};
    for(const [name,value]of Object.entries(fields))list.append(element('dt','',t('inspector.'+fieldLabels[name])),element('dd','',value));
    for(const [name,value]of Object.entries({...copy.definition.metadata,...copy.variant.metadata,...copy.metadata}))
      list.append(element('dt','',name),element('dd','',typeof value==='number'&&Number.isFinite(value)?localization.number(value):typeof value==='object'?JSON.stringify(value):value));
    const bindingStates={active:'bindingActive',used:'bindingUsed','activation-pending':'bindingPending','activation-failed':'bindingFailed'};
    for(const [name,b]of Object.entries(copy.bindings))list.append(element('dt','',name+' · '+(Object.hasOwn(bindingStates,b.state)?t('inspector.'+bindingStates[b.state]):b.state)),element('dd','',b.state==='activation-pending'?t('inspector.activationPending'):b.state==='activation-failed'?t('inspector.activationFailed'):JSON.stringify(b.data)));
    details.append(list);
  }
  grid.append(card,details);node.append(grid);return node;
}
export function renderAlbum(model,{cardRenderer=renderCard,onSelect,layouts={},locale='en',messages={},localization=createLocalization({locale,messages})}={}) {
  const t=localization.text;
  const custom=Object.hasOwn(layouts,model.layout?.id)?layouts[model.layout.id]:null;
  if(custom) return custom(model,{cardRenderer,onSelect,localization});
  const node=element('div','dc-album');if(model.layout?.id==='panorama')node.classList.add('dc-panorama');
  const columns=Number(model.layout?.columns??3);if(Number.isInteger(columns)&&columns>=1&&columns<=12)node.style.setProperty('--dc-album-columns',String(columns));
  const gap=Number(model.layout?.gap??18);if(Number.isFinite(gap)&&gap>=0&&gap<=100)node.style.setProperty('--dc-album-gap',gap+'px');
  const host=element('div','dc-album-host'),shadow=host.attachShadow({mode:'open'}),wrap=element('div','dc-root dc-album-isolated'),style=element('style');
  host.setAttribute('lang',localization.locale);host.setAttribute('dir',localization.dir);
  const abort=new AbortController(),images=new Set();let disposed=false,pageAbort,cardNodes=[];
  Object.assign(host.style,{position:'relative',contain:'layout paint',isolation:'isolate',overflow:'hidden',maxWidth:'100%',minWidth:'0'});
  style.textContent=defaultCSS+'\n.dc-root.dc-album-isolated{padding:0;border:0;background:transparent;'+themes.map(name=>name+':inherit').join(';')+'}';
  applyAlbumAppearance(node,albumAppearance(model.layout));
  const artwork=albumArtwork(model.layout),bookMode=model.layout?.artwork!==undefined||model.layout?.pageSize!==undefined;
  function imageSurface(image,label,container,signal=abort.signal){
    if(!image?.src)return;
    const figure=element('figure'),img=element('img'),caption=element('figcaption','dc-muted');
    figure.style.margin='0';img.src=assetURL(image.src);img.alt=image.alt??label;img.style.maxWidth='100%';img.style.maxHeight='240px';img.style.objectFit='contain';
    img.addEventListener('error',()=>{if(disposed)return;img.hidden=true;caption.textContent=t('albums.artworkUnavailable',{label:image.alt??label});},{once:true,signal});
    images.add(img);figure.append(img,caption);container.append(figure);return img;
  }
  if(!bookMode){for(const {copy} of model.cards){const card=cardRenderer(copy,{onSelect,localization});cardNodes.push(card);node.append(card);}wrap.append(node);}
  else{
    let pageSize;try{pageSize=validateAlbumPageSize(model.layout.pageSize??12);}catch{pageSize=12;}
    const pages=artwork.pages??[],known=new Set(pages.map(page=>page.id)),automatic=model.cards.map((item,index)=>({item,index})).filter(({item})=>!known.has(item.placement?.data?.pageId)),
      pageCount=Math.max(1,pages.length,Math.ceil(((automatic.at(-1)?.index??-1)+1)/pageSize)),book=element('section','dc-album-book'),jacket=element('div'),content=element('div'),controls=element('div','dc-row'),heading=element('h3'),previous=button(t('albums.previous'),()=>setPage(current-1)),next=button(t('albums.next'),()=>setPage(current+1)),pageSelect=element('select');
    let current=0;
    book.tabIndex=0;book.setAttribute('aria-label',model.name??t('albums.book'));Object.assign(book.style,{maxWidth:'100%',minWidth:'0'});
    Object.assign(jacket.style,{display:'flex',gap:'12px',alignItems:'stretch',overflow:'hidden'});
    const spine=element('div'),cover=element('div');spine.style.maxWidth='64px';spine.style.flex='0 0 48px';cover.style.minWidth='0';cover.style.flex='1';
    if(artwork.spine)imageSurface(artwork.spine,t('albums.spine'),spine);if(artwork.cover)imageSurface(artwork.cover,t('albums.cover'),cover);
    if(artwork.spine)jacket.append(spine);if(artwork.cover)jacket.append(cover);book.append(jacket,heading,controls,content);
    pageSelect.setAttribute('aria-label',t('albums.pageSelect'));for(let index=0;index<pageCount;index++){const option=element('option','',pages[index]?.title??t('albums.page',{number:index+1}));option.value=String(index);pageSelect.append(option);}
    pageSelect.addEventListener('change',()=>setPage(Number(pageSelect.value)),{signal:abort.signal});
    book.addEventListener('keydown',event=>{if(event.target!==book)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setPage(current+(event.key==='ArrowRight'?1:-1));}},{signal:abort.signal});
    controls.append(previous,pageSelect,next);applyAlbumAppearance(book,albumAppearance(model.layout));wrap.append(book);
    function setPage(index){
      if(disposed)return;current=Math.max(0,Math.min(pageCount-1,index));pageAbort?.abort();for(const card of cardNodes)card.dispose?.();cardNodes=[];
      for(const img of [...images])if(content.contains(img)){img.removeAttribute('src');images.delete(img);}
      content.replaceChildren();pageAbort=new AbortController();
      const page=pages[current],background=element('div');Object.assign(background.style,{position:'relative',minHeight:'240px',overflow:'hidden'});
      const pageImage=imageSurface(page,t('albums.pageArtwork',{number:current+1}),background,pageAbort.signal);
      if(pageImage)Object.assign(pageImage.style,{position:'absolute',inset:'0',width:'100%',height:'100%',maxHeight:'none',objectFit:'cover',pointerEvents:'none'});
      const gallery=node.cloneNode(false);Object.assign(gallery.style,{position:'relative',minHeight:'240px'});if(pageImage)gallery.style.backgroundColor='transparent';
      const automaticPage=new Set(automatic.filter(({index})=>Math.floor(index/pageSize)===current).map(({item})=>item));
      for(const item of model.cards)if((page&&item.placement?.data?.pageId===page.id)||automaticPage.has(item)){const card=cardRenderer(item.copy,{onSelect,localization});cardNodes.push(card);gallery.append(card);}
      background.append(gallery);content.append(background);heading.textContent=t('albums.pageProgress',{title:page?.title??t('albums.page',{number:current+1}),number:current+1,total:pageCount});
      pageSelect.value=String(current);previous.disabled=current===0;next.disabled=current===pageCount-1;
    }
    host.setPage=setPage;setPage(0);
  }
  host.dispose=()=>{if(disposed)return;disposed=true;abort.abort();pageAbort?.abort();for(const image of images)image.removeAttribute('src');images.clear();for(const card of cardNodes)card.dispose?.();shadow.replaceChildren();};
  shadow.append(style,wrap);return host;
}
export function mountOpener(root,{controller,cardRenderer=renderCard,view,onSelect,packArtwork,locale='en',messages={},localization=createLocalization({locale,messages})}={}) {
  let cleanup,retained,disposed=false,failedView=false;const t=localization.text,oldLang=root.getAttribute('lang'),oldDir=root.getAttribute('dir');
  const clean=()=>{try{cleanup?.();}catch{}cleanup=undefined;retained=undefined;};
  root.setAttribute('lang',localization.locale);root.setAttribute('dir',localization.dir);
  const unsubscribe=controller.subscribe(state=>{
    if(disposed)return;
    if(retained){try{retained.update(state);return;}catch{failedView=true;clean();}}
    clean();root.replaceChildren();
    if(view&&!failedView)try{const rendered=view(state,controller,{localization,onSelect,cardRenderer,packArtwork});if(rendered?.node){root.append(rendered.node);cleanup=()=>rendered.dispose?.();if(typeof rendered.update==='function')retained=rendered;}else root.append(rendered);return;}catch{failedView=true;clean();root.replaceChildren();}
    const node=element('div','dc-opener'),renderAbort=new AbortController(),cardsToDispose=[];let revealImage;
    cleanup=()=>{renderAbort.abort();revealImage?.removeAttribute('src');for(const card of cardsToDispose)try{card.dispose?.();}catch{}};
    const artwork=state.receipt?packArtwork?.(state.receipt.id):undefined,url=assetURL(artwork?.reveal);
    if(url){const image=revealImage=element('img','dc-reveal-artwork');image.src=url;image.alt=artwork.alt??t('artwork.reveal');image.style.maxWidth='100%';image.style.maxHeight='240px';image.style.objectFit='contain';image.addEventListener('error',()=>image.remove(),{once:true,signal:renderAbort.signal});node.append(image);}
    node.append(element('h3','',t(state.phase==='complete'?'opener.complete':'opener.title')));
    if(state.phase==='idle')node.append(element('p','dc-muted',t('opener.idle')));
    if(state.phase==='loading')node.append(element('p','',t('opener.loading')));
    if(state.error)node.append(element('p','dc-error',localizeDiagnostic(localization,state.error)));
    if(state.receipt) {
      const row=element('div','dc-row');
      node.append(element('p','dc-muted',t('opener.progress',{revealed:state.revealed,total:state.receipt.cards.length})));
      const next=button(t('opener.next'),()=>controller.reveal()),all=button(t('opener.all'),()=>controller.skip());
      next.disabled=all.disabled=state.revealed===state.receipt.cards.length;
      row.append(next,all,button(t('opener.replay'),()=>controller.replay()));node.append(row);
      const cards=element('div','dc-grid');
      for(const copy of state.receipt.cards.slice(0,state.revealed)){
        const result=element('div','dc-result-card'),card=cardRenderer(copy,{onSelect,localization});cardsToDispose.push(card);result.append(card,element('small','dc-result-label',t(copy.isNew?'opener.new':'opener.duplicate')));cards.append(result);
      }
      for(let i=state.revealed;i<state.receipt.cards.length;i++) {const back=element('div','dc-sealed-card');back.append(element('span','','◇'),element('small','',t('opener.card',{number:i+1})));cards.append(back);}
      node.append(cards);
    }
    root.append(node);
  });
  return ()=>{if(disposed)return;disposed=true;unsubscribe();clean();root.replaceChildren();for(const [name,value]of [['lang',oldLang],['dir',oldDir]])if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);};
}
export function mountFramework(root,{client,theme={},css='',cardRenderer=renderCard,packRenderer=renderPack,albumRenderer=renderAlbum,inspectorRenderer=render3DInspector,comparisonRenderer=renderComparison,codeRevealRenderer,listingRenderer,views:customViews={},viewLabels={},
  backRenderer,metadataRenderer,openerView,layouts={},participants=[],navigation='sections',
  sections=['wallet','shop','packs','collection','marketplace','rewards','codes','albums','trades'],shell=null,locale='en',messages={}}={}) {
  const localization=createLocalization({locale,messages}),t=localization.text,num=localization.number,date=localization.date,rate=new Intl.NumberFormat(localization.locale,{minimumFractionDigits:1,maximumFractionDigits:1}).format,oldLang=root.getAttribute('lang'),oldDir=root.getAttribute('dir');
  root.setAttribute('lang',localization.locale);root.setAttribute('dir',localization.dir);
  const removeStyles=installStyles(root,{theme,css});
  const applicationShell=createApplicationShell({root,navigation,navigate,localization});
  const {status,content,recovery,overlays}=applicationShell.regions,inspector=element('dialog','dc-inspector-dialog');
  inspector.setAttribute('aria-label',t('inspector.dialog'));overlays.append(inspector);
  let disposed=false,model=null,openerDispose=null,viewDisposers=[],refreshGeneration=0,mutate=null,commandPrincipal=null,busy=false,shellGeneration=0,shellPrincipal=null;
  let active=sections.includes('shop')?'shop':sections[0],viewLeave=null;
  let effectiveSections=sections;
  const actionFocusAbort=new AbortController();
  const renderer=(copy,options={})=>cardRenderer(copy,{backRenderer,localization,...options});
  const currencyName=id=>model.catalog.currencies.find(c=>c.id===id)?.name??id;
  const lineName=id=>model.catalog.lines.find(l=>l.id===id)?.name??id;
  const userName=id=>participants.find(u=>u.id===id)?.name??(id===model.me.userId?t('account.you'):id);
  const closeInspector=()=>inspector.close();
  let inspectorInvoker=null;
  inspector.addEventListener('close',()=>{if(inspector.open)return;const invoker=inspectorInvoker;inspectorInvoker=null;const focused=document.activeElement;if(!disposed&&invoker?.isConnected&&([document.body,document.documentElement,invoker].includes(focused)||inspector.contains(focused)))invoker.focus();});
  function inspect(copy) {
    if(disposed)return;
    if(!inspector.open)inspectorInvoker=document.activeElement;
    inspector.replaceChildren(inspectorRenderer(copy,{cardRenderer:renderer,metadataRenderer,backRenderer,onClose:closeInspector,catalog:model.catalog,localization,
      labels:{line:lineName(copy.lineId),rarity:model.catalog.rarities.find(r=>r.id===copy.rarityId)?.name}}));
    if(!inspector.open)inspector.showModal();
  }
  function inspectTogether(copies){if(disposed||!copies.length)return;if(!inspector.open)inspectorInvoker=document.activeElement;inspector.replaceChildren(comparisonRenderer(copies,{cardRenderer:renderer,catalog:model.catalog,onClose:closeInspector,localization}));if(!inspector.open)inspector.showModal();}
  inspector.addEventListener('click',event=>{if(event.target===inspector)inspector.close();});
  const createController=()=>createRevealController({open:input=>mutate('openPack',{packId:input.packId}),key:client.requestKey});
  let controller=createController();
  async function action(fn,{refreshAfter=true,message=t('status.saved'),focusAfterRefresh}={}) {
    if(busy || disposed)return;
    const source=refreshAfter&&typeof focusAfterRefresh==='function'&&content.contains(document.activeElement)?document.activeElement:null,focusState=source?{principal:commandPrincipal,view:active,refresh:refreshGeneration,shell:shellGeneration,model}:null;
    let moved=false,ownRefresh=false,succeeded=false,value;
    const focusMoved=event=>{if(![source,document.body,document.documentElement].includes(event.target))moved=true;},pointerMoved=()=>{moved=true;};
    if(source){document.addEventListener('focusin',focusMoved,{capture:true,signal:actionFocusAbort.signal});document.addEventListener('pointerdown',pointerMoved,{capture:true,signal:actionFocusAbort.signal});}
    busy=true;status.className='dc-status is-working';status.textContent=t('status.working');
    root.setAttribute('aria-busy','true');const controls=[...root.querySelectorAll('.dc-content button')].map(b=>[b,b.disabled]);controls.forEach(([b])=>b.disabled=true);
    try {
      value=await fn();
      if(!disposed){if(refreshAfter){const current=focusState&&source.isConnected&&content.contains(source)&&model===focusState.model&&refreshGeneration===focusState.refresh;await refresh();ownRefresh=current&&refreshGeneration===focusState.refresh+1&&model!==focusState.model;}status.className='dc-status is-success';status.textContent=typeof message==='function'?message(value):message;succeeded=true;}
      return value;
    } catch(error) {if(!disposed){status.className='dc-status dc-error';status.textContent=localizeDiagnostic(localization,error);}return undefined;}
    finally {
      busy=false;root.removeAttribute('aria-busy');controls.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;});
      if(source){document.removeEventListener('focusin',focusMoved,true);document.removeEventListener('pointerdown',pointerMoved,true);}
      if(succeeded&&ownRefresh&&!moved&&!disposed&&root.isConnected&&!source.isConnected&&commandPrincipal===focusState.principal&&active===focusState.view&&shellGeneration===focusState.shell&&(typeof client.principal!=='function'||client.principal()===focusState.principal)&&document.hasFocus()&&[document.body,document.documentElement].includes(document.activeElement)){
        const target=focusAfterRefresh(content,value);if(target?.isConnected&&content.contains(target)&&!target.matches(':disabled')&&!target.closest('[inert]'))target.focus();
      }
    }
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
    if(refreshAfterAdmin)refresh().catch(error=>{if(!disposed){status.className='dc-status dc-error';status.textContent=localizeDiagnostic(localization,error);}});
  }
  function wallet() {
    const node=section(t('wallet.title'),t('wallet.description'));
    const cards=element('div','dc-wallet-grid');
    for(const c of model.catalog.currencies){const box=element('article','dc-balance');box.append(element('span','dc-muted',c.name),element('strong','',num(model.wallet[c.id]??0)),element('small','dc-muted',t('wallet.value',{tradability:t(c.tradable?'wallet.tradable':'wallet.notTradable'),amount:c.value.numerator/c.value.denominator})));cards.append(box);}node.append(cards);
    if(model.catalog.features.conversion) {
      const form=element('div','dc-form-panel');form.append(element('h3','',t('wallet.convert')));
      const row=element('div','dc-form-row'),amount=field(row,t('wallet.amount'),'number','100');amount.min='1';amount.step='1';
      const eligible=model.catalog.currencies.filter(c=>c.convertible!==false);
      const from=selectField(row,t('wallet.from'),eligible),to=selectField(row,t('wallet.to'),eligible);if(to.options.length>1)to.selectedIndex=1;
      const preview=element('p','dc-conversion-preview');
      function update(){const a=eligible.find(c=>c.id===from.value),b=eligible.find(c=>c.id===to.value),spent=Number(amount.value),received=a&&b?spent*a.value.numerator*b.value.denominator/(a.value.denominator*b.value.numerator):NaN;preview.textContent=a&&b&&Number.isFinite(spent)&&Number.isFinite(received)?num(spent)+' '+a.name+' → '+num(received)+' '+b.name:'';}
      [amount,from,to].forEach(x=>x.addEventListener('input',update));update();
      const submitConversion=()=>{
        const input={from:from.value,to:to.value,amount:Number(amount.value),catalogVersion:model.catalog.version};
        return mutate.pending('convert')?._confirmed?mutate.beginNew('convert',input):mutate('convert',input);
      };
      form.append(row,preview,button(t('wallet.convert'),()=>action(submitConversion,{message:r=>t('wallet.converted',{amount:r.amount,from:currencyName(r.from),received:r.received,to:currencyName(r.to)})})),element('p','dc-muted',t('wallet.wholeUnits')));node.append(form);
    }return node;
  }
  function packArt(product,small=false,onSelect,onRendered,ownDispose) {
    const previewCards=[],pool=product.slots?.flatMap(s=>s.pool)??[];for(const entry of [...pool.slice(0,2),pool[0]].filter(Boolean)){const variant=model.catalog.variants.find(v=>v.id===entry.variantId),definition=model.catalog.cards.find(c=>c.id===variant?.cardId);if(!definition)continue;const card=renderer({id:'preview',definition,variant,rarityId:variant.rarityId,serialNumber:null,bindings:{}},{interactive:false});card.tabIndex=-1;previewCards.push(card);}
    let rendered;try{rendered=packRenderer(product,{small,lineName:lineName(product.lineId),previewCards,localization,onSelect});}catch{rendered=renderPack(product,{small,lineName:lineName(product.lineId),previewCards,localization});}
    if(!rendered?.node&&!rendered?.nodeType)rendered=renderPack(product,{small,lineName:lineName(product.lineId),previewCards,localization});
    onRendered?.(rendered);
    if(rendered?.node){if(rendered.dispose)(ownDispose??(fn=>viewDisposers.push(fn)))(()=>rendered.dispose());return rendered.node;}return rendered;
  }
  function shop(){return renderShop(model,context());}
  function packs() {
    const node=section(t('packs.title'),t('packs.description'));
    const appearances=new Map(),principal=commandPrincipal;let packsDisposed=false;
    const sealed=model.packs.filter(p=>!p.openedAt),opened=model.packs.filter(p=>p.openedAt);
    const list=element('div','dc-pack-list');
    for(const pack of [...sealed,...opened.slice().reverse()]) {
      const box=element('article','dc-owned-pack');box.append(packArt(pack.product,true,()=>{if(!disposed&&!packsDisposed&&commandPrincipal===principal&&open.isConnected)open.focus();},view=>appearances.set(pack.id,view)));
      const info=element('div');info.append(element('span','dc-badge'+(pack.openedAt?'':' is-sealed'),t(pack.openedAt?'packs.opened':'packs.sealed')),element('h3','',pack.product.name),element('small','dc-muted',date(pack.createdAt)));
      const open=button(t(pack.openedAt?'packs.replay':'packs.open'),()=>action(async()=>{await controller.load(pack.id);const state=controller.getState();if(state.error)throw Object.assign(new Error(state.error.message),state.error);},{message:t(pack.openedAt?'packs.replaying':'packs.openSuccess')}));box.append(info,open);list.append(box);
    }
    const unsubscribe=controller.subscribe(state=>{
      if(disposed||packsDisposed||commandPrincipal!==principal)return;
      for(const [id,view]of appearances){const count=state.receipt?.cards.length??0,revealProgress=state.receipt?.id===id?(count?state.revealed/count:state.phase==='complete'?1:0):0;
        // Cosmetic renderer failures must not interrupt committed opening or reveal publication.
        try{if(typeof view.setPresentationInputs==='function')view.setPresentationInputs({revealProgress});else view.node?.setPresentationInputs?.({revealProgress});}catch{}}
    });viewDisposers.push(()=>{packsDisposed=true;unsubscribe();appearances.clear();});
    if(!model.packs.length)empty(node,t('packs.empty'),t('packs.emptyDescription'),t('packs.browse'),'shop');
    node.append(list);const opener=element('div');node.append(opener);openerDispose=mountOpener(opener,{controller,cardRenderer:renderer,view:openerView,onSelect:inspect,localization,packArtwork:id=>model.packs.find(pack=>pack.id===id)?.product.artwork});return node;
  }
  const viewState={};
  const context=()=>({client,inspect,inspectTogether,refresh,mutate,action,navigate,isActionBusy:()=>busy,getPrincipal:()=>commandPrincipal,isCurrentModel:captured=>!disposed&&model===captured,cardRenderer:renderer,albumRenderer,codeRevealRenderer,listingRenderer,packArt,onPurchased:()=>{active='packs';},layouts,state:viewState,localization});
  const views={wallet,shop,packs,marketplace:()=>renderMarketplace(model,context()),rewards:()=>renderFulfillments(model,context()),tradingControls:()=>renderTradingControls(model,context()),codes:()=>renderCodeHistory(model,context()),collection:()=>renderCollection(model,context()),albums:()=>renderAlbums(model,context()),trades:()=>renderTrading(model,context()),...Object.fromEntries(Object.entries(customViews).map(([id,view])=>[id,()=>view(model,context())]))};
  if(!customViews.admin)views.admin=()=>renderAdminPanel(model,context());
  const labels={wallet:t('nav.wallet'),shop:t('nav.shop'),packs:t('nav.packs'),collection:t('nav.collection'),tradingControls:t('nav.tradingControls'),admin:t('nav.admin'),marketplace:t('nav.marketplace'),rewards:t('nav.rewards'),codes:t('nav.codes'),albums:t('nav.albums'),trades:t('nav.trades'),...viewLabels};
  function renderView() {
    if(!model||disposed)return;viewLeave=null;openerDispose?.();openerDispose=null;viewDisposers.forEach(fn=>fn());viewDisposers=[];content.replaceChildren();recovery.replaceChildren();
    root.classList.toggle('dc-with-nav',navigation==='tabs');
    applicationShell.update({model,sections:effectiveSections,views,labels,active,userName});
    if(model.recoverable?.length){
      const panel=element('section','dc-panel');panel.setAttribute('aria-label',t('recovery.title'));panel.append(element('h2','',t('recovery.title')),element('p','',t('recovery.description')));
      const names={purchase:'pack purchase',openPack:'pack opening',buyListing:'marketplace purchase',configureAdmin:'settings change',administerCards:'card administration',convert:'currency conversion',tradeUp:'trade-up',saveAlbum:'album change',proposeTrade:'trade offer',acceptTrade:'trade acceptance',cancelTrade:'trade cancellation',counterTrade:'counteroffer',preferences:'preferences',readNotifications:'notification update',commitImport:'catalog import',reportCodeUsage:'code usage report',createShop:'shop creation',createListing:'listing creation',cancelListing:'listing cancellation',enterRaffle:'raffle entry',openCard:'card opening',consumeBinding:'attached action'};
      for(const intent of model.recoverable){const label=['purchase','openPack','convert','preferences','tradeUp','saveAlbum','proposeTrade','acceptTrade','cancelTrade','counterTrade','buyListing','createShop','createListing','cancelListing','enterRaffle'].includes(intent.command)?t('recovery.'+intent.command):names[intent.command]??'saved change',row=element('div');row.append(element('strong','',label));if(intent.input.productId)row.append(element('p','',t('recovery.product',{count:intent.input.quantity??1,product:model.catalog.products.find(product=>product.id===intent.input.productId)?.name??intent.input.productId})));row.append(button(t('recovery.action',{change:label}),()=>action(()=>mutate.resume(intent),{message:t('recovery.success')})));panel.append(row);}recovery.append(panel);
    }
    for(const name of (navigation==='tabs'?[active]:effectiveSections)){const view=typeof name==='function'?()=>name(model,{client,inspect,inspectTogether,refresh,mutate,action,navigate,cardRenderer:renderer,localization}):views[name];if(view){const result=view();content.append(result.node??result);if(result.dispose)viewDisposers.push(result.dispose);if(result.requestLeave)viewLeave=result.requestLeave;}}
  }
  async function refresh() {
    if(disposed)return;
    const generation=++refreshGeneration;
    const [catalog,me,capabilities]=await Promise.all([client.catalog(),client.me(),client.capabilities?.()??null]);
    if(disposed||generation!==refreshGeneration)return;
    if(shellPrincipal!==me.userId){if(shellPrincipal!==null){shellGeneration++;inspectorInvoker=null;inspector.close();inspector.replaceChildren();openerDispose?.();openerDispose=null;controller.dispose();controller=createController();}shellPrincipal=me.userId;}
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
  async function setShell(value){
    const generation=++shellGeneration;
    try{const manifest=await value;await ready;if(disposed||generation!==shellGeneration)return false;return applicationShell.install(manifest??null);}
    catch{if(disposed||generation!==shellGeneration)return false;applicationShell.install(null);return false;}
  }
  const shellReady=setShell(shell);
  const ready=refresh().catch(error=>{if(disposed)return;status.className='dc-status dc-error';status.textContent=localizeDiagnostic(localization,error);throw error;});
  return {ready,shellReady,setShell,refresh,inspect,inspectTogether,dispose(){if(disposed)return;disposed=true;actionFocusAbort.abort();shellGeneration++;mutate?.dispose();openerDispose?.();viewDisposers.forEach(fn=>fn());controller.dispose();inspector.close();applicationShell.dispose();removeStyles();root.replaceChildren();for(const [name,value]of [['lang',oldLang],['dir',oldDir]])if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);}};
}
