import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {SQLiteStore} from '../src/sqlite.js';
import {initialState,MemoryStore} from '../src/store.js';
import {createStateCodec} from '../src/encryption.js';
import {SessionStore} from '../src/auth.js';
import {fixture,admin} from './helpers.js';
import {page} from '../src/data.js';
import {codesFixture} from './codes-fixtures.mjs';

const moduleUrl=new URL('../src/sqlite.js',import.meta.url).href;
function directory(t,cleanup=()=>{}){const dir=mkdtempSync(join(tmpdir(),'digital-card-indexed-'));t.after(()=>{cleanup();assert(dir.startsWith(join(tmpdir(),'digital-card-indexed-')));rmSync(dir,{recursive:true,force:true});});return dir;}
const digest=value=>createHash('sha256').update(value).digest('hex');
const files=dir=>Object.fromEntries(readdirSync(dir).sort().map(name=>[name,digest(readFileSync(join(dir,name)))]));
const durableFiles=dir=>Object.fromEntries(Object.entries(files(dir)).filter(([name])=>!name.endsWith('-shm')));
function legacy(path,state,key){const db=new DatabaseSync(path);try{db.exec('CREATE TABLE framework_state(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,body TEXT NOT NULL);');db.prepare('INSERT INTO framework_state VALUES(1,1,?)').run(createStateCodec(key).encode(state));}finally{db.close();}}
function populated(){const state=initialState();state.revision=17;state.users.u1={id:'u1',provider:'private-provider',subject:'private-subject',displayName:'private-display',email:'private-email',name:'private-alias'};state.balances.u1={points:42};state.codes={c1:{id:'c1',holderId:'u1',status:'assigned',encrypted:{keyId:'stable-key',material:'private-code'}}};state.requests.r1={result:{codeId:'c1'},requestHash:'stable-request'};state.events=[{id:'e1',type:'retained',at:'2026-01-01',data:{private:'private-event'}}];state.adminControls={users:{u1:{roles:['operator']}}};return state;}

