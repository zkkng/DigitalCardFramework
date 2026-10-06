import {readFileSync,writeFileSync} from 'node:fs';
import {actionDeliverySchema} from '../src/action-contracts.js';
const path=new URL('../docs/action-delivery.schema.json',import.meta.url);
const content=JSON.stringify(actionDeliverySchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Action delivery schema drift');}
else writeFileSync(path,content);
