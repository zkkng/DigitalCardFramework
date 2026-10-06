import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, admin, code } from './helpers.js';
import { CardFramework, MemoryStore, createCodeVault, createCodeGateway } from '../src/index.js';
import { SQLiteStore } from '../src/sqlite.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { vault, codesFixture } from './codes-fixtures.mjs';
import { codeSummary } from '../src/codes.js';
import { page } from '../src/data.js';
const gift = (x, copy, from=x.alice,to=x.bob) => x.core.proposeTrade(from,{key:'gift-'+copy.id,toUserId:to.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});

for(const adapter of ['memory','sqlite'])test('indexed code history preserves former holders, privacy and page semantics: '+adapter,()=>{
  const store=adapter==='memory'?new MemoryStore():new SQLiteStore(':memory:',{encryptionKey:Buffer.alloc(32,41)});
  let at='2026-09-30T12:00:00Z';
  const x=codesFixture({store,stock:200,transfer:'follow-unrevealed',clock:()=>at});
  const emptyActor={userId:x.core.registerUser(admin,{provider:'test',subject:'no-codes',displayName:'No codes'}).id};
  try{
    const first=x.openCode(),second=x.openCode();x.buy('bundle',x.alice,1,'sealed-history');
    const trade=gift(x,first);x.core.acceptTrade(x.bob,{key:'accept-history',tradeId:trade.id});
    store.transact(s=>{s.codes[second.codes[0].id].expiresAt='2026-09-30T13:00:00Z';s.codes[second.codes[0].id].metadata={privateLabel:'holder-search-only'};});
    at='2026-09-30T14:00:00Z';
    const options=[{}, {sort:'name'}, {sort:'newest',limit:1}, {search:'holder-search-only'}, {search:'expired'}, {search:'another holder'}, {search:'SECRET-REWARD'}];
    const expected=new Map();
    for(const actor of [x.alice,x.bob])for(const input of options){
      expected.set(JSON.stringify([actor.userId,input]),store.read(s=>page(Object.values(s.codes).filter(row=>s.copies[row.copyId]?.state!=='sealed'&&(row.holderId===actor.userId||row.holderHistory.includes(actor.userId))).map(row=>({...codeSummary(s,row,actor.userId,at),copyId:row.copyId,name:s.copies[row.copyId].definition.name,createdAt:row.allocatedAt})),input)));
    }
    const before=store.diagnostics?.();
    store.read=()=>{throw Error('History must not materialize the installation');};
    for(const actor of [x.alice,x.bob])for(const input of options)assert.deepEqual(x.core.codeHistory(actor,input),expected.get(JSON.stringify([actor.userId,input])));
    const alice=x.core.codeHistory(x.alice),bob=x.core.codeHistory(x.bob);
    assert.equal(alice.total,2);assert.equal(bob.total,1);
    const former=alice.items.find(row=>row.id===first.codes[0].id);
    assert.equal(former.canReveal,false);assert.equal(former.metadata,undefined);assert.equal(former.history,undefined);
    assert(!JSON.stringify([alice,bob]).includes('SECRET-REWARD'));
    const one=x.core.codeHistory(x.alice,{limit:1}),two=x.core.codeHistory(x.alice,{limit:1,after:one.next});
    assert.deepEqual([...one.items,...two.items],alice.items);assert.equal(two.next,null);
    assert.throws(()=>x.core.codeHistory(x.alice,{after:'missing'}),code('INVALID_CURSOR'));
    assert.throws(()=>x.core.codeHistory({...x.alice,disabled:true}),code('UNAUTHENTICATED'));
    assert.throws(()=>x.core.codeHistory({userId:'missing'}),code('UNAUTHENTICATED'));
    if(before){
      assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);
      const start=store.diagnostics();x.core.codeHistory(x.alice);
      assert.equal(store.diagnostics().decodedQueryRecords-start.decodedQueryRecords,5);
      const empty=store.diagnostics();assert.equal(x.core.codeHistory(emptyActor).total,0);
      assert.equal(store.diagnostics().decodedQueryRecords-empty.decodedQueryRecords,1);
    }
  }finally{x.core.close();}
});

