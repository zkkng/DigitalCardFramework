import {el as element,section} from './ui-kit.js';
import {createLocalization} from './localization.js';
function button(label,action){const node=element('button','dc-button',label);node.type='button';node.addEventListener('click',action);return node;}
function field(parent,label,type='text',value=''){const wrap=element('label','dc-field'),input=element('input');input.type=type;input.value=value;wrap.append(element('span','',label),input);parent.append(wrap);return input;}

/** Shared disclosures preserve the native allocation/rate interpretation. */
export function shopProductInformation(model,product,localization=createLocalization()) {
 const t=localization.text,date=localization.date,rate=new Intl.NumberFormat(localization.locale,{minimumFractionDigits:1,maximumFractionDigits:1}).format,strategy=product.allocationStrategy;
 const deckVersion=strategy&&Object.keys(strategy).length===3&&strategy.deckScope==='purchase-slot'&&((strategy.algorithm==='weighted-deck@1'&&strategy.version===1)||(strategy.algorithm==='weighted-deck@2'&&strategy.version===2)||(strategy.algorithm==='weighted-deck@3'&&strategy.version===3)||(strategy.algorithm==='weighted-deck@4'&&strategy.version===4))?strategy.version:0,ticketDeck=deckVersion>0,count=product.slots.reduce((n,s)=>n+s.count,0);
 const cardsNote=t('shop.cardsPerPack',{count})+((!ticketDeck||deckVersion>=2)&&product.duplicatePolicy.scope!=='none'?t('shop.duplicateProtection'):'');
 const pityNote=product.pity?t(deckVersion>=2?'shop.pityPersonal':'shop.pityLegacy',{rarity:model.catalog.rarities.find(r=>r.id===product.pity.rarityId)?.name??product.pity.rarityId,after:product.pity.after,progress:model.pity[product.id]??0}):'';
 const duplicateNote=deckVersion>=2&&product.duplicatePolicy.scope!=='none'?[t(product.duplicatePolicy.scope==='inventory'?'shop.duplicatesInventory':'shop.duplicatesPack'),t('shop.inserts'),t(product.duplicatePolicy.fallback==='allow'?'shop.fallbackAllow':'shop.fallbackReject')].join(' '):'';
 const windowNote=(product.availableFrom?t('shop.availableFrom',{date:date(product.availableFrom)}):'')+(product.availableUntil?t('shop.availableUntil',{date:date(product.availableUntil)}):'');
 const explanation=ticketDeck?[t('shop.deckExplanation'),...(deckVersion>=2?[t('shop.conditionalTickets')]:[]),...(deckVersion>=3?[t('shop.codeSupply')]:[]),...(deckVersion>=4?[t('shop.feasibleTickets')]:[]),t('shop.quoteSupply')].join(' '):t('shop.baseRates');
 const ratesGroups=product.slots.map((slot,index)=>{const total=slot.pool.reduce((n,e)=>n+e.weight,0);return {slot:index,count:slot.count,label:t('shop.draws',{count:slot.count})+(ticketDeck?t('shop.poolTickets',{count:total}):':'),rows:slot.pool.map(entry=>{const variant=model.catalog.variants.find(v=>v.id===entry.variantId),card=model.catalog.cards.find(c=>c.id===variant.cardId),remaining=model.availability?.variants.find(v=>v.id===variant.id)?.remaining,supply=remaining!==undefined&&remaining!==null?t('shop.remaining',{count:remaining}):'',rarity=model.catalog.rarities.find(r=>r.id===variant.rarityId)?.name??'';return {weight:entry.weight,totalWeight:total,remaining:remaining??null,label:card.name+' · '+variant.rarityId+supply,publicLabel:card.name+' · '+rarity+supply,value:ticketDeck?t('shop.tickets',{count:entry.weight}):rate(entry.weight/total*100)+'%'};})};});
 return {deckVersion,ticketDeck,count,cardsNote,pityNote,duplicateNote,windowNote,explanation,ratesGroups,ratesSummary:t(ticketDeck?'shop.ticketsSummary':'shop.ratesSummary')};
}

