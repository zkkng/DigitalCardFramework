import {el,button,field,select,section,previewCopy,download} from './ui-kit.js';
import {cardBehavior} from './card-types.js';
import {albumAppearance,validateAlbumAppearance,validateAlbumArtwork,validateAlbumPageSize,validateAlbumPageAssignments} from './album-appearance.js';

export function renderCollection(model,{cardRenderer,inspect,inspectTogether,action,mutate}){
  const node=section('Your collection','Every card has its own identity and history. Find favorites, compare a group, or assemble cards that belong together.'),filters=el('div','dc-filter-bar');
  const search=field(filters,'Search collection',{placeholder:'Names, tags, stats and metadata'}),line=select(filters,'Line',[{id:'',name:'All lines'},...model.catalog.lines]),rarity=select(filters,'Rarity',[{id:'',name:'All rarities'},...model.catalog.rarities]),finish=select(filters,'Finish',[{id:'',name:'All finishes'},...['standard','gloss','holo','foil'].map(id=>({id,name:id}))]),sort=select(filters,'Sort',[{id:'newest',name:'Newest first'},{id:'name',name:'Name A–Z'},{id:'rarity',name:'Rarity high to low'}]),show=select(filters,'Show',[{id:'all',name:'All cards'},{id:'favorites',name:'Favorites'},{id:'duplicates',name:'Duplicates'},{id:'available',name:'Available to trade'}]);
  const completion=el('div','dc-completion'),unique=new Set(model.inventory.filter(c=>cardBehavior(c.definition).collectionDefault).map(c=>c.cardId)),meter=el('progress');meter.max=model.catalog.cards.filter(c=>cardBehavior(c).collectionDefault).length;meter.value=unique.size;completion.append(el('strong','',unique.size+' / '+meter.max+' discoveries'),meter,el('small','dc-muted',model.inventory.length+' total copies'));node.append(completion,filters);
  const mode=select(filters,'Browse',[{id:'owned',name:'My copies'},{id:'catalog',name:'Card catalog & wishlist'}]);
  const inserts=select(filters,'Include code cards and inserts',[{id:'no',name:'Hide inserts'},{id:'yes',name:'Include inserts'}]);
  const selection=new Set(),favorites=new Set(model.me.preferences?.favoriteCopyIds),wishes=new Set(model.me.preferences?.wishlistCardIds),counts={};model.inventory.forEach(c=>counts[c.variantId]=(counts[c.variantId]??0)+1);
  const toolbar=el('div','dc-selection-bar'),selectionText=el('strong'),compare=button('Inspect together',()=>inspectTogether(model.inventory.filter(c=>selection.has(c.id)))),clear=button('Clear selection',()=>{selection.clear();draw();},'dc-quiet');toolbar.append(selectionText,compare,clear);
  if(model.catalog.features.tradeUps){const recipe=select(toolbar,'Trade-up recipe',[{id:'',name:'Choose recipe…'},...model.catalog.recipes]);toolbar.append(button('Trade up selected',()=>action(()=>mutate('tradeUp',{recipeId:recipe.value,copyIds:[...selection],catalogVersion:model.catalog.version}),{message:'Trade-up complete. New card added to your collection.'})));}
  const result=el('p','dc-muted'),grid=el('div','dc-collection-grid'),more=button('Show more',()=>{limit+=48;draw();},'dc-quiet');let limit=48;
  node.append(toolbar,result,grid,more);
  function updateSelection(){selectionText.textContent=selection.size+' selected';compare.disabled=selection.size<2;toolbar.hidden=selection.size===0;}
  function draw(){grid.replaceChildren();const browsing=mode.value==='catalog';let copies=browsing?model.catalog.cards.map(card=>previewCopy(card,model.catalog.variants.find(v=>v.cardId===card.id))):model.inventory;
    const query=search.value.trim().toLowerCase();copies=copies.filter(copy=>(inserts.value==='yes'||cardBehavior(copy.definition).collectionDefault)&&(!line.value||copy.lineId===line.value)&&(!rarity.value||copy.rarityId===rarity.value)&&(!finish.value||(copy.variant.finish??'standard')===finish.value)&&(!query||JSON.stringify([copy.definition.name,copy.definition.tags,copy.definition.stats,copy.definition.metadata,copy.variant.metadata]).toLowerCase().includes(query))&&(show.value==='all'||show.value==='favorites'&&favorites.has(copy.id)||show.value==='duplicates'&&(counts[copy.variantId]??0)>1||show.value==='available'&&model.catalog.features.cardTrading&&copy.tradable===true));
    copies=copies.slice().sort(sort.value==='name'?(a,b)=>a.definition.name.localeCompare(b.definition.name):sort.value==='rarity'?(a,b)=>(model.catalog.rarities.find(r=>r.id===b.rarityId)?.rank??0)-(model.catalog.rarities.find(r=>r.id===a.rarityId)?.rank??0):(a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''));
    result.textContent=copies.length+' matching '+(browsing?'definitions':'copies');more.hidden=copies.length<=limit;
    for(const copy of copies.slice(0,limit)){
      const tile=el('article','dc-collection-tile'+(selection.has(copy.id)?' is-selected':''));tile.append(cardRenderer(copy,{onSelect:inspect}));const caption=el('div','dc-tile-caption');
      caption.append(el('span','dc-muted',model.catalog.lines.find(l=>l.id===copy.lineId)?.name??copy.lineId),el('small','',browsing?(unique.has(copy.cardId)?'Discovered':'Not collected'):(copy.lockedBy?'Reserved for trade':(counts[copy.variantId]??1)+' copies · '+copy.id.slice(0,6))));tile.append(caption);
      const row=el('div','dc-tile-actions');if(!browsing){const label=el('label','dc-select-copy'),checkbox=el('input');checkbox.type='checkbox';checkbox.checked=selection.has(copy.id);checkbox.setAttribute('aria-label','Select '+copy.definition.name+' '+copy.id.slice(0,6));checkbox.addEventListener('change',()=>{if(checkbox.checked&&selection.size>=24){checkbox.checked=false;result.textContent='Select at most 24 cards for a shared inspection.';return;}if(checkbox.checked)selection.add(copy.id);else selection.delete(copy.id);tile.classList.toggle('is-selected',checkbox.checked);updateSelection();});label.append(checkbox,el('span','','Compare'));row.append(label,button(favorites.has(copy.id)?'★':'☆',()=>action(()=>mutate('preferences',{favoriteCopyIds:favorites.has(copy.id)?[...favorites].filter(id=>id!==copy.id):[...favorites,copy.id]}),{message:'Favorites updated.'}),'dc-quiet dc-favorite'));row.lastChild.setAttribute('aria-label',(favorites.has(copy.id)?'Unfavorite ':'Favorite ')+copy.definition.name);}
      else row.append(button(wishes.has(copy.cardId)?'On wishlist':'Add to wishlist',()=>action(()=>mutate('preferences',{wishlistCardIds:wishes.has(copy.cardId)?[...wishes].filter(id=>id!==copy.cardId):[...wishes,copy.cardId]}),{message:'Wishlist updated.'}),'dc-quiet'));
      tile.append(row);grid.append(tile);
    }if(!copies.length)grid.append(el('div','dc-empty',browsing?'No definitions match these filters.':'No cards match yet. Open a pack in My packs or change your filters.'));updateSelection();
  }
  for(const input of [search,line,rarity,finish,sort,show,mode,inserts])input.addEventListener('input',()=>{limit=48;draw();});draw();return node;
}

