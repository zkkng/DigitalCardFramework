import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createStateCodec} from './encryption.js';
import {FrameworkError} from './catalog.js';
import {initialState} from './store.js';

/** Durable single-installation store. BEGIN IMMEDIATE serializes writers across processes.
 * A whole-state document deliberately favors a small standalone installation over throughput.
 * A larger deployment can implement the same synchronous read/transact interface.
 */
export class SQLiteStore {
  #db;#codec;#maxBytes;
  constructor(path = ':memory:',{encryptionKey,maxStateBytes=64*1024*1024}={}) {
    this.#codec=createStateCodec(encryptionKey);this.#maxBytes=maxStateBytes;
    this.#db = new DatabaseSync(path, {timeout:5000});
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.#db.exec('CREATE TABLE IF NOT EXISTS framework_state (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;');
    this.#db.prepare('INSERT OR IGNORE INTO framework_state VALUES (1, 1, ?)').run(this.#codec.encode(initialState()));
    const row = this.#db.prepare('SELECT schema_version FROM framework_state WHERE id=1').get();
    if (row.schema_version !== 1){this.#db.close();throw new Error('Unsupported database schema version');}
    try{this.#load();}catch(error){this.#db.close();throw error;}
  }
  #load() { return this.#codec.decode(this.#db.prepare('SELECT body FROM framework_state WHERE id=1').get().body); }
  read(fn) { return structuredClone(fn(this.#load())); }
  transact(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.#load();
      const result = fn(state);
      if (result?.then) throw new Error('Async transaction callbacks are unsupported');
      const detachedResult = structuredClone(result);
      state.revision++;
      const body=this.#codec.encode(state);if(Buffer.byteLength(body)>this.#maxBytes)throw new FrameworkError('STORAGE_CAPACITY','Installation capacity reached; contact the operator',507);
      this.#db.prepare('UPDATE framework_state SET body=? WHERE id=1').run(body);
      this.#db.exec('COMMIT');
      return detachedResult;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch { /* Preserve the original transaction failure. */ }
      throw error;
    }
  }
  integrity(){return this.#db.prepare('PRAGMA quick_check').all().every(row=>row.quick_check==='ok');}
  async backup(path){if(existsSync(path))throw new Error('Backup destination must not already exist');await backup(this.#db,path);return {path,revision:this.read(s=>s.revision)};}
  close() { this.#db.close(); }
}
