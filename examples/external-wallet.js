import {isDeepStrictEqual} from 'node:util';
import {CardFramework,externalPurchaseFingerprint} from '../src/index.js';

// A local demonstration ledger. A real host supplies durable, authenticated
// payment evidence and resumes its saved orders after a process restart.
const wallet={points:100},receipts=new Map(),providerId='example.wallet';
const provider={permissions:['currency.settle'],settlementProviderId:providerId};
const framework=new CardFramework({externalPurchaseProviders:{[providerId]:{
  validateIntent:({intent,user})=>user.provider==='example'&&user.subject==='collector-1'&&intent.externalCurrency==='points'&&intent.externalUnits===String(intent.quote.price.amount),
  verifyProof:({proof})=>isDeepStrictEqual(receipts.get(proof.reference),proof)
}}});
const operator={permissions:['catalog.publish','accounts.register']};
framework.publishCatalog(operator,{
  version:1,currencies:[{id:'credits',name:'Credits',value:{numerator:1,denominator:1}}],
  lines:[{id:'shapes',name:'Shapes'}],rarities:[{id:'common',name:'Common',rank:0}],
  cards:[{id:'circle',lineId:'shapes',name:'Circle',metadata:{symbol:'○'}}],
  variants:[{id:'circle.common',cardId:'circle',rarityId:'common'}],
  products:[{id:'shapes-pack',lineId:'shapes',name:'Shapes pack',revision:1,price:{currencyId:'credits',amount:25},slots:[{count:1,pool:[{variantId:'circle.common',weight:1}]}]}]
});
const user=framework.registerUser(operator,{provider:'example',subject:'collector-1',displayName:'Collector'}),player={userId:user.id};
const order={key:'example-order-1',providerId,transactionId:'example-order-1',userId:user.id,externalCurrency:'points',externalUnits:'25',quote:framework.quote(player,{productId:'shapes-pack',quantity:1})};
const prepared=framework.prepareExternalPurchase(provider,order);
if(wallet.points<Number(order.externalUnits))throw new Error('Insufficient external points');
wallet.points-=Number(order.externalUnits);
const receipt={kind:'debit',reference:'debit:example-order-1',providerId,transactionId:order.transactionId,userId:user.id,externalCurrency:order.externalCurrency,externalUnits:order.externalUnits,fingerprint:externalPurchaseFingerprint(order)};
receipts.set(receipt.reference,structuredClone(receipt));
const result=framework.commitExternalPurchase(provider,{preparationId:prepared.preparationId,fingerprint:prepared.fingerprint,debitReceipt:receipt});
if(result.state!=='fulfilled')throw new Error('Resolve the recorded payment outcome before continuing');
const opened=framework.openPack(player,{key:'open-example-order-1',packId:result.purchase.packs[0].id});
console.log(JSON.stringify({state:result.state,externalPoints:wallet.points,cards:opened.cards.map(card=>card.definition.name),internalWallet:framework.wallet(player)}));
