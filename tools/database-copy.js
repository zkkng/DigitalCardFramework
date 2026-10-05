import {copyFileSync,mkdtempSync,chmodSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const suffixes=['','-wal','-journal','-shm'];
const members=path=>Object.fromEntries(suffixes.filter(suffix=>existsSync(path+suffix)).map(suffix=>[suffix,createHash('sha256').update(readFileSync(path+suffix)).digest('hex')]));
export function temporaryDatabase(){
  const directory=mkdtempSync(join(tmpdir(),'digital-card-operation-'));chmodSync(directory,0o700);
  return {path:join(directory,'state.sqlite'),directory,close(){rmSync(directory,{recursive:true,force:true});}};
}

/** Writers must be stopped; hashes detect changes without opening the source in SQLite. */
export function stoppedDatabaseCopy(source){
  const before=members(source);if(!Object.hasOwn(before,''))throw new Error('Source database does not exist');
  const temporary=temporaryDatabase(),verify=()=>{if(!isDeepStrictEqual(members(source),before))throw new Error('Source changed; stop all writers and retry');};
  try{for(const suffix of ['', '-wal','-journal'])if(Object.hasOwn(before,suffix)){copyFileSync(source+suffix,temporary.path+suffix);chmodSync(temporary.path+suffix,0o600);}verify();return {...temporary,verify};}
  catch(error){temporary.close();throw error;}
}
