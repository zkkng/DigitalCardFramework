import type {Schemas} from './wire-types.js';
import type {PluginCommand,PluginInputs} from './plugin-contracts.js';
export {pluginProtocol,pluginCommands,pluginProtocolSchema,validatePluginMessage} from './plugin-contracts.js';
export type {PluginCommand,PluginInputs,PluginResults,PluginRequest,PluginResponse,PluginReady} from './plugin-contracts.js';
export interface PluginActor {userId:string;disabled?:boolean;role?:string;permissions?:string[]}
export interface InstalledPlugin {id:string;version:string;token:string;commands:PluginCommand[];userIds:string[]}
export interface PluginHttpRequest extends AsyncIterable<Uint8Array> {url?:string;method?:string;headers:Record<string,string|string[]|undefined>;socket?:{encrypted?:boolean;remoteAddress?:string};destroy(error?:Error):unknown}
export interface PluginHttpResponse {destroyed:boolean;writableEnded:boolean;statusCode:number;setHeader(name:string,value:string):unknown;end(body?:string):unknown;once(event:'close',listener:()=>void):unknown;removeListener(event:'close',listener:()=>void):unknown}
export interface PluginFramework {
  inventoryPage(actor:PluginActor,options:{limit?:number;after?:string}):Schemas['InventoryPage']|Promise<Schemas['InventoryPage']>;
  operatorCatalog(actor:PluginActor):Schemas['CatalogManifest']|Promise<Schemas['CatalogManifest']>;
}
export interface PluginHostOptions {
  framework:PluginFramework;plugins:InstalledPlugin[];
  resolveActor(userId:string,options:{signal:AbortSignal}):PluginActor|null|Promise<PluginActor|null>;
  authorize?(context:{pluginId:string;command:PluginCommand;actor:PluginActor;input:PluginInputs[PluginCommand];signal:AbortSignal}):boolean|Promise<boolean>;
  clock?:()=>number;timeoutMs?:number;sessionTTL?:number;delegationTTL?:number;maxSessions?:number;maxDelegations?:number;concurrency?:number;totalConcurrency?:number;maxRequestBytes?:number;maxResponseBytes?:number;
}
export interface PluginHost {
  handle(request:PluginHttpRequest,response:PluginHttpResponse):Promise<boolean>;
  /** Trusted host code must pass an already verified principal. */
  issueDelegation(input:{pluginId:string;actor:PluginActor;commands:PluginCommand[];ttlMs?:number}):string;
  revokeDelegation(token:string):void;
  disable(pluginId:string):void;
  enable(pluginId:string,options:{token:string;commands?:PluginCommand[]}):void;
  setGrants(pluginId:string,commands:PluginCommand[]):void;
  status():{pluginId:string;version:string;enabled:boolean;generation:number;commands:PluginCommand[];active:number;sessions:number}[];
  dispose():void;
}
export declare function createPluginHost(options:PluginHostOptions):PluginHost;
