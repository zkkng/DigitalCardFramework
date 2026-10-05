import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,copyFileSync,mkdtempSync,chmodSync,rmSync,statSync} from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStateCodec} from './encryption.js';
import {FrameworkError} from './catalog.js';
import {initialState} from './store.js';
import {cloneResult,completionBytes,querySnapshot} from './storage-query.js';
import {STORAGE_SCHEMA,schemaSql,schemaSqlV2,codeHolderSchemaSql,migrateCodeHolders,encodeState,readState,writeDifference,sqliteQueries} from './indexed-storage.js';

const emptyRecords=()=>({fields:new Map(),entities:new Map(),usedBytes:0});
const marker={format:'digital-card.indexed-state',version:STORAGE_SCHEMA,recordKeys:'blind-v1'};
const expectedSchemas=new Map();
const schemaEntries=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().filter(row=>row.name.startsWith('framework_')||row.tbl_name.startsWith('framework_')).map(row=>({...row,sql:row.sql?.replace(/\s+/g,' ').trim()}));
function validateSchema(db,storageVersion) {
  if(!expectedSchemas.has(storageVersion)){const model=new DatabaseSync(':memory:');try{model.exec(storageVersion===2?schemaSqlV2:schemaSql);expectedSchemas.set(storageVersion,schemaEntries(model));}finally{model.close();}}
  if(!isDeepStrictEqual(schemaEntries(db),expectedSchemas.get(storageVersion)))throw new Error('Database schema does not match its declared version');
}
function version(db) {
  const pragma=db.prepare('PRAGMA user_version').get().user_version;
  if(pragma>STORAGE_SCHEMA)throw new Error('Unsupported database schema version');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  if(tables.has('framework_meta')){
    const row=db.prepare('SELECT schema_version,codec_check FROM framework_meta WHERE id=1').get();
    if(!row||![2,STORAGE_SCHEMA].includes(row.schema_version)||pragma!==row.schema_version||tables.has('framework_state'))throw new Error('Unsupported database schema version');
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
      for(const suffix of members)if(existsSync(path+suffix)){copyFileSync(path+suffix,target+suffix);chmodSync(target+suffix,0o600);}
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
  #db;#codec;#maxBytes;#identity;#recordKey;#readOnly;#active=false;#decoded=0;#materializations=0;#writes=0;
  constructor(path=':memory:',{encryptionKey,maxStateBytes=64*1024*1024,readOnly=false,onMigration}={}) {
    if(!Number.isSafeInteger(maxStateBytes)||maxStateBytes<1)throw new Error('Invalid storage capacity');
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
      if(readOnly){this.#db.exec('BEGIN');const found=version(this.#db);this.#authenticate(found);if(found.version!==STORAGE_SCHEMA)throw new Error('Database migration requires writable access');this.#db.exec('COMMIT');return;}
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const found=version(this.#db);this.#authenticate(found);
        if(found.version!==STORAGE_SCHEMA){
          const state=found.version===2?readState(this.#db,this.#codec,this.#recordKey):found.version===1?this.#codec.decode(found.body):initialState();
          if(onMigration)cloneResult(onMigration({from:found.version,to:STORAGE_SCHEMA,stage:'before-schema'}));
          const encoded=encodeState(state,this.#codec,this.#identity,this.#recordKey);
          if(found.version===2){
            this.#db.exec(codeHolderSchemaSql);
            migrateCodeHolders(this.#db,encoded);
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
  measure(state) {const usedBytes=encodeState(state,this.#codec,this.#identity,this.#recordKey).usedBytes,reservedBytes=completionBytes(state);return {usedBytes,reservedBytes,totalBytes:usedBytes+reservedBytes,limitBytes:this.#maxBytes};}
  assertCapacity(state,{previous}={}) {
    const measured=this.measure(state);
    if(measured.totalBytes>this.#maxBytes&&(previous===undefined||measured.totalBytes>this.measure(previous).totalBytes))throw new FrameworkError('STORAGE_CAPACITY','Installation capacity reached; existing completion reservations are retained',507);
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
        this.assertCapacity(state,{previous:before});
        this.#writes+=writeDifference(this.#db,encodeState(before,this.#codec,this.#identity,this.#recordKey),encodeState(state,this.#codec,this.#identity,this.#recordKey));
      }
      this.#db.exec('COMMIT');return result;
    }catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
    finally{this.#active=false;}
  }
  diagnostics(){return {storageSchema:STORAGE_SCHEMA,decodedQueryRecords:this.#decoded,compatibilityMaterializations:this.#materializations,recordWrites:this.#writes,readOnly:this.#readOnly};}
  integrity(){return this.#db.prepare('PRAGMA quick_check').all().every(row=>row.quick_check==='ok');}
  async backup(path){if(existsSync(path))throw new Error('Backup destination must not already exist');await backup(this.#db,path);return {path,revision:this.query(q=>q.value('revision'))};}
  close(){this.#db.close();}
}
