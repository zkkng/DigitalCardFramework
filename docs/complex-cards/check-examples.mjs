// Documentation checks only. This is deliberately not an archive/media importer.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const [manifestSchema, sceneSchema, manifest, front, back] = await Promise.all([
  read('./schemas/manifest.schema.json'), read('./schemas/scene.schema.json'),
  read('./examples/lakeside.card.json'), read('./examples/scenes/front.json'),
  read('./examples/scenes/back.json')
]);
const ajv = new Ajv2020({allErrors:true, strict:true});
const validManifest = ajv.compile(manifestSchema), validScene = ajv.compile(sceneSchema);
const initial = {manifest, scenes:{'scenes/front.json':front, 'scenes/back.json':back}};

function check(example) {
  const {manifest:m, scenes} = example;
  assert(validManifest(m), ajv.errorsText(validManifest.errors));
  const assets = new Map(), paths = new Set();
  for (const asset of m.assets) {
    assert(!assets.has(asset.id), `Duplicate asset ${asset.id}`);
    assert(!paths.has(asset.path.toLowerCase()), `Colliding path ${asset.path}`);
    assets.set(asset.id, asset); paths.add(asset.path.toLowerCase());
  }
  const capabilities = new Set([...m.capabilities.required,...m.capabilities.optional.map(x=>x.id)]);
  assert.equal(capabilities.size,m.capabilities.required.length+m.capabilities.optional.length,'Duplicate capability');
  for (const face of Object.values(m.faces)) {
    assert.equal(assets.get(face.poster)?.role,'poster','Missing face poster');
    const scene = scenes[face.scene];
    assert(scene, `Missing scene ${face.scene}`);
    assert(validScene(scene), ajv.errorsText(validScene.errors));
    assert(capabilities.has(scene.dialect), 'Undeclared scene capability');
    const nodes = new Map();
    for (const node of scene.nodes) {
      assert(!nodes.has(node.id), `Duplicate node ${node.id}`);
      nodes.set(node.id,node);
      const asset = assets.get(node.asset);
      assert(asset, `Missing asset ${node.asset}`);
      if (node.material) {
        assert(capabilities.has(node.material.recipe),'Undeclared material capability');
        const keys = {
          'dc.material.water@0.1':['angle','width','intensity'],
          'dc.material.bloom@0.1':['progress','feather','intensity'],
          'dc.material.glitter@0.1':['angle','flakeSize','density','intensity']
        }[node.material.recipe];
        assert.deepEqual(Object.keys(node.material.parameters).sort(), [...keys].sort(),'Invalid recipe parameters');
      }
      if (node.type === 'video') {
        assert(capabilities.has('dc.video@0.1'),'Undeclared video capability');
        assert.equal(asset.role,'video');
        assert(node.video, 'Missing video policy');
        assert.equal(assets.get(node.video.poster)?.role,'poster','Missing video poster');
        assert(!node.sequence, 'Video cannot use atlas sequence');
      } else {
        assert(!node.video, 'Video policy on non-video node');
        assert(asset.mediaType.startsWith('image/'),'Image node needs image asset');
      }
      if (node.type === 'atlas-sequence') {
        assert(capabilities.has('dc.atlas-sequence@0.1'),'Undeclared atlas capability');
        assert.equal(asset.role,'atlas');
        assert(node.sequence, 'Missing frames');
        for (const frame of node.sequence) {
          const [x,y,w,h]=frame.rect;
          assert(w>0 && h>0 && x+w<=asset.width && y+h<=asset.height,'Frame outside atlas');
        }
      } else assert(!node.sequence,'Sequence on non-atlas node');
    }
    const targets = new Set(), trackIds = new Set();
    for (const track of scene.tracks) {
      assert(!trackIds.has(track.id),'Duplicate track ID'); trackIds.add(track.id);
      const node = nodes.get(track.node);
      assert(node, 'Missing track node');
      const target = `${track.node}:${track.property}`;
      assert(!targets.has(target),'Multiple property writers');targets.add(target);
      let previous = -Infinity;
      for (const [position,value] of track.keys) {
        assert(position>previous && position>=-1 && position<=1,'Invalid input key domain/order');
        assert(Number.isFinite(value),'Nonfinite output'); previous=position;
      }
      if (track.property.startsWith('material.')) {
        assert(node.material && Object.hasOwn(node.material.parameters,track.property.split('.').at(-1)), 'Missing material target');
      }
      if (track.property==='sequence.progress') {
        assert.equal(node.type,'atlas-sequence');
        assert(track.keys.every(([,v])=>v>=0&&v<=1),'Invalid sequence progress');
      }
    }
  }
}

check(initial);
const invalidCases = [
  ['unknown version',x=>x.manifest.contractVersion='9.0.0'],
  ['traversal path',x=>x.manifest.assets[0].path='../outside.webp'],
  ['duplicate asset',x=>x.manifest.assets.push({...x.manifest.assets[0]})],
  ['missing poster',x=>x.manifest.faces.front.poster='missing'],
  ['missing node asset',x=>x.scenes['scenes/front.json'].nodes[0].asset='missing'],
  ['undeclared recipe',x=>x.manifest.capabilities.optional=x.manifest.capabilities.optional.filter(c=>c.id!=='dc.material.water@0.1')],
  ['missing track target',x=>x.scenes['scenes/front.json'].tracks[0].node='missing'],
  ['duplicate writer',x=>x.scenes['scenes/front.json'].tracks.push({...x.scenes['scenes/front.json'].tracks[0],id:'duplicate'})],
  ['unordered keys',x=>x.scenes['scenes/front.json'].tracks[0].keys.reverse()],
  ['atlas overflow',x=>x.scenes['scenes/front.json'].nodes.find(n=>n.type==='atlas-sequence').sequence[0].rect=[0,0,9999,160]],
  ['missing video poster',x=>x.scenes['scenes/back.json'].nodes[0].video.poster='missing'],
  ['executable field',x=>x.scenes['scenes/front.json'].nodes[0].script='alert(1)']
];
for (const [name,mutate] of invalidCases) {
  const example=structuredClone(initial); mutate(example);
  assert.throws(()=>check(example),undefined,`${name} must reject`);
}
console.log(`PASS: manifest and 2 scenes; schema/reference/track checks; ${invalidCases.length} invalid cases rejected.`);
console.log('No media supplied: hashes, archive safety, rendering and device performance are not verified.');
