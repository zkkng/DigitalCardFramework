import {readFileSync,writeFileSync} from 'node:fs';
import {pluginProtocolSchema} from '../src/plugin-contracts.js';
const path=new URL('../docs/plugin-protocol.schema.json',import.meta.url),content=JSON.stringify(pluginProtocolSchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw Error('Plugin protocol schema drift');}else writeFileSync(path,content);
