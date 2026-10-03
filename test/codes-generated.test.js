import test from 'node:test';
import assert from 'node:assert/strict';
import {CardFramework} from '../src/index.js';
import {admin,code} from './helpers.js';
import {codesFixture,vault} from './codes-fixtures.mjs';

function generated(factory){
 const x=codesFixture({stock:0,change(c){c.variants.find(v=>v.id==='reward.standard').codes[0].poolId='generated';}});
 const core=new CardFramework({store:x.store,codeVault:vault(),codeGenerators:{example:factory}});
 core.configureCodePool(admin,{key:'generated-pool',pool:{id:'generated',providerId:'example.game',name:'Generated reward',generator:'example'}});
 const buy=(key='purchase',quantity=1)=>core.purchase(x.alice,{...core.quote(x.alice,{productId:'bundle',quantity}),key});
 return {...x,core,buy};
}
test('generated codes are allocated once at purchase, encrypted and privately registered before opening',()=>{
 let calls=0;
 const x=generated(({copy,pool})=>{calls++;assert.equal(copy.state,'sealed');assert.equal(pool.id,'generated');return {code:'GENERATED-SECRET-'+calls,externalId:'issuance-'+calls,metadata:{reward:17}};});
 const bought=x.buy('three',3);assert.equal(calls,3);assert.equal(x.core.codeHistory(x.alice).total,0);
 assert.deepEqual(x.buy('three',3),bought);assert.equal(calls,3);
 const stock=x.core.codeInventory(admin).items.filter(r=>r.poolId==='generated');
 assert.equal(stock.length,3);
 const first=x.core.codeRegistrationMaterial(admin,stock[0].id);
 assert.equal(first.holderId,x.alice.userId);assert.equal(first.metadata.reward,17);assert.match(first.code,/^GENERATED-SECRET-/);
 assert.throws(()=>x.core.codeRegistrationMaterial(x.alice,first.codeId),code('FORBIDDEN'));
 assert.throws(()=>x.core.revealCode(x.alice,{key:'sealed',codeId:first.codeId}),code('NOT_FOUND'));
 for(const pack of bought.packs)x.core.openPack(x.alice,{key:'open-'+pack.id,packId:pack.id});
 const history=x.core.codeHistory(x.alice).items;assert.equal(history.length,3);assert.equal(calls,3);
 assert.equal(new Set(history.map((row,i)=>x.core.revealCode(x.alice,{key:'reveal-'+i,codeId:row.id}).code)).size,3);
 for(const value of [x.store.read(s=>s),bought,x.core.catalog(),x.core.inventory(x.alice),x.core.events(admin),history])assert(!JSON.stringify(value).includes('GENERATED-SECRET'));
 assert(x.core.audit(admin).ok);x.core.close();
});
test('generator identity is immutable and unavailable factories fail without debiting',()=>{
 const x=generated(()=>({code:'ONE'}));
 assert.throws(()=>x.core.configureCodePool(admin,{key:'change',pool:{id:'generated',providerId:'example.game',name:'Changed'}}),code('POOL_IDENTITY'));
 assert.throws(()=>x.core.configureCodePool(admin,{key:'missing',pool:{id:'other',providerId:'example.game',name:'Missing',generator:'absent'}}),code('MISSING_CODE_GENERATOR'));
 const restart=new CardFramework({store:x.store,codeVault:vault()}),before=x.store.read(s=>s);
 assert.throws(()=>restart.purchase(x.alice,{...restart.quote(x.alice,{productId:'bundle'}),key:'missing-factory'}),code('MISSING_CODE_GENERATOR'));
 assert.deepEqual(x.store.read(s=>s),before);restart.close();
});
test('a collision or invalid generated value rolls back every pack, debit and retry record',()=>{
 for(const factory of [async()=>{throw Error('Async generator failure');},()=>({code:'SAME'}),()=>({then(){}}),()=>({code:'bad\nvalue'}),()=>{throw Error('Unavailable generator');}]){
  const x=generated(factory),before=x.store.read(s=>s);
  assert.throws(()=>x.buy('rollback',2));assert.deepEqual(x.store.read(s=>s),before);x.core.close();
 }
});
test('generated references are unique within the provider namespace',()=>{
 let count=0;const x=generated(()=>({code:'DIFFERENT-'+(++count),externalId:'same-reference'}));
 x.buy('first');const before=x.store.read(s=>s);
 assert.throws(()=>x.buy('second'),code('DUPLICATE_CODE'));assert.deepEqual(x.store.read(s=>s),before);x.core.close();
});

test('private registration refuses a changed index key even when the encryption key still decrypts',()=>{
 const x=generated(()=>({code:'PRIVATE-REGISTRATION'}));x.buy();
 const id=x.core.codeInventory(admin).items.find(r=>r.poolId==='generated').id;
 const restarted=new CardFramework({store:x.store,codeVault:vault({indexKey:Buffer.alloc(32,8)})});
 assert.throws(()=>restarted.codeRegistrationMaterial(admin,id),code('CODE_KEYS'));restarted.close();
});
