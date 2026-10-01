import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openapi} from '../src/contracts.js';
test('published OpenAPI is generated from its checked-in source and uses unique operation IDs',()=>{
  assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8')),openapi);
  const ids=Object.values(openapi.paths).flatMap(path=>Object.values(path).map(op=>op.operationId));
  assert.equal(new Set(ids).size,ids.length);
});