test('schema 2 holder migration preserves ciphertext, state and history through failure and restart',t=>{
  const dir=directory(t),path=join(dir,'schema2.sqlite'),key=randomBytes(32),codec=createStateCodec(key);
  const x=codesFixture({store:new SQLiteStore(path,{encryptionKey:key}),transfer:'follow-unrevealed'});
  const copy=x.openCode(),offer=x.core.proposeTrade(x.alice,{key:'transfer',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
  x.core.acceptTrade(x.bob,{key:'accept',tradeId:offer.id});
  const logical=x.store.read(s=>s),expected=x.core.codeHistory(x.alice);x.core.close();
  const old=new DatabaseSync(path);
  old.exec('DROP TABLE framework_code_holders; PRAGMA user_version=2; CREATE TABLE authentication_sentinel(id TEXT PRIMARY KEY,value TEXT);');
  old.prepare('INSERT INTO authentication_sentinel VALUES(?,?)').run('session','retained');
  old.prepare('UPDATE framework_meta SET schema_version=2,codec_check=?').run(codec.encode({format:'digital-card.indexed-state',version:2,recordKeys:'blind-v1'}));
  const payloads=old.prepare('SELECT collection,entity_key,payload FROM framework_entities ORDER BY collection,entity_key').all();old.close();
  const before=files(dir);assert.throws(()=>new SQLiteStore(path,{encryptionKey:randomBytes(32)}));assert.deepEqual(files(dir),before);
  assert.throws(()=>new SQLiteStore(path,{encryptionKey:key,readOnly:true}),/migration requires writable/);
  for(const stage of ['before-schema','after-records','before-commit']){
    assert.throws(()=>new SQLiteStore(path,{encryptionKey:key,onMigration:event=>{assert.equal(event.from,2);assert.equal(event.to,3);if(event.stage===stage)throw Error('interrupted projection migration');}}),/interrupted projection migration/);
    const stopped=new DatabaseSync(path,{readOnly:true});
    assert.equal(stopped.prepare('PRAGMA user_version').get().user_version,2);
    assert.equal(stopped.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='framework_code_holders'").get().n,0);
    assert.deepEqual(stopped.prepare('SELECT collection,entity_key,payload FROM framework_entities ORDER BY collection,entity_key').all(),payloads);stopped.close();
  }
  const current=new SQLiteStore(path,{encryptionKey:key});assert.deepEqual(current.read(s=>s),logical);
  assert.equal(current.query(q=>q.codeHistoryEntries(x.alice.userId)).length,expected.total);current.close();
  const raw=new DatabaseSync(path,{readOnly:true});
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version,3);
  assert.deepEqual(raw.prepare('SELECT collection,entity_key,payload FROM framework_entities ORDER BY collection,entity_key').all(),payloads);
  assert.equal(raw.prepare('SELECT value FROM authentication_sentinel').get().value,'retained');
  const hashes=raw.prepare('SELECT holder_hash FROM framework_code_holders').all();assert(hashes.length===2&&hashes.every(row=>/^[a-f0-9]{64}$/.test(row.holder_hash)));
  const plan=raw.prepare("EXPLAIN QUERY PLAN SELECT code_id FROM framework_code_holders WHERE holder_hash=?").all(hashes[0].holder_hash);
  assert(plan.some(row=>/SEARCH.*holder_hash/.test(row.detail)));raw.close();
  const reopened=new SQLiteStore(path,{encryptionKey:key,readOnly:true});assert.deepEqual(reopened.read(s=>s),logical);reopened.close();
  const tamper=new DatabaseSync(path);
  const forged=createHmac('sha256',key).update(JSON.stringify(['digital-card.record-key.v1','code-holder','unrelated'])).digest('hex');
  tamper.prepare('UPDATE framework_code_holders SET holder_hash=? WHERE holder_hash=?').run(forged,hashes[0].holder_hash);tamper.close();
  const damaged=new SQLiteStore(path,{encryptionKey:key});
  assert.throws(()=>damaged.query(q=>q.codeHistoryEntries('unrelated')),error=>error.code==='INVALID_STATE');damaged.close();
});

test('ordered legacy migration preserves logical state, encrypted material and stable identifiers',t=>{
  const dir=directory(t),path=join(dir,'legacy.sqlite'),key=randomBytes(32),state=populated(),stages=[];legacy(path,state,key);
  const store=new SQLiteStore(path,{encryptionKey:key,onMigration:event=>stages.push(event.stage)});
  assert.deepEqual(store.read(s=>s),state);assert.deepEqual(stages,['before-schema','after-records','before-commit']);assert.equal(store.query(q=>q.userByIdentity('private-provider','private-subject')).id,'u1');store.close();
  const db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='framework_state'").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM framework_entities WHERE collection='codes'").get().n,1);db.close();
  const bytes=Buffer.concat(Object.keys(files(dir)).map(name=>readFileSync(join(dir,name))));for(const secret of ['private-provider','private-subject','private-display','private-email','private-alias','private-code','private-event'])assert(!bytes.includes(Buffer.from(secret)),secret+' must remain encrypted');
  const reopened=new SQLiteStore(path,{encryptionKey:key,readOnly:true});assert.deepEqual(reopened.read(s=>s),state);assert.throws(()=>reopened.transact(()=>{}),/read-only/);reopened.close();
});

test('wrong keys, future schemas and altered layouts fail before any file or DDL change',t=>{
  const dir=directory(t),key=randomBytes(32);
  for(const scenario of ['legacy-key','legacy-no-key','future','logical-future','normalized-key','missing-index','missing-table','extra-trigger','declared-version']){
    const path=join(dir,scenario+'.sqlite');legacy(path,populated(),key);
    if(scenario.startsWith('normalized')||['missing-index','missing-table','extra-trigger','declared-version'].includes(scenario)){new SQLiteStore(path,{encryptionKey:key}).close();}
    const db=new DatabaseSync(path);
    if(scenario==='future')db.exec('PRAGMA user_version=99');
    if(scenario==='logical-future')db.prepare('UPDATE framework_state SET body=?').run(createStateCodec(key).encode({...populated(),schemaVersion:99}));
    if(scenario==='missing-index')db.exec('DROP INDEX framework_identity');
    if(scenario==='missing-table')db.exec('DROP TABLE framework_entities');
    if(scenario==='extra-trigger')db.exec('CREATE TRIGGER unexpected AFTER UPDATE ON framework_fields BEGIN SELECT 1; END');
    if(scenario==='declared-version')db.exec('PRAGMA user_version=1');
    db.close();const before=files(dir);
    const supplied=scenario==='legacy-no-key'?undefined:scenario.endsWith('key')?randomBytes(32):key;
    assert.throws(()=>new SQLiteStore(path,{encryptionKey:supplied}),undefined,scenario);assert.deepEqual(files(dir),before,scenario+' must not change database or sidecars');
  }
});