export function renderAlbums(model,{client,cardRenderer,albumRenderer,layouts,inspect,action,mutate,state={}}){
  const albumButton=(label,callback,...options)=>button(label,(...args)=>{if(disposed)return;return callback(...args)},...options);
  const node=section('Albums, your way','Curate a shelf, build a panoramic scene, or choose bounded colors and spacing. Private albums are visible only to you.'),bar=el('div','dc-row'),pick=select(bar,'Your albums',[{id:'',name:'Create a new album'},...model.albums]);node.append(bar);
  const editor=el('div','dc-album-editor'),info=el('div','dc-form-row'),name=field(info,'Album name',{value:'My collection'}),visibility=select(info,'Visibility',[{id:'private',name:'Private'},...(model.catalog.features.publicAlbums?[{id:'public',name:'Public'}]:[])]),layout=select(info,'Layout',[{id:'grid',name:'Card gallery'},{id:'panorama',name:'Panorama · no gaps'},...Object.keys(layouts??{}).map(id=>({id,name:id}))]),columns=field(info,'Columns',{type:'number',value:'3'}),gap=field(info,'Gap (px)',{type:'number',value:'18'});columns.min='1';columns.max='12';gap.min='0';gap.max='100';
  const cssBox=el('details','dc-form-panel');cssBox.append(el('summary','','Album appearance & layout JSON'));const css=field(cssBox,'Appearance JSON',{type:'textarea',value:'{}',placeholder:'{"background":"#142321","padding":24}'}),json=field(cssBox,'Additional layout JSON',{type:'textarea',value:'{}'});css.rows=4;json.rows=3;
  const selected=[],placementData=new Map(),available=el('div','dc-album-picker'),arrangement=el('div','dc-album-arrangement'),preview=el('div','dc-album-preview'),error=el('p','dc-error');let original=null,disposed=false,pickerLimit=48;
  let artwork={},previewDispose,artEditor,artAbort,artGeneration=0,pagination=false;
  const artworkBox=el('details','dc-form-panel'),artworkControls=el('div'),artEditorRoot=el('div'),pageSize=field(artworkBox,'Cards per album page',{type:'number',value:'12'});pageSize.min='1';pageSize.max='100';
  artworkBox.prepend(el('summary','','Cover, spine & pages'));artworkBox.append(artworkControls,artEditorRoot);editor.append(artworkBox);
  pageSize.addEventListener('input',()=>{pagination=true;});
  const canDesign=model.me.role==='admin'||model.me.permissions?.includes('catalog.publish');
  function closeArtEditor(){artGeneration++;artAbort?.abort();artEditor?.dispose();artEditor=undefined;artEditorRoot.replaceChildren();}
  async function openArtEditor(surface,label,dimensions,makeNew=false){
    if(!canDesign||disposed)return;closeArtEditor();const generation=artGeneration,current=()=>!disposed&&generation===artGeneration,controller=artAbort=new AbortController(),message=el('p','','Loading artwork editor…');artEditorRoot.append(message);
    try{
      const [{mountStudio},{blankPackage},{importPackage},{createLocalLibrary},{publishArtworkPackage}]=await Promise.all([import('./presentation/studio.js'),import('./presentation/project.js'),import('./presentation/package.js'),import('./presentation/authoring-tools.js'),import('./visual-studio-ui.js')]);
      if(!current())return;
      let pkg;
      if(surface.design&&!makeNew){const response=await fetch('/presentations/'+surface.design.digest+'/download',{credentials:'same-origin',signal:controller.signal});if(!response.ok)throw new Error('Saved album artwork design is unavailable');pkg=await importPackage(new Uint8Array(await response.arrayBuffer()));}
      else{
        pkg=await blankPackage();const size=dimensions??(label==='Album spine'?{width:320,height:1500}:label==='Album cover'?{width:1000,height:1500}:{width:1600,height:1000});
        for(const value of Object.values(size))if(!Number.isInteger(value)||value<200||value>4096)throw new Error('Artwork canvas dimensions must be integers from 200 to 4096');
        pkg.manifest.canvas=size;for(const scene of pkg.scenes.values())for(const node of scene.nodes){node.width=size.width;node.height=size.height;}
      }
      if(!current())return;pkg.manifest.title=label+' artwork';
      const sizing=el('div','dc-form-row'),width=field(sizing,'Artwork canvas width',{type:'number',value:String(pkg.manifest.canvas.width)}),height=field(sizing,'Artwork canvas height',{type:'number',value:String(pkg.manifest.canvas.height)}),canvas=el('div');
      width.min=height.min='200';width.max=height.max='4096';
      sizing.append(albumButton('Start new artwork canvas',()=>openArtEditor(surface,label,{width:Number(width.value),height:Number(height.value)},true),'dc-quiet'),albumButton('Close artwork editor',closeArtEditor,'dc-quiet'));
      const stylesheet=el('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./presentation/studio.css',import.meta.url).href;artEditorRoot.replaceChildren(stylesheet,sizing,message,canvas);
      const editorInstance=artEditor=mountStudio(canvas,{initialPackage:pkg,library:createLocalLibrary(),onPublish:async exported=>{
        const design=await publishArtworkPackage(exported,{principal:model.me.userId,signal:controller.signal,active:current});if(!current())return false;
        const poster=exported.manifest.assets.find(asset=>asset.id===exported.manifest.faces.front.poster);surface.src=design.baseURL+poster.path;surface.design=design;renderArtwork();previewAlbum();message.textContent=label+' artwork added to the draft. Save the album to publish this layout.';return true;
      }});
      await editorInstance.ready;if(!current())return;message.textContent='Design '+label.toLowerCase()+' and capture posters. Publish registers public artwork files and adds the reference to this draft. Private album visibility does not make these asset URLs private. Save the album separately.';
    }catch(err){if(current())message.textContent=err.message;}
  }
  function stableAssignments(){
    const next=new Map(placementData),size=validateAlbumPageSize(Number(pageSize.value));
    for(const [index,id] of selected.entries())if(next.get(id)?.pageId===undefined){const page=artwork.pages?.[Math.floor(index/size)];if(page)next.set(id,{...next.get(id),pageId:page.id});}
    return next;
  }
  function changePage(index,delta){
    try{const next=stableAssignments();closeArtEditor();for(const [id,data]of next)placementData.set(id,data);[artwork.pages[index],artwork.pages[index+delta]]=[artwork.pages[index+delta],artwork.pages[index]];renderArtwork();draw();previewAlbum();}catch(err){error.textContent=err.message;}
  }
  function removePage(index){
    try{const next=stableAssignments(),page=artwork.pages[index],count=selected.filter(id=>next.get(id)?.pageId===page.id).length;if(count)throw new Error('Move the '+count+' cards assigned to this page before removing it. Choose another page or explicit automatic order.');closeArtEditor();for(const [id,data]of next)placementData.set(id,data);artwork.pages.splice(index,1);renderArtwork();draw();previewAlbum();}catch(err){error.textContent=err.message;}
  }
  function renderArtwork(){
    if(disposed)return;
    artworkControls.replaceChildren();
    function controls(surface,label){
      const row=el('fieldset');row.append(el('legend','',label));
      const source=field(row,label+' image URL',{value:surface.src??''}),alt=field(row,label+' description',{value:surface.alt??''});alt.maxLength=200;
      source.addEventListener('input',()=>{closeArtEditor();if(source.value)surface.src=source.value;else delete surface.src;delete surface.design;});
      alt.addEventListener('input',()=>{if(alt.value)surface.alt=alt.value;else delete surface.alt;});
      if(canDesign)row.append(albumButton('Design '+label.toLowerCase(),()=>openArtEditor(surface,label),'dc-quiet'));
      artworkControls.append(row);return row;
    }
    artwork.cover??={};artwork.spine??={};controls(artwork.cover,'Album cover');controls(artwork.spine,'Album spine');
    for(const [index,page] of (artwork.pages??[]).entries()){
      const row=controls(page,'Page '+(index+1)),title=field(row,'Page '+(index+1)+' title',{value:page.title??''});title.maxLength=100;
      title.addEventListener('input',()=>{if(title.value)page.title=title.value;else delete page.title;draw();});
      row.append(albumButton('Move page '+(index+1)+' earlier',()=>changePage(index,-1),'dc-quiet'),albumButton('Move page '+(index+1)+' later',()=>changePage(index,1),'dc-quiet'),albumButton('Remove page '+(index+1),()=>removePage(index),'dc-quiet'));
      row.children[row.children.length-3].disabled=index===0;row.children[row.children.length-2].disabled=index===artwork.pages.length-1;
    }
    const add=albumButton('Add album page',()=>{closeArtEditor();artwork.pages??=[];artwork.pages.push({id:'page-'+crypto.randomUUID().replaceAll('-','')});renderArtwork();draw();},'dc-quiet');add.disabled=(artwork.pages?.length??0)>=100;artworkControls.append(add);
  }
  const pickerSearch=field(editor,'Find a card for this album',{placeholder:'Name, rarity or copy ID'}),pickerMore=albumButton('Show more owned cards',()=>{pickerLimit+=48;draw();},'dc-quiet');pickerSearch.addEventListener('input',()=>{pickerLimit=48;draw();});
  const inserts=select(editor,'Include code cards and inserts',[{id:'no',name:'Hide inserts'},{id:'yes',name:'Include inserts'}]);inserts.addEventListener('change',draw);
  editor.prepend(info,cssBox,el('h3','','Choose cards'));editor.append(available,pickerMore,el('h3','','Arrange your album'),el('p','dc-muted','Drag a selected tile onto another to move it, or use its arrow buttons.'),arrangement,error);
  function currentLayout(){const extra=JSON.parse(json.value);if(!extra||typeof extra!=='object'||Array.isArray(extra))throw new Error('Layout JSON must be an object');if(extra.artwork!==undefined||extra.pageSize!==undefined)throw new Error('Use the cover, spine and page controls for artwork and page size');const count=Number(columns.value),spacing=Number(gap.value);if(!Number.isInteger(count)||count<1||count>12||!Number.isFinite(spacing)||spacing<0||spacing>100)throw new Error('Use 1–12 columns and a gap of 0–100 pixels');const draft=structuredClone(artwork);for(const key of ['cover','spine'])if(!draft[key]?.src)delete draft[key];const valid=validateAlbumArtwork(draft),book=pagination||Object.keys(valid).some(key=>key!=='pages'||valid.pages.length);return {...extra,id:layout.value,columns:count,gap:layout.value==='panorama'?0:spacing,appearance:validateAlbumAppearance(JSON.parse(css.value)),...(book?{artwork:valid,pageSize:validateAlbumPageSize(Number(pageSize.value))}:{})};}
  function draw(){if(disposed)return;available.replaceChildren();arrangement.replaceChildren();const query=pickerSearch.value.toLowerCase(),matching=model.inventory.filter(copy=>cardBehavior(copy.definition).albumEligible&&(inserts.value==='yes'||cardBehavior(copy.definition).albumDefault||selected.includes(copy.id))&&[copy.definition.name,copy.rarityId,copy.id].join(' ').toLowerCase().includes(query));pickerMore.hidden=matching.length<=pickerLimit;for(const copy of matching.slice(0,pickerLimit)){const choose=albumButton((selected.includes(copy.id)?'✓ ':'+ ')+copy.definition.name+' · '+copy.id.slice(0,6),()=>{if(selected.includes(copy.id))selected.splice(selected.indexOf(copy.id),1);else selected.push(copy.id);draw();},'dc-quiet');choose.setAttribute('aria-pressed',String(selected.includes(copy.id)));available.append(choose);}
    for(const [index,id]of selected.entries()){
      const copy=model.inventory.find(c=>c.id===id);if(!copy)continue;const tile=el('div','dc-arrange-tile');tile.draggable=true;
      tile.addEventListener('dragstart',e=>e.dataTransfer.setData('application/x-dc-album',id));tile.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-dc-album'))e.preventDefault();});
      tile.addEventListener('drop',e=>{e.preventDefault();const dragged=e.dataTransfer.getData('application/x-dc-album'),from=selected.indexOf(dragged),to=selected.indexOf(id);if(from<0)return;selected.splice(from,1);selected.splice(to,0,dragged);draw();});
      tile.append(cardRenderer(copy,{interactive:false,onSelect:inspect}));
      const page=select(tile,'Album page for '+copy.definition.name+' · '+copy.id.slice(0,6),[{id:'',name:'Automatic order'},...(artwork.pages??[]).map((page,index)=>({id:page.id,name:page.title??'Page '+(index+1)}))]);
      page.value=(artwork.pages??[]).some(p=>p.id===placementData.get(id)?.pageId)?placementData.get(id).pageId:'';
      page.addEventListener('change',()=>{placementData.set(id,{...placementData.get(id),pageId:page.value||null});previewAlbum();});
      const row=el('div','dc-row'),left=albumButton('←',()=>{[selected[index-1],selected[index]]=[selected[index],selected[index-1]];draw();},'dc-quiet'),right=albumButton('→',()=>{[selected[index+1],selected[index]]=[selected[index],selected[index+1]];draw();},'dc-quiet');
      left.disabled=index===0;right.disabled=index===selected.length-1;left.setAttribute('aria-label','Move '+copy.definition.name+' earlier');right.setAttribute('aria-label','Move '+copy.definition.name+' later');
      row.append(left,right,albumButton('×',()=>{selected.splice(index,1);draw();},'dc-quiet'));row.lastChild.setAttribute('aria-label','Remove '+copy.definition.name);tile.append(row);arrangement.append(tile);
    }
  }
  function showPreview(result,title){previewDispose?.();const rendered=result.node??result;preview.replaceChildren(...(title?[el('h3','',title)]:[]),rendered);previewDispose=result.dispose?()=>result.dispose():undefined;}
  function previewAlbum(){if(disposed)return;try{error.textContent='';const layout=currentLayout(),entries=placements();validateAlbumPageAssignments(layout,entries);showPreview(albumRenderer({name:name.value,layout,cards:selected.map((id,index)=>({placement:{position:index,data:placementData.get(id)??{}},copy:model.inventory.find(c=>c.id===id)})).filter(x=>x.copy)},{cardRenderer,onSelect:inspect,layouts}));}catch(err){if(!disposed)error.textContent=err.message;}}
  const placements=()=>selected.map((copyId,position)=>({copyId,position,data:placementData.get(copyId)??{}}));
  const albumDraft=()=>{const layout=currentLayout(),entries=placements();validateAlbumPageAssignments(layout,entries);return {name:name.value,visibility:visibility.value,layout,placements:entries};};
  const controls=el('div','dc-row');controls.append(albumButton('Preview album',previewAlbum,'dc-quiet'),albumButton('Save album',()=>action(async()=>{const result=await mutate('saveAlbum',{albumId:original?.id,expectedVersion:original?.version,...albumDraft()});if(!disposed){state.selectedAlbumId=result.id??original?.id;if(result.id)original=result;}return result;},{message:'Album saved.'})),albumButton('Export layout',()=>{try{download('album-layout.json',albumDraft());}catch(err){if(!disposed)error.textContent=err.message;}},'dc-quiet'));
  editor.append(controls);node.append(editor,preview);
  function loadDocument(doc){validateAlbumPageAssignments(doc?.layout??{},doc?.placements??[]);const nextArtwork=validateAlbumArtwork(doc?.layout?.artwork??{}),nextSize=validateAlbumPageSize(doc?.layout?.pageSize??12);closeArtEditor();artwork=nextArtwork;pagination=doc?.layout?.pageSize!==undefined;pageSize.value=String(nextSize);name.value=doc?.name??'My collection';visibility.value=doc?.visibility??'private';layout.value=doc?.layout?.id??'grid';columns.value=doc?.layout?.columns??3;gap.value=doc?.layout?.gap??18;css.value=JSON.stringify(albumAppearance(doc?.layout),null,2);const {id,columns:c,gap:g,css:s,appearance:a,artwork:aw,pageSize:ps,...extra}=doc?.layout??{};json.value=JSON.stringify(extra,null,2);placementData.clear();for(const p of doc?.placements??[])placementData.set(p.copyId,p.data??{});selected.splice(0,selected.length,...(doc?.placements?.slice().sort((a,b)=>a.position-b.position).map(p=>p.copyId)??[]));renderArtwork();draw();previewAlbum();}
  pick.addEventListener('change',()=>{try{const next=model.albums.find(a=>a.id===pick.value)??null;loadDocument(next);original=next;state.selectedAlbumId=pick.value;}catch(err){pick.value=original?.id??'';error.textContent=err.message;}});
  const imported=el('details','dc-form-panel');imported.append(el('summary','','Import an exported album layout'));const text=field(imported,'Album document JSON',{type:'textarea'});text.rows=4;imported.append(albumButton('Load layout into editor',()=>{try{const doc=JSON.parse(text.value);if(!Array.isArray(doc.placements)||doc.placements.length>1000||new Set(doc.placements.map(p=>p.copyId)).size!==doc.placements.length||doc.placements.some(p=>!model.inventory.some(c=>c.id===p.copyId)))throw new Error('Layout must reference unique copies in your current inventory (maximum 1,000)');loadDocument(doc);error.textContent='Layout loaded locally. Review it before saving.';}catch(err){if(!disposed)error.textContent=err.message;}},'dc-quiet'));node.append(imported);
  if(model.catalog.features.publicAlbums){const publicBox=el('details','dc-form-panel');publicBox.append(el('summary','','Visit public albums'));const list=el('div','dc-public-list');publicBox.append(albumButton('Explore',async()=>{try{const albums=await client.publicAlbums();if(disposed)return;list.replaceChildren();for(const album of albums)list.append(albumButton(album.name+' · '+album.ownerName,async()=>{try{const viewed=await client.viewAlbum(album.id);if(disposed)return;showPreview(albumRenderer(viewed,{cardRenderer,onSelect:inspect,layouts}),viewed.name+' · '+viewed.ownerName);}catch(err){if(!disposed)error.textContent=err.message;}},'dc-quiet'));if(!albums.length)list.append(el('p','dc-muted','No public albums yet.'));}catch(err){if(!disposed)error.textContent=err.message;}},'dc-quiet'),list);node.append(publicBox);}
  original=model.albums.find(a=>a.id===state.selectedAlbumId)??null;if(original){pick.value=original.id;loadDocument(original);}else{renderArtwork();draw();}return {node,dispose(){disposed=true;closeArtEditor();previewDispose?.();}};
}
