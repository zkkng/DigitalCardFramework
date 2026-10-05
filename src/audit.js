import { externalPurchaseDigest, externalPurchaseId, externalPurchaseIntent } from './external-purchases.js';

/** Read-only invariant checker used for startup, restored backups and operator diagnostics. */
export function auditState(s){
  const issues=[],add=(code,detail)=>issues.push({code,detail});
  if(!s.catalog)return {ok:false,issues:[{code:'NO_CATALOG',detail:'Publish a catalog before serving players'}]};
  for(const name of ['users','balances','copies','packs','supply','trades','albums','requests']){
    if(!s[name]||typeof s[name]!=='object'||Array.isArray(s[name])){add('STATE_SECTION_INVALID',name);s={...s,[name]:{}};}
  }
  for(const name of ['ledger','events'])if(!Array.isArray(s[name])){add('STATE_SECTION_INVALID',name);s={...s,[name]:[]};}
  const currencies=new Set(s.catalog.currencies.map(c=>c.id)),copies=Object.values(s.copies),counts={},serials=new Set();
  for(const copy of copies){counts[copy.variantId]=(counts[copy.variantId]??0)+1;if(!s.users[copy.ownerId])add('OWNER_MISSING',copy.id);if(!['sealed','owned','consumed'].includes(copy.state))add('COPY_STATE',copy.id);if(copy.serialNumber!==null){const key=copy.variantId+':'+copy.serialNumber;if(serials.has(key)||!Number.isInteger(copy.serialNumber)||copy.serialNumber<1||copy.serialNumber>copy.editionTotal)add('SERIAL_INVALID',copy.id);serials.add(key);}if(copy.lockedBy?.startsWith('market:')){const listing=s.listings?.[copy.lockedBy.slice(7)];if(!listing||listing.status!=='active'||listing.sellerId!==copy.ownerId||!listing.units.some(u=>u.status==='available'&&(u.copyId===copy.id||s.packs[u.packId]?.copyIds.includes(copy.id))))add('ORPHAN_MARKET_LOCK',copy.id);}else if(copy.lockedBy){const trade=s.trades[copy.lockedBy];if(!trade||trade.status!=='pending'||trade.fromUserId!==copy.ownerId||!trade.give.copyIds.includes(copy.id))add('ORPHAN_LOCK',copy.id);}}
  for(const variant of s.catalog.variants){if((counts[variant.id]??0)!==(s.supply[variant.id]??0))add('SUPPLY_MISMATCH',variant.id);if(variant.supplyLimit!==undefined&&(s.supply[variant.id]??0)>variant.supplyLimit)add('SUPPLY_EXCEEDED',variant.id);}
  auditBalances(s,currencies,add);
  for(const trade of Object.values(s.trades))if(trade.status==='pending')for(const copyId of trade.give.copyIds){const c=s.copies[copyId];if(!c||c.ownerId!==trade.fromUserId||c.state!=='owned'||c.lockedBy!==trade.id)add('ESCROW_INVALID',trade.id+':'+copyId);}
  for(const album of Object.values(s.albums)){const seen=new Set();for(const p of album.placements){const c=s.copies[p.copyId];if(seen.has(p.copyId)||!c||c.ownerId!==album.ownerId||c.state!=='owned')add('ALBUM_INVALID',album.id+':'+p.copyId);seen.add(p.copyId);}}
  const credits=new Map();
  for(const entry of s.ledger)if(entry.type==='external-credit'){const list=credits.get(entry.reference)??[];list.push(entry);credits.set(entry.reference,list);}
  for(const [token,settlement]of Object.entries(s.externalSettlements??{})){
    const rows=credits.get(token)??[],r=settlement.result;
    if(rows.length!==1||!r||rows[0].userId!==r.userId||rows[0].currencyId!==r.currencyId||rows[0].delta!==r.amount||rows[0].balance!==r.balance)add('SETTLEMENT_LEDGER_MISMATCH',token);
    credits.delete(token);
  }
  for(const token of credits.keys())add('SETTLEMENT_RECEIPT_MISSING',token);
  const codePrints=new Set(),assignedCodes=new Set();
  for(const copy of copies){
    for(const codeId of copy.codeIds??[]){const row=s.codes?.[codeId];if(assignedCodes.has(codeId)||!row||row.copyId!==copy.id)add('CODE_ASSIGNMENT_INVALID',copy.id);assignedCodes.add(codeId);}
    if(copy.provenance){const p=copy.provenance;if(p.type==='pack'){const pack=s.packs[p.packId];if(!pack||!pack.copyIds.includes(copy.id)||p.productId!==pack.productId||p.catalogVersion!==pack.catalogVersion||p.position!==pack.copyIds.indexOf(copy.id))add('PROVENANCE_INVALID',copy.id);}}
  }
  for(const row of Object.values(s.codes??{})){
    if(codePrints.has(row.fingerprint))add('CODE_DUPLICATE',row.id);codePrints.add(row.fingerprint);
    if(!s.codePools?.[row.poolId]||s.codePools[row.poolId].providerId!==row.providerId)add('CODE_POOL_INVALID',row.id);
    if(!['available','allocated','redeemed','revoked'].includes(row.status)||row.secret?.version!==1||!row.secret.keyId)add('CODE_STATE_INVALID',row.id);
    if(row.copyId&&row.status==='available'||row.status==='redeemed'&&!row.redeemedAt||row.status==='revoked'&&!row.revokedAt)add('CODE_LIFECYCLE_INVALID',row.id);
    if(row.copyId){const copy=s.copies[row.copyId];if(!copy||!assignedCodes.has(row.id)||!s.users[row.holderId])add('CODE_HOLDER_INVALID',row.id);if(row.transfer==='follow-unrevealed'&&copy?.ownerId!==row.holderId)add('CODE_FOLLOW_INVALID',row.id);}
    else if(row.holderId||row.status==='allocated')add('CODE_ALLOCATION_INVALID',row.id);
    if(row.revealedAt&&!row.revealedBy||row.reportedUsed&&!row.revealedAt)add('CODE_DISCLOSURE_INVALID',row.id);
  }
  for(const proof of Object.values(s.codeConfirmations??{})){const row=s.codes?.[proof.codeId];if(!row||row.providerId!==proof.providerId||row.status!==proof.status)add('CODE_CONFIRMATION_INVALID',proof.codeId);}
  const listed=new Set();
  for(const l of Object.values(s.listings??{})){
    if(!s.shops?.[l.shopId]||!s.users[l.sellerId])add('LISTING_SHOP_INVALID',l.id);
    for(const unit of l.units){if(unit.status==='available'&&l.status==='active'&&unit.kind!=='action'){const key=unit.copyId??unit.packId;if(listed.has(key))add('STOCK_DUPLICATE',l.id);listed.add(key);const item=unit.kind==='copy'?s.copies[unit.copyId]:s.packs[unit.packId];if(item?.ownerId!==l.sellerId||item?.lockedBy!=='market:'+l.id)add('STOCK_RESERVATION_INVALID',l.id);}if(unit.status==='sold'&&!s.orders?.[unit.orderId]?.unitIds.includes(unit.id))add('STOCK_ORDER_INVALID',l.id);}
    if(l.draw){const winners=new Set(),units=new Set();for(const w of l.draw.winners){if(winners.has(w.userId)||units.has(w.unitId)||!l.entries[w.userId]||!l.units.some(u=>u.id===w.unitId))add('RAFFLE_WINNER_INVALID',l.id);winners.add(w.userId);units.add(w.unitId);}}
  }
  for(const o of Object.values(s.orders??{})){const l=s.listings?.[o.listingId];if(!l||!s.users[o.buyerId]||!s.users[o.sellerId]||o.quantity!==o.unitIds.length||o.paid.amount!==l.price.amount*o.quantity)add('ORDER_INVALID',o.id);const entries=s.ledger.filter(e=>e.reference===o.id),debits=entries.filter(e=>e.type==='shop.purchase').reduce((n,e)=>n+e.delta,0),credits=entries.filter(e=>e.type==='shop.proceeds').reduce((n,e)=>n+e.delta,0);if(debits!==-o.paid.amount||credits!==o.paid.amount)add('ORDER_LEDGER_INVALID',o.id);for(const id of o.actionJobIds)if(s.actionJobs?.[id]?.source.orderId!==o.id)add('ORDER_ACTION_INVALID',o.id);}
  for(const job of Object.values(s.actionJobs??{})){if(!['pending','running','succeeded','dead'].includes(job.status)||!Number.isInteger(job.attempts)||job.attempts<0||job.userId&&!s.users[job.userId]||job.status==='running'&&(!job.leaseToken||!job.leaseUntil))add('ACTION_JOB_INVALID',job.id);}
  const identities=new Set();for(const u of Object.values(s.users)){const identity=JSON.stringify([u.provider,u.subject]);if(identities.has(identity))add('IDENTITY_DUPLICATE',u.id);identities.add(identity);}
  auditRelationships(s,add);
  auditExternalPurchases(s,add);
  return {ok:issues.length===0,issues,revision:s.revision,counts:{users:Object.keys(s.users).length,copies:copies.length,packs:Object.keys(s.packs).length,trades:Object.keys(s.trades).length,events:s.events.length}};
}