test('one unique code insert per pack; allocation, opening and provenance survive retries',()=>{
  const x=codesFixture();const bought=x.buy('bundle',x.alice,3,'multi');
  assert.equal(x.core.codeHistory(x.alice).total,0);
  const rows=bought.packs.flatMap(p=>x.core.openPack(x.alice,{key:'open-'+p.id,packId:p.id}).cards);
  assert.equal(rows.length,9);assert.equal(rows.filter(c=>c.definition.type==='code').length,3);
  const history=x.core.codeHistory(x.alice).items;assert.equal(history.length,3);
  const values=history.map((r,i)=>x.core.revealCode(x.alice,{key:'reveal-'+i,codeId:r.id}).code);
  assert.equal(new Set(values).size,3);
  const old=x.core.purchase(x.alice,{...x.core.quote(x.alice,{productId:'bundle',quantity:3}),key:'multi'});assert.deepEqual(old,bought);
  for(const row of rows){assert.equal(row.provenance.purchaseId,bought.id);assert.equal(row.provenance.productId,'bundle');assert.equal(row.provenance.catalogVersion,1);assert.equal(row.provenance.productRevision,1);assert.match(row.provenance.definitionDigest,/^[a-f0-9]{64}$/);assert.equal(row.provenance.packId,row.source.packId);assert.equal(row.provenance.packMetadata.batch,'autumn');}
  assert.equal(x.core.audit(admin).ok,true);x.core.close();
});
test('code stock shortage rolls back a multi-pack debit, copies, supply, requests and allocation',()=>{
  const x=codesFixture({stock:1}),before=x.store.read(s=>s);
  assert.throws(()=>x.buy('bundle',x.alice,2),code('POOL_EXHAUSTED'));
  assert.deepEqual(x.store.read(s=>s),before);x.core.close();
});
test('batch duplicates, duplicate provider references and namespace normalization are atomic',()=>{
  const x=codesFixture(),before=x.store.read(s=>s);
  assert.throws(()=>x.core.importCodes(admin,{key:'dupe',poolId:'rewards',codes:[{code:'new'},{code:'SECRET-REWARD-0'}]}),code('DUPLICATE_CODE'));
  assert.deepEqual(x.store.read(s=>s),before);
  assert.throws(()=>x.core.importCodes(admin,{key:'dupref',poolId:'rewards',codes:[{code:'new',externalId:'ext-0'}]}),code('DUPLICATE_CODE'));
  assert.throws(()=>x.core.configureCodePool(admin,{key:'other',pool:{id:'other',providerId:'example.game',name:'Other',normalization:'upper-trim'}}),code('POOL_IDENTITY'));
  x.core.configureCodePool(admin,{key:'other2',pool:{id:'other',providerId:'example.game',name:'Other'}});
  assert.throws(()=>x.core.importCodes(admin,{key:'dupe2',poolId:'other',codes:[{code:'SECRET-REWARD-0'}]}),code('DUPLICATE_CODE'));
  x.core.close();
});
test('no plaintext in database state, catalog, inventory, receipts, public albums, events or requests',()=>{
  const x=codesFixture(),copy=x.openCode(),codeId=copy.codes[0].id;
  const album=x.core.saveAlbum(x.alice,{key:'album',name:'Optional insert',visibility:'public',placements:[{copyId:copy.id}]});
  x.core.revealCode(x.alice,{key:'reveal',codeId});
  const payloads=[x.store.read(s=>s),x.core.catalog(),x.core.inventory(x.alice),x.core.codeHistory(x.alice),x.core.viewAlbum(null,album.id),x.core.events(admin),x.core.openPack(x.alice,{key:'reopen',packId:copy.source.packId})];
  for(const payload of payloads)assert(!JSON.stringify(payload).includes('SECRET-REWARD'));
  const publicCopy=x.core.viewAlbum(null,album.id).cards[0].copy;
  assert.equal(publicCopy.provenance.purchaseId,undefined);assert.equal(publicCopy.source.packMetadata,undefined);assert.equal(publicCopy.codes[0].canReveal,false);
  assert.equal(x.core.revealCode(x.alice,{key:'reveal',codeId}).code,'SECRET-REWARD-0');x.core.close();
});
test('sealed codes, other accounts, disabled users and fake provider status cannot reveal or mutate',()=>{
  const x=codesFixture(),pack=x.buy('bundle').packs[0],codeId=x.store.read(s=>Object.values(s.codes).find(r=>r.copyId)?.id);
  assert.throws(()=>x.core.revealCode(x.alice,{key:'sealed',codeId}),code('NOT_FOUND'));
  x.core.openPack(x.alice,{key:'open',packId:pack.id});
  for(const actor of [x.bob,{...x.alice,disabled:true},{}])assert.throws(()=>x.core.revealCode(actor,{key:'steal',codeId}));
  assert.throws(()=>x.core.confirmCodeStatus(x.alice,{codeId,providerId:'example.game',eventId:'fake',status:'redeemed',occurredAt:'2026-09-30T12:00:00Z'}),code('FORBIDDEN'));
  assert.throws(()=>x.core.reportCodeUsage(x.alice,{key:'premature',codeId}),code('CODE_NOT_REVEALED'));
  x.core.close();
});
test('revealing and reported usage are distinct from provider-confirmed redemption',()=>{
  const x=codesFixture(),codeId=x.openCode().codes[0].id;
  x.core.revealCode(x.alice,{key:'reveal',codeId});
  assert.equal(x.core.codeHistory(x.alice).items[0].status,'allocated');
  x.core.reportCodeUsage(x.alice,{key:'used',codeId});assert.equal(x.core.codeHistory(x.alice).items[0].reportedUsed,true);
  const proof={providerId:'example.game',eventId:'receipt-1',codeId,status:'redeemed',occurredAt:'2026-09-30T12:01:00Z'};
  assert.deepEqual(x.core.confirmCodeStatus(admin,proof),x.core.confirmCodeStatus(admin,proof));
  assert.throws(()=>x.core.confirmCodeStatus(admin,{...proof,status:'revoked'}),code('PROVIDER_EVENT_CONFLICT'));
  assert.throws(()=>x.core.confirmCodeStatus(admin,{...proof,eventId:'receipt-2',status:'revoked'}),code('CODE_STATE_CONFLICT'));
  x.core.reportCodeUsage(x.alice,{key:'clear',codeId,used:false});assert.equal(x.core.codeHistory(x.alice).items[0].status,'redeemed');
  assert.equal(x.core.revealCode(x.alice,{key:'review-old',codeId}).code,'SECRET-REWARD-0');x.core.close();
});
test('follow-unrevealed transfers access, blocks stale holders and blocks later transfers after disclosure',()=>{
  const x=codesFixture({transfer:'follow-unrevealed'}),copy=x.openCode(),codeId=copy.codes[0].id,t=gift(x,copy);
  assert.throws(()=>x.core.revealCode(x.alice,{key:'locked',codeId}),code('CARD_LOCKED'));
  x.core.acceptTrade(x.bob,{key:'accept',tradeId:t.id});
  assert.throws(()=>x.core.revealCode(x.alice,{key:'old-owner',codeId}),code('NOT_FOUND'));
  assert.equal(x.core.codeHistory(x.alice).items[0].canReveal,false);
  x.core.revealCode(x.bob,{key:'new-owner',codeId});
  assert.throws(()=>gift(x,copy,x.bob,x.alice),code('TRANSFER_BLOCKED'));x.core.close();
});
test('retain keeps old codes accessible after hybrid trade while the new owner cannot reveal them',()=>{
  const x=codesFixture({type:'collectible'}),copy=x.openCode(),codeId=copy.codes[0].id;
  x.core.revealCode(x.alice,{key:'reveal',codeId});const t=gift(x,copy);x.core.acceptTrade(x.bob,{key:'accept',tradeId:t.id});
  assert.equal(x.core.revealCode(x.alice,{key:'reveal',codeId}).code,'SECRET-REWARD-0');
  assert.throws(()=>x.core.revealCode(x.bob,{key:'steal',codeId}),code('NOT_FOUND'));
  assert.equal(x.core.codeHistory(x.alice).total,1);assert.equal(x.core.codeHistory(x.bob).total,0);
  assert.deepEqual(x.core.inspectCard(x.bob,copy.id).provenance,copy.provenance);x.core.close();
});
test('requested-card disclosure invalidates pending offer versions; block policy always vetoes',()=>{
  const x=codesFixture({transfer:'follow-unrevealed'}),copy=x.openCode();
  const t=x.core.proposeTrade(x.bob,{key:'request',toUserId:x.alice.userId,give:{copyIds:[],currencies:[]},receive:{copyIds:[copy.id],currencies:[]}});
  x.core.revealCode(x.alice,{key:'reveal',codeId:copy.codes[0].id});
  assert.throws(()=>x.core.acceptTrade(x.alice,{key:'accept',tradeId:t.id}),code('STALE_INVENTORY'));
  x.core.close();const blocked=codesFixture({transfer:'block'});assert.throws(()=>gift(blocked,blocked.openCode()),code('TRANSFER_BLOCKED'));blocked.core.close();
});
test('expiry excludes stock and blocks first reveal while historical records remain',()=>{
  let now='2026-09-30T12:00:00Z';const x=codesFixture({stock:0,clock:()=>now});
  x.core.importCodes(admin,{key:'expiring',poolId:'rewards',codes:[{code:'EXPIRING',expiresAt:'2026-09-30T13:00:00Z'},{code:'SECOND',expiresAt:'2026-09-30T13:00:00Z'}]});
  const copy=x.openCode();now='2026-09-30T14:00:00Z';
  assert.throws(()=>x.core.revealCode(x.alice,{key:'late',codeId:copy.codes[0].id}),code('CODE_UNAVAILABLE'));
  assert.equal(x.core.codeHistory(x.alice).items[0].status,'expired');assert.throws(()=>x.buy('bundle'),code('POOL_EXHAUSTED'));x.core.close();
});
test('AES envelope authentication, index-key mismatch and key rotation fail closed',()=>{
  const x=codesFixture(),copy=x.openCode(),codeId=copy.codes[0].id;
  const other=new CardFramework({store:x.store,codeVault:vault({indexKey:Buffer.alloc(32,10)})});
  assert.throws(()=>other.revealCode(x.alice,{key:'bad-index',codeId}),code('CODE_KEYS'));
  const rotated=new CardFramework({store:x.store,codeVault:vault({activeKeyId:'two',keys:{one:Buffer.alloc(32,7),two:Buffer.alloc(32,8)}})});
  assert.equal(rotated.rotateCodeEncryption(admin).count,8);
  const onlyNew=new CardFramework({store:x.store,codeVault:vault({activeKeyId:'two',keys:{two:Buffer.alloc(32,8)}})});
  assert.equal(onlyNew.verifyCodeVault(admin).count,8);assert.equal(onlyNew.revealCode(x.alice,{key:'new-key',codeId}).code,'SECRET-REWARD-0');
  x.store.transact(s=>{s.codes[codeId].secret.data=Buffer.from('tamper').toString('base64');});
  assert.throws(()=>onlyNew.revealCode(x.alice,{key:'tamper',codeId}),code('CODE_INTEGRITY'));x.core.close();
});
test('verified provider bridge rejects wrong code, sanitizes failures and ignores late timeout results',async()=>{
  const x=codesFixture(),codeId=x.openCode().codes[0].id;
  const gateway=lookup=>createCodeGateway({framework:x.core,providers:{'example.game':{lookup}},timeoutMs:5});
  await assert.rejects(gateway(async()=>({codeId:'wrong',status:'redeemed'})).reconcile(x.alice,{codeId}),code('INVALID_PROVIDER'));
  await assert.rejects(gateway(async()=>{throw Error('SECRET-REWARD-0');}).reconcile(x.alice,{codeId}),e=>!e.message.includes('SECRET'));
  await assert.rejects(gateway(async()=>{await new Promise(r=>setTimeout(r,30));return {codeId,status:'redeemed',eventId:'late',occurredAt:'2026-10-01T00:00:00Z'};}).reconcile(x.alice,{codeId}),code('PROVIDER_TIMEOUT'));
  await new Promise(r=>setTimeout(r,40));assert.equal(x.core.codeHistory(x.alice).items[0].status,'allocated');
  const verified=await gateway(async material=>{assert.equal(material.code,'SECRET-REWARD-0');return {codeId,status:'redeemed',eventId:'real',occurredAt:'2026-10-01T00:00:00Z'};}).reconcile(x.alice,{codeId});assert.equal(verified.status,'redeemed');x.core.close();
});
test('optional inserts are decided once per pack and never satisfy pity or normal duplicate policy',()=>{
  const x=codesFixture({random:sum=>sum-1,change(c){const p=c.products.find(p=>p.id==='bundle');p.slots[0].count=1;p.slots[1].probability={numerator:0,denominator:2};p.duplicatePolicy={scope:'pack',fallback:'reject'};}});
  const copies=x.open('bundle');assert.equal(copies.length,1);assert.equal(x.core.codeHistory(x.alice).total,0);x.core.close();
});

