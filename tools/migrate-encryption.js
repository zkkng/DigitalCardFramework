import {existsSync,readFileSync,copyFileSync,chmodSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {SQLiteStore} from '../src/sqlite.js';
import {keyFromHex} from '../src/encryption.js';
import {auditState} from '../src/audit.js';
import {stoppedDatabaseCopy,temporaryDatabase} from './database-copy.js';
const [source,target]=process.argv.slice(2);if(!source||!target)throw new Error('Usage: node tools/migrate-encryption.js source.sqlite new-encrypted.sqlite');
if(!existsSync(resolve(source))||existsSync(resolve(target)))throw new Error('Source must exist; target must be a new path');
const secret=name=>process.env[name+'_FILE']?readFileSync(process.env[name+'_FILE'],'utf8').trim():process.env[name];
const key=keyFromHex(secret('STATE_ENCRYPTION_KEY'));if(!key)throw new Error('New STATE_ENCRYPTION_KEY is required');
const original=stoppedDatabaseCopy(resolve(source)),output=temporaryDatabase();
try{
  const old=new SQLiteStore(original.path,{encryptionKey:keyFromHex(secret('OLD_STATE_ENCRYPTION_KEY'))});let snapshot;
  try{snapshot=old.read(s=>s);if(!old.integrity()||!auditState(snapshot).ok)throw new Error('Source verification failed');}finally{old.close();}
  const migrated=new SQLiteStore(output.path,{encryptionKey:key});
  try{migrated.transact(s=>{Object.assign(s,snapshot);});const actual=migrated.read(s=>s);if(!migrated.integrity()||!auditState(actual).ok||!isDeepStrictEqual(actual,{...snapshot,revision:snapshot.revision+1}))throw new Error('Target verification failed');}finally{migrated.close();}
  original.verify();copyFileSync(output.path,resolve(target),constants.COPYFILE_EXCL);chmodSync(resolve(target),0o600);
  console.log('Verified encrypted state written to new database. Authentication sessions were not copied; collectors sign in again. Source preserved.');
}finally{output.close();original.close();}
