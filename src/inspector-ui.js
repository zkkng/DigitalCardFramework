import {el,button} from './ui-kit.js';
/** Camera is presentation state; it never changes copy ownership or card definitions. */
function camera(stage,target){let yaw=0,pitch=0,zoom=1,drag=null;
  stage.tabIndex=0;stage.setAttribute('aria-label','3D card stage. Drag to rotate. Arrow keys rotate; plus and minus zoom; R resets.');
  const apply=()=>{target.style.transform=`scale(${zoom}) rotateX(${pitch}deg) rotateY(${yaw}deg)`;stage.dataset.yaw=String(Math.round(yaw));for(const card of stage.querySelectorAll('.dc-card')){card.style.setProperty('--dc-x',String(Math.sin(yaw*Math.PI/180)*.8));card.style.setProperty('--dc-y',String(pitch/85));}};
  stage.addEventListener('pointerdown',e=>{if(e.target.closest('.dc-camera-controls'))return;drag={x:e.clientX,y:e.clientY,yaw,pitch};stage.setPointerCapture(e.pointerId);});
  stage.addEventListener('pointermove',e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.65;pitch=Math.max(-85,Math.min(85,drag.pitch-(e.clientY-drag.y)*.5));apply();});
  stage.addEventListener('pointerup',()=>drag=null);stage.addEventListener('pointercancel',()=>drag=null);
  stage.addEventListener('keydown',e=>{if(e.target!==stage)return;const actions={ArrowLeft:()=>yaw-=15,ArrowRight:()=>yaw+=15,ArrowUp:()=>pitch=Math.min(85,pitch+10),ArrowDown:()=>pitch=Math.max(-85,pitch-10),'+':()=>zoom=Math.min(1.7,zoom+.1),'=':()=>zoom=Math.min(1.7,zoom+.1),'-':()=>zoom=Math.max(.5,zoom-.1),r:()=>{yaw=pitch=0;zoom=1;}};if(actions[e.key]){e.preventDefault();actions[e.key]();apply();}});
  const controls=el('div','dc-camera-controls');controls.append(button('↶',()=>{yaw-=45;apply();},'dc-quiet'),button('Flip',()=>{yaw+=180;apply();},'dc-quiet'),button('↷',()=>{yaw+=45;apply();},'dc-quiet'),button('−',()=>{zoom=Math.max(.5,zoom-.1);apply();},'dc-quiet'),button('+',()=>{zoom=Math.min(1.7,zoom+.1);apply();},'dc-quiet'),button('Reset',()=>{yaw=pitch=0;zoom=1;apply();},'dc-quiet'));
  controls.querySelectorAll('button')[0].setAttribute('aria-label','Rotate left');controls.querySelectorAll('button')[2].setAttribute('aria-label','Rotate right');controls.querySelectorAll('button')[3].setAttribute('aria-label','Zoom out');controls.querySelectorAll('button')[4].setAttribute('aria-label','Zoom in');stage.append(controls);apply();return {apply};
}
export function render3DInspector(copy,{cardRenderer,metadataRenderer,backRenderer,onClose,labels={},catalog}={}){
  const node=el('section','dc-inspector'),grid=el('div','dc-inspector-grid'),stage=el('div','dc-3d-stage'),card=cardRenderer(copy,{interactive:false,backRenderer}),details=el('div');
  card.tabIndex=-1;card.classList.add('dc-orbit-card');const inner=card.querySelector('.dc-card-inner')??card;inner.append(el('span','dc-card-edge'));stage.append(card);camera(stage,inner);
  details.append(el('span','dc-eyebrow','COLLECTION OBJECT'),el('h2','',copy.definition.name),el('p','dc-muted',copy.definition.description??'Explore both faces, layered depth and the history of this card.'));
  if(copy.definition.tags?.length){const tags=el('div','dc-tags');copy.definition.tags.forEach(t=>tags.append(el('span','dc-badge',t)));details.append(tags);}
  const stats=el('div','dc-stat-grid');for(const [key,value]of Object.entries(copy.definition.stats??{})){const stat=el('div'),label=catalog?.displayFields?.find(f=>f.path==='stats.'+key)?.label??key;stat.append(el('small','dc-muted',label),el('strong','',typeof value==='object'?JSON.stringify(value):value));stats.append(stat);}details.append(stats);
  if(metadataRenderer)details.append(metadataRenderer(copy));else{
    const list=el('dl'),fields={Line:labels.line??copy.lineId,Rarity:labels.rarity??copy.rarityId,Finish:copy.variant.finish??'standard',Edition:copy.serialNumber?`${copy.serialNumber} of ${copy.editionTotal}`:'Open edition','Opened by':copy.openedByName??copy.openedBy??'Catalog preview','Opened at':copy.openedAt?new Date(copy.openedAt).toLocaleString():'Not opened','Copy ID':copy.id};
    const metadata={...copy.definition.metadata,...copy.variant.metadata,...copy.metadata};for(const [key,value]of Object.entries({...fields,...metadata})){const label=Object.hasOwn(metadata,key)?catalog?.displayFields?.find(f=>f.path==='metadata.'+key)?.label??key:key;list.append(el('dt','',label),el('dd','',typeof value==='object'?JSON.stringify(value):value));}
    for(const [key,b]of Object.entries(copy.bindings??{}))list.append(el('dt','',key+' · '+b.state),el('dd','',JSON.stringify(b.data)));details.append(list);
  }
  if(onClose)details.prepend(button('Close inspection',onClose,'dc-quiet dc-close'));grid.append(stage,details);node.append(grid);return node;
}
export function renderComparison(copies,{cardRenderer,catalog,onClose}={}){
  const node=el('section','dc-inspector dc-comparison'),head=el('div','dc-row');head.append(el('h2','',`${copies.length} cards · shared inspection`),button('Close inspection',onClose,'dc-quiet'));node.append(head);
  const combinations=(catalog.combinations??[]).filter(c=>c.pieces.some(p=>copies.some(copy=>copy.cardId===p.cardId)));
  const toolbar=el('div','dc-row'),stage=el('div','dc-3d-stage dc-comparison-stage'),scene=el('div','dc-comparison-scene');stage.append(scene);
  const notice=el('p','dc-muted');let choice=null;
  function draw(){scene.replaceChildren();scene.classList.toggle('is-assembled',!!choice);scene.style.gridTemplateColumns=`repeat(${choice?.columns??Math.min(4,copies.length)},minmax(0,1fr))`;scene.style.gap=(choice?.gap??20)+'px';scene.style.setProperty('--dc-rows',String(choice?.rows??1));
    if(choice){for(let row=0;row<choice.rows;row++)for(let column=0;column<choice.columns;column++){const piece=choice.pieces.find(p=>p.row===row&&p.column===column),copy=copies.find(c=>c.cardId===piece?.cardId);scene.append(copy?cardRenderer(copy,{interactive:false}):el('div','dc-missing-piece',piece?'Missing piece':'Empty'));}const missing=choice.pieces.filter(p=>!copies.some(c=>c.cardId===p.cardId));notice.textContent=choice.name+' · '+(missing.length?missing.length+' pieces missing':'Complete scene');}
    else{copies.forEach(c=>scene.append(cardRenderer(c,{interactive:false})));notice.textContent='Compare cards together. Drag the stage to inspect the group from any angle.';}}
  toolbar.append(button('Side by side',()=>{choice=null;draw();},'dc-quiet'));for(const combo of combinations)toolbar.append(button('Assemble '+combo.name,()=>{choice=combo;draw();},'dc-quiet'));
  draw();camera(stage,scene);node.append(toolbar,notice,stage);return node;
}
