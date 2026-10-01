import { fixture, admin } from './helpers.js';
import { MemoryStore, createCodeVault } from '../src/index.js';
export const vault = (options = {}) => createCodeVault({ activeKeyId:'one',keys:{one:Buffer.alloc(32,7)},indexKey:Buffer.alloc(32,9),...options });
export function codesFixture({ store = new MemoryStore(), stock = 8, transfer = 'retain', reveal = 'scratch', type = 'code', clock, ...rest } = {}) {
  const x = fixture({store,codeVault:vault(),clock,...rest,change(c){
    c.cards.push({id:'reward',lineId:'sky',name:'Reward insert',type,behavior:{tradable:true},metadata:{'example.subject':'reward'}});
    c.variants.push({id:'reward.standard',cardId:'reward',rarityId:c.rarities[0].id,codes:[{id:'game',poolId:'rewards',transfer,reveal}]});
    c.products.push({id:'bundle',lineId:'sky',name:'Cards and code',revision:1,price:{currencyId:'credits',amount:10},metadata:{batch:'autumn'},slots:[
      {id:'normal',count:2,pool:[{variantId:'dawn.standard',weight:1}]},
      {id:'reward',role:'insert',count:1,pool:[{variantId:'reward.standard',weight:1}],metadata:{purpose:'bonus'}},
    ]});
    rest.change?.(c);
  }});
  x.core.configureCodePool(admin,{key:'pool',pool:{id:'rewards',providerId:'example.game',name:'Game code',redeemUrl:'https://example.com/redeem',metadata:{region:'global'}}});
  if(stock)x.core.importCodes(admin,{key:'stock',poolId:'rewards',codes:Array.from({length:stock},(_,i)=>({code:'SECRET-REWARD-'+i,externalId:'ext-'+i}))});
  const open = () => x.open('bundle').find(copy=>copy.cardId==='reward');
  return {...x,store,openCode:open};
}
