import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {manifestSchema,sceneSchema} from '../../src/presentation/schema.js';
import {validateManifest,validateScene} from '../../src/presentation/validate.js';
const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const manifest=await read('./examples/lakeside.card.json'),front=await read('./examples/scenes/front.json'),back=await read('./examples/scenes/back.json');
const ajv=new Ajv2020({strict:true,allErrors:true}),vm=ajv.compile(manifestSchema),vs=ajv.compile(sceneSchema);
assert.deepEqual(await read('./schemas/manifest.schema.json'),manifestSchema);assert.deepEqual(await read('./schemas/scene.schema.json'),sceneSchema);
assert(vm(manifest),ajv.errorsText(vm.errors));validateManifest(manifest);for(const scene of [front,back]){assert(vs(scene),ajv.errorsText(vs.errors));validateScene(scene,manifest);}
const invalid=[m=>m.contractVersion='9',m=>m.profile='executable',m=>m.assets[0].path='../secret',m=>m.assets.push(m.assets[0]),m=>m.faces.front.poster='missing',m=>m.revision=1.5];for(const change of invalid){const m=structuredClone(manifest);change(m);assert.throws(()=>validateManifest(m));}
for(const change of [s=>s.nodes[0].asset='unknown',s=>s.nodes[0].script='run()',s=>s.nodes[0].bindings.x=['eval',1],s=>s.nodes[0].material.kind='arbitrary-shader',s=>s.nodes[0].width=-1,s=>s.nodes.push(s.nodes[0])]){const scene=structuredClone(front);change(scene);assert.throws(()=>validateScene(scene,manifest));}
console.log('Runtime schemas and examples agree; 12 invalid variants rejected. Media bytes are tested by the package conformance suite.');
