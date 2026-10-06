import {readFileSync,writeFileSync} from 'node:fs';
import {pluginManifestSchema} from '../src/plugin-deployment.js';
const target=new URL('../docs/plugin-manifest.schema.json',import.meta.url),content=JSON.stringify(pluginManifestSchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==content)throw Error('Plugin manifest schema drift');}else writeFileSync(target,content);
