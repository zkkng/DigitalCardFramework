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
export class ApiError extends Error {
  code:string;status:number;
  constructor(code:string,message:string,status:number);
}
export function createClient(options?:{baseUrl?:string;fetch?:typeof globalThis.fetch}):Client;

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
export function createRevealController(options:{open:(input:Operations['openPack']['request'])=>Schemas['Receipt']|Promise<Schemas['Receipt']>;key?:()=>string}):RevealController;

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
export function createCommandRunner(options:{client:Partial<Client>&Pick<Client,'requestKey'>;storage?:CommandStorage;namespace:string}):CommandRunner;
