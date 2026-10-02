import {readFileSync,writeFileSync} from 'node:fs';
import {CardFramework} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {exportContent} from '../src/importer.js';
import {keyFromHex} from '../src/encryption.js';
const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw new Error('Options must use --name value');options[args[i].slice(2)]=args[i+1];}
if(!['preview','apply','export'].includes(command)||!options.database)throw new Error('Usage: node tools/content.js preview|apply|export --database data/cards.sqlite --file content.yaml [--mode merge|replace] [--format json|yaml] [--digest preview-digest] [--policy-revision reviewed-revision]');
const rawKey=process.env.STATE_ENCRYPTION_KEY_FILE?readFileSync(process.env.STATE_ENCRYPTION_KEY_FILE,'utf8').trim():process.env.STATE_ENCRYPTION_KEY;
const core=new CardFramework({store:new SQLiteStore(options.database,{encryptionKey:keyFromHex(rawKey)})}),operator={role:'admin'};
try{
  const format=options.format??(options.file?.endsWith('.yaml')||options.file?.endsWith('.yml')?'yaml':'json');
  if(command==='export'){if(!options.file)throw new Error('Export requires --file');writeFileSync(options.file,exportContent(core.operatorCatalog(operator),{format}));console.log('Catalog exported to '+options.file);}
  else{let expectedVersion=0;try{expectedVersion=core.catalog().version;}catch(error){if(error.code!=='NO_CATALOG')throw error;}
    const preview=core.previewImport(operator,{source:readFileSync(options.file,'utf8'),format,mode:options.mode??(expectedVersion?'merge':'replace'),expectedVersion});
    if(command==='preview')console.log(JSON.stringify({digest:preview.digest,policyRevision:preview.policyRevision,expectedVersion,counts:preview.counts,changes:preview.changes,warnings:preview.warnings},null,2));
    else{if(options.digest!==preview.digest)throw new Error('Provide --digest from a current preview before applying');if(Number(options['policy-revision']??0)!==preview.policyRevision)throw new Error('Provide --policy-revision from the reviewed preview; card policy changed');console.log(JSON.stringify(core.commitImport(operator,{key:'cli-'+preview.digest,...preview}),null,2));}
  }
}finally{core.close();}
