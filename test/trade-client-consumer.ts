import {createClient} from '@digital-card/framework/client';
import {createTradeDraft} from '@digital-card/framework/trade-client';
const draft=createTradeDraft({client:createClient(),userId:'account',catalog:{features:{cardTrading:true,currencyTrading:true},currencies:[{id:'credits',tradable:true}]}});
draft.subscribe(state=>{const version:number|undefined=state.selectedGive[0]?.version;const name:string|undefined=state.selectedGive[0]?.definition?.name;void version;void name;});
draft.add('give','copy');draft.setCurrency('receive','credits',1);
const offer=draft.buildOffer();const version:number|undefined=offer.versions.copy;void version;
// @ts-expect-error sides are explicit so edits cannot target arbitrary state fields
draft.add('inventory','copy');
// @ts-expect-error currency amounts use integer JSON numbers, not strings
draft.setCurrency('give','credits','1');
// @ts-expect-error a client response must provide a checked copy version
createTradeDraft({userId:'account',catalog:{features:{},currencies:[]},client:{tradeInventory:async()=>({owner:null,items:[{id:'copy',tradable:true}],next:null})}});
// @ts-expect-error selected copy versions remain numbers in controller state
const wrong:string=draft.getState().selectedGive[0]!.version;
void wrong;
