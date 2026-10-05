import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeService } from '../src/codes.js';
import { codesFixture, vault } from './codes-fixtures.mjs';
import { admin, code } from './helpers.js';

const at='2026-10-03T12:00:00.000Z';
const specs=[{id:'reward',poolId:'rewards'}];
const service=(x,options={})=>new CodeService({store:x.store,vault:vault(),clock:()=>at,...options});

test('code readiness validates imported ciphertext and counts without changing state or returning secrets',()=>{
  const x=codesFixture({stock:3});
  try{
    const before=x.store.read(s=>s),snapshot=structuredClone(before),codes=service(x);
    assert.deepEqual(codes.assertAllocationReady(snapshot,specs,at,{quantity:3}),{requiredCodes:3,generatedCodes:0});
    assert.deepEqual(snapshot,before);assert.deepEqual(x.store.read(s=>s),before);
    assert.throws(()=>codes.assertAllocationReady(snapshot,specs,at,{quantity:4}),code('CODE_STOCK_EXHAUSTED'));
    assert.throws(()=>codes.assertAllocationReady(snapshot,[...specs,{id:'second',poolId:'rewards'}],at,{quantity:2}),code('CODE_STOCK_EXHAUSTED'));
    Object.values(snapshot.codes)[2].secret.data=Buffer.from('damaged').toString('base64');
    assert.throws(()=>codes.assertAllocationReady(snapshot,specs,at),code('CODE_INTEGRITY'));
  }finally{x.core.close();}
});

test('code readiness rejects wrong or missing vault, disabled pools and unavailable code keys',()=>{
  const x=codesFixture({stock:1});
  try{
    const state=x.store.read(s=>s);
    assert.throws(()=>service(x,{vault:null}).assertAllocationReady(state,specs,at),code('CODE_KEYS'));
    assert.throws(()=>service(x,{vault:vault({indexKey:Buffer.alloc(32,10)})}).assertAllocationReady(state,specs,at),code('CODE_KEYS'));
    assert.throws(()=>service(x,{vault:vault({activeKeyId:'other',keys:{other:Buffer.alloc(32,11)}})}).assertAllocationReady(state,specs,at),code('CODE_KEYS'));
    state.codePools.rewards.enabled=false;
    assert.throws(()=>service(x).assertAllocationReady(state,specs,at),code('CODE_POOL_UNAVAILABLE'));
    assert.deepEqual(service(x,{vault:null}).assertAllocationReady(state,[],at),{requiredCodes:0,generatedCodes:0});
  }finally{x.core.close();}
});

test('code readiness checks generator configuration and capacity without invoking factories',()=>{
  const x=codesFixture({stock:0});let calls=0;
  const generator=()=>{calls++;return{code:'UNUSED'};};
  try{
    const codes=service(x,{generators:{factory:generator},maxCodes:2});
    codes.configurePool(admin,{key:'generated',pool:{id:'generated',name:'Generated',providerId:'example.generated',generator:'factory'}});
    const before=x.store.read(s=>s),attachments=[{id:'one',poolId:'generated'}];
    assert.deepEqual(codes.assertAllocationReady(before,attachments,at,{quantity:2}),{requiredCodes:2,generatedCodes:2});
    assert.equal(calls,0);assert.deepEqual(x.store.read(s=>s),before);
    assert.throws(()=>codes.assertAllocationReady(before,attachments,at,{quantity:3}),code('INSTALLATION_CAPACITY'));
    assert.throws(()=>service(x).assertAllocationReady(before,attachments,at),code('MISSING_CODE_GENERATOR'));
    for(const callback of [async()=>({code:'UNUSED'}),(async()=>({code:'UNUSED'})).bind(null),function*(){yield{code:'UNUSED'};}])
      assert.throws(()=>service(x,{generators:{factory:callback}}).assertAllocationReady(before,attachments,at),code('INVALID_PROVIDER'));
    assert.throws(()=>service(x,{generators:Object.create({factory:generator})}).assertAllocationReady(before,attachments,at),code('MISSING_CODE_GENERATOR'));
    assert.equal(calls,0);
  }finally{x.core.close();}
});

test('generated capacity includes existing inventory and aggregate demand without modifying state',()=>{
  const x=codesFixture({stock:1});
  try{
    const codes=service(x,{maxCodes:3}),state=x.store.read(s=>s),before=structuredClone(state);
    assert.equal(codes.assertGeneratedCapacity(state,2),undefined);
    assert.throws(()=>codes.assertGeneratedCapacity(state,3),code('INSTALLATION_CAPACITY'));
    assert.throws(()=>codes.assertGeneratedCapacity(state,-1),code('INVALID_INPUT'));
    assert.deepEqual(state,before);assert.deepEqual(x.store.read(s=>s),before);
  }finally{x.core.close();}
});
