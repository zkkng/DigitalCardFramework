import type {Schemas} from './wire-types.js';
export declare const pluginProtocol:'digital-card-plugin@1';
export declare const pluginCommands:readonly ['inventory.read','catalog.read'];
export type PluginCommand='inventory.read'|'catalog.read';
export interface PluginInputs {'inventory.read':{limit?:number;after?:string};'catalog.read':Record<string,never>}
export interface PluginResults {'inventory.read':Schemas['InventoryPage'];'catalog.read':Schemas['CatalogManifest']}
export interface PluginHandshake {protocol:'digital-card-plugin@1';pluginId:string;version:string}
export interface PluginReady extends PluginHandshake {sessionId:string;expiresAt:string;generation:number;commands:PluginCommand[];quotas:{maxRequestBytes:number;maxResponseBytes:number;concurrency:number;timeoutMs:number}}
export type PluginRequest={[C in PluginCommand]:{protocol:'digital-card-plugin@1';sessionId:string;requestId:string;command:C;input:PluginInputs[C]}}[PluginCommand];
export type PluginResponse={[C in PluginCommand]:{protocol:'digital-card-plugin@1';requestId:string;command:C;result:PluginResults[C]}}[PluginCommand];
export interface PluginError {protocol:'digital-card-plugin@1';requestId?:string;error:{code:string;message:string;retryable:boolean}}
export interface PluginMessages {handshakeRequest:PluginHandshake;handshakeResponse:PluginReady;commandRequest:PluginRequest;commandResponse:PluginResponse;closeRequest:{protocol:'digital-card-plugin@1';sessionId:string};closeResponse:{protocol:'digital-card-plugin@1';sessionId:string;status:'closed'};error:PluginError}
export declare const pluginProtocolSchema:Readonly<Record<string,unknown>>;
export declare function validatePluginMessage<K extends keyof PluginMessages>(kind:K,value:unknown):PluginMessages[K];
