import {createWireTransport,WireApiError} from './wire-client.js';
import type {WireCallOptions} from './wire-client.js';
import {WireContractError,validateWireResponse} from './wire-contracts.js';
import type {Operations,Schemas} from './wire-types.js';

type QueryOperation='adminUsers'|'adminHistory'|'shops'|'listings'|'orders'|'fulfillments'|'actionJobs'|'directory'|'notifications'|'codeHistory'|'codeInventory';
type DirectOperation='quote'|'purchase'|'openPack'|'convert'|'tradeUp'|'saveAlbum'|'albums'|'proposeTrade'|'trades'|'acceptTrade'|'cancelTrade'|'consumeBinding'|'catalog'|'me'|'wallet'|'history'|'packs'|'publicAlbums'|'bindings'|'availability'|'readNotifications'|'counterTrade'|'operatorCatalog'|'previewImport'|'commitImport'|'reconcileCurrency'|'revealCode'|'reportCodeUsage'|'reconcileCode'|'codePools'|'configureCodePool'|'importCodes'|'confirmCodeStatus'|'tradingPolicy'|'configureTrading'|'setCardTransferLock'|'commerceSettings'|'configureCommerce'|'createShop'|'setShopEnabled'|'createListing'|'quoteListing'|'buyListing'|'cancelListing'|'enterRaffle'|'raffleStatus'|'drawRaffle'|'openCard'|'retryAction'|'cardPolicies'|'effectiveCardPolicy'|'saveCardPolicy'|'previewCardPolicy'|'activateCardPolicy'|'retireCardPolicy'|'restoreCardPolicy'|'saveCardResource'|'retireCardResource'|'restoreCardResource'|'updateCopyStats'|'adminOverview'|'configureAdmin'|'administerCards'|'registerCommandIntent'|'executeCommandIntent'|'acknowledgeCommandIntent';
type DirectMethods={
  [K in DirectOperation]: Operations[K]['request'] extends undefined
    ? ()=>Promise<Operations[K]['response']>
    : (input:Operations[K]['request'])=>Promise<Operations[K]['response']>;
};
type QueryMethods={[K in QueryOperation]:(options?:QueryOptions)=>Promise<Operations[K]['response']>};
export interface QueryOptions {
  limit?:number;after?:string;search?:string;sort?:'newest'|'name'|'ordinal';
  [key:string]:string|number|boolean|null|undefined;
}
export interface Client extends DirectMethods,QueryMethods {
  capabilities():Promise<Schemas['CapabilityAvailability']>;
  commandIntents(options?:{command?:DurableCommand}):Promise<Operations['commandIntents']['response']>;
  adminUser(options:QueryOptions&{userId:string}):Promise<Schemas['AdminUserDetail']>;
  inventory():Promise<Schemas['InventoryCopy'][]>;
  inventoryPage(options?:QueryOptions):Promise<Schemas['InventoryPage']>;
  tradeInventory(userId:string,options?:QueryOptions):Promise<Schemas['TradeInventoryPage']>;
  inspectCard(copyId:string):Promise<Operations['inspectCard']['response']>;
  viewAlbum(albumId:string):Promise<Operations['viewAlbum']['response']>;
  preferences(input:Operations['setPreferences']['request']):Promise<Operations['setPreferences']['response']>;
  pity():Promise<Operations['pityProgress']['response']>;
  principal():string|null;
  requestKey():string;
}


export interface RevealState {
  phase:'idle'|'loading'|'ready'|'revealing'|'complete'|'error';
  receipt:Schemas['Receipt']|null;revealed:number;error:{code:string;message:string}|null;
}
export interface RevealController {
  getState():RevealState;
  subscribe(listener:(state:RevealState)=>void):()=>void;
  load(packId:string):Promise<void>;
  reveal():void;skip():void;replay():void;dispose():void;
}

