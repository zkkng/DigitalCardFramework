import {CardFramework,MemoryStore} from '../src/index.js';
import {sampleCatalog} from '../examples/catalog.js';
export const admin={role:'admin'};
export function fixture({store=new MemoryStore(),change,random=()=>0,clock=()=> '2026-09-30T12:00:00.000Z',bindings={},policies={},codeVault,codeLimits,actionHandlers,actionOptions,eventSubscriptions,raffleRandom}={}) {
  const c=structuredClone(sampleCatalog);c.version=1;
  c.products.push(...[
    ['common','dawn.standard'],['rare','aurora.holo'],['unique','solstice.unique']
  ].map(([name,variantId])=>({id:name,lineId:'sky',name,revision:1,price:{currencyId:'credits',amount:10},slots:[{count:1,pool:[{variantId,weight:1}]}]})));
  change?.(c);
  const core=new CardFramework({store,random,clock,bindings:{'demo.code':()=>({code:'PRIVATE-DEMO-CODE'}),...bindings},policies,codeVault,codeLimits,actionHandlers,actionOptions,eventSubscriptions,raffleRandom});
  core.publishCatalog(admin,c);
  const a=core.registerUser(admin,{provider:'test',subject:'alice',displayName:'Alice'});
  const b=core.registerUser(admin,{provider:'test',subject:'bob',displayName:'Bob'});
  for(const u of[a,b])core.grantCurrency(admin,{userId:u.id,currencyId:'credits',amount:10000,reason:'Test funding',key:'fund'});
  const alice={userId:a.id},bob={userId:b.id};
  let sequence=0;
  function buy(productId='common',actor=alice,quantity=1,key='buy-'+(++sequence)) {
    return core.purchase(actor,{...core.quote(actor,{productId,quantity}),key});
  }
  function open(productId='common',actor=alice,quantity=1) {
    return buy(productId,actor,quantity).packs.flatMap(p=>core.openPack(actor,{packId:p.id,key:'open-'+(++sequence)}).cards);
  }
  return {core,c,alice,bob,a,b,buy,open};
}
export function code(errorCode) {return error=>error.code===errorCode;}
