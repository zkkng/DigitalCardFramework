import {createWireTransport} from './wire-client.js';
export class ApiError extends Error {
  constructor(code,message,status) {super(message);this.code=code;this.status=status;}
}
export function createClient({baseUrl='/api',fetch:request=globalThis.fetch}={}) {
  let principal=null;
  const wire=createWireTransport({baseUrl,fetch:request,principal:()=>principal});
  const query=options=>'?' + new URLSearchParams(Object.entries(options??{}).filter(([,value])=>value!==undefined&&value!==null)).toString();
  async function call(path,body,method=body===undefined?'GET':'POST') {
    const response=await request(baseUrl+path,{method,credentials:'same-origin',
      headers:body===undefined?{}:{'Content-Type':'application/json',...(principal?{'X-DC-Principal':principal}: {})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new ApiError(data.code,data.message,response.status);
    return data;
  }
  return {
    capabilities:()=>wire('capabilities'),
    commandIntents:options=>wire('commandIntents',undefined,{query:options}),
    registerCommandIntent:input=>wire('registerCommandIntent',input),
    executeCommandIntent:input=>wire('executeCommandIntent',input),
    acknowledgeCommandIntent:input=>wire('acknowledgeCommandIntent',input),
    adminOverview:()=>call('/operator/admin'),
    adminUsers:options=>call('/operator/admin/users'+query(options)),
    adminUser:options=>call('/operator/admin/user'+query(options)),
    adminHistory:options=>call('/operator/admin/history'+query(options)),
    configureAdmin:input=>call('/operator/admin/settings',input),
    administerCards:input=>call('/operator/admin/cards',input),
    cardPolicies:()=>call('/operator/card-policies'),effectiveCardPolicy:input=>call('/operator/card-policies/effective',input),saveCardPolicy:input=>call('/operator/card-policies/save',input),previewCardPolicy:input=>call('/operator/card-policies/preview',input),activateCardPolicy:input=>call('/operator/card-policies/activate',input),retireCardPolicy:input=>call('/operator/card-policies/retire',input),restoreCardPolicy:input=>call('/operator/card-policies/restore',input),saveCardResource:input=>call('/operator/card-resources/save',input),retireCardResource:input=>call('/operator/card-resources/retire',input),restoreCardResource:input=>call('/operator/card-resources/restore',input),updateCopyStats:input=>call('/operator/copy-stats',input),
    tradingPolicy:()=>call('/trading-policy'),configureTrading:input=>call('/operator/trading',input),setCardTransferLock:input=>call('/operator/card-lock',input),
    commerceSettings:()=>call('/commerce-settings'),configureCommerce:input=>call('/operator/commerce',input),shops:options=>call('/shops'+query(options)),createShop:input=>call('/shops',input),setShopEnabled:input=>call('/operator/shop-status',input),
    listings:options=>call('/listings'+query(options)),createListing:input=>call('/listings',input),quoteListing:input=>call('/listings/quote',input),buyListing:input=>call('/listings/buy',input),cancelListing:input=>call('/listings/cancel',input),orders:options=>call('/orders'+query(options)),
    enterRaffle:input=>call('/raffles/enter',input),raffleStatus:input=>call('/raffles/status',input),drawRaffle:input=>call('/operator/raffles/draw',input),
    fulfillments:options=>call('/fulfillments'+query(options)),actionJobs:options=>call('/operator/actions'+query(options)),retryAction:input=>call('/operator/actions/retry',input),openCard:input=>call('/cards/open',input),
    catalog:()=>call('/catalog'), me:async()=>{const me=await call('/me');principal=me.userId;return me;}, wallet:()=>call('/wallet'), history:()=>call('/history'),
    inventory:()=>call('/inventory'), packs:()=>call('/packs'), quote:input=>call('/quote',input),
    inventoryPage:options=>call('/inventory'+query({...options,limit:options?.limit??50})),directory:options=>call('/users'+query(options)),
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
    principal:()=>principal,
    requestKey:()=>globalThis.crypto.randomUUID()
  };
}
export function createRevealController({open,key=()=>globalThis.crypto.randomUUID()}) {
  let state={phase:'idle',receipt:null,revealed:0,error:null}, generation=0, pendingKey=null, packId=null, disposed=false, publication=0;
  const listeners=new Set();
  const publish=next=>{if(disposed)return;state={...state,...next};const version=++publication,snapshot=structuredClone(state);for(const fn of listeners){if(disposed||version!==publication)break;fn(structuredClone(snapshot));}};
  return {
    getState:()=>structuredClone(state),
    subscribe(fn) {if(disposed)return ()=>{};listeners.add(fn);fn(structuredClone(state));return ()=>listeners.delete(fn);},
    async load(id) {
      if(disposed)return;
      const current=++generation;
      if(packId!==id) {packId=id;pendingKey=key();}
      publish({phase:'loading',receipt:null,revealed:0,error:null});
      if(disposed||current!==generation)return;
      try {
        const receipt=await open({key:pendingKey,packId:id});
        if(current!==generation) return;
        publish({phase:'ready',receipt,revealed:0});
      } catch(error) {if(current===generation) publish({phase:'error',error:{code:error.code??'NETWORK_ERROR',message:error.message}});}
    },
    reveal() {if(!state.receipt) return; const revealed=Math.min(state.revealed+1,state.receipt.cards.length);publish({revealed,phase:revealed===state.receipt.cards.length?'complete':'revealing'});},
    skip() {if(state.receipt) publish({revealed:state.receipt.cards.length,phase:'complete'});},
    replay() {if(state.receipt) publish({revealed:0,phase:'ready'});},
    dispose() {disposed=true;generation++;listeners.clear();}
  };
}

/** Persist original input before dispatch. Namespace must identify the authenticated principal. */
export function createCommandRunner({client,storage,namespace}) {
  if(typeof namespace!=='string'||!namespace||namespace.length>300)throw new Error('A principal namespace is required');
  if(storage===undefined)try{storage=globalThis.sessionStorage;}catch{}
  const storageKey='digital-card.commands.v1:'+namespace,active=new Map(),uncertain=new Map(),acknowledged=new Map();let disposed=false;
  const serverRecovery=['registerCommandIntent','executeCommandIntent','acknowledgeCommandIntent','commandIntents'].every(name=>typeof client[name]==='function');
  const allowed=new Set(['purchase','openPack','convert','tradeUp','saveAlbum','proposeTrade','acceptTrade','cancelTrade','consumeBinding','counterTrade','preferences','readNotifications','commitImport','reportCodeUsage','createShop','createListing','buyListing','cancelListing','enterRaffle','openCard','configureAdmin','administerCards']);
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
  const unavailable=()=>new ApiError('COMMAND_STORAGE_UNAVAILABLE','Safe command storage is unavailable. Restore storage or use host recovery before retrying.',503);
  function read(){
    try{
      if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw unavailable();
      const raw=storage.getItem(storageKey);if(raw===null||raw===undefined)return Object.create(null);
      if(typeof raw!=='string'||raw.length>1024*1024||new TextEncoder().encode(raw).byteLength>1024*1024)throw unavailable();
      const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>1000)throw unavailable();
      for(const [token,input]of Object.entries(value))if(!allowed.has(token.split(':')[0])||!input||typeof input!=='object'||Array.isArray(input)||typeof input.key!=='string'||!input.key||input.key.length>128||Object.hasOwn(input,'_confirmed')&&typeof input._confirmed!=='boolean')throw unavailable();
      return Object.assign(Object.create(null),value);
    }catch{throw unavailable();}
  }
  function write(pending,preserveToken){
    try{
      const confirmed=Object.keys(pending).filter(token=>pending[token]._confirmed&&token!==preserveToken);
      const currentConfirmed=preserveToken&&pending[preserveToken]?._confirmed?1:0;
      while(confirmed.length+currentConfirmed>256)delete pending[confirmed.shift()];
      let value=JSON.stringify(pending);
      while((Object.keys(pending).length>1000||value.length>1024*1024||new TextEncoder().encode(value).byteLength>1024*1024)&&confirmed.length){delete pending[confirmed.shift()];value=JSON.stringify(pending);}
      if(Object.keys(pending).length>1000||value.length>1024*1024||new TextEncoder().encode(value).byteLength>1024*1024)throw unavailable();
      storage.setItem(storageKey,value);if(storage.getItem(storageKey)!==value)throw unavailable();
      for(const token of acknowledged.keys())if(!pending[token]&&!uncertain.has(token))acknowledged.delete(token);
    }catch{throw unavailable();}
  }
  function fence(){
    if(disposed)throw new ApiError('COMMAND_DISPOSED','This command runner is disposed.',409);
    if(typeof client.principal==='function'&&client.principal()!==namespace)throw new ApiError('PRINCIPAL_CHANGED','The signed-in account changed. Resume with the original account.',409);
  }
  function clean(command,input){
    const value=structuredClone(input);delete value.key;delete value._confirmed;
    if(command!=='buyListing')return value;
    return Object.fromEntries(['listingId','quantity','unitIds','digest','price'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  }
  function tokenFor(command,input){
    const intent=command==='purchase'?{productId:input.productId,quantity:input.quantity}:command==='buyListing'?{listingId:input.listingId,quantity:input.quantity}:input;
    return command+':'+JSON.stringify(stable(intent));
  }
  function clear(token,key,confirmed=false){
    if(disposed)return;
    try{const saved=read();if(saved[token]?.key!==key)return;if(confirmed)saved[token]._confirmed=true;else delete saved[token];write(saved,token);}catch{}
  }
  function run(command,input,{recover=false}={}){
    try{
      fence();if(!allowed.has(command))throw new Error('Unsupported durable command');
      const safe=clean(command,input),token=tokenFor(command,safe);if(active.has(token))return active.get(token);
      const saved=read();
      if(Object.keys(saved).some(key=>key.startsWith(command+':')&&key!==token&&!saved[key]._confirmed))throw new ApiError('COMMAND_PENDING','Resolve the original pending command before making a different purchase or change.',409);
      if(serverRecovery&&!recover&&!saved[token]&&Object.keys(saved).some(key=>key.startsWith(command+':')&&saved[key]._confirmed))return run.beginNew(command,input);
      if(!recover&&acknowledged.get(token)===saved[token]?.key&&saved[token]?._confirmed&&!uncertain.has(token))return run.beginNew(command,input);
      const local=uncertain.get(token),priorAttempt=!!local||!!saved[token];
      if(!saved[token]&&!local){saved[token]={...safe,key:input.key??client.requestKey()};write(saved);}
      const payload=structuredClone(local??saved[token]);delete payload._confirmed;uncertain.set(token,payload);
      const task=Promise.resolve().then(async()=>{
        let intent,executing=false;
        try{
          fence();let result;
          if(serverRecovery){
            intent=await client.registerCommandIntent({command,input:structuredClone(payload)});fence();
            if(intent.command!==command||intent.userId!==namespace)throw new ApiError('PRINCIPAL_CHANGED','The returned command does not belong to this account.',409);
            const originalToken=tokenFor(command,clean(command,intent.input));
            if(originalToken!==token){const journal=read();if(journal[token]?.key===payload.key)delete journal[token];journal[originalToken]=structuredClone(intent.input);write(journal);uncertain.delete(token);uncertain.set(originalToken,structuredClone(intent.input));throw new ApiError('COMMAND_PENDING','Recover the previously reviewed command before making a different change.',409);}
            Object.assign(payload,structuredClone(intent.input));const journal=read();journal[token]=structuredClone(intent.input);write(journal);uncertain.set(token,structuredClone(intent.input));fence();executing=true;
            const response=await client.executeCommandIntent({id:intent.id});result=response.result;
          }else result=await client[command](structuredClone(payload));
          fence();clear(token,payload.key,true);uncertain.delete(token);acknowledged.set(token,payload.key);return result;
        }
        catch(error){
          const definite=Number.isInteger(error.status)&&(error.status>=400&&error.status<500||error.status===507)&&![401,403,429].includes(error.status)&&!['PRINCIPAL_CHANGED','COMMAND_DISPOSED','COMMAND_PENDING'].includes(error.code);
          if(!disposed&&definite){if(serverRecovery&&executing){try{fence();const current=await client.commandIntents({command});fence();if(current.items.some(row=>row.id===intent.id&&row.state==='failed')){clear(token,payload.key,true);uncertain.delete(token);acknowledged.set(token,payload.key);}}catch{}}else if(!serverRecovery&&!priorAttempt){clear(token,payload.key);uncertain.delete(token);}}
          throw error;
        }
        finally{active.delete(token);}
      });active.set(token,task);return task;
    }catch(error){return Promise.reject(error);}
  }
  run.pending=command=>{if(disposed)return null;try{const saved=read(),tokens=Object.keys(saved).filter(key=>key.startsWith(command+':')),token=tokens.find(key=>!saved[key]._confirmed)??tokens.at(-1);return token?structuredClone(saved[token]):null;}catch{return null;}};
  run.recover=(command,input)=>run(command,input,{recover:true});
  run.recoverable=async command=>{fence();if(!serverRecovery)return {items:[]};const result=await client.commandIntents(command?{command}:{});fence();return result;};
  run.resume=intent=>run.recover(intent.command,intent.input);
  run.beginNew=(command,input)=>{
    if(serverRecovery)return (async()=>{
      fence();const token=tokenFor(command,clean(command,input)),saved=read();
      if([...uncertain.keys()].some(key=>key.startsWith(command+':'))||Object.keys(saved).some(key=>key.startsWith(command+':')&&!saved[key]._confirmed))throw new ApiError('COMMAND_PENDING','Recover the original result before starting another command.',409);
      const pending=await client.commandIntents({command});fence();
      for(const intent of pending.items){const originalToken=tokenFor(command,clean(command,intent.input));if(!['completed','failed'].includes(intent.state)||!saved[originalToken]?._confirmed||saved[originalToken].key!==intent.input.key)throw new ApiError('COMMAND_PENDING','Recover the original command before starting another.',409);await client.acknowledgeCommandIntent({id:intent.id});fence();}
      const latest=read();for(const key of Object.keys(latest))if(key.startsWith(command+':')&&latest[key]._confirmed)delete latest[key];write(latest);const next=structuredClone(input);delete next.key;return run(command,next);
    })();
    try{
      fence();const token=tokenFor(command,clean(command,input)),saved=read();
      if(uncertain.has(token)||Object.keys(saved).some(key=>key.startsWith(command+':')&&!saved[key]._confirmed))throw new ApiError('COMMAND_PENDING','Recover the original result before starting another command.',409);
      if(saved[token]){delete saved[token];write(saved);}return run(command,input);
    }catch(error){return Promise.reject(error);}
  };
  run.dispose=()=>{disposed=true;};return run;
}
