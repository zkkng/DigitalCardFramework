import {readFileSync,writeFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import {_Code} from 'ajv/dist/compile/codegen/code.js';
import {openapi} from '../src/contracts.js';

function dateTime(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!match)return false;
  const [,year,month,day,hour,minute,second,,offsetHour='0',offsetMinute='0']=match;
  const y=Number(year),m=Number(month),d=Number(day);
  const leap=y%4===0&&(y%100!==0||y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return m>=1&&m<=12&&d>=1&&d<=days[m-1]&&Number(hour)<24&&Number(minute)<60&&Number(second)<60&&Number(offsetHour)<24&&Number(offsetMinute)<60;
}
const formatCode=new _Code('({"date-time":'+dateTime.toString()+'})');
const ajv=new Ajv2020({strict:false,allErrors:true,code:{source:true,esm:true,formats:formatCode}});
ajv.addFormat('date-time',dateTime);
const root='https://digital-card.invalid/wire';
ajv.addSchema({$id:root,components:openapi.components});
const exports={},entries={};
let ordinal=0;
function add(schema){
  const name='v'+ordinal++,id=root+'/'+name;
  function local(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(local);return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,key==='$ref'&&typeof child==='string'&&child.startsWith('#/')?root+child:local(child)]));}
  ajv.addSchema(local(schema),id);exports[name]=id;return name;
}
const error=add({$ref:'#/components/schemas/Error'});
for(const item of Object.values(openapi.paths))for(const operation of Object.values(item)){
  const request=operation.requestBody?.content?.['application/json']?.schema;
  const responses=Object.fromEntries(Object.entries(operation.responses).filter(([,response])=>response.content?.['application/json']?.schema).map(([status,response])=>[status,Number(status)>=400?error:add(response.content['application/json'].schema)]));
  entries[operation.operationId]={request:request?add(request):null,responses};
}
let code=standalone(ajv,exports);
// Ajv's Unicode length helper is emitted as a CommonJS import even in ESM mode.
// Inline the equivalent browser primitive and reject every other runtime import.
code=code.replace(/require\("ajv\/dist\/runtime\/ucs2length"\)\.default/g,'((value)=>Array.from(value).length)');
if(/\brequire\s*\(/.test(code))throw new Error('Unsupported standalone validator runtime dependency');
code+='\nexport const wireValidators='+JSON.stringify(entries)+';\nexport const wireErrorValidator='+JSON.stringify(error)+';\n';
const target=new URL('../src/wire-validators.js',import.meta.url);
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==code)throw new Error('Generated wire validators are stale');}
else writeFileSync(target,code);
