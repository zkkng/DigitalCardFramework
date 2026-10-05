import {resolve} from 'node:path';
import {SQLiteStore} from '../src/sqlite.js';
import {keyFromHex} from '../src/encryption.js';
import {auditState} from '../src/audit.js';
import {DatabaseSync,backup} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {existsSync,copyFileSync,chmodSync,constants} from 'node:fs';
import {join} from 'node:path';
import {stoppedDatabaseCopy,temporaryDatabase} from './database-copy.js';
const [database,destination,mode,...extra]=process.argv.slice(2);if(!database||!destination||extra.length||(mode!==undefined&&mode!=='--stopped'))throw new Error('Usage: node tools/backup.js database.sqlite new-backup.sqlite [--stopped]');
if(!existsSync(resolve(database)))throw new Error('Source database does not exist');
if(existsSync(resolve(destination)))throw new Error('Backup destination must be a new path');
const key=process.env.STATE_ENCRYPTION_KEY_FILE?(await readFile(process.env.STATE_ENCRYPTION_KEY_FILE,'utf8')).trim():process.env.STATE_ENCRYPTION_KEY;
const options={encryptionKey:keyFromHex(key)},original=mode==='--stopped'?stoppedDatabaseCopy(resolve(database)):null,temporary=temporaryDatabase();
try{
  const source=new DatabaseSync(original?.path??resolve(database),{readOnly:!original,timeout:5000});
  try{await backup(source,temporary.path);}finally{source.close();}
  const validation=join(temporary.directory,'validation.sqlite');copyFileSync(temporary.path,validation);
  const restored=new SQLiteStore(validation,options);let audit;
  try{audit=restored.read(auditState);if(!restored.integrity()||!audit.ok)throw new Error('Backup verification failed');}finally{restored.close();}
  original?.verify();copyFileSync(temporary.path,resolve(destination),constants.COPYFILE_EXCL);chmodSync(resolve(destination),0o600);
  console.log(JSON.stringify({ok:true,...audit.counts}));
}finally{temporary.close();original?.close();}
