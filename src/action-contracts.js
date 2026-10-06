import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';

export const actionProtocol='digital-card-action@1';
const identifier={type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'};
const unicodeString={type:'string',not:{pattern:'[\\uD800-\\uDFFF]'}};
const jobId={...unicodeString,minLength:1,maxLength:128};
const propertyNames={allOf:[{not:{enum:['__proto__','constructor','prototype']}},unicodeString]};
/** Portable post-commit delivery; configured identities are checked separately. */
export const actionDeliverySchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'https://digital-card.invalid/action-delivery/v1',
  $ref:'#/$defs/request',
  $defs:{json:{anyOf:[{type:'null'},{type:'boolean'},unicodeString,{type:'number'},
    {type:'array',items:{$ref:'#/$defs/json'}},{type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}}]},
    request:{type:'object',additionalProperties:false,required:['protocol','pluginId','handlerId','jobId','beneficiaryId','source','params'],properties:{
      protocol:{const:actionProtocol},pluginId:identifier,handlerId:identifier,jobId,
      beneficiaryId:{anyOf:[unicodeString,{type:'null'}]},source:{type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}},params:{type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}},
    }},
    acknowledgment:{type:'object',additionalProperties:false,required:['protocol','pluginId','jobId','status'],properties:{
      protocol:{const:actionProtocol},pluginId:identifier,jobId,status:{const:'completed'},
    }},
  },
};
const compiler=new Ajv2020({strict:true,strictNumbers:true,allowUnionTypes:true});
compiler.addSchema(actionDeliverySchema);
const request=compiler.compile({$ref:actionDeliverySchema.$id+'#/$defs/request'});
const acknowledgment=compiler.compile({$ref:actionDeliverySchema.$id+'#/$defs/acknowledgment'});
export function validateActionDelivery(value){
  try{safeData(value,{maxDepth:18,maxNodes:20020,maxBytes:1048576});}catch{throw new FrameworkError('PLUGIN_JOB','Invalid committed action delivery',400);}
  if(!request(value)||value.jobId.length>128)throw new FrameworkError('PLUGIN_JOB','Invalid committed action delivery',400);
  try{for(const key of ['source','params'])safeData(value[key],{maxDepth:16,maxNodes:10000,maxBytes:32768});}catch{throw new FrameworkError('PLUGIN_JOB','Invalid committed action delivery',400);}
  return value;
}
export function validateActionAcknowledgment(value){
  if(!acknowledgment(value)||value.jobId.length>128)throw new FrameworkError('PLUGIN_RESPONSE','Invalid plugin acknowledgment',503);
  return value;
}
