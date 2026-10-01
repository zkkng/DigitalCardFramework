/** Run: node examples/code-cards.mjs. Fictional one-use codes; no external redemption. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CardFramework, createCodeVault, createCodeGateway } from '../src/index.js';
import { sampleCatalog } from './catalog.js';

// In production, inject persistent keys from your secret manager and a durable store.
const vault=createCodeVault({activeKeyId:'v1',keys:{v1:randomBytes(32)},indexKey:randomBytes(32)});
const framework=new CardFramework({codeVault:vault});
const operator={role:'admin'},catalog=structuredClone(sampleCatalog);
catalog.cards.push({id:'bonus',lineId:'sky',type:'code',name:'A private reward'});
catalog.variants.push({id:'bonus.code',cardId:'bonus',rarityId:'common',codes:[{id:'reward',poolId:'example.reward',reveal:'scratch',transfer:'retain'}]});
// A normal collectible can also carry a code and remain visible in the album.
catalog.variants.find(v=>v.id==='dawn.standard').codes=[{id:'hybrid',poolId:'example.reward',reveal:'peel',transfer:'follow-unrevealed'}];
catalog.products.push({id:'with-reward',lineId:'sky',name:'Two cards and one code insert',revision:1,price:{currencyId:'credits',amount:10},metadata:{campaign:'example'},slots:[
  {id:'cards',role:'card',count:2,pool:[{variantId:'dawn.standard',weight:1}]},
  {id:'bonus',role:'insert',count:1,pool:[{variantId:'bonus.code',weight:1}],metadata:{purpose:'external-reward'}},
]});
framework.publishCatalog(operator,catalog);
framework.configureCodePool(operator,{key:'pool',pool:{id:'example.reward',providerId:'example.provider',name:'Example reward',redeemUrl:'https://example.com/redeem'}});
const imported=framework.importCodes(operator,{key:'batch-1',poolId:'example.reward',codes:Array.from({length:3},()=>({code:randomUUID(),metadata:{edition:'example'}}))});
assert.equal(imported.count,3);
const account=framework.registerUser(operator,{provider:'example',subject:'reader',displayName:'Reader'}),actor={userId:account.id};
framework.grantCurrency(operator,{key:'fund',userId:account.id,currencyId:'credits',amount:10,reason:'Example funding'});
const purchase=framework.purchase(actor,{...framework.quote(actor,{productId:'with-reward'}),key:'purchase'});
const receipt=framework.openPack(actor,{key:'open',packId:purchase.packs[0].id});
assert.equal(receipt.cards.length,3);
const history=framework.codeHistory(actor);assert.equal(history.total,3);
const revealed=framework.revealCode(actor,{key:'reveal',codeId:history.items[0].id});
assert.equal(typeof revealed.code,'string');
framework.reportCodeUsage(actor,{key:'reported',codeId:revealed.id,used:true});
// Substitute your authenticated provider SDK. Unknown status never becomes redeemed.
const gateway=createCodeGateway({framework,providers:{'example.provider':{lookup:async({codeId,signal})=>({codeId,status:'unknown'})}}});
assert.equal((await gateway.reconcile(actor,{codeId:revealed.id})).status,'unverified');
assert.equal(framework.audit(operator).ok,true);
console.log('Verified: two hybrid collectibles, one private insert, unique codes, provenance and provider reconciliation.');
framework.close();