test('migration exceptions roll back DDL, data and version atomically',t=>{
  const dir=directory(t),key=randomBytes(32),state=populated();
  for(const stage of ['before-schema','after-records','before-commit']){
    const path=join(dir,stage+'.sqlite');legacy(path,state,key);const sentinel=Error('migration failure');
    assert.throws(()=>new SQLiteStore(path,{encryptionKey:key,onMigration:event=>{if(event.stage===stage)throw sentinel;}}),error=>error===sentinel);
    const db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);assert.deepEqual(createStateCodec(key).decode(db.prepare('SELECT body FROM framework_state').get().body),state);assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name),['framework_state']);db.close();
    const recovered=new SQLiteStore(path,{encryptionKey:key});assert.deepEqual(recovered.read(s=>s),state);recovered.close();
  }
});

test('process loss during migration and at WAL commit preserves one complete outcome',t=>{
  const dir=directory(t),key=randomBytes(32),state=populated();
  for(const boundary of ['migration','before-commit','after-commit']){
    const path=join(dir,boundary+'.sqlite');legacy(path,state,key);if(boundary!=='migration')new SQLiteStore(path,{encryptionKey:key}).close();
    const script=`import {DatabaseSync} from 'node:sqlite';import {SQLiteStore} from ${JSON.stringify(moduleUrl)};
      const boundary=process.env.BOUNDARY,options={encryptionKey:Buffer.from(process.env.TEST_KEY,'hex')};
      if(boundary==='migration')options.onMigration=event=>{if(event.stage==='after-records')process.exit(81)};
      const store=new SQLiteStore(process.env.TEST_DB,options),exec=DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'){if(boundary==='before-commit')process.exit(81);const result=exec.call(this,sql);process.exit(81);return result;}return exec.call(this,sql);};
      store.transact(s=>{s.balances.u1.points=99;s.requests.completed={id:'stable-completion'};});`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TEST_DB:path,TEST_KEY:key.toString('hex'),BOUNDARY:boundary},encoding:'utf8',timeout:20000});assert.equal(child.status,81,child.stderr);
    const restored=new SQLiteStore(path,{encryptionKey:key}),expected=structuredClone(state);if(boundary==='after-commit'){expected.balances.u1.points=99;expected.requests.completed={id:'stable-completion'};expected.revision++;}assert.deepEqual(restored.read(s=>s),expected);assert(restored.integrity());restored.close();
  }
});

test('simultaneous migration openers converge without partial records',async t=>{
  const dir=directory(t),path=join(dir,'race.sqlite'),state=populated();legacy(path,state);
  const run=()=>new Promise(resolve=>{const messages=[],errors=[];const w=new Worker(`import {parentPort,workerData} from 'node:worker_threads';const {SQLiteStore}=await import(workerData.moduleUrl);const store=new SQLiteStore(workerData.path);parentPort.postMessage(store.read(s=>s));store.close();`,{eval:true,workerData:{moduleUrl,path}});w.on('message',message=>messages.push(message));w.on('error',error=>errors.push(error));w.once('exit',code=>resolve({code,messages,errors}));});
  const results=await Promise.all([run(),run()]);
  for(const result of results){assert.equal(result.code,0,result.errors.map(error=>error.stack).join('\n'));assert.deepEqual(result.errors,[]);assert.equal(result.messages.length,1);assert.deepEqual(result.messages[0],state);}

});

