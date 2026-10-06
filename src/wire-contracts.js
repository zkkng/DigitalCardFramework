import * as validators from './wire-validators.js';
import {openapi} from './contracts.js';

export class WireContractError extends Error {
  constructor(operation,phase,errors){super(`Invalid ${phase} contract for ${operation}`);this.name='WireContractError';this.code='INVALID_WIRE_CONTRACT';this.operation=operation;this.phase=phase;this.errors=structuredClone(errors??[]);}
}
const operations=new Map(Object.entries(openapi.paths).flatMap(([path,item])=>Object.entries(item).map(([method,operation])=>[operation.operationId,{path,method:method.toUpperCase(),operation}])));
export function operationContract(id){const entry=operations.get(id);if(!entry)throw new WireContractError(id,'operation',[]);return {path:entry.path,method:entry.method};}
function validate(id,phase,name,value){
  const check=validators[name];
  if(!check(value))throw new WireContractError(id,phase,check.errors);
  return value;
}
export function validateWireRequest(id,value){
  operationContract(id);
  const name=validators.wireValidators[id].request;
  if(!name){if(value!==undefined)throw new WireContractError(id,'request',[]);return value;}
  return validate(id,'request',name,value);
}
export function validateWireResponse(id,status,value){
  operationContract(id);
  const name=validators.wireValidators[id].responses[String(status)]??(status>=400?validators.wireErrorValidator:null);
  if(!name)throw new WireContractError(id,'response-status',[]);
  return validate(id,'response:'+status,name,value);
}
