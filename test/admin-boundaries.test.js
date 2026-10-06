import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminController} from '../src/admin-client.js';
import {fixture} from './helpers.js';

const saved=()=>({command:'configureAdmin',input:{key:'retained-settings',expectedRevision:0,reason:'Maintenance',scope:'site',changes:{packPurchasesPaused:true}},review:{command:'configureAdmin',input:{expectedRevision:0,reason:'Maintenance',scope:'site',changes:{packPurchasesPaused:true}},title:'Pause purchases',description:'Maintenance window',changes:[{label:'Purchases',before:'Allowed',after:'Paused'}]}});
for(const [name,alter] of [
  ['wrong request variant',value=>{value.input.scope='invalid';}],
  ['fractional revision',value=>{value.input.expectedRevision=0.5;}],
  ['different reviewed input',value=>{value.review.input.changes.packPurchasesPaused=false;}],
  ['different reviewed command',value=>{value.review.command='administerCards';}],
  ['malformed review change',value=>{value.review.changes[0].before={};}],
])test('saved admin boundary rejects '+name+' without changing retry identity',async()=>{
  const value=saved();alter(value);const raw=JSON.stringify(value);let calls=0,writes=0;
  const controller=createAdminController({namespace:'operator',storage:{getItem:()=>raw,setItem(){writes++;},removeItem(){writes++;}},client:{requestKey:()=> 'replacement-key',adminOverview:async()=>({revision:0}),configureAdmin:async()=>{calls++;}}});
  try{await controller.load();controller.stage({input:{scope:'site',reason:'Maintenance',changes:{packPurchasesPaused:false}},title:'Resume purchases',changes:[{label:'Purchases',before:'Paused',after:'Allowed'}]});assert.equal(await controller.confirm(),null);assert.equal(calls,0);assert.equal(writes,0);assert.equal(controller.getState().pending,false);assert.equal(controller.getState().error.code,'COMMAND_STORAGE_UNAVAILABLE');}finally{controller.dispose();}
});

test('saved admin correlation accepts reordered object fields and replays its original key',async()=>{
  const x=fixture(),actor={...x.alice,role:'admin'},value=saved();
  value.review.input={changes:{packPurchasesPaused:true},scope:'site',reason:'Maintenance',expectedRevision:0};
  const values=new Map([['digital-card.admin-command.v1:operator',JSON.stringify(value)]]),attempts=[];
  const client={requestKey:()=>{throw new Error('Recovery must retain its key');},adminOverview:async()=>x.core.adminOverview(actor),configureAdmin:async input=>{attempts.push(input);return x.core.configureAdmin(actor,input);}};
  const controller=createAdminController({client,namespace:'operator',storage:{getItem:key=>values.get(key)??null,setItem:(key,text)=>values.set(key,text),removeItem:key=>values.delete(key)}});
  try{const receipt=await controller.confirm();assert.equal(receipt.revision,1);assert.equal(attempts.length,1);assert.equal(attempts[0].key,'retained-settings');assert.equal(values.size,0);assert.equal(controller.getState().pending,false);}finally{controller.dispose();x.core.close();}
});
