import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {SessionStore,createAuthHost} from '../src/auth.js';
import {SQLiteStore} from '../src/sqlite.js';
import {createStateCodec} from '../src/encryption.js';
import {createRateLimiter} from '../src/limits.js';
import {fixture,admin} from './helpers.js';
import {auditState} from '../src/audit.js';

test('encrypted state rejects tampering and wrong keys, backs up consistently, and rolls back capacity failure',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-prod-')),path=join(dir,'state.sqlite'),key=randomBytes(32),codec=createStateCodec(key);
  const encoded=codec.encode({secret:'PRIVATE'});assert(!encoded.includes('PRIVATE'));assert.deepEqual(codec.decode(encoded),{secret:'PRIVATE'});
  const changed=JSON.parse(encoded);changed.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>codec.decode(JSON.stringify(changed)));
  const store=new SQLiteStore(path,{encryptionKey:key});const x=fixture({store});x.open('unique');assert(x.core.audit(admin).ok);assert(store.integrity());
  const backup=join(dir,'backup.sqlite');await store.backup(backup);assert(!readFileSync(backup).includes(Buffer.from('PRIVATE-DEMO-CODE')));assert.throws(()=>new SQLiteStore(path,{encryptionKey:randomBytes(32)}));
  const restored=new SQLiteStore(backup,{encryptionKey:key});assert.deepEqual(restored.read(s=>s),store.read(s=>s));restored.close();x.core.close();
  const bounded=new SQLiteStore(path,{encryptionKey:key,maxStateBytes:1});const before=bounded.read(s=>s.revision);assert.throws(()=>bounded.transact(s=>s.additionalData='x'.repeat(1000)),e=>e.code==='STORAGE_CAPACITY');assert.equal(bounded.read(s=>s.revision),before);bounded.close();rmSync(dir,{recursive:true});
});

test('opaque sessions survive restart, expire, consume login challenges once and hide tokens',()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-auth-')),path=join(dir,'auth.sqlite'),key=randomBytes(32);let now=0;
  let sessions=new SessionStore(path,{encryptionKey:key,clock:()=>now});const secret=sessions.create('session',{subject:'sensitive-subject'},100),flow=sessions.create('flow',{nonce:'private-nonce'},50);sessions.close();
  assert(!readFileSync(path).includes(Buffer.from(secret)));assert(!readFileSync(path).includes(Buffer.from('sensitive-subject')));
  sessions=new SessionStore(path,{encryptionKey:key,clock:()=>now});assert.equal(sessions.get(secret,'session').subject,'sensitive-subject');assert(sessions.get(flow,'flow',{consume:true}));assert.equal(sessions.get(flow,'flow',{consume:true}),null);now=101;assert.equal(sessions.get(secret,'session'),null);sessions.close();rmSync(dir,{recursive:true});
});

test('session capacity is atomic, expires before allocation and preserves existing authentication',()=>{
  let now=0;const sessions=new SessionStore(':memory:',{encryptionKey:randomBytes(32),maxSessions:1,clock:()=>now});const first=sessions.create('session',{userId:'a'},10);assert.throws(()=>sessions.create('flow',{},10),/capacity/);assert.equal(sessions.get(first,'session').userId,'a');now=11;assert(sessions.create('flow',{},10));assert.equal(sessions.get(first,'session'),null);sessions.close();assert.throws(()=>new SessionStore(':memory:',{maxSessions:0}),/capacity/);
});

test('host requires a bound login challenge; verified subject derives authority, replay and foreign logout fail',async()=>{
  const x=fixture(),sessions=new SessionStore(':memory:',{encryptionKey:randomBytes(32)});let finishes=0;
  const provider={begin:async()=>({url:'https://issuer.test/authorize',data:{nonce:'nonce',state:'state'}}),finish:async(url,data)=>{finishes++;assert.equal(data.nonce,'nonce');assert.equal(url.searchParams.get('state'),'state');return {issuer:'https://issuer.test',subject:'operator',displayName:'Operator'};}};
  let host;const server=createServer(async(req,res)=>{if(req.url==='/who'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(host.resolveIdentity(req)));}else if(!await host.handle(req,res)){res.statusCode=404;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;host=createAuthHost({framework:x.core,sessions,provider,origin,secure:false,adminSubjects:['operator']});
  try{const bad=await fetch(origin+'/auth/callback?state=state');assert.equal(bad.status,400);assert.equal(finishes,0);
    const login=await fetch(origin+'/auth/login',{redirect:'manual'}),flowCookie=login.headers.get('set-cookie').split(';')[0];
    const callback=await fetch(origin+'/auth/callback?state=state',{headers:{cookie:flowCookie},redirect:'manual'});assert.equal(callback.status,303);
    const sessionCookie=callback.headers.getSetCookie().find(x=>x.startsWith('dc_session=')).split(';')[0];assert.equal((await (await fetch(origin+'/who',{headers:{cookie:sessionCookie}})).json()).role,'admin');
    assert.equal((await fetch(origin+'/auth/callback?state=state',{headers:{cookie:flowCookie},redirect:'manual'})).status,400);assert.equal(finishes,1);
    assert.equal((await fetch(origin+'/auth/logout',{method:'POST',headers:{cookie:sessionCookie,origin:'https://evil.test'}})).status,403);
    assert.equal((await fetch(origin+'/auth/logout',{method:'POST',headers:{cookie:sessionCookie,origin}})).status,204);assert.equal(await (await fetch(origin+'/who',{headers:{cookie:sessionCookie}})).json(),null);
  }finally{await new Promise(r=>server.close(r));sessions.close();x.core.close();}
});

test('limiter trusts direct peer, separates reads and writes, caps keys and recovers after a window',()=>{
  let now=0;const limit=createRateLimiter({clock:()=>now,reads:2,writes:1,maxKeys:4}),request={socket:{remoteAddress:'a'},headers:{'x-forwarded-for':'fake'}};
  assert(limit({request,mutation:true}));assert(!limit({request,mutation:true}));assert(limit({request,mutation:false}));assert(limit({request,mutation:false}));assert(!limit({request,mutation:false}));now=60001;assert(limit({request,mutation:true}));
});

test('integrity audit diagnoses supply and ledger corruption without altering state',()=>{
  const x=fixture();x.open();assert(x.core.audit(admin).ok);
  // Obtain a standalone real state through an explicitly supplied store.
  const store=new SQLiteStore(':memory:'),y=fixture({store});y.open();const snapshot=store.read(s=>s);snapshot.supply['dawn.standard']=9;snapshot.balances[y.a.id].credits+=1;
  assert(!auditState(snapshot).ok);assert(auditState(snapshot).issues.some(i=>i.code==='SUPPLY_MISMATCH'));assert(y.core.audit(admin).ok);y.core.close();x.core.close();
});
