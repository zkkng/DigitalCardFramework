import {createTradeDraft} from './trade-client.js';
import {el,button,field,select,section} from './ui-kit.js';

/** Two real inventories, two offer trays, and immutable offer review. Entire view is replaceable. */
export function renderTrading(model,context){
  const {client,cardRenderer,inspect,action,mutate}=context,node=section('The trade lounge','Find a collector. Drag cards into the offer, or use Add to offer. Every exchange is reviewed before ownership changes.');
  const enabled=model.catalog.features.cardTrading||model.catalog.features.currencyTrading;
  const header=el('div','dc-trade-heading');header.append(el('span','dc-eyebrow','COLLECTOR TO COLLECTOR'),el('span','dc-badge',model.trades.filter(t=>t.status==='pending').length+' pending offers'));node.prepend(header);
  let draft,unsubscribe,disposed=false,partnerOptions=[],counter=null,state,ownSearch='',partnerSearch='',ownLimit=24,partnerLimit=24;
  const composer=el('div','dc-trade-composer'),toolbar=el('div','dc-form-row'),choose=select(toolbar,'Trade with',[{id:'',name:'Choose a collector…'}]),recipientSearch=field(toolbar,'Find collector',{placeholder:'Search by display name'}),loadButton=button('Search',loadDirectory,'dc-quiet');toolbar.append(loadButton);
  const counterNotice=el('p','dc-accent'),error=el('p','dc-error');error.setAttribute('role','status');
  const board=el('div','dc-trade-board'),panes={};
  for(const side of ['give','receive']){
    const pane=el('section','dc-inventory-pane'),heading=el('h3','',side==='give'?'Your inventory':'Their inventory'),search=field(pane,side==='give'?'Search your cards':'Search their cards',{placeholder:'Name, rarity, line or tag'}),grid=el('div','dc-trade-inventory'),tray=el('div','dc-offer-tray'),money=el('div','dc-offer-money'),more=button('Show more cards',()=>{if(side==='give')ownLimit+=24;else partnerLimit+=24;renderState();},'dc-quiet');
    search.addEventListener('input',()=>{if(side==='give')ownSearch=search.value.toLowerCase();else partnerSearch=search.value.toLowerCase();renderState();});
    pane.prepend(heading);tray.setAttribute('aria-label',side==='give'?'Cards you offer':'Cards you request');tray.dataset.side=side;
    tray.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-dc-copy')){e.preventDefault();tray.classList.add('is-dragover');}});tray.addEventListener('dragleave',()=>tray.classList.remove('is-dragover'));
    tray.addEventListener('drop',e=>{e.preventDefault();tray.classList.remove('is-dragover');try{const item=JSON.parse(e.dataTransfer.getData('application/x-dc-copy'));if(item.side!==side)throw new Error('Add cards to the tray below their own inventory');draft.add(side,item.id);}catch(err){error.textContent=err.message;}});
    pane.append(grid,more,el('h4','',side==='give'?'You offer':'You request'),tray,money);board.append(pane);panes[side]={heading,grid,tray,more,money};
    for(const currency of model.catalog.currencies.filter(c=>model.catalog.features.currencyTrading&&c.tradable)){const input=field(money,(side==='give'?'Offer ':'Request ')+currency.name,{type:'number',value:'0'});input.min='0';input.step='1';input.dataset.currency=currency.id;
      input.addEventListener('input',()=>{try{input.setCustomValidity('');draft.setCurrency(side,currency.id,Number(input.value));error.textContent='';}catch(err){input.setCustomValidity(err.message);draft.review(false);error.textContent=err.message;confirm.disabled=send.disabled=true;}});}
  }
  const message=field(composer,'Message to the other collector',{type:'textarea',placeholder:'Add a note about this offer'});message.maxLength=500;message.rows=2;message.addEventListener('input',()=>draft?.setMessage(message.value));
  const review=el('label','dc-review-check'),confirm=el('input');confirm.type='checkbox';confirm.addEventListener('change',()=>{try{if([...composer.querySelectorAll('.dc-offer-money input')].some(input=>!input.reportValidity())){confirm.checked=false;throw new Error('Correct the currency amounts before reviewing');}draft.review(confirm.checked);}catch(err){error.textContent=err.message;}});review.append(confirm,el('span','','I reviewed both trays and the currency amounts.'));
  const summary=el('p','dc-trade-summary'),send=button('Send offer',()=>action(async()=>{const payload=draft.buildOffer();const result=counter?await mutate('counterTrade',{tradeId:counter.id,expectedDigest:counter.digest,give:payload.give,receive:payload.receive,message:payload.message}):await mutate('proposeTrade',payload);draft.clear();return result;},{message:'Offer sent. Your offered assets are reserved until acceptance, cancellation or expiry.'}));
  const reset=button('Clear draft',()=>draft.clear(),'dc-quiet');composer.prepend(toolbar,counterNotice,error,board);composer.append(summary,review,el('p','dc-muted','Offers expire after 24 hours. Your cards and offered currency are reserved; requested assets remain available until the other collector accepts.'),send,reset);
  if(enabled)node.append(composer);else node.append(el('p','dc-muted','This host has disabled new trades. Existing offers can still be cancelled.'));
  const list=el('div','dc-offer-list');node.append(el('h3','dc-subheading','Your offers'),list);
  const name=id=>model.catalog.currencies.find(c=>c.id===id)?.name??id;
  const snapshotCards=(trade,side)=>{const box=el('div','dc-snapshot-side');box.append(el('span','dc-eyebrow',side==='give'?'SENDER OFFERS':'SENDER REQUESTS'));const grid=el('div','dc-trade-snapshots');for(const id of trade[side].copyIds){const copy=trade.snapshots?.[id];if(copy)grid.append(cardRenderer(copy,{interactive:false,onSelect:inspect}));else grid.append(el('span','dc-badge','Card '+id.slice(0,8)));}box.append(grid);for(const amount of trade[side].currencies)box.append(el('p','',amount.amount.toLocaleString()+' '+name(amount.currencyId)));if(!trade[side].copyIds.length&&!trade[side].currencies.length)box.append(el('small','dc-muted','Nothing requested · gift'));return box;};
  for(const trade of model.trades.slice().reverse()){
    const offer=el('article','dc-trade-offer'),head=el('div','dc-row');head.append(el('span','dc-badge is-'+trade.status,trade.status),el('h3','',(trade.fromName??'Collector')+' → '+(trade.toName??'Collector')));offer.append(head);
    if(trade.message)offer.append(el('p','dc-offer-message',trade.message));const sides=el('div','dc-trade-columns');sides.append(snapshotCards(trade,'give'),snapshotCards(trade,'receive'));offer.append(sides);
    offer.append(el('small','dc-muted','Created '+new Date(trade.createdAt).toLocaleString()+' · Expires '+new Date(trade.expiresAt).toLocaleString()));
    if(trade.status==='pending'){
      const row=el('div','dc-row');if(enabled&&trade.toUserId===model.me.userId){
        const checkLabel=el('label','dc-review-check'),check=el('input');check.type='checkbox';checkLabel.append(check,el('span','','I reviewed this offer’s cards and amounts.'));offer.append(checkLabel);
        const accept=button('Accept exchange',()=>action(()=>mutate('acceptTrade',{tradeId:trade.id,expectedDigest:trade.digest}),{message:'Exchange complete. Cards and currency changed hands together.'}));accept.disabled=true;check.addEventListener('change',()=>accept.disabled=!check.checked);
        row.append(accept,button('Make counteroffer',()=>startDraft(trade),'dc-quiet'));
      }
      row.append(button(trade.fromUserId===model.me.userId?'Cancel offer':'Decline',()=>action(()=>mutate('cancelTrade',{tradeId:trade.id}),{message:'Offer closed. Reserved assets returned.'}),'dc-quiet'));offer.append(row);
    }list.append(offer);
  }
  if(!model.trades.length)list.append(el('div','dc-empty','Your next exchange starts here. Choose a collector above.'));

  async function loadDirectory(){try{const users=await client.directory({limit:200,search:recipientSearch.value});if(disposed)return;partnerOptions=users.items;const selected=choose.value||state?.recipientId;choose.replaceChildren();for(const u of [{id:'',name:'Choose a collector…'},...users.items]){const opt=el('option','',u.name+(u.inventoryVisible===false?' · private inventory':''));opt.value=u.id;choose.append(opt);}if(partnerOptions.some(u=>u.id===selected))choose.value=selected;}catch(err){if(!disposed)error.textContent=err.message;}}
  function startDraft(trade=null){unsubscribe?.();draft?.dispose();counter=trade;
    const recipient=trade?.fromUserId??choose.value;if(trade)choose.value=recipient;
    const inventoryClient={...client,tradeInventory:async(id,options)=>{try{return await client.tradeInventory(id,options);}catch(err){if(id!==model.me.userId&&model.catalog.features.currencyTrading&&[403,404].includes(err.status))return {owner:{id,name:partnerOptions.find(u=>u.id===id)?.name??'Collector',private:true},items:[],next:null,total:0};throw err;}}};
    draft=createTradeDraft({client:inventoryClient,userId:model.me.userId,catalog:model.catalog,storage:globalThis.sessionStorage,namespace:model.me.userId+(trade?':counter:'+trade.id:''),parentTradeId:trade?.id,
      initial:trade?{toUserId:trade.fromUserId,give:trade.receive,receive:trade.give,message:''}:undefined});
    unsubscribe=draft.subscribe(next=>{state=next;renderState();});counterNotice.textContent=trade?'Counteroffer: the original offer is replaced only when you send successfully.':'';draft.load(recipient||state.recipientId||null);composer.scrollIntoView({block:'nearest'});
  }
  function renderState(){if(disposed||!state)return;confirm.checked=state.reviewed;confirm.disabled=state.phase!=='ready'||!state.recipientId;send.disabled=!state.reviewed||!state.recipientId;send.textContent=counter?'Send counteroffer':'Send offer';error.textContent=state.error??'';
    if(document.activeElement!==message)message.value=state.message;
    summary.textContent=`You offer ${state.give.length} cards${state.giveCurrencies.map(c=>' + '+c.amount.toLocaleString()+' '+name(c.currencyId)).join('')} · You request ${state.receive.length} cards${state.receiveCurrencies.map(c=>' + '+c.amount.toLocaleString()+' '+name(c.currencyId)).join('')}${state.phase==='loading'?' · Loading inventories…':''}`;
    for(const side of ['give','receive']){const pane=panes[side],items=side==='give'?state.inventory:state.partnerInventory,search=side==='give'?ownSearch:partnerSearch,limit=side==='give'?ownLimit:partnerLimit;
      pane.heading.textContent=side==='give'?'Your inventory':(state.partner?.name??'Their')+' inventory';pane.grid.replaceChildren();pane.tray.replaceChildren();
      const filtered=items.filter(copy=>JSON.stringify([copy.definition.name,copy.rarityId,copy.lineId,copy.definition.tags]).toLowerCase().includes(search));
      for(const copy of filtered.slice(0,limit)){
        const tile=el('div','dc-trade-card'+(state[side].includes(copy.id)?' is-selected':'')),eligible=model.catalog.features.cardTrading&&(copy.tradable||counter&&copy.lockedBy===counter.id);tile.draggable=!!eligible;tile.dataset.copyId=copy.id;
        tile.addEventListener('dragstart',e=>{e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('application/x-dc-copy',JSON.stringify({side,id:copy.id}));});tile.append(cardRenderer(copy,{interactive:false,onSelect:inspect}));
        const add=button(state[side].includes(copy.id)?'In offer':'Add to offer',()=>{try{draft.add(side,copy.id);}catch(err){error.textContent=err.message;}},'dc-quiet');add.disabled=!eligible||state[side].includes(copy.id);tile.append(add);if(!eligible)tile.append(el('small','dc-muted',copy.untradableReason??'Reserved'));pane.grid.append(tile);
      }
      if(!filtered.length)pane.grid.append(el('p','dc-muted',state.phase==='loading'?'Loading…':side==='receive'&&state.partner?.private?'Private inventory. Currency offers are available.':'No matching cards.'));
      pane.more.hidden=filtered.length<=limit;
      if(state[side==='give'?'ownNext':'partnerNext'])pane.grid.append(button('Load next inventory page',()=>draft.more(side),'dc-quiet'));
      const selected=state[side==='give'?'selectedGive':'selectedReceive'];for(const copy of selected){const item=el('div','dc-tray-card');item.append(cardRenderer(copy,{interactive:false,onSelect:inspect}),button('Remove',()=>draft.remove(side,copy.id),'dc-quiet'));pane.tray.append(item);}if(!selected.length)pane.tray.append(el('p','dc-drop-hint','Drop cards here · or use Add to offer'));
      for(const input of pane.money.querySelectorAll('input'))if(document.activeElement!==input)input.value=String(state[side+'Currencies'].find(c=>c.currencyId===input.dataset.currency)?.amount??0);
    }
    const invalid=[...composer.querySelectorAll('.dc-offer-money input')].some(input=>!input.checkValidity());
    confirm.disabled=invalid||state.phase!=='ready'||!state.recipientId;send.disabled=confirm.disabled||!state.reviewed;
  }
  choose.addEventListener('change',()=>{ownLimit=partnerLimit=24;startDraft();});recipientSearch.addEventListener('keydown',e=>{if(e.key==='Enter')loadDirectory();});
  if(enabled){loadDirectory();startDraft();}
  return {node,dispose(){disposed=true;unsubscribe?.();draft?.dispose();}};
}
