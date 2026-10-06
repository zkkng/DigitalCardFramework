import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {validateActionDelivery,validateActionAcknowledgment,createRemoteActionHandler} from '@digital-card/framework/remote-actions';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/action-delivery.json',import.meta.url),'utf8'));
test('published action schema and SDK validate the same Unicode/integer golden delivery',()=>{
  const schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8'));
  const compiler=new Ajv2020({strict:true,allowUnionTypes:true});const validate=compiler.compile(schema);
  assert.equal(validate(fixture),true);assert.deepEqual(validateActionDelivery(fixture),fixture);
  const reply={protocol:fixture.protocol,pluginId:fixture.pluginId,jobId:fixture.jobId,status:'completed'};
  assert.deepEqual(validateActionAcknowledgment(reply),reply);
  assert.equal(compiler.compile({$ref:schema.$id+'#/$defs/acknowledgment'})(reply),true);
});
test('action SDK rejects malformed, non-JSON and excessive input before dispatch',async()=>{
  let calls=0;const handler=createRemoteActionHandler({url:'http://127.0.0.1/actions',pluginId:fixture.pluginId,handlerId:fixture.handlerId,token:'public-fixture-credential',fetchImpl:async()=>{calls++;throw Error('Unexpected dispatch');}});
  const job={idempotencyKey:fixture.jobId,userId:fixture.beneficiaryId,source:fixture.source,params:fixture.params};
  const cycle={};cycle.self=cycle;
  let deep={};for(let i=0;i<18;i++)deep={child:deep};
  for(const patch of [{source:null},{params:[]},{userId:undefined},{params:{value:NaN}},{params:{value:Infinity}},{params:{value:()=>1}},{params:{value:'\ud800'}},{params:{['\ud800']:'key'}},{params:cycle},{params:deep},{params:{value:'x'.repeat(32768)}}])await assert.rejects(handler({...job,...patch}),error=>error.code==='PLUGIN_JOB');
  assert.equal(calls,0);
  for(const patch of [{protocol:null},{pluginId:'bad identity'},{handlerId:null},{jobId:''},{beneficiaryId:23},{source:[]},{params:null},{actor:{role:'admin'}}])assert.throws(()=>validateActionDelivery({...fixture,...patch}),error=>error.code==='PLUGIN_JOB');
});
test('acknowledgments reject missing, null and unknown fields',()=>{
  const reply={protocol:fixture.protocol,pluginId:fixture.pluginId,jobId:fixture.jobId,status:'completed'};
  for(const key of Object.keys(reply)){const value={...reply};delete value[key];assert.throws(()=>validateActionAcknowledgment(value));assert.throws(()=>validateActionAcknowledgment({...reply,[key]:null}));}
  assert.throws(()=>validateActionAcknowledgment({...reply,handlerId:fixture.handlerId}));
});
