import {createClient,createRevealController} from '/src/client.js';
import {mountFramework,mountOpener,installStyles,renderCard,element} from '/src/ui.js';
const client=createClient();
const users=await (await fetch('/demo/users')).json();
await fetch('/demo/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:users[0].id})});
const theme={'--dc-bg':'#ede9df','--dc-panel':'#faf8f1','--dc-text':'#243f33','--dc-muted':'#596a5f','--dc-accent':'#a8c4a7','--dc-border':'#c1cbba','--dc-font':'Georgia,serif'};
const backRenderer=()=>element('span','dc-back-mark','ATLAS');
function metadataRenderer(copy) {const node=element('div');node.append(element('p','','Collected by '+(copy.openedByName??'you')),element('p','',copy.definition.metadata['artist.credit']??'Independent collection'));return node;}
function albumRenderer(model,{cardRenderer,onSelect}) {
  const node=element('div','journal-album');
  for(const {copy}of model.cards){const page=element('article');page.append(cardRenderer(copy,{onSelect}),element('p','',copy.definition.name));node.append(page);}
  return node;
}
const app=mountFramework(document.querySelector('#framework'),{client,theme,backRenderer,metadataRenderer,albumRenderer,
  sections:['collection','albums','wallet','shop']});
await app.ready;
const modal=document.querySelector('#modal'),modalRoot=document.querySelector('#modal-root');
installStyles(modalRoot,{theme});
const controller=createRevealController({open:input=>client.openPack(input),key:client.requestKey});
mountOpener(modalRoot,{controller,view(state,controls){
  const node=element('div','instant-list');
  if(state.phase==='loading')node.append(element('p','','Loading…'));
  if(state.error)node.append(element('p','dc-error',state.error.message));
  if(state.receipt)for(const copy of state.receipt.cards)node.append(renderCard(copy,{backRenderer,onSelect:()=>{modal.close();app.inspect(copy);}}));
  return node;
}});
document.querySelector('#open-modal').addEventListener('click',async()=>{
  try {
    const packs=await client.packs();const pack=packs.find(p=>!p.openedAt)??packs.at(-1);
    if(!pack){document.querySelector('#message').textContent='Buy a pack in the shop first.';return;}
    modal.showModal();await controller.load(pack.id);await app.refresh();
  }catch(error){document.querySelector('#message').textContent=error.message;}
});
document.querySelector('#close-modal').addEventListener('click',()=>modal.close());
