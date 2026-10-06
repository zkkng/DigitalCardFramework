import {completionPool} from './completion.js';
import {createRecordTransaction,validateRecordPlan} from './record-transaction.js';
import {validRecordAccounting,recordAccountingField,summarizeRecords,finalizeRecordAccounting} from './record-accounting.js';
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdtempSync,chmodSync,rmSync,statSync} from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStateCodec} from './encryption.js';
import {FrameworkError,check} from './catalog.js';
import {initialState} from './store.js';
import {cloneResult,completionBytes,querySnapshot} from './storage-query.js';
import {copySnapshotFiles} from './storage-snapshot.js';
import {STORAGE_SCHEMA,schemaSql,schemaSqlV2,schemaSqlV3,notificationSchemaSql,codeHolderSchemaSql,migrateCodeHolders,encodeState,readState,writeDifference,sqliteQueries,storageRecordKey,decodeRecordEnvelope,encodedRecordBytes,encodeRecordPayload,encodeEntity} from './indexed-storage.js';

const emptyRecords=()=>({fields:new Map(),entities:new Map(),usedBytes:0});
const marker={format:'digital-card.indexed-state',version:STORAGE_SCHEMA,recordKeys:'blind-v1'};
const expectedSchemas=new Map();
const schemaEntries=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().filter(row=>row.name.startsWith('framework_')||row.tbl_name.startsWith('framework_')).map(row=>({...row,sql:row.sql?.replace(/\s+/g,' ').trim()}));
function validateSchema(db,storageVersion) {
  if(!expectedSchemas.has(storageVersion)){const model=new DatabaseSync(':memory:');try{model.exec(storageVersion===2?schemaSqlV2:storageVersion===3?schemaSqlV3:schemaSql);expectedSchemas.set(storageVersion,schemaEntries(model));}finally{model.close();}}
  if(!isDeepStrictEqual(schemaEntries(db),expectedSchemas.get(storageVersion)))throw new Error('Database schema does not match its declared version');
}
function version(db) {
  const pragma=db.prepare('PRAGMA user_version').get().user_version;
  if(pragma>STORAGE_SCHEMA)throw new Error('Unsupported database schema version');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  if(tables.has('framework_meta')){
    const row=db.prepare('SELECT schema_version,codec_check FROM framework_meta WHERE id=1').get();
    if(!row||![2,3,STORAGE_SCHEMA].includes(row.schema_version)||pragma!==row.schema_version||tables.has('framework_state'))throw new Error('Unsupported database schema version');
    validateSchema(db,row.schema_version);
    return {version:row.schema_version,check:row.codec_check};
  }
  if(tables.has('framework_state')){
    const fields=db.prepare('PRAGMA table_info(framework_state)').all().map(({name,type,pk})=>({name,type,pk}));
    if(schemaEntries(db).length!==1||!isDeepStrictEqual(fields,[{name:'id',type:'INTEGER',pk:1},{name:'schema_version',type:'INTEGER',pk:0},{name:'body',type:'TEXT',pk:0}]))throw new Error('Database schema does not match its declared version');
    const row=db.prepare('SELECT schema_version,body FROM framework_state WHERE id=1').get();
    if(!row||row.schema_version!==1||pragma>1)throw new Error('Unsupported database schema version');
    return {version:1,body:row.body};
  }
  if(schemaEntries(db).length||pragma)throw new Error('Unrecognized database schema');
  return {version:0};
}
function inspect(path,authenticate) {
  const members=['','-wal','-journal'];
  const stamp=()=>members.map(suffix=>{try{const s=statSync(path+suffix,{bigint:true});return [suffix,s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}catch(error){if(error.code==='ENOENT')return suffix+':absent';throw error;}}).join('|');
  const retrySignal=new Int32Array(new SharedArrayBuffer(4));
  for(let attempt=0;attempt<20;attempt++){
    if(attempt)Atomics.wait(retrySignal,0,0,10);
    let directory,probe;
    const before=stamp(),changed=()=>stamp()!==before;
    try{
      // Even a read-only SQLite connection can create or update WAL sidecars.
      // Preliminary authentication uses a private recovery-capable copy. The
      // source is always rechecked under its authoritative transaction lock.
      directory=mkdtempSync(join(tmpdir(),'digital-card-probe-'));chmodSync(directory,0o700);
      const target=join(directory,'state.sqlite');
      const pairs=members.filter(suffix=>existsSync(path+suffix)).map(suffix=>[path+suffix,target+suffix]);
      copySnapshotFiles(pairs);for(const [,file]of pairs)chmodSync(file,0o600);
      if(changed())continue;
      probe=new DatabaseSync(target,{timeout:5000});probe.exec('BEGIN');
      authenticate(version(probe));
      if(changed())continue;
      return;
    }catch(error){if(!changed())throw error;}
    finally{probe?.close();if(directory)rmSync(directory,{recursive:true,force:true});}
  }
  throw new Error('Database changed during inspection; retry opening it');
}

/** Indexed durable queries with serialized commands. Legacy command callbacks materialize state. */
export class SQLiteStore {
  #db;#codec;#maxBytes;#maxCompletionBytes;#identity;#recordKey;#readOnly;#storageVersion=STORAGE_SCHEMA;#active=false;#decoded=0;#materializations=0;#writes=0;
  constructor(path=':memory:',{encryptionKey,maxStateBytes=64*1024*1024,maxCompletionBytes=64*1024*1024,readOnly=false,onMigration}={}) {
    if(!Number.isSafeInteger(maxStateBytes)||maxStateBytes<1)throw new Error('Invalid storage capacity');
    if(!Number.isSafeInteger(maxCompletionBytes)||maxCompletionBytes<1)throw new Error('Invalid completion capacity');this.#maxCompletionBytes=maxCompletionBytes;
    this.#codec=createStateCodec(encryptionKey);this.#maxBytes=maxStateBytes;this.#readOnly=readOnly;
    const digest=value=>{
      const text=JSON.stringify(value);
      return encryptionKey?createHmac('sha256',encryptionKey).update(text).digest('hex'):createHash('sha256').update(text).digest('hex');
    };
    this.#identity=(provider,subject)=>digest(['digital-card.identity.v1',provider,subject]);
    this.#recordKey=(collection,key)=>digest(['digital-card.record-key.v1',collection,key]);
    // Inspect schema and key before journal-mode changes or writable migration access.
    if(path!==':memory:'&&existsSync(path))inspect(path,found=>this.#authenticate(found));
    this.#db=new DatabaseSync(path,{readOnly,timeout:5000});
    try {
      this.#db.exec('PRAGMA foreign_keys=ON;');
      if(readOnly){this.#db.exec('BEGIN');const found=version(this.#db);this.#storageVersion=found.version;this.#authenticate(found);if(![3,STORAGE_SCHEMA].includes(found.version))throw new Error('Database migration requires writable access');this.#db.exec('COMMIT');return;}
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const found=version(this.#db);this.#authenticate(found);
        if(found.version!==STORAGE_SCHEMA){
          const state=found.version>=2?readState(this.#db,this.#codec,this.#recordKey):found.version===1?this.#codec.decode(found.body):initialState();
          if(onMigration)cloneResult(onMigration({from:found.version,to:STORAGE_SCHEMA,stage:'before-schema'}));
          const encoded=encodeState(state,this.#codec,this.#identity,this.#recordKey);
          if(found.version>=2){
            if(found.version===2)this.#db.exec(codeHolderSchemaSql);
            this.#db.exec(notificationSchemaSql);
            if(found.version===2)migrateCodeHolders(this.#db,encoded);
            if(this.#db.prepare("SELECT payload,owner_id FROM framework_entities WHERE collection='notifications'").all().some(row=>{const envelope=this.#codec.decode(row.payload);return envelope.key!==envelope.value.id||row.owner_id!==envelope.value.userId;})){
              const oldBytes=this.#db.prepare("SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS n FROM framework_entities WHERE collection='notifications'").get().n;
              const newBytes=[...encoded.entities.values()].filter(row=>row.collection==='notifications').reduce((n,row)=>n+row.bytes,0);
              const accounting=this.#db.prepare('SELECT payload FROM framework_fields WHERE name=?').get(recordAccountingField);
              const previousBytes=this.#db.prepare("SELECT (SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM framework_entities)+(SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM framework_fields) AS n").get().n;
              const nextBytes=previousBytes+newBytes-oldBytes-Buffer.byteLength(accounting?.payload??'');
              check(nextBytes<=previousBytes||nextBytes+completionBytes(state)<=this.#maxBytes,'STORAGE_CAPACITY','Notification identity migration needs additional maxStateBytes; reopen read-only or increase the configured budget',507);
              check(nextBytes+completionBytes(state)+completionPool(state).reservedBytes<=this.#maxBytes+this.#maxCompletionBytes,'COMPLETION_CAPACITY','Notification identity migration needs additional storage or completion capacity',507);
              this.#db.exec("DELETE FROM framework_entities WHERE collection='notifications'");
              const rows={fields:new Map([['notifications',encoded.fields.get('notifications')]]),entities:new Map([...encoded.entities].filter(([,row])=>row.collection==='notifications')),encode:encoded.encode};
              writeDifference(this.#db,emptyRecords(),rows);
              // Cached encoded-byte totals belong to the previous record identities.
              this.#db.prepare('DELETE FROM framework_fields WHERE name=?').run(recordAccountingField);
            }
            this.#db.prepare('UPDATE framework_meta SET schema_version=?,codec_check=? WHERE id=1').run(STORAGE_SCHEMA,this.#codec.encode(marker));
          }else{
            this.#db.exec(schemaSql);
            this.#db.prepare('INSERT INTO framework_meta VALUES(1,?,?)').run(STORAGE_SCHEMA,this.#codec.encode(marker));
            writeDifference(this.#db,emptyRecords(),encoded);
          }
          if(onMigration)cloneResult(onMigration({from:found.version,to:STORAGE_SCHEMA,stage:'after-records'}));
          if(found.version===1)this.#db.exec('DROP TABLE framework_state');
          this.#db.exec(`PRAGMA user_version=${STORAGE_SCHEMA}`);
          if(onMigration)cloneResult(onMigration({from:found.version,to:STORAGE_SCHEMA,stage:'before-commit'}));
        }
        this.#db.exec('COMMIT');
      }catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    }catch(error){this.#db.close();throw error;}
  }
  #authenticate(found) {
    if(found.version===1){const state=this.#codec.decode(found.body);if(state?.schemaVersion!==1)throw new Error('Unsupported logical state schema');}
    if(found.version>=2&&!isDeepStrictEqual(this.#codec.decode(found.check),{...marker,version:found.version}))throw new Error('Invalid database encryption marker');
  }
  #snapshot(fn) {
    if(this.#active)throw new Error('Nested storage operations are unsupported');
    this.#active=true;
    try{this.#db.exec('BEGIN');const result=cloneResult(fn());this.#db.exec('COMMIT');return result;}
    catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
    finally{this.#active=false;}
  }
  read(fn) {return this.#snapshot(()=>{this.#materializations++;return fn(readState(this.#db,this.#codec,this.#recordKey));});}
  query(fn) {return this.#snapshot(()=>querySnapshot(sqliteQueries(this.#db,this.#codec,this.#identity,this.#recordKey,()=>this.#decoded++),fn));}
  measure(state) {const usedBytes=encodeState(state,this.#codec,this.#identity,this.#recordKey).usedBytes,reservedBytes=completionBytes(state);const pool=completionPool(state);return {usedBytes,reservedBytes,totalBytes:usedBytes+reservedBytes,limitBytes:this.#maxBytes,completionStoredBytes:pool.storedBytes,completionReservedBytes:pool.reservedBytes,completionLimitBytes:this.#maxCompletionBytes};}
  assertCapacity(state,{previous}={}) {
    const measured=this.measure(state);
    if(measured.completionStoredBytes+measured.completionReservedBytes>this.#maxCompletionBytes)throw new FrameworkError('COMPLETION_CAPACITY','Completion storage capacity reached',507);
    const prior=previous===undefined?null:this.measure(previous);
    const completionGrowth=prior?Math.max(0,measured.completionStoredBytes-prior.completionStoredBytes):0;
    const revisionGrowth=completionGrowth>0?Math.max(0,measured.usedBytes-this.measure({...state,revision:previous.revision}).usedBytes):0;
    // Completion allowance is consumed only by this transaction. Retained receipts
    // never provide a reusable discount for later ordinary writes.
    if(measured.totalBytes>this.#maxBytes&&(prior===null||measured.totalBytes>prior.totalBytes+completionGrowth+revisionGrowth))throw new FrameworkError('STORAGE_CAPACITY','Installation capacity reached; existing completion reservations are retained',507);
    if(measured.totalBytes+measured.completionReservedBytes>this.#maxBytes+this.#maxCompletionBytes)throw new FrameworkError('COMPLETION_CAPACITY','Combined storage capacity reached',507);
    return measured;
  }
  transact(fn) {
    if(this.#readOnly)throw new Error('Database is read-only');
    if(this.#active)throw new Error('Nested storage operations are unsupported');
    this.#active=true;
    try{
      this.#db.exec('BEGIN IMMEDIATE');this.#materializations++;
      const state=readState(this.#db,this.#codec,this.#recordKey),before=structuredClone(state);
      const result=cloneResult(fn(state));
      if(!isDeepStrictEqual(state,before)){
        state.revision++;
        if(Object.hasOwn(state,recordAccountingField)){
          const baseline=encodeState(state,this.#codec,this.#identity,this.#recordKey).usedBytes;
          const size=(field,key,value)=>value===undefined?0:encodedRecordBytes(this.#codec,field,key,value);
          const originalAccounting=size(recordAccountingField,null,state[recordAccountingField]);
          const obligations=Object.entries(state.completionObligations??{}).map(([key,row])=>({key,bytes:size('completionObligations',key,row)}));
          finalizeRecordAccounting(state,before,value=>baseline+size(recordAccountingField,null,value[recordAccountingField])-originalAccounting
            +obligations.reduce((sum,row)=>sum+size('completionObligations',row.key,value.completionObligations[row.key])-row.bytes,0));
        }
        this.assertCapacity(state,{previous:before});
        this.#writes+=writeDifference(this.#db,encodeState(before,this.#codec,this.#identity,this.#recordKey),encodeState(state,this.#codec,this.#identity,this.#recordKey));
      }
      this.#db.exec('COMMIT');return result;
    }catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
    finally{this.#active=false;}
  }
  prepareRecordTransactions(){
    return this.transact(state=>{
      let summary;try{summary=JSON.parse(state[recordAccountingField]);}catch{}
      if(validRecordAccounting(summary,state.revision))return {prepared:false};
      state[recordAccountingField]=String(state[recordAccountingField]??'')+' ';
      return {prepared:true};
    });
  }
  transactRecords(fn,options={}){
    if(this.#readOnly)throw new Error('Database is read-only');
    if(this.#active)throw new Error('Nested storage operations are unsupported');
    this.#active=true;let scope;
    try{
      this.#db.exec('BEGIN IMMEDIATE');
      const decode=(row,field,key,charge)=>{if(!row){charge(0);return undefined;}charge(Buffer.byteLength(row.payload??''));this.#decoded++;return decodeRecordEnvelope(this.#codec,row.payload,field,key,this.#recordKey);};
      const backend={
        field:(name,charge)=>{const row=this.#db.prepare('SELECT kind,payload FROM framework_fields WHERE name=?').get(name);if(!row)return undefined;return {...row,...(row.kind==='scalar'?{value:decode(row,name,null,charge).value}:{})};},
        record:(name,key,charge)=>{const storageKey=storageRecordKey(name,key,this.#recordKey),row=this.#db.prepare('SELECT ordinal,payload FROM framework_entities WHERE collection=? AND entity_key=?').get(name,storageKey);const envelope=decode(row,name,storageKey,charge);return row?{value:envelope.value,ordinal:row.ordinal}:undefined;},
        entries:(name,charge)=>{const rows=[];for(const row of this.#db.prepare('SELECT entity_key,ordinal,payload FROM framework_entities WHERE collection=? ORDER BY ordinal').iterate(name)){const envelope=decode(row,name,row.entity_key,charge);rows.push({key:envelope.key,value:envelope.value,ordinal:row.ordinal});}return rows;},
        count:name=>this.#db.prepare('SELECT COUNT(*) AS n FROM framework_entities WHERE collection=?').get(name).n,
        nextOrdinal:name=>this.#db.prepare('SELECT COALESCE(MAX(ordinal)+1,0) AS n FROM framework_entities WHERE collection=?').get(name).n,
        ownerCounts:ownerId=>sqliteQueries(this.#db,this.#codec,this.#identity,this.#recordKey).collectionCounts(ownerId),
        notificationOverflow:(ownerId,keep,charge)=>{const count=this.#db.prepare("SELECT COUNT(*) AS n FROM framework_entities WHERE collection='notifications' AND owner_id=?").get(ownerId).n;charge(0);const rows=this.#db.prepare("SELECT entity_key,ordinal,payload FROM framework_entities INDEXED BY framework_notification_owner_order WHERE collection='notifications' AND owner_id=? ORDER BY ordinal LIMIT ?").all(ownerId,Math.max(0,count-keep));return rows.map(row=>({key:decode(row,'notifications',row.entity_key,charge).key}));},
        ownedVariantCount:(ownerId,variantIds)=>variantIds.length?this.#db.prepare("SELECT COUNT(*) AS n FROM framework_entities INDEXED BY framework_owner_variant WHERE collection='copies' AND owner_id=? AND state='owned' AND variant_id IN ("+variantIds.map(()=>'?').join(',')+")").get(ownerId,...variantIds).n:0,
      };
      scope=createRecordTransaction(backend,options);
      const result=cloneResult(fn(scope.api)),plan=scope.finish();
      if(plan.changes.length||plan.scalars.length){
        validateRecordPlan(plan,options);
        const revision=scope.api.value('revision');let summary;
        try{summary=JSON.parse(scope.api.value(recordAccountingField));}catch{}
        check(validRecordAccounting(summary,revision),'RECORD_MIGRATION_REQUIRED','Prepare revision-bound record accounting before using record transactions',503);
        const previousSummary=structuredClone(summary),partial={schemaVersion:1,revision:0,events:[],ledger:[]},previousPartial={schemaVersion:1,revision:0,events:[],ledger:[]};
        const before=emptyRecords(),after=emptyRecords();after.encode=(field,key,value)=>encodeRecordPayload(this.#codec,field,key,value);
        let delta=0;
        for(const row of plan.changes){
          const metadata=plan.fields.get(row.collection),kind=metadata?.kind??(row.array?'array':'object');
          if(metadata)before.fields.set(row.collection,{kind,raw:null});after.fields.set(row.collection,{kind,raw:null});
          const key=JSON.stringify([row.collection,row.key]);
          if(row.value!==undefined){const encoded=encodeEntity(row.collection,row.key,row.value,row.ordinal,this.#codec,this.#identity,this.#recordKey);after.entities.set(key,encoded);delta+=encoded.bytes;}
          if(row.old){const old=encodeEntity(row.collection,row.key,row.old.value,row.old.ordinal,this.#codec,this.#identity,this.#recordKey);before.entities.set(key,old);delta-=old.bytes;previousPartial[row.collection]??=kind==='array'?[]:Object.create(null);if(kind==='array')previousPartial[row.collection].push(row.old.value);else previousPartial[row.collection][row.key]=row.old.value;}
          summary.counts[row.collection]=(summary.counts[row.collection]??0)+Number(row.value!==undefined)-Number(!!row.old);
          partial[row.collection]??=kind==='array'?[]:Object.create(null);
          if(row.value!==undefined){if(kind==='array')partial[row.collection].push(row.value);else partial[row.collection][row.key]=row.value;}
          if(row.collection==='events')check(row.value.sequence===row.ordinal+1,'INVALID_STATE','Event sequence differs from append position',500);
        }
        const oldPart=summarizeRecords(previousPartial);
        summary.revision=revision+1;
        const scalar=(name,old,value)=>{before.fields.set(name,{kind:'scalar',raw:JSON.stringify(old),value:old});after.fields.set(name,{kind:'scalar',raw:JSON.stringify(value),value});};
        scalar('revision',revision,summary.revision);
        delta+=encodedRecordBytes(this.#codec,'revision',null,summary.revision)-encodedRecordBytes(this.#codec,'revision',null,revision);
        for(const row of plan.scalars){if(row.old!==undefined)before.fields.set(row.name,{kind:'scalar',raw:JSON.stringify(row.old),value:row.old});after.fields.set(row.name,{kind:'scalar',raw:JSON.stringify(row.value),value:row.value});delta+=encodedRecordBytes(this.#codec,row.name,null,row.value)-(row.old===undefined?0:encodedRecordBytes(this.#codec,row.name,null,row.old));}
        const oldAccounting=scope.api.value(recordAccountingField),accountingBytes=encodedRecordBytes(this.#codec,recordAccountingField,null,oldAccounting);
        const completionRow=plan.completion&&plan.changes.find(row=>row.collection==='completionObligations'&&row.key===plan.completion.id),priorUsed=completionRow?.old?.value.usedBytes??0;
        let stabilized=false;
        for(let i=0;i<24;i++){
          const added=summarizeRecords(partial);check(added.missingCompletions===0,'COMPLETION_MIGRATION_REQUIRED','New obligations require completion reservations',503);
          for(const key of ['ordinaryRequests','ordinaryJobs','ordinaryEvents'])summary[key]=previousSummary[key]+added[key]-oldPart[key];
          for(const key of Object.keys(summary.workers))summary.workers[key]=previousSummary.workers[key]+added.workers[key]-oldPart.workers[key];
          for(const key of Object.keys(summary.completion))summary.completion[key]=previousSummary.completion[key]+added.completion[key]-oldPart.completion[key];
          const used=previousSummary.usedBytes+delta-accountingBytes+encodedRecordBytes(this.#codec,recordAccountingField,null,JSON.stringify(summary));
          const consumed=completionRow?priorUsed+Math.max(0,used-previousSummary.usedBytes):0;
          if(completionRow)check(consumed<=completionRow.value.bytes,'COMPLETION_INVARIANT','Completion exceeds its admitted reservation',500);
          if(used===summary.usedBytes&&(!completionRow||consumed===completionRow.value.usedBytes)){stabilized=true;break;}summary.usedBytes=used;
          if(completionRow&&consumed!==completionRow.value.usedBytes){const token=JSON.stringify([completionRow.collection,completionRow.key]),oldBytes=after.entities.get(token).bytes;completionRow.value.usedBytes=consumed;const encoded=encodeEntity(completionRow.collection,completionRow.key,completionRow.value,completionRow.ordinal,this.#codec,this.#identity,this.#recordKey);after.entities.set(token,encoded);delta+=encoded.bytes-oldBytes;}
        }
        check(stabilized,'INVALID_STATE','Record accounting did not stabilize',500);
        scalar(recordAccountingField,oldAccounting,JSON.stringify(summary));
        const total=summary.usedBytes+summary.externalReservedBytes,previousTotal=previousSummary.usedBytes+previousSummary.externalReservedBytes;
        const allowance=completionRow?Math.max(0,completionRow.value.usedBytes-priorUsed):0;
        check(total<=this.#maxBytes||total<=previousTotal+allowance,'STORAGE_CAPACITY','Installation capacity reached; existing completion reservations are retained',507);
        check(summary.completion.storedBytes+summary.completion.reservedBytes<=this.#maxCompletionBytes&&total+summary.completion.reservedBytes<=this.#maxBytes+this.#maxCompletionBytes,'COMPLETION_CAPACITY','Completion storage capacity reached',507);
        this.#writes+=writeDifference(this.#db,before,after);
      }
      scope.close();this.#db.exec('COMMIT');return result;
    }catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
    finally{scope?.close();this.#active=false;}
  }
  diagnostics(){return {storageSchema:this.#storageVersion,decodedQueryRecords:this.#decoded,compatibilityMaterializations:this.#materializations,recordWrites:this.#writes,readOnly:this.#readOnly};}
  integrity(){return this.#db.prepare('PRAGMA quick_check').all().every(row=>row.quick_check==='ok');}
  async backup(path){if(existsSync(path))throw new Error('Backup destination must not already exist');await backup(this.#db,path);return {path,revision:this.query(q=>q.value('revision'))};}
  close(){this.#db.close();}
}
