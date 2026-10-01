/** Read-only invariant checker used for startup, restored backups and operator diagnostics. */
export function auditState(s){
  const issues=[],add=(code,detail)=>issues.push({code,detail});
  if(!s.catalog)return {ok:false,issues:[{code:'NO_CATALOG',detail:'Publish a catalog before serving players'}]};
  const currencies=new Set(s.catalog.currencies.map(c=>c.id)),copies=Object.values(s.copies),counts={},serials=new Set();
  for(const copy of copies){counts[copy.variantId]=(counts[copy.variantId]??0)+1;if(!s.users[copy.ownerId])add('OWNER_MISSING',copy.id);if(!['sealed','owned','consumed'].includes(copy.state))add('COPY_STATE',copy.id);if(copy.serialNumber!==null){const key=copy.variantId+':'+copy.serialNumber;if(serials.has(key)||!Number.isInteger(copy.serialNumber)||copy.serialNumber<1||copy.serialNumber>copy.editionTotal)add('SERIAL_INVALID',copy.id);serials.add(key);}if(copy.lockedBy?.startsWith('market:')){const listing=s.listings?.[copy.lockedBy.slice(7)];if(!listing||listing.status!=='active'||listing.sellerId!==copy.ownerId||!listing.units.some(u=>u.status==='available'&&(u.copyId===copy.id||s.packs[u.packId]?.copyIds.includes(copy.id))))add('ORPHAN_MARKET_LOCK',copy.id);}else if(copy.lockedBy){const trade=s.trades[copy.lockedBy];if(!trade||trade.status!=='pending'||trade.fromUserId!==copy.ownerId||!trade.give.copyIds.includes(copy.id))add('ORPHAN_LOCK',copy.id);}}
  for(const variant of s.catalog.variants){if((counts[variant.id]??0)!==(s.supply[variant.id]??0))add('SUPPLY_MISMATCH',variant.id);if(variant.supplyLimit!==undefined&&(s.supply[variant.id]??0)>variant.supplyLimit)add('SUPPLY_EXCEEDED',variant.id);}
  const balances={};for(const entry of s.ledger){const key=entry.userId+':'+entry.currencyId;balances[key]=(balances[key]??0)+entry.delta;if(balances[key]!==entry.balance||!Number.isSafeInteger(entry.balance)||entry.balance<0)add('LEDGER_MISMATCH',entry.id);}
  for(const [userId,wallet]of Object.entries(s.balances))for(const [currencyId,amount]of Object.entries(wallet))if(!currencies.has(currencyId)||!Number.isSafeInteger(amount)||amount<0||amount!==(balances[userId+':'+currencyId]??0))add('BALANCE_INVALID',userId+':'+currencyId);
  for(const trade of Object.values(s.trades))if(trade.status==='pending')for(const copyId of trade.give.copyIds){const c=s.copies[copyId];if(!c||c.ownerId!==trade.fromUserId||c.state!=='owned'||c.lockedBy!==trade.id)add('ESCROW_INVALID',trade.id+':'+copyId);}
  for(const album of Object.values(s.albums)){const seen=new Set();for(const p of album.placements){const c=s.copies[p.copyId];if(seen.has(p.copyId)||!c||c.ownerId!==album.ownerId||c.state!=='owned')add('ALBUM_INVALID',album.id+':'+p.copyId);seen.add(p.copyId);}}
  const credits=new Map();
  for(const entry of s.ledger)if(entry.type==='external-credit'){const list=credits.get(entry.reference)??[];list.push(entry);credits.set(entry.reference,list);}
  for(const [token,settlement]of Object.entries(s.externalSettlements??{})){
    const rows=credits.get(token)??[],r=settlement.result;
    if(rows.length!==1||!r||rows[0].userId!==r.userId||rows[0].currencyId!==r.currencyId||rows[0].delta!==r.amount)add('SETTLEMENT_LEDGER_MISMATCH',token);
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
  return {ok:issues.length===0,issues,revision:s.revision,counts:{users:Object.keys(s.users).length,copies:copies.length,packs:Object.keys(s.packs).length,trades:Object.keys(s.trades).length,events:s.events.length}};
}
