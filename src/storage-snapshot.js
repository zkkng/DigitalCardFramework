import {openSync,closeSync,fstatSync,readSync,writeSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

function copyWindows(source,target){
  let input,output;
  try{
    input=openSync(source,'r');const size=fstatSync(input).size;
    if(!Number.isSafeInteger(size))throw new Error('Snapshot file exceeds supported size');
    output=openSync(target,'wx',0o600);const buffer=Buffer.allocUnsafe(65536);
    for(let position=0;position<size;){
      const read=readSync(input,buffer,0,Math.min(buffer.length,size-position),position);
      if(!read)throw new Error('Snapshot source changed during copying');
      let written=0;while(written<read){const count=writeSync(output,buffer,written,read-written);if(!count)throw new Error('Snapshot copy could not progress');written+=count;}
      position+=read;
    }
  }finally{if(output!==undefined)closeSync(output);if(input!==undefined)closeSync(input);}
}
// Source inspection must not close another connection's POSIX file locks.
const childCopy=`import {copyFileSync,constants} from 'node:fs';let input='';for await(const chunk of process.stdin)input+=chunk;for(const [source,target]of JSON.parse(input))copyFileSync(source,target,constants.COPYFILE_EXCL);`;
export function copySnapshotFiles(pairs){
  if(process.platform==='win32'){for(const [source,target]of pairs)copyWindows(source,target);return;}
  const result=spawnSync(process.execPath,['--input-type=module','-e',childCopy],{input:JSON.stringify(pairs),encoding:'utf8',timeout:30000,windowsHide:true});
  if(result.error||result.status!==0)throw new Error('Snapshot copy failed');
}
