import {writeFileSync} from 'node:fs';
import {openapi} from '../src/contracts.js';
writeFileSync(new URL('../docs/openapi.json',import.meta.url),JSON.stringify(openapi,null,2)+'\n');