const own = (object,key) => Boolean(object && Object.hasOwn(object,key));
const accountKey = (userId,currencyId) => JSON.stringify([userId,currencyId]);

function auditBalances(s,currencies,add) {
  const balances=new Map(),seen=new Set();
  for(const entry of s.ledger){
    const key=accountKey(entry.userId,entry.currencyId),amount=(balances.get(key)?.amount??0)+entry.delta;
    if(seen.has(entry.id))add('LEDGER_DUPLICATE',entry.id);seen.add(entry.id);
    if(!own(s.users,entry.userId))add('LEDGER_USER_MISSING',entry.id);
    if(!currencies.has(entry.currencyId))add('LEDGER_CURRENCY_MISSING',entry.id);
    if(!Number.isSafeInteger(entry.delta)||!Number.isSafeInteger(amount)||amount!==entry.balance||!Number.isSafeInteger(entry.balance)||entry.balance<0)add('LEDGER_MISMATCH',entry.id);
    balances.set(key,{userId:entry.userId,currencyId:entry.currencyId,amount});
  }
  for(const userId of Object.keys(s.users))if(!own(s.balances,userId))add('WALLET_MISSING',userId);
  for(const [userId,wallet]of Object.entries(s.balances)){
    if(!own(s.users,userId))add('WALLET_USER_MISSING',userId);
    if(!wallet||typeof wallet!=='object'||Array.isArray(wallet)){add('WALLET_INVALID',userId);continue;}
    for(const [currencyId,amount]of Object.entries(wallet))if(!currencies.has(currencyId)||!Number.isSafeInteger(amount)||amount<0||amount!==(balances.get(accountKey(userId,currencyId))?.amount??0))add('BALANCE_INVALID',userId+':'+currencyId);
  }
  // Check the ledger's accounts too: deleting even a zero balance must be visible.
  for(const {userId,currencyId,amount}of balances.values()){
    const wallet=s.balances[userId];
    if(!own(wallet,currencyId))add('BALANCE_MISSING',userId+':'+currencyId);
    else if(wallet[currencyId]!==amount)add('BALANCE_INVALID',userId+':'+currencyId);
  }
}

