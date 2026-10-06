import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const compiler=process.env.DC_TYPESCRIPT_COMPILER??fileURLToPath(new URL('./lib/tsc.js',import.meta.resolve('typescript/package.json')));
const result=spawnSync(process.execPath,[compiler,'--strict','--noUncheckedIndexedAccess','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM','--noEmit','src/client.ts','src/wire-client.ts','src/trade-client.ts','test/sdk-consumer.ts','test/client-consumer.ts','test/trade-client-consumer.ts','test/capability-consumer.ts'],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url))});
if(result.error)throw result.error;
if(result.status!==0)process.exitCode=result.status??1;
else{
  for(const generator of ['generate-wire-types.mjs','generate-wire-validators.mjs']){
    const checked=spawnSync(process.execPath,[fileURLToPath(new URL(generator,import.meta.url)),'--check'],{stdio:'inherit'});
    if(checked.status!==0)throw new Error('Generated contract drift');
  }
  const directory=mkdtempSync(join(tmpdir(),'digital-card-sdk-'));
  try{
    const emitted=spawnSync(process.execPath,[compiler,'--strict','--noUncheckedIndexedAccess','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM','--declaration','--rootDir','src','--outDir',directory,'src/client.ts','src/wire-client.ts','src/trade-client.ts'],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url))});
    if(emitted.status!==0)throw new Error('SDK compilation failed');
    for(const filename of ['client.js','client.d.ts','wire-client.js','wire-client.d.ts','trade-client.js','trade-client.d.ts'])if(readFileSync(join(directory,filename),'utf8')!==readFileSync(new URL('../src/'+filename,import.meta.url),'utf8'))throw new Error('Generated SDK drift: '+filename);
  }finally{rmSync(directory,{recursive:true,force:true});}
}
