import type {PluginHostOptions,PluginHost,PluginCommand,InstalledPlugin} from './plugin-host.js';
export interface PluginManifest {
  contract:'digital-card-plugin-manifest@1';id:string;version:string;protocol:'digital-card-plugin@1';commands:PluginCommand[];
  dependencies:{id:string;version:string}[];configurationSchema:Record<string,unknown>;
  runtime:{kind:'external-http';language:string;prerequisites:string[];migration:'none'|'operator-required'};
}
export interface PluginInstallation extends Omit<InstalledPlugin,'version'> {configuration?:Record<string,unknown>}
export type PluginDeploymentOptions=Omit<PluginHostOptions,'plugins'|'authorize'> & {manifests:PluginManifest[];installations:PluginInstallation[];authorize?(context:Parameters<NonNullable<PluginHostOptions['authorize']>>[0] & {configuration:Record<string,unknown>}):boolean|Promise<boolean>};
export interface PluginDeployment extends Pick<PluginHost,'handle'|'issueDelegation'|'revokeDelegation'|'disable'|'enable'|'dispose'> {
  drain(pluginId:string):void;
  replace(options:{manifests:PluginManifest[];installations:PluginInstallation[];migrationApproved?:string[]}):void;
  status():(ReturnType<PluginHost['status']>[number] & {draining:boolean;dependenciesReady:boolean;configurationValid:true})[];
}
export declare const pluginManifestSchema:Record<string,unknown>;
export declare function validatePluginManifest(input:unknown):PluginManifest;
export declare function createPluginDeployment(options:PluginDeploymentOptions):PluginDeployment;
