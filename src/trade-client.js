/** Headless visual trade draft. State is presentation only; the server owns every transfer. */
export function createTradeDraft({client,userId,catalog,storage,namespace=userId,initial,parentTradeId=null}={}){
  const listeners=new Set(),storageKey='digital-card.trade-draft.v1:'+namespace;
  let generation=0,disposed=false,state={phase:'idle',recipientId:initial?.toUserId??null,owner:null,partner:null,
    inventory:[],partnerInventory:[],give:[],receive:[],giveCurrencies:[],receiveCurrencies:[],message:'',reviewed:false,error:null,
    ownNext:null,partnerNext:null};
  let restored=initial;try{restored??=JSON.parse(storage?.getItem(storageKey)??'null');}catch{}
  const copyMaps={give:new Map(),receive:new Map()};
  const publicState=()=>structuredClone({...state,selectedGive:state.give.map(id=>copyMaps.give.get(id)).filter(Boolean),selectedReceive:state.receive.map(id=>copyMaps.receive.get(id)).filter(Boolean)});
  function publish(change,edit=false){if(disposed)return;state={...state,...change,...(edit?{reviewed:false}: {})};
    if(edit)try{storage?.setItem(storageKey,JSON.stringify({toUserId:state.recipientId,give:{copyIds:state.give,currencies:state.giveCurrencies},receive:{copyIds:state.receive,currencies:state.receiveCurrencies},message:state.message,parentTradeId}));}catch{}
    for(const fn of listeners)fn(publicState());}
  function eligible(copy){return copy?.tradable||parentTradeId&&copy?.lockedBy===parentTradeId;}
  function sideFields(side){if(!['give','receive'].includes(side))throw new Error('Invalid trade side');return side==='give'?{list:'inventory',cursor:'ownNext',owner:userId}:{list:'partnerInventory',cursor:'partnerNext',owner:state.recipientId};}
  function select(side,copyId){sideFields(side);const copy=copyMaps[side].get(copyId);if(!eligible(copy))throw new Error(copy?.untradableReason??'Card is not available');if(state[side].includes(copyId))return;if(state[side].length>=100)throw new Error('An offer can contain at most 100 cards per side');publish({[side]:[...state[side],copyId]},true);}
  async function load(recipientId){const current=++generation;publish({phase:'loading',recipientId,reviewed:false,error:null});
    try{const [own,partner]=await Promise.all([client.tradeInventory(userId,{limit:200}),recipientId?client.tradeInventory(recipientId,{limit:200}):Promise.resolve({items:[],owner:null,next:null})]);if(disposed||generation!==current)return;
      for(const side of ['give','receive'])copyMaps[side].clear();own.items.forEach(copy=>copyMaps.give.set(copy.id,copy));partner.items.forEach(copy=>copyMaps.receive.set(copy.id,copy));
      const restore=restored?.toUserId===recipientId?restored:null;restored=null;
      publish({phase:'ready',owner:own.owner,partner:partner.owner,inventory:own.items,partnerInventory:partner.items,ownNext:own.next,partnerNext:partner.next,
        give:(restore?.give?.copyIds??[]).filter(id=>eligible(copyMaps.give.get(id))),receive:(restore?.receive?.copyIds??[]).filter(id=>eligible(copyMaps.receive.get(id))),
        giveCurrencies:restore?.give?.currencies??[],receiveCurrencies:restore?.receive?.currencies??[],message:restore?.message??''},true);
    }catch(error){if(generation===current)publish({phase:'error',error:error.message,inventory:[],partnerInventory:[],give:[],receive:[]});}
  }
  return {
    getState:publicState,subscribe(fn){listeners.add(fn);fn(publicState());return()=>listeners.delete(fn);},load,
    async more(side){const f=sideFields(side),after=state[f.cursor],current=generation;if(!after)return;const result=await client.tradeInventory(f.owner,{limit:200,after});if(disposed||generation!==current)return;result.items.forEach(copy=>copyMaps[side].set(copy.id,copy));publish({[f.list]:[...state[f.list],...result.items],[f.cursor]:result.next});},
    add:select,remove(side,copyId){sideFields(side);publish({[side]:state[side].filter(id=>id!==copyId)},true);},
    setCurrency(side,currencyId,amount){sideFields(side);if(!catalog.features.currencyTrading)throw new Error('Currency trading is disabled');if(!catalog.currencies.some(c=>c.id===currencyId&&c.tradable))throw new Error('Currency is not tradable');if(!Number.isSafeInteger(amount)||amount<0)throw new Error('Use a nonnegative whole amount');const key=side+'Currencies';const currencies=state[key].filter(c=>c.currencyId!==currencyId);if(amount)currencies.push({currencyId,amount});publish({[key]:currencies},true);},
    setMessage(message){if(typeof message!=='string'||message.length>500)throw new Error('Message is too long');publish({message},true);},
    review(value=true){if(state.phase!=='ready')throw new Error('Load both inventories first');publish({reviewed:!!value});},
    buildOffer(){if(!state.reviewed)throw new Error('Review and confirm the offer contents');if(!state.recipientId)throw new Error('Choose a recipient');if(!state.give.length&&!state.receive.length&&!state.giveCurrencies.length&&!state.receiveCurrencies.length)throw new Error('Add cards or currency');
      return {toUserId:state.recipientId,give:{copyIds:[...state.give],currencies:structuredClone(state.giveCurrencies)},receive:{copyIds:[...state.receive],currencies:structuredClone(state.receiveCurrencies)},versions:Object.fromEntries([...state.give.map(id=>copyMaps.give.get(id)),...state.receive.map(id=>copyMaps.receive.get(id))].map(copy=>[copy.id,copy.version])),message:state.message};},
    clear(){try{storage?.removeItem(storageKey);}catch{}publish({give:[],receive:[],giveCurrencies:[],receiveCurrencies:[],message:'',reviewed:false});},
    dispose(){disposed=true;generation++;listeners.clear();}
  };
}