export type DurableCommand=Schemas['CommandIntent']['command'];
type CommandOperation<C extends DurableCommand>=C extends 'preferences'?'setPreferences':C;
type WithoutKey<T>=T extends object?Omit<T,'key'>&{key?:string}:never;
export type CommandInput<C extends DurableCommand>=WithoutKey<Operations[CommandOperation<C>]['request']>;
export type CommandResult<C extends DurableCommand>=Operations[CommandOperation<C>]['response'];
export interface CommandStorage {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem?(key:string):void;
}
export interface CommandRunner {
  <C extends DurableCommand>(command:C,input:CommandInput<C>,options?:{recover?:boolean}):Promise<CommandResult<C>>;
  recover<C extends DurableCommand>(command:C,input:CommandInput<C>):Promise<CommandResult<C>>;
  beginNew<C extends DurableCommand>(command:C,input:CommandInput<C>):Promise<CommandResult<C>>;
  pending(command:DurableCommand):({key:string;_confirmed?:boolean;[field:string]:unknown})|null;
  recoverable(command?:DurableCommand):Promise<Operations['commandIntents']['response']>;
  resume(intent:Schemas['CommandIntent']):Promise<CommandResult<DurableCommand>>;
  dispose():void;
}


export class ApiError extends Error {
  code:string;status:number;
  constructor(code:string,message:string,status:number){super(message);this.code=code;this.status=status;}
}
export function createClient({baseUrl='/api',fetch:request=globalThis.fetch}:{baseUrl?:string;fetch?:typeof globalThis.fetch}={}):Client {
  let principal:string|null=null;
  const wire=createWireTransport({baseUrl,fetch:request,principal:()=>principal});
  async function call<K extends keyof Operations>(id:K,input:Operations[K]['request'],options:WireCallOptions<K>={}):Promise<Operations[K]['response']>{
    try{return await wire(id,input,options);}catch(error){if(error instanceof WireApiError)throw new ApiError(error.code,error.message,error.status);if(error instanceof WireContractError&&error.phase==='request')throw new ApiError('INVALID_INPUT',error.message,400);throw error;}
  }
  return {
    capabilities:()=>call('capabilities',undefined),commandIntents:options=>call('commandIntents',undefined,{query:options}),
    registerCommandIntent:input=>call('registerCommandIntent',input),executeCommandIntent:input=>call('executeCommandIntent',input),acknowledgeCommandIntent:input=>call('acknowledgeCommandIntent',input),
    adminOverview:()=>call('adminOverview',undefined),adminUsers:options=>call('adminUsers',undefined,{query:options}),adminUser:options=>call('adminUser',undefined,{query:options}),adminHistory:options=>call('adminHistory',undefined,{query:options}),configureAdmin:input=>call('configureAdmin',input),administerCards:input=>call('administerCards',input),
    cardPolicies:()=>call('cardPolicies',undefined),effectiveCardPolicy:input=>call('effectiveCardPolicy',input),saveCardPolicy:input=>call('saveCardPolicy',input),previewCardPolicy:input=>call('previewCardPolicy',input),activateCardPolicy:input=>call('activateCardPolicy',input),retireCardPolicy:input=>call('retireCardPolicy',input),restoreCardPolicy:input=>call('restoreCardPolicy',input),saveCardResource:input=>call('saveCardResource',input),retireCardResource:input=>call('retireCardResource',input),restoreCardResource:input=>call('restoreCardResource',input),updateCopyStats:input=>call('updateCopyStats',input),
    tradingPolicy:()=>call('tradingPolicy',undefined),configureTrading:input=>call('configureTrading',input),setCardTransferLock:input=>call('setCardTransferLock',input),commerceSettings:()=>call('commerceSettings',undefined),configureCommerce:input=>call('configureCommerce',input),shops:options=>call('shops',undefined,{query:options}),createShop:input=>call('createShop',input),setShopEnabled:input=>call('setShopEnabled',input),
    listings:options=>call('listings',undefined,{query:options}),createListing:input=>call('createListing',input),quoteListing:input=>call('quoteListing',input),buyListing:input=>call('buyListing',input),cancelListing:input=>call('cancelListing',input),orders:options=>call('orders',undefined,{query:options}),enterRaffle:input=>call('enterRaffle',input),raffleStatus:input=>call('raffleStatus',input),drawRaffle:input=>call('drawRaffle',input),fulfillments:options=>call('fulfillments',undefined,{query:options}),actionJobs:options=>call('actionJobs',undefined,{query:options}),retryAction:input=>call('retryAction',input),openCard:input=>call('openCard',input),
    catalog:()=>call('catalog',undefined),me:async()=>{const me=await call('me',undefined);principal=me.userId;return me;},wallet:()=>call('wallet',undefined),history:()=>call('history',undefined),
    inventory:async()=>{const result=await call('inventory',undefined);if(!Array.isArray(result))throw new WireContractError('inventory','response-mode',[]);return result;},packs:()=>call('packs',undefined),quote:input=>call('quote',input),
    inventoryPage:async options=>{const result=await call('inventory',undefined,{query:{...options,limit:options?.limit??50}});if(Array.isArray(result))throw new WireContractError('inventory','response-mode',[]);return result;},directory:options=>call('directory',undefined,{query:options}),tradeInventory:(userId,options)=>call('tradeInventory',undefined,{path:{userId},query:options}),
    availability:()=>call('availability',undefined),pity:()=>call('pityProgress',undefined),preferences:input=>call('setPreferences',input),notifications:options=>call('notifications',undefined,{query:options}),readNotifications:input=>call('readNotifications',input),operatorCatalog:()=>call('operatorCatalog',undefined),previewImport:input=>call('previewImport',input),commitImport:input=>call('commitImport',input),purchase:input=>call('purchase',input),openPack:input=>call('openPack',input),reconcileCurrency:input=>call('reconcileCurrency',input),convert:input=>call('convert',input),tradeUp:input=>call('tradeUp',input),albums:()=>call('albums',undefined),saveAlbum:input=>call('saveAlbum',input),viewAlbum:albumId=>call('viewAlbum',undefined,{path:{albumId}}),publicAlbums:()=>call('publicAlbums',undefined),trades:()=>call('trades',undefined),proposeTrade:input=>call('proposeTrade',input),acceptTrade:input=>call('acceptTrade',input),cancelTrade:input=>call('cancelTrade',input),counterTrade:input=>call('counterTrade',input),bindings:()=>call('bindings',undefined),consumeBinding:input=>call('consumeBinding',input),codeHistory:options=>call('codeHistory',undefined,{query:options}),revealCode:input=>call('revealCode',input),reportCodeUsage:input=>call('reportCodeUsage',input),reconcileCode:input=>call('reconcileCode',input),codeInventory:options=>call('codeInventory',undefined,{query:options}),codePools:()=>call('codePools',undefined),configureCodePool:input=>call('configureCodePool',input),importCodes:input=>call('importCodes',input),confirmCodeStatus:input=>call('confirmCodeStatus',input),inspectCard:copyId=>call('inspectCard',undefined,{path:{copyId}}),principal:()=>principal,requestKey:()=>globalThis.crypto.randomUUID()
  };
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function failure(error:unknown){const value=record(error)?error:{};return {code:typeof value.code==='string'?value.code:'NETWORK_ERROR',message:typeof value.message==='string'?value.message:String(error),status:typeof value.status==='number'?value.status:undefined};}
export function createRevealController({open,key=()=>globalThis.crypto.randomUUID()}:{open:(input:Operations['openPack']['request'])=>Schemas['Receipt']|Promise<Schemas['Receipt']>;key?:()=>string}):RevealController {
  let state:RevealState={phase:'idle',receipt:null,revealed:0,error:null},generation=0,pendingKey:string|null=null,packId:string|null=null,disposed=false,publication=0;
  const listeners=new Set<(state:RevealState)=>void>();
  const publish=(next:Partial<RevealState>)=>{if(disposed)return;state={...state,...next};const version=++publication,snapshot=structuredClone(state);for(const listener of listeners){if(disposed||version!==publication)break;listener(structuredClone(snapshot));}};
  return {
    getState:()=>structuredClone(state),subscribe(listener){if(disposed)return()=>{};listeners.add(listener);listener(structuredClone(state));return()=>{listeners.delete(listener);};},
    async load(id){if(disposed)return;const current=++generation;if(packId!==id){packId=id;pendingKey=key();}publish({phase:'loading',receipt:null,revealed:0,error:null});if(disposed||current!==generation)return;
      try{if(pendingKey===null)throw new Error('Opening identity is unavailable');const receipt=await open({key:pendingKey,packId:id});if(current!==generation)return;publish({phase:'ready',receipt,revealed:0});}catch(error){if(current===generation){const {code,message}=failure(error);publish({phase:'error',error:{code,message}});}}
    },
    reveal(){if(!state.receipt)return;const revealed=Math.min(state.revealed+1,state.receipt.cards.length);publish({revealed,phase:revealed===state.receipt.cards.length?'complete':'revealing'});},skip(){if(state.receipt)publish({revealed:state.receipt.cards.length,phase:'complete'});},replay(){if(state.receipt)publish({revealed:0,phase:'ready'});},dispose(){disposed=true;generation++;listeners.clear();}
  };
}
type StoredCommand=Record<string,unknown>&{key:string;_confirmed?:boolean};
type Journal=Record<string,StoredCommand>;
function stored(value:unknown):value is StoredCommand{return record(value)&&typeof value.key==='string'&&!!value.key&&value.key.length<=128&&(!Object.hasOwn(value,'_confirmed')||typeof value._confirmed==='boolean');}
function stable(value:unknown):unknown {return Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;}
/** Persist original input before dispatch. Namespace must identify the authenticated principal. */
export function createCommandRunner({client,storage,namespace}:{client:Partial<Client>&Pick<Client,'requestKey'>;storage?:CommandStorage;namespace:string}):CommandRunner {
  if(typeof namespace!=='string'||!namespace||namespace.length>300)throw new Error('A principal namespace is required');
  if(storage===undefined)try{storage=globalThis.sessionStorage;}catch{}
  const storageKey='digital-card.commands.v1:'+namespace,active=new Map<string,Promise<CommandResult<DurableCommand>>>(),uncertain=new Map<string,StoredCommand>(),acknowledged=new Map<string,string>();let disposed=false;
  const recovery=typeof client.registerCommandIntent==='function'&&typeof client.executeCommandIntent==='function'&&typeof client.acknowledgeCommandIntent==='function'&&typeof client.commandIntents==='function'?{
    register:(input:Operations['registerCommandIntent']['request'])=>client.registerCommandIntent!(input),
    execute:(input:Operations['executeCommandIntent']['request'])=>client.executeCommandIntent!(input),
    acknowledge:(input:Operations['acknowledgeCommandIntent']['request'])=>client.acknowledgeCommandIntent!(input),
    list:(input?:{command?:DurableCommand})=>client.commandIntents!(input)
  }:null;
  const allowed=new Set<string>(['purchase','openPack','convert','tradeUp','saveAlbum','proposeTrade','acceptTrade','cancelTrade','consumeBinding','counterTrade','preferences','readNotifications','commitImport','reportCodeUsage','createShop','createListing','buyListing','cancelListing','enterRaffle','openCard','configureAdmin','administerCards']);
  const unavailable=()=>new ApiError('COMMAND_STORAGE_UNAVAILABLE','Safe command storage is unavailable. Restore storage or use host recovery before retrying.',503);
  function read():Journal {
    try{
      if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw unavailable();const raw=storage.getItem(storageKey);if(raw===null||raw===undefined)return Object.create(null) as Journal;
      if(typeof raw!=='string'||raw.length>1048576||new TextEncoder().encode(raw).byteLength>1048576)throw unavailable();const value:unknown=JSON.parse(raw);if(!record(value)||Object.keys(value).length>1000)throw unavailable();
      const result:Journal=Object.create(null);for(const [token,input]of Object.entries(value)){if(!allowed.has(token.split(':')[0]??'')||!stored(input))throw unavailable();result[token]=input;}return result;
    }catch{throw unavailable();}
  }
  function write(pending:Journal,preserveToken?:string){
    try{
      if(!storage)throw unavailable();const confirmed=Object.keys(pending).filter(token=>pending[token]?._confirmed&&token!==preserveToken),currentConfirmed=preserveToken&&pending[preserveToken]?._confirmed?1:0;
      while(confirmed.length+currentConfirmed>256){const oldest=confirmed.shift();if(oldest!==undefined)delete pending[oldest];}let value=JSON.stringify(pending);
      while((Object.keys(pending).length>1000||value.length>1048576||new TextEncoder().encode(value).byteLength>1048576)&&confirmed.length){const oldest=confirmed.shift();if(oldest!==undefined)delete pending[oldest];value=JSON.stringify(pending);}
      if(Object.keys(pending).length>1000||value.length>1048576||new TextEncoder().encode(value).byteLength>1048576)throw unavailable();storage.setItem(storageKey,value);if(storage.getItem(storageKey)!==value)throw unavailable();for(const token of acknowledged.keys())if(!pending[token]&&!uncertain.has(token))acknowledged.delete(token);
    }catch{throw unavailable();}
  }
  function fence(){if(disposed)throw new ApiError('COMMAND_DISPOSED','This command runner is disposed.',409);if(typeof client.principal==='function'&&client.principal()!==namespace)throw new ApiError('PRINCIPAL_CHANGED','The signed-in account changed. Resume with the original account.',409);}
  function clean(command:DurableCommand,input:unknown):Record<string,unknown>{if(!record(input))throw new Error('Command input must be an object');const value=structuredClone(input);delete value.key;delete value._confirmed;if(command!=='buyListing')return value;return Object.fromEntries(['listingId','quantity','unitIds','digest','price'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));}
  function tokenFor(command:DurableCommand,input:Record<string,unknown>){const intent=command==='purchase'?{productId:input.productId,quantity:input.quantity}:command==='buyListing'?{listingId:input.listingId,quantity:input.quantity}:input;return command+':'+JSON.stringify(stable(intent));}
  function clear(token:string,key:string,confirmed=false){if(disposed)return;try{const saved=read(),row=saved[token];if(row?.key!==key)return;if(confirmed)row._confirmed=true;else delete saved[token];write(saved,token);}catch{}}
  // Command tokens include the command name, so cached tasks retain their result type.
  function execute<C extends DurableCommand>(command:C,payload:StoredCommand):Promise<CommandResult<C>>{
    const method=client[command] as ((input:StoredCommand)=>Promise<CommandResult<C>>)|undefined;
    if(typeof method!=='function')return Promise.reject(new Error('Unsupported durable command'));return method.call(client,structuredClone(payload));
  }
  function run<C extends DurableCommand>(command:C,input:CommandInput<C>,{recover=false}: {recover?:boolean}={}):Promise<CommandResult<C>> {
    try{
      fence();if(!allowed.has(command))throw new Error('Unsupported durable command');const safe=clean(command,input),token=tokenFor(command,safe),existing=active.get(token);if(existing)return existing as Promise<CommandResult<C>>;
      const saved=read();if(Object.keys(saved).some(key=>key.startsWith(command+':')&&key!==token&&!saved[key]?._confirmed))throw new ApiError('COMMAND_PENDING','Resolve the original pending command before making a different purchase or change.',409);
      if(recovery&&!recover&&!saved[token]&&Object.keys(saved).some(key=>key.startsWith(command+':')&&saved[key]?._confirmed))return run.beginNew(command,input);
      if(!recover&&acknowledged.get(token)===saved[token]?.key&&saved[token]?._confirmed&&!uncertain.has(token))return run.beginNew(command,input);
      const local=uncertain.get(token),priorAttempt=!!local||!!saved[token];if(!saved[token]&&!local){const key=input.key??client.requestKey();if(typeof key!=='string'||!key||key.length>128)throw unavailable();saved[token]={...safe,key};write(saved);}
      const selected=local??saved[token];if(!selected)throw unavailable();const payload=structuredClone(selected);delete payload._confirmed;uncertain.set(token,payload);
      const task:Promise<CommandResult<C>>=Promise.resolve().then(async()=>{
        let intent:Schemas['CommandIntent']|undefined,executing=false;
        try{
          fence();let result:CommandResult<C>;
          if(recovery){
            intent=await recovery.register({command,input:structuredClone(payload)} as Operations['registerCommandIntent']['request']);fence();
            if(intent.command!==command||intent.userId!==namespace)throw new ApiError('PRINCIPAL_CHANGED','The returned command does not belong to this account.',409);
            const originalToken=tokenFor(command,clean(command,intent.input));if(originalToken!==token){const journal=read();if(journal[token]?.key===payload.key)delete journal[token];journal[originalToken]=structuredClone(intent.input);write(journal);uncertain.delete(token);uncertain.set(originalToken,structuredClone(intent.input));throw new ApiError('COMMAND_PENDING','Recover the previously reviewed command before making a different change.',409);}
            Object.assign(payload,structuredClone(intent.input));const journal=read();journal[token]=structuredClone(intent.input);write(journal);uncertain.set(token,structuredClone(intent.input));fence();executing=true;
            const response=await recovery.execute({id:intent.id});if(response.intent.id!==intent.id||response.intent.command!==command||response.intent.userId!==namespace||!['completed','acknowledged'].includes(response.intent.state)||JSON.stringify(stable(response.intent.input))!==JSON.stringify(stable(intent.input)))throw new ApiError('COMMAND_RECOVERY_MISMATCH','Command recovery response does not match the original intent.',502);
            validateWireResponse(command==='preferences'?'setPreferences':command,200,response.result);
            result=response.result as CommandResult<C>;
          }else result=await execute(command,payload);
          fence();clear(token,payload.key,true);uncertain.delete(token);acknowledged.set(token,payload.key);return result;
        }catch(error){
          const detail=failure(error),status=detail.status,definite=typeof status==='number'&&Number.isInteger(status)&&(status>=400&&status<500||status===507)&&![401,403,429].includes(status)&&!['PRINCIPAL_CHANGED','COMMAND_DISPOSED','COMMAND_PENDING'].includes(detail.code);
          if(!disposed&&definite){if(recovery&&executing&&intent){try{fence();const current=await recovery.list({command});fence();const id=intent.id;if(current.items.some(row=>row.id===id&&row.state==='failed')){clear(token,payload.key,true);uncertain.delete(token);acknowledged.set(token,payload.key);}}catch{}}else if(!priorAttempt&&(!recovery||!executing&&detail.code==='INVALID_INPUT')){clear(token,payload.key);uncertain.delete(token);}}
          throw error;
        }finally{active.delete(token);}
      });active.set(token,task);return task;
    }catch(error){return Promise.reject(error);}
  }
  run.pending=(command:DurableCommand)=>{if(disposed)return null;try{const saved=read(),tokens=Object.keys(saved).filter(key=>key.startsWith(command+':')),token=tokens.find(key=>!saved[key]?._confirmed)??tokens.at(-1);return token&&saved[token]?structuredClone(saved[token]):null;}catch{return null;}};
  run.recover=<C extends DurableCommand>(command:C,input:CommandInput<C>)=>run(command,input,{recover:true});
  run.recoverable=async(command?:DurableCommand)=>{fence();if(!recovery)return {items:[]};const result=await recovery.list(command?{command}:{});fence();return result;};
  run.resume=(intent:Schemas['CommandIntent'])=>run.recover(intent.command,intent.input as CommandInput<DurableCommand>);
  run.beginNew=<C extends DurableCommand>(command:C,input:CommandInput<C>):Promise<CommandResult<C>>=>{
    if(recovery)return (async()=>{fence();const token=tokenFor(command,clean(command,input)),saved=read();if([...uncertain.keys()].some(key=>key.startsWith(command+':'))||Object.keys(saved).some(key=>key.startsWith(command+':')&&!saved[key]?._confirmed))throw new ApiError('COMMAND_PENDING','Recover the original result before starting another command.',409);const pending=await recovery.list({command});fence();
      for(const intent of pending.items){const originalToken=tokenFor(command,clean(command,intent.input));if(!['completed','failed'].includes(intent.state)||!saved[originalToken]?._confirmed||saved[originalToken]?.key!==intent.input.key)throw new ApiError('COMMAND_PENDING','Recover the original command before starting another.',409);await recovery.acknowledge({id:intent.id});fence();}
      const latest=read();for(const key of Object.keys(latest))if(key.startsWith(command+':')&&latest[key]?._confirmed)delete latest[key];write(latest);const next=structuredClone(input);delete next.key;return run(command,next);
    })();
    try{fence();const token=tokenFor(command,clean(command,input)),saved=read();if(uncertain.has(token)||Object.keys(saved).some(key=>key.startsWith(command+':')&&!saved[key]?._confirmed))throw new ApiError('COMMAND_PENDING','Recover the original result before starting another command.',409);if(saved[token]){delete saved[token];write(saved);}return run(command,input);}catch(error){return Promise.reject(error);}
  };
  run.dispose=()=>{disposed=true;};return run;
}