test('vault rejects truncated authentication tags and envelopes rebound to another row',()=>{
  const v=vault(),sealed=v.seal('PRIVATE','row-one');
  assert.throws(()=>v.open(sealed,'row-two'),code('CODE_INTEGRITY'));
  const truncated={...sealed,tag:Buffer.from(sealed.tag,'base64').subarray(0,4).toString('base64')};
  assert.throws(()=>v.open(truncated,'row-one'),code('CODE_INTEGRITY'));
});

test('a high-rarity guaranteed insert does not reset normal-card pity',()=>{
  const x=codesFixture({change(c){const p=c.products.find(p=>p.id==='bundle');p.slots[0].count=1;p.slots[0].pool=[{variantId:'dawn.standard',weight:9},{variantId:'aurora.holo',weight:1}];p.pity={after:2,rarityId:'rare'};c.variants.find(v=>v.id==='reward.standard').rarityId='unique';}});
  const first=x.open('bundle');assert.equal(first[0].rarityId,'common');assert.equal(first[1].rarityId,'unique');assert.equal(x.core.pityProgress(x.alice).bundle,1);
  const second=x.open('bundle');assert.equal(second[0].rarityId,'rare');assert.equal(x.core.pityProgress(x.alice).bundle,0);x.core.close();
});

test('multiple hybrid attachments draw distinct codes and require enough stock together',()=>{
  const change=c=>c.variants.find(v=>v.id==='reward.standard').codes.push({id:'second',poolId:'rewards',reveal:'open'});
  const x=codesFixture({stock:2,type:'collectible',change});const copy=x.openCode();assert.equal(copy.codes.length,2);assert.notEqual(copy.codes[0].id,copy.codes[1].id);assert.equal(copy.definition.behavior.albumDefault,true);assert.equal(x.core.audit(admin).ok,true);x.core.close();
  const short=codesFixture({stock:1,change});const before=short.store.read(s=>s);assert.throws(()=>short.buy('bundle'),code('POOL_EXHAUSTED'));assert.deepEqual(short.store.read(s=>s),before);short.core.close();
});
test('custom types, hybrid defaults and album exclusion are validated and snapshotted',()=>{
  const x=codesFixture({type:'example.ticket',change(c){c.cardTypes=[{id:'example.ticket',name:'Ticket',defaults:{collectionDefault:false,albumEligible:false}}];}});
  const copy=x.openCode();assert.equal(copy.definition.behavior.albumEligible,false);
  assert.throws(()=>x.core.saveAlbum(x.alice,{key:'album',name:'No',placements:[{copyId:copy.id}]}),code('ALBUM_INELIGIBLE'));
  const c=x.core.operatorCatalog(admin);c.version++;c.cards.find(c=>c.id==='reward').behavior.albumEligible=true;x.core.publishCatalog(admin,c);
  assert.equal(x.core.inspectCard(x.alice,copy.id).definition.behavior.albumEligible,false);x.core.close();
});
test('code entitlements survive encrypted SQLite restart without plaintext on disk',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dc-codes-'));try{
    const db=path.join(dir,'state.sqlite'),storageKey=Buffer.alloc(32,4);
    const x=codesFixture({store:new SQLiteStore(db,{encryptionKey:storageKey})}),copy=x.openCode();x.core.revealCode(x.alice,{key:'first',codeId:copy.codes[0].id});x.core.close();
    assert(!(await readFile(db)).includes(Buffer.from('SECRET-REWARD')));
    const core=new CardFramework({store:new SQLiteStore(db,{encryptionKey:storageKey}),codeVault:vault()});
    assert.equal(core.codeHistory(x.alice).total,1);assert.equal(core.revealCode(x.alice,{key:'again',codeId:copy.codes[0].id}).code,'SECRET-REWARD-0');core.close();
  }finally{await rm(dir,{recursive:true,force:true});}
});
