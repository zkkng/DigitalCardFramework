export class ApiError extends Error {
  constructor(code,message,status) {super(message);this.code=code;this.status=status;}
}
export function createClient({baseUrl='/api',fetch:request=globalThis.fetch}={}) {
  async function call(path,body,method=body===undefined?'GET':'POST') {
    const response=await request(baseUrl+path,{method,credentials:'same-origin',
      headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new ApiError(data.code,data.message,response.status);
    return data;
  }
  return {
    catalog:()=>call('/catalog'), me:()=>call('/me'), wallet:()=>call('/wallet'), history:()=>call('/history'),
    inventory:()=>call('/inventory'), packs:()=>call('/packs'), quote:input=>call('/quote',input),
    purchase:input=>call('/purchase',input), openPack:input=>call('/open',input),
    convert:input=>call('/convert',input), tradeUp:input=>call('/trade-up',input),
    albums:()=>call('/albums'), saveAlbum:input=>call('/albums',input), viewAlbum:albumId=>call('/albums/'+encodeURIComponent(albumId)),
    publicAlbums:()=>call('/public-albums'), trades:()=>call('/trades'), proposeTrade:input=>call('/trades',input),
    acceptTrade:input=>call('/trades/accept',input), cancelTrade:input=>call('/trades/cancel',input),
    bindings:()=>call('/bindings'), consumeBinding:input=>call('/bindings/use',input),
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
  let pending=storage?.getItem(storageKey)?JSON.parse(storage.getItem(storageKey)):{};
  const active=new Map();
  const persist=()=>storage?.setItem(storageKey,JSON.stringify(pending));
  const stable=x=>Array.isArray(x)?x.map(stable):x && typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
  const allowed=new Set(['purchase','openPack','convert','tradeUp','saveAlbum','proposeTrade','acceptTrade','cancelTrade','consumeBinding']);
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
