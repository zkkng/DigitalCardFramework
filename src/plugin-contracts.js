import Ajv2020 from 'ajv/dist/2020.js';
import {openapi} from './contracts.js';
import {FrameworkError} from './catalog.js';
import {assetFormats} from './asset-contracts.js';

export const pluginProtocol='digital-card-plugin@1';
export const pluginCommands=Object.freeze(['inventory.read','catalog.read','purchase.quote','purchase.register','purchase.pending','purchase.execute','purchase.acknowledge']);
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'};
const pluginId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const version={type:'string',pattern:'^[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}$'};
const token={type:'string',pattern:'^[A-Za-z0-9_-]{43}$'};
const integer=(maximum)=>({type:'integer',minimum:1,maximum});
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const commandBase={protocol:{const:pluginProtocol},sessionId:token,requestId:id};
const ref=name=>({$ref:'#/components/schemas/'+name});
const purchaseIntent={allOf:[ref('CommandIntent'),{type:'object',properties:{command:{const:'purchase'}}}]};
const inputs={'inventory.read':object({limit:integer(200),after:id},[]),'catalog.read':object({}),
  'purchase.quote':ref('QuoteRequest'),'purchase.register':ref('Quote'),'purchase.pending':object({}),
  'purchase.execute':ref('CommandIntentId'),'purchase.acknowledge':ref('CommandIntentId')};
const results={'inventory.read':ref('InventoryPage'),'catalog.read':ref('CatalogManifest'),'purchase.quote':ref('Quote'),
  'purchase.register':purchaseIntent,'purchase.pending':object({items:{type:'array',maxItems:1,items:purchaseIntent}}),
  'purchase.execute':object({intent:purchaseIntent,result:ref('PurchaseResult')}),
  'purchase.acknowledge':object({id,state:{const:'acknowledged'}})};
const commandBranches=pluginCommands.map(command=>object({...commandBase,command:{const:command},input:inputs[command]}));
const commandResponses=pluginCommands.map(command=>object({protocol:{const:pluginProtocol},requestId:id,command:{const:command},result:results[command]}));
const schemas={};
function include(name){if(schemas[name])return;const schema=openapi.components.schemas[name];if(!schema)throw Error('Missing plugin response schema');schemas[name]=schema;function visit(value){if(!value||typeof value!=='object')return;if(typeof value.$ref==='string'&&value.$ref.startsWith('#/components/schemas/'))include(value.$ref.split('/').at(-1));for(const child of Object.values(value))visit(child);}visit(schema);}
for(const name of ['InventoryPage','CatalogManifest','QuoteRequest','Quote','Purchase','CommandIntentId','CommandIntent','PurchaseResult'])include(name);
export const pluginProtocolSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/plugin/v1',
  components:{schemas},
  $defs:{
    handshakeRequest:object({protocol:{const:pluginProtocol},pluginId,version}),
    handshakeResponse:object({protocol:{const:pluginProtocol},pluginId,version,sessionId:token,expiresAt:{type:'string',format:'date-time'},generation:integer(Number.MAX_SAFE_INTEGER),commands:{type:'array',uniqueItems:true,maxItems:pluginCommands.length,items:{enum:pluginCommands}},quotas:object({maxRequestBytes:integer(1048576),maxResponseBytes:integer(33554432),concurrency:integer(32),timeoutMs:integer(300000)})}),
    commandRequest:{oneOf:commandBranches},commandResponse:{oneOf:commandResponses},
    closeRequest:object({protocol:{const:pluginProtocol},sessionId:token}),
    closeResponse:object({protocol:{const:pluginProtocol},sessionId:token,status:{const:'closed'}}),
    error:object({protocol:{const:pluginProtocol},requestId:id,error:object({code:{type:'string',maxLength:64},message:{type:'string',maxLength:256},retryable:{type:'boolean'}})},['protocol','error']),
  },
};
function dateTime(value){const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);if(!match)return false;const [,year,month,day,hour,minute,second,offsetHour='0',offsetMinute='0']=match;const y=Number(year),m=Number(month),d=Number(day),date=new Date(Date.UTC(y+400,m-1,d));return m>=1&&m<=12&&d>=1&&date.getUTCMonth()===m-1&&date.getUTCDate()===d&&Number(hour)<24&&Number(minute)<60&&Number(second)<60&&Number(offsetHour)<24&&Number(offsetMinute)<60;}
const compiler=new Ajv2020({strict:false,allErrors:false,formats:{'date-time':dateTime,...assetFormats}});compiler.addSchema(pluginProtocolSchema);
const validators=Object.fromEntries(Object.keys(pluginProtocolSchema.$defs).map(kind=>[kind,compiler.compile({$ref:pluginProtocolSchema.$id+'#/$defs/'+kind})]));
export function validatePluginMessage(kind,value){const validate=typeof kind==='string'&&Object.hasOwn(validators,kind)?validators[kind]:null;if(!validate||!validate(value))throw new FrameworkError('PLUGIN_CONTRACT','Invalid plugin protocol message',typeof kind==='string'&&kind.endsWith('Request')?400:502);return value;}