function auditRelationships(s,add) {
  const variants=new Map(s.catalog.variants.map(v=>[v.id,v])),cards=new Map(s.catalog.cards.map(c=>[c.id,c]));
  for(const name of ['users','copies','packs','trades','albums','codes','codePools','shops','listings','orders','actionJobs']){
    for(const [key,row]of Object.entries(s[name]??{}))if(row.id!==key)add('RECORD_ID_MISMATCH',name+':'+key);
  }
  for(const [variantId,amount]of Object.entries(s.supply))if(!variants.has(variantId)||!Number.isSafeInteger(amount)||amount<0)add('SUPPLY_INVALID',variantId);
  const packCopies=new Set();
  for(const pack of Object.values(s.packs)){
    if(!own(s.users,pack.ownerId))add('PACK_OWNER_MISSING',pack.id);
    if(!Array.isArray(pack.copyIds)){add('PACK_CONTENTS_INVALID',pack.id);continue;}
    if(pack.product&&(pack.product.id!==pack.productId||pack.product.revision!==pack.productRevision))add('PACK_PRODUCT_INVALID',pack.id);
    const seen=new Set();
    for(const copyId of pack.copyIds){
      const copy=s.copies[copyId];
      if(seen.has(copyId)||packCopies.has(copyId)||!copy||copy.source?.type!=='pack'||copy.source.packId!==pack.id)add('PACK_COPY_INVALID',pack.id+':'+copyId);
      seen.add(copyId);packCopies.add(copyId);
      if(copy&&!pack.openedAt&&(copy.state!=='sealed'||copy.ownerId!==pack.ownerId))add('SEALED_PACK_INVALID',pack.id+':'+copyId);
      if(copy&&pack.openedAt&&copy.state==='sealed')add('OPEN_PACK_INVALID',pack.id+':'+copyId);
    }
    if(Boolean(pack.openedAt)!==Boolean(pack.receipt))add('PACK_RECEIPT_INVALID',pack.id);
    if(pack.receipt){
      const ids=pack.receipt.cards?.map(c=>c.id);
      if(pack.receipt.id!==pack.id||pack.receipt.openedAt!==pack.openedAt||!ids||JSON.stringify(ids)!==JSON.stringify(pack.copyIds))add('PACK_RECEIPT_INVALID',pack.id);
    }
    if(pack.lockedBy){
      const listing=typeof pack.lockedBy==='string'&&pack.lockedBy.startsWith('market:')?s.listings?.[pack.lockedBy.slice(7)]:null;
      if(!listing||listing.status!=='active'||listing.sellerId!==pack.ownerId||!listing.units.some(u=>u.kind==='pack'&&u.packId===pack.id&&u.status==='available'))add('ORPHAN_PACK_LOCK',pack.id);
    }
  }
  for(const copy of Object.values(s.copies)){
    const variant=variants.get(copy.variantId),card=cards.get(copy.cardId);
    if(!variant||!card||variant.cardId!==copy.cardId||variant.rarityId!==copy.rarityId||card.lineId!==copy.lineId)add('COPY_CATALOG_INVALID',copy.id);
    if(copy.source?.type==='pack'&&!packCopies.has(copy.id))add('COPY_PACK_MISSING',copy.id);
    if(copy.state==='sealed'&&(!copy.source?.packId||!s.packs[copy.source.packId]||s.packs[copy.source.packId].openedAt))add('SEALED_COPY_INVALID',copy.id);
    for(const jobId of copy.actionJobIds??[])if(s.actionJobs?.[jobId]?.source.copyId!==copy.id)add('COPY_ACTION_INVALID',copy.id);
  }
  for(const album of Object.values(s.albums))if(!own(s.users,album.ownerId))add('ALBUM_OWNER_MISSING',album.id);

  const purchases=new Map();
  for(const [key,request]of Object.entries(s.requests)){
    if(!request||typeof request.hash!=='string'||!own(request,'result')){add('REQUEST_INVALID',key);continue;}
    const result=request.result;
    if(!result||!Array.isArray(result.packs)||!result.paid||typeof result.id!=='string')continue;
    if(purchases.has(result.id)&&JSON.stringify(purchases.get(result.id))!==JSON.stringify(result))add('PURCHASE_RECEIPT_CONFLICT',result.id);
    purchases.set(result.id,result);
    const ids=new Set();
    for(const snapshot of result.packs){
      const pack=s.packs[snapshot.id];
      if(ids.has(snapshot.id)||!pack||pack.purchaseId!=null&&pack.purchaseId!==result.id||snapshot.purchaseId!=null&&snapshot.purchaseId!==result.id||pack.productId!==snapshot.productId||pack.productRevision!==snapshot.productRevision||pack.catalogVersion!==snapshot.catalogVersion)add('PURCHASE_PACK_INVALID',result.id);
      ids.add(snapshot.id);
    }
  }
  const externalFunding=new Set();
  for(const row of Object.values(s.externalPurchases??{}))if(row?.state==='fulfilled'&&row.purchase){
    if(!Array.isArray(row.purchase.packs)||!row.purchase.paid||typeof row.purchase.id!=='string'){add('EXTERNAL_PURCHASE_INVALID',row.preparationId);continue;}
    if(!purchases.has(row.purchase.id))externalFunding.add(row.purchase.id);
    else if(JSON.stringify(purchases.get(row.purchase.id))!==JSON.stringify(row.purchase))add('PURCHASE_RECEIPT_CONFLICT',row.purchase.id);
    purchases.set(row.purchase.id,row.purchase);
  }
  const purchaseLedger=new Map();
  for(const entry of s.ledger)if(entry.type==='purchase'){
    const rows=purchaseLedger.get(entry.reference)??[];rows.push(entry);purchaseLedger.set(entry.reference,rows);
    if(!purchases.has(entry.reference))add('PURCHASE_RECEIPT_MISSING',entry.reference);
  }
  for(const [id,purchase]of purchases){
    const rows=purchaseLedger.get(id)??[];
    if(externalFunding.has(id)){if(rows.length)add('PURCHASE_FUNDING_CONFLICT',id);}
    else if(rows.length!==1||rows[0].delta!==-purchase.paid.amount||rows[0].currencyId!==purchase.paid.currencyId||purchase.packs.some(p=>p.ownerId!==rows[0]?.userId))add('PURCHASE_LEDGER_INVALID',id);
  }
  for(const pack of Object.values(s.packs))if(pack.purchaseId&&!purchases.get(pack.purchaseId)?.packs.some(p=>p.id===pack.id))add('PACK_PURCHASE_MISSING',pack.id);
  auditEscrow(s,add);

  const codeReferences=new Set();
  for(const row of Object.values(s.codes??{})){
    if(row.externalId!=null){const ref=JSON.stringify([row.providerId,row.externalId]);if(codeReferences.has(ref))add('CODE_EXTERNAL_ID_DUPLICATE',row.id);codeReferences.add(ref);}
    if(row.copyId&&(!row.allocatedAt||!s.copies[row.copyId]?.codeIds?.includes(row.id)))add('CODE_ALLOCATION_INVALID',row.id);
    if(row.holderId&&!own(s.users,row.holderId))add('CODE_HOLDER_INVALID',row.id);
    if(row.revealedBy&&!own(s.users,row.revealedBy))add('CODE_DISCLOSURE_INVALID',row.id);
    for(const userId of row.holderHistory??[])if(!own(s.users,userId))add('CODE_HOLDER_HISTORY_INVALID',row.id);
  }
  for(const [token,request]of Object.entries(s.codeRequests??{})){
    const result=request.result;
    if(result?.codeId&&!own(s.codes,result.codeId))add('CODE_REQUEST_INVALID',token);
    if(result?.batchId&&Array.isArray(result.ids)&&result.ids.some(id=>s.codes?.[id]?.batchId!==result.batchId))add('CODE_BATCH_RECEIPT_INVALID',token);
  }
  const events=new Map(),sequences=new Set(),deliveries=new Set();
  for(const event of s.events){
    if(events.has(event.id)||sequences.has(event.sequence)||!Number.isSafeInteger(event.sequence)||event.sequence<1)add('EVENT_IDENTITY_INVALID',event.id);
    events.set(event.id,event);sequences.add(event.sequence);
  }
  for(const job of Object.values(s.actionJobs??{})){
    const source=job.source??{};
    if(source.type==='event'){
      const event=events.get(source.eventId),key=JSON.stringify([source.eventId,source.subscriptionId]);
      if(!event||JSON.stringify(job.params?.event)!==JSON.stringify(event))add('ACTION_EVENT_INVALID',job.id);
      if(deliveries.has(key))add('ACTION_EVENT_DUPLICATE',job.id);deliveries.add(key);
    }
    if(source.type==='card.opened'&&(!s.copies[source.copyId]?.actionJobIds?.includes(job.id)||!own(s.users,job.userId)))add('ACTION_COPY_INVALID',job.id);
    if(source.type==='shop.purchased'&&!s.orders?.[source.orderId]?.actionJobIds?.includes(job.id))add('ACTION_ORDER_INVALID',job.id);
  }
  for(const listing of Object.values(s.listings??{})){
    const unitIds=new Set();
    for(const unit of listing.units){
      if(unitIds.has(unit.id))add('STOCK_UNIT_DUPLICATE',listing.id);unitIds.add(unit.id);
      if(unit.status==='sold'&&s.orders?.[unit.orderId]?.listingId!==listing.id)add('STOCK_ORDER_INVALID',listing.id);
      if(unit.kind==='pack'&&unit.status==='available'&&listing.status==='active')for(const copyId of s.packs[unit.packId]?.copyIds??[])if(s.copies[copyId]?.lockedBy!=='market:'+listing.id)add('STOCK_CONTENTS_INVALID',listing.id);
    }
  }
  for(const order of Object.values(s.orders??{})){
    const listing=s.listings?.[order.listingId],ids=new Set();
    for(const id of order.unitIds){const unit=listing?.units.find(u=>u.id===id);if(ids.has(id)||!unit||unit.status!=='sold'||unit.orderId!==order.id)add('ORDER_STOCK_INVALID',order.id);ids.add(id);}
    const rows=s.ledger.filter(e=>e.reference===order.id&&['shop.purchase','shop.proceeds'].includes(e.type));
    if(rows.length!==2||!rows.some(e=>e.type==='shop.purchase'&&e.userId===order.buyerId&&e.currencyId===order.paid.currencyId&&e.delta===-order.paid.amount)||!rows.some(e=>e.type==='shop.proceeds'&&e.userId===order.sellerId&&e.currencyId===order.paid.currencyId&&e.delta===order.paid.amount))add('ORDER_LEDGER_INVALID',order.id);
  }
  for(const row of s.ledger)if(['shop.purchase','shop.proceeds'].includes(row.type)&&!own(s.orders,row.reference))add('ORDER_RECEIPT_MISSING',row.reference);
}