test('identity, collection and pending pages decode only bounded selected records using indexes',t=>{
  let store;const dir=directory(t,()=>store?.close()),path=join(dir,'queries.sqlite'),key=randomBytes(32);store=new SQLiteStore(path,{encryptionKey:key});
  store.transact(s=>{Object.assign(s,populated());s.copies={};s.packs={};s.externalPurchases={};for(let i=0;i<600;i++){const id=String(i).padStart(5,'0'),ownerId=i%2?'u1':'u2';s.copies['c'+id]={id:'c'+id,ownerId,state:'owned',cardId:'card',variantId:'v'+(i%10),definition:{name:'Example '+id,type:'collectible'},createdAt:'2026-01-01'};s.packs['p'+id]={id:'p'+id,ownerId,openedAt:i%3?null:'2026-01-02',createdAt:'2026-01-01'};s.externalPurchases['ep_'+id]={id:'ep_'+id,terms:{providerId:i%2?'provider':'other'},state:i%3?'prepared':'committed',completionBytes:0};}});
  const before=store.diagnostics();const result=store.query(q=>({user:q.userByIdentity('private-provider','private-subject'),counts:q.collectionCounts('u1'),copies:q.pageCopies({ownerId:'u1',limit:7}),packs:q.pagePacks({ownerId:'u1',status:'unopened',limit:4}),pending:q.pageExternalPurchases({providerId:'provider',states:['prepared','quarantined'],limit:5}),variants:q.variantCounts({ownerId:'u1',limit:2})}));
  assert.equal(result.counts.ownedCopies,300);assert.equal(result.copies.items.length,7);assert.equal(result.pending.items.length,5);assert.equal(result.variants.items.length,2);assert.equal(store.diagnostics().decodedQueryRecords-before.decodedQueryRecords,17);assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);
  assert(result.pending.items.every(x=>x.terms.providerId==='provider'&&x.state==='prepared'));
  const next=store.query(q=>q.pageCopies({ownerId:'u1',limit:7,after:result.copies.next}));assert(!next.items.some(x=>result.copies.items.some(y=>x.id===y.id)));
  const db=new DatabaseSync(path,{readOnly:true}),plans=[
    ["SELECT payload FROM framework_entities WHERE collection='users' AND identity_hash=?",['hash'],'framework_identity'],
    ["SELECT payload FROM framework_entities WHERE collection='copies' AND owner_id=? AND state='owned' ORDER BY created_at DESC,entity_key LIMIT 8",['u1'],'framework_owner_state'],
    ["SELECT variant_id,COUNT(*) FROM framework_entities WHERE collection='copies' AND owner_id=? AND state='owned' GROUP BY variant_id",['u1'],'framework_owner_variant'],
    ["SELECT payload FROM framework_entities INDEXED BY framework_provider_cursor WHERE collection='externalPurchases' AND provider_id=? AND state IN ('prepared','quarantined') AND entity_key>? ORDER BY entity_key LIMIT 6",['provider','ep_00100'],'framework_provider_cursor']];
  for(const [sql,args,index]of plans){const detail=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(x=>x.detail).join('\n');assert(detail.includes(index),detail);assert(!detail.includes('USE TEMP B-TREE'),detail);assert(!detail.includes('SCAN framework_entities'),detail);}db.close();
});

test('read-only queries and no-op identity registration leave revision, rows and durable WAL unchanged',t=>{
  let store;const dir=directory(t,()=>store?.close()),path=join(dir,'idle.sqlite');store=new SQLiteStore(path);const x=fixture({store});x.open();const before=durableFiles(dir),diagnostics=store.diagnostics(),revision=store.query(q=>q.value('revision'));
  for(let i=0;i<10;i++){x.core.registerUser(admin,{provider:'test',subject:'alice',displayName:'Alice'});x.core.me(x.alice);x.core.wallet(x.alice);x.core.inventoryPage(x.alice,{limit:1});x.core.collectionSummary(x.alice,{limit:1});x.core.packsPage(x.alice,{limit:1});x.core.catalogVersion();store.transact(()=>{});}
  assert.equal(store.query(q=>q.value('revision')),revision);assert.equal(store.diagnostics().recordWrites,diagnostics.recordWrites);assert.deepEqual(durableFiles(dir),before);
});

test('capacity measures encrypted records exactly and reserves space before new writes',t=>{
  let store;const dir=directory(t,()=>store?.close()),path=join(dir,'capacity.sqlite'),key=randomBytes(32);store=new SQLiteStore(path,{encryptionKey:key});store.transact(s=>{s.externalPurchases={pending:{completionBytes:8192,state:'prepared'}};});const state=store.read(s=>s),measurement=store.measure(state);store.close();
  const db=new DatabaseSync(path,{readOnly:true}),physicalPayload=db.prepare('SELECT (SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM framework_fields)+(SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM framework_entities) AS bytes').get().bytes;db.close();assert.equal(measurement.usedBytes,physicalPayload);assert.equal(measurement.reservedBytes,8192);
  store=new SQLiteStore(path,{encryptionKey:key,maxStateBytes:measurement.totalBytes+1});const before=store.read(s=>s);assert.throws(()=>store.transact(s=>{s.newData='x'.repeat(100);}),error=>error.code==='STORAGE_CAPACITY');assert.deepEqual(store.read(s=>s),before);
  store.transact(s=>{s.externalPurchases.pending.completionBytes=0;s.externalPurchases.pending.state='committed';s.completedReceipt='x'.repeat(3000);});assert(store.measure(store.read(s=>s)).totalBytes<measurement.totalBytes);
});

test('callback failure and nonserializable results cannot commit partial state',()=>{
  for(const store of [new MemoryStore(),new SQLiteStore()]){try{const before=store.read(s=>s);assert.throws(()=>store.transact(s=>{s.users.changed={id:'changed'};return ()=>{};}));assert.throws(()=>store.transact(async s=>{s.users.changed={id:'changed'};}),/Async/);assert.deepEqual(store.read(s=>s),before);assert.throws(()=>store.query(async()=>1),/Async/);}finally{store.close();}}
});

