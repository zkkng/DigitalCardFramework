/** Key implemented API contracts, runtime 0.1.0. Module JSDoc documents advanced adapters. */
export type Digest = `sha256:${string}`;
export type Quality = 'poster' | 'lite' | 'standard' | 'ultra';
export type Side = 'front' | 'back';
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface PresentationRef {contract:'digital-card@0.1';digest:Digest;baseURL:string}
export interface ViewInputs {
  tilt?:{x:number;y:number}; angle?:number; pointer?:{x:number;y:number};
  pressed?:boolean; focused?:boolean; revealProgress?:number; flipProgress?:number;
  host?:Record<string,number|boolean>;
}
export interface ViewResult {mode:'interactive'|'poster'|'cancelled';quality?:Quality;fallbackReason?:string}
export interface Package {
  manifest:Record<string,any>; scenes:Map<string,Record<string,any>>;
  files:Map<string,Uint8Array>; archive?:Uint8Array; digest:Digest;
}
export interface Resolver {
  manifest:Record<string,any>; scenes:Map<string,Record<string,any>>;
  asset(id:string):Promise<Record<string,any>&{url:string}>; dispose():void;
}
export interface CardView {
  element:HTMLElement; ready:Promise<ViewResult>;
  setInputs(input:ViewInputs):Promise<ViewResult|undefined>|undefined;
  setSide(side:Side):Promise<ViewResult|undefined>|undefined;
  setQuality(quality:Quality):Promise<ViewResult|undefined>|undefined;
  setVisibility(state:'visible'|'prewarm'|'hidden'):void;
  setLayerVisible(id:string,visible:boolean):void;
  setAudio(options:{enabled?:boolean;volume?:number}):void;
  updateScene(scene:Record<string,any>):Promise<ViewResult>;
  activate():void; snapshot():Promise<Blob>; dispose():void;
}
export interface Budget {estimatedGpuBytes?:number;maxDpr?:number;activeVideoDecoders?:number;maxGraphOperationsPerUpdate?:number}
export interface PlayerStage {
  mount(target:HTMLElement,model:{resolver:Resolver;title?:string},options?:{
    resolver?:Resolver;quality?:Quality;side?:Side;inputMode?:'host'|'pointer'|'drag';
    onEvent?:(event:Record<string,any>)=>void;
  }):CardView;
  setBudget(budget:Budget):Promise<void>; invalidateLayout():void;
  diagnostics():Record<string,number>; dispose():void;
}
export declare function createPlayerStage(options:{root:HTMLElement;budget?:Budget;motion?:'static'|'respect-preference';adapters?:any[];onDiagnostic?:(event:Record<string,any>)=>void}):PlayerStage;
export declare function directoryResolver(baseURL:string,options?:{digest?:Digest;signal?:AbortSignal}):Promise<Resolver>;
export declare function buildPackage(manifest:Record<string,any>,scenes:Map<string,Record<string,any>>,files:Map<string,Uint8Array>):Promise<Package>;
export declare function importPackage(bytes:Uint8Array,options?:Record<string,any>):Promise<Package>;
export declare function browserResolver(pkg:Package):Resolver;
export interface BuildRequest {
  id?:string;title?:string;source:{format?:string;bytes:Uint8Array;mediaType?:string;[key:string]:unknown};
  effects?:{id:string;node:string;side?:Side;parameters?:Record<string,Json>}[];
}
export interface Authoring {
  build(request:BuildRequest,options?:{signal?:AbortSignal}):Promise<Package>;
  buildBatch(requests:(BuildRequest&{id:string})[],options?:{signal?:AbortSignal}):Promise<Package[]>;
  publishPack(request:{cards:(BuildRequest&{id:string})[];catalog:Record<string,any>;key:string},options?:{signal?:AbortSignal}):Promise<{catalog:Record<string,any>;result:unknown;digests:Digest[]}>;
  describe():{apiVersion:string;importers:string[];effects:string[];publication:boolean};
}
export declare function createAuthoring(options?:{
  importers?:Record<string,(source:any,context:any)=>Promise<Package>>;
  effects?:Record<string,(node:any,parameters:any,context:any)=>any>;
  transform?:(project:any,context:any)=>Promise<void>;
  validateCatalog?:(catalog:any)=>unknown;
  publish?:(pkg:Package,context:{key:string;signal?:AbortSignal})=>Promise<PresentationRef>;
  commitCatalog?:(catalog:any,context:{key:string;signal?:AbortSignal})=>Promise<unknown>;
  onEvent?:(event:Record<string,any>)=>unknown;
}):Authoring;

/** Poster capture is supplied by a browser player or a host compositor. */
export interface Project {
  manifest:Record<string,any>; scenes:Map<string,Record<string,any>>;assets:Map<string,Uint8Array>;
  getRevision():number;edit(fn:(project:Project)=>void):void;undoEdit():boolean;redoEdit():boolean;
  setPosters(posters:Partial<Record<Side,Blob>>):Promise<void>;
  export(options?:{retainSources?:boolean}):Promise<Package>;
}