function auditEscrow(s,add){
  const byTrade=new Map(),liabilities=new Map();
  for(const row of s.ledger)if(['trade.escrow','trade.refund','trade'].includes(row.type)){
    if(!own(s.trades,row.reference))add('TRADE_RECEIPT_MISSING',row.reference);
    const rows=byTrade.get(row.reference)??[];rows.push(row);byTrade.set(row.reference,rows);
  }
  const signature=row=>JSON.stringify([row.userId,row.currencyId,row.type,row.delta]);
  for(const trade of Object.values(s.trades)){
    if(!own(s.users,trade.fromUserId)||!own(s.users,trade.toUserId)||trade.fromUserId===trade.toUserId)add('TRADE_USER_INVALID',trade.id);
    if(!['pending','accepted','cancelled','declined','expired','countered'].includes(trade.status))add('TRADE_STATE_INVALID',trade.id);
    const expected=[];
    for(const money of trade.give.currencies){
      expected.push({userId:trade.fromUserId,currencyId:money.currencyId,type:'trade.escrow',delta:-money.amount});
      if(trade.status==='pending'){
        const key=accountKey(trade.fromUserId,money.currencyId),old=liabilities.get(key)??{userId:trade.fromUserId,currencyId:money.currencyId,amount:0};
        old.amount+=money.amount;liabilities.set(key,old);
      }else expected.push({userId:trade.status==='accepted'?trade.toUserId:trade.fromUserId,currencyId:money.currencyId,type:trade.status==='accepted'?'trade':'trade.refund',delta:money.amount});
    }
    if(trade.status==='accepted')for(const money of trade.receive.currencies){
      expected.push({userId:trade.toUserId,currencyId:money.currencyId,type:'trade',delta:-money.amount},{userId:trade.fromUserId,currencyId:money.currencyId,type:'trade',delta:money.amount});
    }
    if(JSON.stringify(expected.map(signature).sort())!==JSON.stringify((byTrade.get(trade.id)??[]).map(signature).sort()))add('ESCROW_LEDGER_INVALID',trade.id);
  }
  for(const {userId,currencyId,amount}of liabilities.values())if(!Number.isSafeInteger(amount+(s.balances[userId]?.[currencyId]??0)))add('ESCROW_HEADROOM_INVALID',userId+':'+currencyId);
}

