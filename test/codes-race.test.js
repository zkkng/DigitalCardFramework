import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { codesFixture } from './codes-fixtures.mjs';
import { SQLiteStore } from '../src/sqlite.js';
import { CardFramework } from '../src/index.js';
import { admin } from './helpers.js';

test('separate SQLite connections racing for the last code commit exactly one purchase',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'code-race-')),db=path.join(dir,'state.sqlite');const workers=[];
  try{
    const x=codesFixture({store:new SQLiteStore(db),stock:1});const actors=[x.alice,x.bob];x.core.close();
    const jobs=actors.map((actor,i)=>{const worker=new Worker(new URL('./code-purchase-worker.mjs',import.meta.url),{workerData:{db,actor,key:'race-'+i}});workers.push(worker);return new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',()=>resolve(worker));});});
    await Promise.all(jobs);
    const results=await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',resolve);worker.postMessage('go');})));
    assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'POOL_EXHAUSTED');
    const core=new CardFramework({store:new SQLiteStore(db)});assert.equal(core.wallet(actors[0]).credits+core.wallet(actors[1]).credits,19990);assert.equal(core.audit(admin).ok,true);assert.equal(core.packs(actors[0]).length+core.packs(actors[1]).length,1);core.close();
  }finally{await Promise.all(workers.map(w=>w.terminate()));await rm(dir,{recursive:true,force:true});}
});