/** The native shop retains its command runner and explicit payment/recovery controls. */
export function renderShop(model,context={}, {productId,quantity:initialQuantity,forceReview=false}={}) {
    const localization=context.localization??createLocalization(),t=localization.text,date=localization.date,rate=new Intl.NumberFormat(localization.locale,{minimumFractionDigits:1,maximumFractionDigits:1}).format;
    const client=context.client,commands=context.mutate,action=context.action,refresh=context.refresh;
    const currencyName=id=>model.catalog.currencies.find(c=>c.id===id)?.name??id, lineName=id=>model.catalog.lines.find(l=>l.id===id)?.name??id;
    const disposers=[],packArt=(product,small,onSelect)=>context.packArt?.(product,small,onSelect,undefined,fn=>disposers.push(fn))??element('div','dc-pack-art',product.name);
    let shopDisposed=false;const principal=context.getPrincipal?.()??model.me.userId;
    const current=()=>!shopDisposed&&node.isConnected&&(context.getPrincipal?.()??principal)===principal&&(context.isCurrentModel?.(model)??true)!==false&&(typeof client.principal!=='function'||client.principal()===principal);
    const fence=()=>{if(!current())throw new Error(t('shop.changedView'));};
    const node=section(t('shop.title'),t('shop.description'));
    const guide=element('div','dc-steps');
    for(const [n,title,description]of [['01','shop.stepBuy','shop.stepBuyDescription'],['02','shop.stepReveal','shop.stepRevealDescription'],['03','shop.stepCollect','shop.stepCollectDescription']]){const step=element('div');step.append(element('span','dc-step-number',n),element('strong','',t(title)),element('small','dc-muted',t(description)));guide.append(step);}node.append(guide);
    const grid=element('div','dc-shop-grid');
    for(const product of model.catalog.products.filter(p=>p.enabled!==false&&(!productId||p.id===productId))) {
      const box=element('article','dc-product');box.append(packArt(product,false,()=>{if(!shopDisposed&&(context.getPrincipal?.()??principal)===principal&&buy.isConnected)buy.focus();}));
      const information=shopProductInformation(model,product,localization),{deckVersion,ticketDeck}=information,info=element('div','dc-product-info');
      info.append(element('span','dc-eyebrow',lineName(product.lineId)),element('h3','',product.name.replace(/^.*? · /,'')),element('p','dc-muted',information.cardsNote));
      if(information.pityNote)info.append(element('p','dc-pity-note',information.pityNote));
      if(information.duplicateNote)info.append(element('p','dc-muted',information.duplicateNote));
      if(information.windowNote)info.append(element('small','dc-muted',information.windowNote));
      const details=element('details','dc-rates');details.append(element('summary','',information.ratesSummary));
      for(const group of information.ratesGroups){details.append(element('p','dc-muted',group.label));for(const item of group.rows){const row=element('div','dc-rate-row');row.append(element('span','',item.label),element('strong','',item.value));details.append(row);}}
      details.append(element('p','dc-muted',information.explanation));info.append(details);
      const purchase=element('div','dc-purchase-row'),quantity=field(purchase,t('shop.quantity'),'number',String(initialQuantity??1));quantity.min='1';quantity.max=String(product.maxQuantity);quantity.step='1';
      let pendingPurchase=commands.pending('purchase'),recover=pendingPurchase&&!pendingPurchase._confirmed&&pendingPurchase.productId===product.id,reviewedQuote=null,quoteGeneration=0,allocationState=null,allocationBlocked=false;
      const allocationNote=element('p','dc-muted');allocationNote.setAttribute('role','status');
      const activationNote=element('p','dc-binding-activation-note');activationNote.setAttribute('role','status');info.append(activationNote);
      function showActivation(quote){activationNote.textContent=quote?.bindingActivation?t('shop.activation',{count:quote.bindingActivation.maximum}):'';if(!ticketDeck&&quote?.bindingActivation&&!allocationNote.parentNode)info.append(allocationNote);}
      if(recover){quantity.value=String(pendingPurchase.quantity);quantity.disabled=true;}
      const buy=button('',async()=>{
        const focused=document.activeElement===buy,dialog=buy.closest('dialog');let moved=false,reviewGeneration,result;
        const onFocus=event=>{if(![buy,document.body,document.documentElement,dialog].includes(event.target))moved=true;},onPointer=()=>{moved=true;};
        if(focused){document.addEventListener('focusin',onFocus,true);document.addEventListener('pointerdown',onPointer,true);}
        try{result=await action(async()=>{
          fence();const current=++quoteGeneration,requestedQuantity=Number(quantity.value);
          try{
            const quote=recover?pendingPurchase:reviewedQuote??await client.quote({productId:product.id,quantity:requestedQuantity});fence();
            if(current!==quoteGeneration||requestedQuantity!==Number(quantity.value))throw new Error(t('shop.changedQuantity'));
            if((ticketDeck||forceReview||quote.bindingActivation)&&!recover&&!reviewedQuote){reviewedQuote=structuredClone(quote);reviewGeneration=current;showActivation(reviewedQuote);allocationNote.textContent=[t('shop.review',{count:quote.quantity,amount:quote.price.amount,currency:currencyName(quote.price.currencyId)}),...(deckVersion>=3?[t('shop.reviewCodeSupply')]:[]),...(deckVersion>=4?[t('shop.feasibleTickets')]:[]),t('shop.reviewAllocation')].join(' ');return {review:true,activation:!!reviewedQuote.bindingActivation};}
            if(!ticketDeck&&!recover&&(quote.price.currencyId!==product.price.currencyId||quote.price.amount!==product.price.amount*requestedQuantity)){await refresh();throw new Error(t('shop.changedPrice'));}
            const original=commands.pending('purchase');const receipt=await (!recover&&original?._confirmed?commands.beginNew('purchase',quote):recover?commands.recover('purchase',quote):commands('purchase',quote));fence();context.onPurchased?.();if(ticketDeck||forceReview)await refresh();return receipt;
          }catch(error){if(!shopDisposed){reviewedQuote=null;if(ticketDeck&&['ALLOCATION_STALE','ALLOCATION_PENDING'].includes(error.code)){allocationBlocked=true;allocationNote.textContent=t('allocation.needsReview');}}throw error;}
        },{refreshAfter:!ticketDeck&&!forceReview,message:r=>r.review?t(r.activation?'shop.reviewActivationReady':'shop.reviewReady'):t('shop.purchased',{count:r.packs.length})+(r.bindingActivation?' '+t('shop.activationDelivered',{count:r.bindingActivation.count}):'')});
        }finally{if(focused){document.removeEventListener('focusin',onFocus,true);document.removeEventListener('pointerdown',onPointer,true);}}
        if(!shopDisposed)update();
        // A disabled quote button can lose native focus while its reviewed quote is loading.
        if(result?.review&&focused&&!moved&&reviewGeneration===quoteGeneration&&current()&&!buy.disabled&&(!dialog||dialog.open&&buy.closest('dialog')===dialog)&&[document.body,document.documentElement,buy].includes(document.activeElement))buy.focus();
      });
      function update(){
        pendingPurchase=commands.pending('purchase');recover=pendingPurchase&&!pendingPurchase._confirmed&&pendingPurchase.productId===product.id;
        quantity.disabled=!!recover;
        const total=recover?pendingPurchase.price.amount:reviewedQuote?.price.amount??product.price.amount*Number(quantity.value),currency=recover?pendingPurchase.price.currencyId:reviewedQuote?.price.currencyId??product.price.currencyId,available=model.availability?.products.find(p=>p.id===product.id)?.available!==false;
        buy.textContent=available||recover?t(recover?'shop.retry':ticketDeck||forceReview||reviewedQuote?(reviewedQuote?'shop.buyReviewed':'shop.reviewButton'):'shop.buy',{amount:Number.isFinite(total)?total:'—',currency:currencyName(currency)}):t('shop.unavailable');
        showActivation(recover?pendingPurchase:reviewedQuote);
        buy.disabled=!recover&&(!available||allocationBlocked||!!pendingPurchase&&!pendingPurchase._confirmed||!Number.isInteger(Number(quantity.value))||Number(quantity.value)<1||Number(quantity.value)>product.maxQuantity||total>(model.wallet[currency]??0));
      }
      quantity.addEventListener('input',()=>{quoteGeneration++;reviewedQuote=null;allocationNote.textContent='';update();});update();purchase.append(buy);info.append(purchase);
      if(ticketDeck||forceReview)info.append(allocationNote);
      if(ticketDeck){
        if(typeof client.allocationStatus==='function'&&typeof client.acknowledgeAllocation==='function'){
          const recovery=element('div','dc-allocation-recovery'),attemptNote=element('p','dc-muted');attemptNote.setAttribute('role','status');
          const inspectAttempt=button(t('allocation.check'),async()=>{
            await action(async()=>{fence();const result=await client.allocationStatus({productId:product.id});fence();
              if(result.productId!==product.id||!['idle','prepared','stale','completed','acknowledged'].includes(result.state)||['prepared','stale','completed'].includes(result.state)&&typeof result.attemptId!=='string')throw new Error(t('allocation.invalidStatus'));
              allocationState=result;allocationBlocked=['prepared','stale'].includes(result.state);if(allocationBlocked){reviewedQuote=null;quoteGeneration++;}if(result.state==='acknowledged')await confirmOriginalFailure();showAttempt();return result;
            },{refreshAfter:false,message:t('allocation.checked')});if(!shopDisposed)update();
          });
          const acknowledge=button(t('allocation.acknowledge'),async()=>{
            await action(async()=>{fence();if(!allocationState||!['prepared','stale'].includes(allocationState.state))throw new Error(t('allocation.checkFirst'));
              const attemptId=allocationState.attemptId,result=await client.acknowledgeAllocation({attemptId});fence();if(result.attemptId!==attemptId||result.state!=='acknowledged')throw new Error(t('allocation.invalidAcknowledgement'));
              allocationState={...allocationState,state:'acknowledged',errorCode:null};allocationBlocked=false;reviewedQuote=null;quoteGeneration++;
              await confirmOriginalFailure();
              const original=commands.pending('purchase');showAttempt();return {...result,unresolved:!!original&&!original._confirmed};
            },{refreshAfter:false,message:result=>t(result.unresolved?'allocation.acknowledgedUnresolved':'allocation.acknowledged')});if(!shopDisposed)update();
          });
          async function confirmOriginalFailure(){const pending=commands.pending('purchase');if(pending&&pending.productId===product.id&&!pending._confirmed&&typeof commands.confirmFailed==='function'){await commands.confirmFailed('purchase',pending);fence();}}
          function showAttempt(){
            const state=allocationState?.state;acknowledge.hidden=!['prepared','stale'].includes(state);
            if(state==='completed')attemptNote.textContent=t('allocation.completed');
            else if(state==='prepared'||state==='stale')attemptNote.textContent=t(state==='stale'?'allocation.stale':'allocation.pending')+' '+t('allocation.abandon');
            else{const pending=commands.pending('purchase');attemptNote.textContent=t(pending&&!pending._confirmed?'allocation.retryOriginal':'allocation.freshReview');}
          }
          acknowledge.hidden=true;recovery.append(inspectAttempt,attemptNote,acknowledge);info.append(recovery);
        }
      }
      box.append(info);grid.append(box);
    }node.append(grid);return {node,dispose(){if(shopDisposed)return;shopDisposed=true;for(const cleanup of disposers.splice(0))cleanup();node.remove();}};
  }