function auditExternalPurchases(s,add){
  const records=s.externalPurchases??{},proofs=s.externalPurchaseProofs??{},keys=s.externalPurchaseKeys??{};
  const pending=new Set(['prepared','refund_required','quarantined']),terminal=new Set(['fulfilled','cancelled','compensated']);
  const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const indexedProofs=new Map(),indexedKeys=new Set(),purchaseIds=new Set(),reversedCredits=new Map(),resolutionTokens=new Set();
  for(const entry of s.ledger)if(entry.type==='external-credit-reversed'){
    const rows=reversedCredits.get(entry.reference)??[];rows.push(entry);reversedCredits.set(entry.reference,rows);
  }
  for(const [token,proof]of Object.entries(proofs)){
    if(!proof||typeof proof!=='object'){add('EXTERNAL_PROOF_INVALID',token);continue;}
    const row=records[proof.preparationId],identity=JSON.stringify([proof.preparationId,proof.kind]);
    if(!hex(token)||!hex(proof.hash)||!['debit','no_debit','refund'].includes(proof.kind)||!row||row.proofHashes?.[proof.kind]!==proof.hash)add('EXTERNAL_PROOF_INVALID',token);
    if(indexedProofs.has(identity))add('EXTERNAL_PROOF_DUPLICATE',token);indexedProofs.set(identity,{token,...proof});
  }
  for(const [token,key]of Object.entries(keys)){
    if(!key||typeof key!=='object'){add('EXTERNAL_KEY_INVALID',token);continue;}
    if(!hex(token)||!records[key.preparationId]||records[key.preparationId].fingerprint!==key.fingerprint)add('EXTERNAL_KEY_INVALID',token);
    indexedKeys.add(key.preparationId);
  }
  for(const [id,row]of Object.entries(records)){
    if(!row||typeof row!=='object'){add('EXTERNAL_IDENTITY_INVALID',id);continue;}
    let validTerms=true;
    try{
      if(row.terms?.version!==1||externalPurchaseDigest(row.terms)!==row.fingerprint||externalPurchaseDigest(externalPurchaseIntent(row.terms))!==row.fingerprint||row.preparationId!==externalPurchaseId(row.terms.providerId,row.terms.transactionId)||id!==row.preparationId)validTerms=false;
    }catch{validTerms=false;}
    if(!validTerms){add('EXTERNAL_IDENTITY_INVALID',id);continue;}
    const terms=row.terms,quote=terms.quote;
    if(!own(s.users,terms.userId)||!s.catalog.currencies.some(c=>c.id===quote.price.currencyId))add('EXTERNAL_ACCOUNT_INVALID',id);
    if(!pending.has(row.state)&&!terminal.has(row.state))add('EXTERNAL_STATE_INVALID',id);
    if(!date(row.preparedAt)||!Number.isSafeInteger(row.completionBytes)||row.completionBytes<0||pending.has(row.state)&&row.completionBytes===0||terminal.has(row.state)&&row.completionBytes!==0)add('EXTERNAL_RESERVATION_INVALID',id);
    if(!indexedKeys.has(id))add('EXTERNAL_KEY_MISSING',id);
    for(const [kind,hash]of Object.entries(row.proofHashes??{}))if(!hex(hash)||indexedProofs.get(JSON.stringify([id,kind]))?.hash!==hash)add('EXTERNAL_PROOF_MISSING',id);
    const kinds=Object.keys(row.proofHashes??{}).sort();
    const expected=row.state==='prepared'?[]:row.state==='cancelled'?['no_debit']:row.state==='compensated'?['debit','refund']:['debit'];
    if(JSON.stringify(kinds)!==JSON.stringify(expected))add('EXTERNAL_PROOF_STATE_INVALID',id);
    for(const kind of kinds){
      const reference=row.proofReferences?.[kind],index=indexedProofs.get(JSON.stringify([id,kind]));
      const proof={kind,reference,providerId:terms.providerId,transactionId:terms.transactionId,userId:terms.userId,externalCurrency:terms.externalCurrency,externalUnits:terms.externalUnits,fingerprint:row.fingerprint,...(kind==='refund'?{compensationId:row.compensationId,debitReference:row.debitReference}:{})};
      if(typeof reference!=='string'||!reference.trim()||Array.from(reference).length>128||/[\u0000-\u001f\u007f]/.test(reference)||externalPurchaseDigest(proof)!==row.proofHashes[kind]||index?.token!==externalPurchaseDigest({providerId:terms.providerId,reference}))add('EXTERNAL_PROOF_REFERENCE_INVALID',id);
    }
    if(Object.keys(row.proofReferences??{}).some(kind=>!kinds.includes(kind)))add('EXTERNAL_PROOF_REFERENCE_INVALID',id);
    if(row.proofHashes?.debit){
      const proof={kind:'debit',reference:row.debitReference,providerId:terms.providerId,transactionId:terms.transactionId,userId:terms.userId,externalCurrency:terms.externalCurrency,externalUnits:terms.externalUnits,fingerprint:row.fingerprint};
      const index=indexedProofs.get(JSON.stringify([id,'debit']));
      if(typeof row.debitReference!=='string'||externalPurchaseDigest(proof)!==row.proofHashes.debit||index?.token!==externalPurchaseDigest({providerId:terms.providerId,reference:row.debitReference}))add('EXTERNAL_DEBIT_INVALID',id);
    }
    if(row.state==='prepared'){
      const snapshot=row.snapshot;
      if(!snapshot||snapshot.catalog?.version!==quote.catalogVersion||snapshot.product?.id!==quote.productId||snapshot.product?.revision!==quote.productRevision||snapshot.product?.price?.currencyId!==quote.price.currencyId||snapshot.product?.price?.amount*quote.quantity!==quote.price.amount)add('EXTERNAL_SNAPSHOT_INVALID',id);
    }
    if((row.state==='fulfilled')!==Boolean(row.purchase))add('EXTERNAL_DELIVERY_STATE_INVALID',id);
    if(row.purchase){
      const purchase=row.purchase;
      if(purchaseIds.has(purchase.id))add('EXTERNAL_DELIVERY_DUPLICATE',id);purchaseIds.add(purchase.id);
      if(!date(row.fulfilledAt)||purchase.paid?.currencyId!==quote.price.currencyId||purchase.paid?.amount!==quote.price.amount||!Array.isArray(purchase.packs)||purchase.packs.length!==quote.quantity)add('EXTERNAL_PURCHASE_INVALID',id);
      const packIds=new Set();
      for(const view of Array.isArray(purchase.packs)?purchase.packs:[]){
        const pack=s.packs[view.id];
        // Old receipts may predate purchaseId fields; retained pack identity is still required.
        if(packIds.has(view.id)||!pack||pack.purchaseId!=null&&pack.purchaseId!==purchase.id||view.ownerId!==terms.userId||view.productId!==quote.productId||view.productRevision!==quote.productRevision||view.catalogVersion!==quote.catalogVersion)add('EXTERNAL_PACK_INVALID',id);
        packIds.add(view.id);
      }
    }
    if(['refund_required','compensated'].includes(row.state)&&(!date(row.refundRequiredAt)||!row.failureCode||row.compensationId!=='ec_'+externalPurchaseDigest({preparationId:id,fingerprint:row.fingerprint})))add('EXTERNAL_COMPENSATION_INVALID',id);
    if(row.state==='compensated'&&!date(row.compensatedAt)||row.state==='cancelled'&&!date(row.cancelledAt)||row.state==='quarantined'&&(!date(row.quarantinedAt)||!row.failureCode||!row.legacy))add('EXTERNAL_TERMINAL_INVALID',id);
    const reversals=reversedCredits.get(id)??[];
    if(row.legacy?.reversedCredit){
      const token=externalPurchaseDigest({providerId:terms.providerId,transactionId:terms.transactionId}),settlement=s.externalSettlements?.[token];
      if(!settlement||reversals.length!==1||reversals[0].userId!==terms.userId||reversals[0].currencyId!==quote.price.currencyId||reversals[0].delta!==-quote.price.amount)add('EXTERNAL_REVERSAL_INVALID',id);
    }else if(reversals.length)add('EXTERNAL_REVERSAL_INVALID',id);
    const resolutionKey=row.legacy?.resolutionPurchaseKey,resolutionSlots=row.completionRequests??0;
    if(!Number.isInteger(resolutionSlots)||resolutionSlots<0||resolutionSlots>1||resolutionSlots===1&&(row.state!=='quarantined'||row.failureCode!=='LEGACY_CREDIT_SPENT'||!resolutionKey)||resolutionKey!==undefined&&(typeof resolutionKey!=='string'||!resolutionKey.trim()||Array.from(resolutionKey).length>128||/[\u0000-\u001f\u007f]/.test(resolutionKey)||row.legacy.reversedCredit||row.state==='quarantined'&&resolutionSlots!==1||row.state!=='quarantined'&&!row.legacyResolution))add('EXTERNAL_RESOLUTION_RESERVATION_INVALID',id);
    if(row.state==='quarantined'&&resolutionSlots===1&&typeof resolutionKey==='string')auditLegacyAdoption(s,row,resolutionKey,s.requests[terms.userId+':'+resolutionKey]?.result,add);
    if(row.legacyResolution)auditLegacyResolution(s,row,add,resolutionTokens);
    else if(row.state==='fulfilled'&&row.quarantinedAt)add('EXTERNAL_RESOLUTION_MISSING',id);
  }
  for(const token of Object.keys(s.operatorRequests??{}))if(token.startsWith('external-resolution:')&&!resolutionTokens.has(token))add('EXTERNAL_RESOLUTION_ORPHAN',token);
  for(const copy of Object.values(s.copies)){
    const id=copy.source?.externalPreparationId;
    if(id&&(!records[id]||records[id].state!=='fulfilled'||records[id].purchase?.id!==copy.source.purchaseId))add('EXTERNAL_COPY_INVALID',copy.id);
  }
  for(const row of s.ledger)if(row.type==='external-credit-reversed'&&!records[row.reference]?.legacy?.reversedCredit)add('EXTERNAL_REVERSAL_MISSING',row.id);
}