test('shared authentication tables survive framework migration and either initialization order',t=>{
  const dir=directory(t),key=randomBytes(32);
  for(const order of ['sessions-first','framework-first','legacy']){
    const path=join(dir,order+'.sqlite');if(order==='legacy')legacy(path,populated(),key);if(order==='framework-first')new SQLiteStore(path,{encryptionKey:key}).close();
    const sessions=new SessionStore(path,{encryptionKey:key}),token=sessions.create('session',{userId:'stable-user'},60000);sessions.close();
    const store=new SQLiteStore(path,{encryptionKey:key});assert(store.integrity());store.close();
    const reopened=new SessionStore(path,{encryptionKey:key});assert.deepEqual(reopened.get(token,'session'),{userId:'stable-user'});reopened.close();new SQLiteStore(path,{encryptionKey:key}).close();
  }
});

test('private map keys are blind indexed and remain addressable without decrypting other records',t=>{
  let store;const dir=directory(t,()=>store?.close()),path=join(dir,'private.sqlite'),key=randomBytes(32),secrets=['private-extension-key@example.invalid','private-browser-request-token','private-operator-request-token'];
  store=new SQLiteStore(path,{encryptionKey:key});store.transact(s=>{s.extensionData={[secrets[0]]:{name:'private-arbitrary-name',value:'private-arbitrary-value'}};s.requests[secrets[1]]={result:{id:'retained'}};s.operatorRequests={[secrets[2]]:{result:{id:'operator-result'}}};});
  const expected=store.read(s=>s),before=store.diagnostics();assert.deepEqual(store.query(q=>q.get('extensionData',secrets[0])),expected.extensionData[secrets[0]]);assert.equal(store.diagnostics().decodedQueryRecords-before.decodedQueryRecords,1);assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);assert.deepEqual(store.query(q=>q.value('operatorRequests')),expected.operatorRequests);
  const bytes=Buffer.concat(readdirSync(dir).map(name=>readFileSync(join(dir,name))));for(const secret of [...secrets,'private-arbitrary-name','private-arbitrary-value'])assert(!bytes.includes(Buffer.from(secret)));
  store.transact(s=>{delete s.extensionData[secrets[0]];s.extensionData['another-private-key']={value:'updated'};});assert.equal(store.query(q=>q.get('extensionData',secrets[0])),undefined);assert.deepEqual(store.query(q=>q.value('extensionData')),{'another-private-key':{value:'updated'}});
});

test('failed inspection of a live WAL database never changes durable data',t=>{
  let store;const dir=directory(t,()=>store?.close()),path=join(dir,'live.sqlite'),key=randomBytes(32);store=new SQLiteStore(path,{encryptionKey:key});store.transact(s=>Object.assign(s,populated()));const before=durableFiles(dir);
  assert.throws(()=>new SQLiteStore(path,{encryptionKey:randomBytes(32)}),/authentication/);assert.deepEqual(durableFiles(dir),before);assert.equal(store.query(q=>q.value('revision')),18);
});

test('query handles expire and a WAL read snapshot remains stable across another writer',t=>{
  let store,other;const dir=directory(t,()=>{other?.close();store?.close();}),path=join(dir,'snapshot.sqlite');store=new SQLiteStore(path);store.transact(s=>{s.balances.u1={points:1};});other=new SQLiteStore(path);
  let retained;store.query(q=>{retained=q;assert.equal(q.get('balances','u1').points,1);other.transact(s=>{s.balances.u1.points=2;});assert.equal(q.get('balances','u1').points,1);});
  assert.throws(()=>retained.get('balances','u1'),/ended/);assert.equal(store.query(q=>q.get('balances','u1')).points,2);
  const memory=new MemoryStore();memory.query(q=>{retained=q;});assert.throws(()=>retained.value('users'),/ended/);
});

test('inventory free-text and locale-name compatibility uses account records and public projections',t=>{
  const store=new SQLiteStore(),x=fixture({store});t.after(()=>store.close());x.open('common',x.alice,3);x.open('common',x.bob,2);
  store.transact(s=>{Object.values(s.copies).filter(c=>c.ownerId===x.alice.userId).forEach((copy,i)=>{copy.definition.name=['Zeta','äster','Alpha'][i];copy.definition.description=i===1?'visible-description-needle':'Example';});});
  const inventory=x.core.inventory(x.alice),before=store.diagnostics();for(const options of [{sort:'name',limit:2},{search:'visible-description-needle',limit:1},{search:'alpha',sort:'name'}])assert.deepEqual(x.core.inventoryPage(x.alice,options),page(inventory,options));assert.equal(store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);
});
