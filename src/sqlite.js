import {DatabaseSync} from 'node:sqlite';
import {initialState} from './store.js';

/** Durable single-installation store. BEGIN IMMEDIATE serializes writers across processes.
 * A whole-state document deliberately favors a small standalone installation over throughput.
 * A larger deployment can implement the same synchronous read/transact interface.
 */
export class SQLiteStore {
  #db;
  constructor(path = ':memory:') {
    this.#db = new DatabaseSync(path, {timeout:5000});
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.#db.exec('CREATE TABLE IF NOT EXISTS framework_state (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;');
    this.#db.prepare('INSERT OR IGNORE INTO framework_state VALUES (1, 1, ?)').run(JSON.stringify(initialState()));
    const row = this.#db.prepare('SELECT schema_version FROM framework_state WHERE id=1').get();
    if (row.schema_version !== 1) throw new Error('Unsupported database schema version');
  }
  #load() { return JSON.parse(this.#db.prepare('SELECT body FROM framework_state WHERE id=1').get().body); }
  read(fn) { return structuredClone(fn(this.#load())); }
  transact(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.#load();
      const result = fn(state);
      if (result?.then) throw new Error('Async transaction callbacks are unsupported');
      state.revision++;
      this.#db.prepare('UPDATE framework_state SET body=? WHERE id=1').run(JSON.stringify(state));
      this.#db.exec('COMMIT');
      return structuredClone(result);
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.#db.close(); }
}
