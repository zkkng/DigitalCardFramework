import {resolve} from 'node:path';
import {SQLiteStore} from '../src/sqlite.js';
import {keyFromHex} from '../src/encryption.js';
import {auditState} from '../src/audit.js';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const [database,destination]=process.argv.slice(2);if(!database||!destination)throw new Error('Usage: node tools/backup.js database.sqlite new-backup.sqlite');
if(!existsSync(resolve(database)))throw new Error('Source database does not exist');
const key=process.env.STATE_ENCRYPTION_KEY_FILE?(await readFile(process.env.STATE_ENCRYPTION_KEY_FILE,'utf8')).trim():process.env.STATE_ENCRYPTION_KEY;
const options={encryptionKey:keyFromHex(key)},store=new SQLiteStore(resolve(database),options);
try{if(!store.integrity()||!store.read(auditState).ok)throw new Error('Source verification failed');await store.backup(resolve(destination));const restored=new SQLiteStore(resolve(destination),options);try{const audit=restored.read(auditState);if(!restored.integrity()||!audit.ok)throw new Error('Backup verification failed');console.log(JSON.stringify({ok:true,...audit.counts}));}finally{restored.close();}}finally{store.close();}