function auditLegacyResolution(s,row,add,tokens){
  const id=row.preparationId,terms=row.terms,quote=terms.quote,resolution=row.legacyResolution;
  const same=(a,b)=>a!==undefined&&b!==undefined&&externalPurchaseDigest(a)===externalPurchaseDigest(b);
  const text=(value,max=128)=>typeof value==='string'&&value.trim().length>0&&Array.from(value).length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
  const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  if(!resolution||typeof resolution!=='object'||!text(resolution.key)||!text(resolution.actorId)||!text(resolution.reason,500)||resolution.decision?.kind!=='adopt_purchase'||!text(resolution.decision?.purchaseKey)||!date(resolution.at)||resolution.at!==row.fulfilledAt||!same(resolution.adoptedQuote,quote)||resolution.purchaseId!==row.purchase?.id||row.state!=='fulfilled'||!row.legacy||row.legacy.reversedCredit||row.legacy.resolutionPurchaseKey!==resolution.decision.purchaseKey||row.completionRequests!==0||row.failureCode!=='LEGACY_CREDIT_SPENT'||!date(row.quarantinedAt)){
    add('EXTERNAL_RESOLUTION_INVALID',id);return;
  }
  const providerId=terms.providerId,actorId=resolution.actorId,key=resolution.key;
  const token='external-resolution:'+externalPurchaseDigest({providerId,actorId,key}),saved=s.operatorRequests?.[token];tokens.add(token);
  const input={preparationId:id,fingerprint:row.fingerprint,key,reason:resolution.reason,decision:resolution.decision};
  const projection={};
  for(const field of ['preparationId','fingerprint','state','terms','preparedAt','fulfilledAt','purchase','failureCode','compensationId','refundRequiredAt','cancelledAt','compensatedAt','quarantinedAt','legacyResolution','debitReference'])if(row[field]!==undefined)projection[field]=row[field];
  if(!saved||saved.hash!==externalPurchaseDigest({type:'external-purchase.legacy-resolved',providerId,actorId,input})||!same(saved.result,projection))add('EXTERNAL_RESOLUTION_RECEIPT_INVALID',id);
  auditLegacyAdoption(s,row,resolution.decision.purchaseKey,row.purchase,add);
}

