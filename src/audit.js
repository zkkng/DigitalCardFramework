/** Read-only invariant checker used for startup, restored backups and operator diagnostics. */
export function auditState(s){
  const issues=[],add=(code,detail)=>issues.push({code,detail});
  if(!s.catalog)return {ok:false,issues:[{code:'NO_CATALOG',detail:'Publish a catalog before serving players'}]};
  const currencies=new Set(s.catalog.currencies.map(c=>c.id)),copies=Object.values(s.copies),counts={},serials=new Set();
  for(const copy of copies){counts[copy.variantId]=(counts[copy.variantId]??0)+1;if(!s.users[copy.ownerId])add('OWNER_MISSING',copy.id);if(!['sealed','owned','consumed'].includes(copy.state))add('COPY_STATE',copy.id);if(copy.serialNumber!==null){const key=copy.variantId+':'+copy.serialNumber;if(serials.has(key)||!Number.isInteger(copy.serialNumber)||copy.serialNumber<1||copy.serialNumber>copy.editionTotal)add('SERIAL_INVALID',copy.id);serials.add(key);}if(copy.lockedBy){const trade=s.trades[copy.lockedBy];if(!trade||trade.status!=='pending'||trade.fromUserId!==copy.ownerId||!trade.give.copyIds.includes(copy.id))add('ORPHAN_LOCK',copy.id);}}
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
  const identities=new Set();for(const u of Object.values(s.users)){const identity=JSON.stringify([u.provider,u.subject]);if(identities.has(identity))add('IDENTITY_DUPLICATE',u.id);identities.add(identity);}
  return {ok:issues.length===0,issues,revision:s.revision,counts:{users:Object.keys(s.users).length,copies:copies.length,packs:Object.keys(s.packs).length,trades:Object.keys(s.trades).length,events:s.events.length}};
}
