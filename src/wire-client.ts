import {operationContract,validateWireRequest,validateWireResponse} from './wire-contracts.js';
import type {Operations, Schemas} from './wire-types.js';
export class WireApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(error: Schemas['Error'],status: number){super(error.message);this.name='WireApiError';this.code=error.code;this.status=status;}
}
export interface WireTransportOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  principal: ()=>string|null;
}
export interface WireCallOptions<K extends keyof Operations> {
  path?: Operations[K]['path'];
  query?: Record<string,string|number|boolean|null|undefined>;
  signal?: AbortSignal;
}
export function createWireTransport({baseUrl='/api',fetch:request=globalThis.fetch,principal}:WireTransportOptions){
  return async function call<K extends keyof Operations>(id:K,input:Operations[K]['request'],options:WireCallOptions<K>={}):Promise<Operations[K]['response']>{
    const {path,method}=operationContract(id);
    validateWireRequest(id,input);
    const bindings:Record<string,unknown>=options.path??{};
    const resolved=path.replace(/\{([^}]+)\}/g,(_match:string,key:string)=>{
      const value=bindings[key];if(typeof value!=='string'||!value)throw new Error('Missing route parameter: '+key);
      return encodeURIComponent(value);
    });
    const query=new URLSearchParams();
    for(const [key,value]of Object.entries(options.query??{}))if(value!==undefined&&value!==null)query.set(key,String(value));
    const headers:Record<string,string>={};
    if(input!==undefined){headers['Content-Type']='application/json';const actor=principal();if(actor)headers['X-DC-Principal']=actor;}
    const response=await request(baseUrl+resolved+(query.size?'?'+query.toString():''),{method,credentials:'same-origin',headers,body:input===undefined?undefined:JSON.stringify(input),signal:options.signal});
    const value:unknown=await response.json();
    validateWireResponse(id,response.status,value);
    if(!response.ok)throw new WireApiError(value as Schemas['Error'],response.status);
    return value as Operations[K]['response'];
  };
}