function auditLegacyAdoption(s,row,purchaseKey,purchase,add){
  const id=row.preparationId,terms=row.terms,quote=terms.quote,providerId=terms.providerId;
  const same=(a,b)=>a!==undefined&&b!==undefined&&externalPurchaseDigest(a)===externalPurchaseDigest(b);
  const requestKey=terms.userId+':'+purchaseKey,request=s.requests[requestKey];
  const purchaseInput={productId:quote.productId,quantity:quote.quantity,productRevision:quote.productRevision,catalogVersion:quote.catalogVersion};
  const hashes=[externalPurchaseDigest({type:'packs.purchased',input:purchaseInput}),externalPurchaseDigest({type:'packs.purchased',input:{...purchaseInput,adminRevision:quote.adminRevision}})];
  if(!request||!hashes.includes(request.hash)||!same(request.result,purchase)||!same(purchase?.paid,quote.price)||typeof purchase?.id!=='string'||!Array.isArray(purchase?.packs)||purchase.packs.length!==quote.quantity||own(s.requests,terms.userId+':'+row.legacy.purchaseKey)||Object.entries(s.requests).some(([key,value])=>key!==requestKey&&value?.result?.id===purchase?.id))add('EXTERNAL_RESOLUTION_PURCHASE_INVALID',id);
  const settlementToken=externalPurchaseDigest({providerId,transactionId:terms.transactionId}),settlement=s.externalSettlements?.[settlementToken];
  const settlementResult=settlement?.result,amount=quote.price.amount,currencyId=quote.price.currencyId;
  const expectedSettlement=externalPurchaseDigest({userId:terms.userId,currencyId,amount,externalCurrency:terms.externalCurrency,externalUnits:terms.externalUnits});
  const credits=s.ledger.filter(entry=>entry.type==='external-credit'&&entry.reference===settlementToken),debits=s.ledger.filter(entry=>entry.type==='purchase'&&entry.reference===purchase?.id);
  const entries=s.ledger.filter(entry=>entry.userId===terms.userId&&entry.currencyId===currencyId),index=entries.indexOf(credits[0]),credit=entries[index],debit=entries[index+1];
  if(!settlement||settlement.hash!==expectedSettlement||settlement.externalCurrency!==terms.externalCurrency||settlement.externalUnits!==terms.externalUnits||settlementResult?.providerId!==providerId||settlementResult?.transactionId!==terms.transactionId||settlementResult?.userId!==terms.userId||settlementResult?.currencyId!==currencyId||settlementResult?.amount!==amount||settlementResult?.balance!==credit?.balance||credits.length!==1||debits.length!==1||index<0||credit?.delta!==amount||credit?.balance!==amount||index>0&&entries[index-1].balance!==0||debit!==debits[0]||debit?.delta!==-amount||debit?.balance!==0)add('EXTERNAL_RESOLUTION_FUNDING_INVALID',id);
  for(const view of Array.isArray(purchase?.packs)?purchase.packs:[]){
    const pack=s.packs[view.id];
    if(!pack||view.purchaseId!==purchase.id||pack.purchaseId!==purchase.id||pack.productId!==quote.productId||pack.productRevision!==quote.productRevision||pack.catalogVersion!==quote.catalogVersion||!same(view.product,pack.product)||!Array.isArray(pack.copyIds)||view.cardCount!==pack.copyIds.length||pack.product?.price?.currencyId!==currencyId||pack.product?.price?.amount*quote.quantity!==amount){add('EXTERNAL_RESOLUTION_DELIVERY_INVALID',id);continue;}
    for(const copyId of pack.copyIds){const copy=s.copies[copyId];if(!copy||copy.source?.packId!==pack.id||copy.source?.purchaseId!==purchase.id||(copy.codeIds??[]).some(codeId=>s.codes?.[codeId]?.copyId!==copyId))add('EXTERNAL_RESOLUTION_DELIVERY_INVALID',id);}
  }
}
