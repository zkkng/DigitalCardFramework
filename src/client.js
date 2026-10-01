export class ApiError extends Error {
  constructor(code,message,status) {super(message);this.code=code;this.status=status;}
}
export function createClient({baseUrl='/api',fetch:request=globalThis.fetch}={}) {
  let principal=null;
  const query=options=>'?' + new URLSearchParams(Object.entries(options??{}).filter(([,value])=>value!==undefined&&value!==null)).toString();
  async function call(path,body,method=body===undefined?'GET':'POST') {
    const response=await request(baseUrl+path,{method,credentials:'same-origin',
      headers:body===undefined?{}:{'Content-Type':'application/json',...(principal?{'X-DC-Principal':principal}: {})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new ApiError(data.code,data.message,response.status);
    return data;
  }
  return {
    tradingPolicy:()=>call('/trading-policy'),configureTrading:input=>call('/operator/trading',input),setCardTransferLock:input=>call('/operator/card-lock',input),
    commerceSettings:()=>call('/commerce-settings'),configureCommerce:input=>call('/operator/commerce',input),shops:options=>call('/shops'+query(options)),createShop:input=>call('/shops',input),setShopEnabled:input=>call('/operator/shop-status',input),
    listings:options=>call('/listings'+query(options)),createListing:input=>call('/listings',input),quoteListing:input=>call('/listings/quote',input),buyListing:input=>call('/listings/buy',input),cancelListing:input=>call('/listings/cancel',input),orders:options=>call('/orders'+query(options)),
    enterRaffle:input=>call('/raffles/enter',input),raffleStatus:input=>call('/raffles/status',input),drawRaffle:input=>call('/operator/raffles/draw',input),
    fulfillments:options=>call('/fulfillments'+query(options)),actionJobs:options=>call('/operator/actions'+query(options)),retryAction:input=>call('/operator/actions/retry',input),openCard:input=>call('/cards/open',input),
    catalog:()=>call('/catalog'), me:async()=>{const me=await call('/me');principal=me.userId;return me;}, wallet:()=>call('/wallet'), history:()=>call('/history'),
    inventory:()=>call('/inventory'), packs:()=>call('/packs'), quote:input=>call('/quote',input),
    inventoryPage:options=>call('/inventory'+query({limit:50,...options})),directory:options=>call('/users'+query(options)),
    tradeInventory:(userId,options)=>call('/users/'+encodeURIComponent(userId)+'/inventory'+query(options)),
    availability:()=>call('/availability'),pity:()=>call('/pity'),preferences:input=>call('/preferences',input),
    notifications:options=>call('/notifications'+query(options)),readNotifications:input=>call('/notifications/read',input),
    operatorCatalog:()=>call('/operator/catalog'),previewImport:input=>call('/operator/import/preview',input),commitImport:input=>call('/operator/import/commit',input),
    purchase:input=>call('/purchase',input), openPack:input=>call('/open',input),
    reconcileCurrency:input=>call('/currency/reconcile',input),
    convert:input=>call('/convert',input), tradeUp:input=>call('/trade-up',input),
    albums:()=>call('/albums'), saveAlbum:input=>call('/albums',input), viewAlbum:albumId=>call('/albums/'+encodeURIComponent(albumId)),
    publicAlbums:()=>call('/public-albums'), trades:()=>call('/trades'), proposeTrade:input=>call('/trades',input),
    acceptTrade:input=>call('/trades/accept',input), cancelTrade:input=>call('/trades/cancel',input),
    counterTrade:input=>call('/trades/counter',input),
    bindings:()=>call('/bindings'), consumeBinding:input=>call('/bindings/use',input),
    codeHistory:options=>call('/codes'+query(options)),revealCode:input=>call('/codes/reveal',input),reportCodeUsage:input=>call('/codes/report',input),reconcileCode:input=>call('/codes/reconcile',input),
    codeInventory:options=>call('/operator/codes'+query(options)),codePools:()=>call('/operator/code-pools'),configureCodePool:input=>call('/operator/code-pools',input),importCodes:input=>call('/operator/codes/import',input),confirmCodeStatus:input=>call('/operator/codes/confirm',input),
    inspectCard:copyId=>call('/cards/'+encodeURIComponent(copyId)),
    requestKey:()=>globalThis.crypto.randomUUID()
  };
}
export function createRevealController({open,key=()=>globalThis.crypto.randomUUID()}) {
  let state={phase:'idle',receipt:null,revealed:0,error:null}, generation=0, pendingKey=null, packId=null;
  const listeners=new Set();
  const publish=next=>{state={...state,...next}; for(const fn of listeners) fn(structuredClone(state));};
  return {
    getState:()=>structuredClone(state),
    subscribe(fn) {listeners.add(fn);fn(structuredClone(state));return ()=>listeners.delete(fn);},
    async load(id) {
      const current=++generation;
      if(packId!==id) {packId=id;pendingKey=key();}
      publish({phase:'loading',receipt:null,revealed:0,error:null});
      try {
        const receipt=await open({key:pendingKey,packId:id});
        if(current!==generation) return;
        publish({phase:'ready',receipt,revealed:0});
      } catch(error) {if(current===generation) publish({phase:'error',error:{code:error.code??'NETWORK_ERROR',message:error.message}});}
    },
    reveal() {if(!state.receipt) return; const revealed=Math.min(state.revealed+1,state.receipt.cards.length);publish({revealed,phase:revealed===state.receipt.cards.length?'complete':'revealing'});},
    skip() {if(state.receipt) publish({revealed:state.receipt.cards.length,phase:'complete'});},
    replay() {if(state.receipt) publish({revealed:0,phase:'ready'});},
    dispose() {generation++;listeners.clear();}
  };
}

/** Persist a command before sending it; ambiguous failures reuse its original key and payload.
 * namespace must identify the signed-in principal. storage uses the Web Storage interface.
 */
export function createCommandRunner({client,storage,namespace='default'}) {
  const storageKey='digital-card.commands.v1:'+namespace;
  let pending=Object.create(null);
  try{const value=JSON.parse(storage?.getItem(storageKey)??'null');if(value&&typeof value==='object'&&!Array.isArray(value))pending=Object.assign(Object.create(null),value);}catch{}
  const active=new Map();
  const persist=()=>{try{storage?.setItem(storageKey,JSON.stringify(pending));}catch{/* Blocked storage keeps retry keys for this mounted session. */}};
  const stable=x=>Array.isArray(x)?x.map(stable):x && typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
  const allowed=new Set(['purchase','openPack','convert','tradeUp','saveAlbum','proposeTrade','acceptTrade','cancelTrade','consumeBinding','counterTrade','preferences','readNotifications','commitImport','reportCodeUsage','createShop','createListing','buyListing','cancelListing','enterRaffle','openCard']);
  return function run(command,input) {
    if(!allowed.has(command))throw new Error('Unsupported durable command');
    const intent=command==='purchase'?{productId:input.productId,quantity:input.quantity}:input;
    const token=command+':'+JSON.stringify(stable(intent));
    if(active.has(token))return active.get(token);
    if(!pending[token]){pending[token]={...input,key:client.requestKey()};persist();}
    const payload=pending[token];
    const clear=()=>{
      delete pending[token];
      try {persist();} catch {pending[token]=payload;}
    };
    const task=Promise.resolve().then(async()=>{
      try{const result=await client[command](payload);clear();return result;}
      catch(error){if(error.status && error.status<500)clear();throw error;}
      finally{active.delete(token);}
    });
    active.set(token,task);return task;
  };
}
