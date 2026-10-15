import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {build} from '../src/presentation/node_modules/esbuild/lib/main.js';
import {serveReference} from '../src/static.js';

const output=resolve(process.argv[2]??'test-results/portable-lottie'),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'portable-lottie-')),checks=[],errors=[];
let browser;
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/presentation/adapters.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',external:['node:*'],write:false});
const special=new Map([['/runtime/adapters.js',bundle.outputFiles[0].contents],['/runtime/dotlottie-player.wasm',await readFile(new URL('../src/presentation/node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm',import.meta.url))]]);
const server=createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/'){response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="en"><title>Portable live vector effects</title><style>body{margin:20px}#root{display:flex;position:relative;width:620px;height:450px;gap:20px}.target{width:300px;height:450px;flex:none}</style><main id="root"><div class="target" id="first"></div><div class="target" id="second"></div></main></html>');return;}
    if(special.has(pathname)){response.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream');response.end(special.get(pathname));return;}
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch{response.writeHead(500);response.end();}
});
try{
  for(const mode of ['angle','clock']){
    const destination=resolve(temp,mode+'.dcard');
    assert.equal(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-lottie-card.py',import.meta.url)),...(mode==='clock'?['--clock']:[]),destination],{windowsHide:true,timeout:10000,maxBuffer:16384}).length,0);
    special.set('/'+mode+'.dcard',await readFile(destination));
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1',...(engine==='firefox'&&process.env.DC_CI_SOFTWARE_WEBGL==='1'?{firefoxUserPrefs:{'webgl.disabled':false,'webgl.force-enabled':true}}:{})});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1000,height:750},reducedMotion:'no-preference'});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(async()=>{
    const [{createPlayerStage,importPackage,browserResolver},{dotLottieAdapter}]=await Promise.all([import('/src/presentation/index.js'),import('/runtime/adapters.js')]);
    const packages={};for(const mode of ['angle','clock'])packages[mode]=await importPackage(new Uint8Array(await(await fetch('/'+mode+'.dcard')).arrayBuffer()));
    const test=window.liveEffect={packages,createPlayerStage,browserResolver,dotLottieAdapter,records:[],events:[],views:[],resolvers:[],assetOwners:new WeakMap()};
    test.adapter=()=>{
      const real=dotLottieAdapter({wasmURL:'/runtime/dotlottie-player.wasm'});
      return {...real,async create(context,data){
        let owner;const instance=await real.create({...context,async asset(id){const resource=await context.asset(id),identity=test.assetOwners.get(resource);if(!identity||owner&&owner!==identity)throw Error('Adapter assets must belong to one mounted view');owner=identity;return resource;}},data).catch(error=>{test.releaseFirst?.();throw error;});if(test.reverseCreation&&owner==='first')await test.secondCreated;const record={instance,owner,clock:!!data.clock,updates:0,disposed:0,last:null};test.records.push(record);if(test.reverseCreation&&owner==='second')test.releaseFirst();
        return {...instance,update(input){record.updates++;record.last={angle:input.inputs.angle,time:input.activeTimeSeconds,staticMotion:input.staticMotion};return instance.update(input);},dispose(){record.disposed++;instance.dispose();}};
      }};
    };
    test.mount=async(mode='angle',options={})=>{
      test.reverseCreation=!!options.reverseCreation;test.secondCreated=new Promise(resolve=>{test.releaseFirst=resolve;});
      const stage=test.stage=createPlayerStage({root:document.querySelector('#root'),adapters:options.adapters??[test.adapter()],...(options.motion?{motion:options.motion}:{})});
      test.views=[];test.resolvers=[];
      for(const target of [document.querySelector('#first'),...(options.two?[document.querySelector('#second')]:[])]){
        const resolver=browserResolver(packages[mode]),asset=resolver.asset.bind(resolver);resolver.asset=async id=>{const resource={...await asset(id)};test.assetOwners.set(resource,target.id);return resource;};const view=stage.mount(target,{resolver},{inputMode:'drag',onEvent:event=>test.events.push(event)});test.resolvers.push(resolver);test.views.push(view);
      }
      return Promise.all(test.views.map(view=>view.ready));
    };
    test.recordFor=owner=>test.records.findLast(record=>record.owner===owner&&!record.disposed);
    test.dispose=()=>{test.releaseFirst?.();test.stage?.dispose();for(const resolver of test.resolvers)resolver.dispose();};
    test.pixels=async(view)=>{
      const blob=await view.snapshot(),image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');let painted=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i]>20)painted++;const center=(Math.floor(canvas.height/2)*canvas.width+Math.floor(canvas.width/2))*4,background=[...bytes.subarray(center,center+4)];canvas.width=canvas.height=0;return {hash,painted,background};
    };
    test.effectHash=async record=>{const canvas=record.instance.canvas,bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');};
    test.pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  });
  assert((await page.evaluate(()=>window.liveEffect.mount('angle',{two:true,reverseCreation:true}))).every(result=>result.mode==='interactive'));
  await page.waitForFunction(()=>window.liveEffect.records.filter(record=>!record.disposed).every(record=>record.updates>0));
  assert.deepEqual(await page.evaluate(()=>liveEffect.records.map(record=>record.owner)),['second','first'],'Two real adapters complete in reversed view order');
  async function sampleAngle(x){
    await page.evaluate(x=>{const [first,second]=window.liveEffect.views;first.setInputs({tilt:{x,y:0}});second.setInputs({tilt:{x:0,y:0}});},x);
    // Loaded views and an earlier neutral update do not establish delivery of this input.
    await page.waitForFunction(angle=>{const test=window.liveEffect;return test.recordFor('first')?.last?.angle===angle&&test.recordFor('second')?.last?.angle===0.5;},(x+1)/2);
    return page.evaluate(async()=>{const test=window.liveEffect;return {pixels:await test.pixels(test.views[0]),effect:await test.effectHash(test.recordFor('first')),other:await test.pixels(test.views[1]),delivered:['first','second'].map(owner=>test.recordFor(owner).last.angle)};});
  }
  const beforeAngle=await sampleAngle(-1),afterAngle=await sampleAngle(1);
  assert.deepEqual(beforeAngle.delivered,[0,0.5]);assert.deepEqual(afterAngle.delivered,[1,0.5]);
  const angle=await page.evaluate(({before,after})=>{
    const test=window.liveEffect;
    const surface=test.recordFor('first').instance.canvas,pixels=surface.getContext('2d').getImageData(0,0,surface.width,surface.height).data;let transparent=0,painted=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent++;if(pixels[i]>20)painted++;}
    return {before:before.pixels,after:after.pixels,effectBefore:before.effect,effectAfter:after.effect,other:before.other,unchanged:after.other,transparent,painted,diagnostics:test.stage.diagnostics()};
  },{before:beforeAngle,after:afterAngle});
  assert(angle.before.painted>1000);assert(angle.transparent>1000&&angle.painted>20,'Real vector surface contains both transparent and painted pixels');assert.equal(angle.after.background[3],255,'Native background remains visible through the transparent effect');assert.notEqual(angle.effectBefore,angle.effectAfter,'Tilt-derived angle changes the actual vector surface');assert.notEqual(angle.before.hash,angle.after.hash,'Live angle changes actual composited output');assert.equal(angle.other.hash,angle.unchanged.hash,'Second instance retains independent input');assert.equal(angle.diagnostics.views,2);
  // Keyboard input uses the stage's existing accessible drag mode.
  await page.locator('#first [role="img"]').press('ArrowLeft');await page.waitForFunction(()=>window.liveEffect.recordFor('first').last.angle<1);
  await page.waitForFunction(()=>window.liveEffect.stage.diagnostics().scheduledFrames===0);
  const idle=await page.evaluate(async()=>{const test=window.liveEffect,frames=test.stage.diagnostics().frames;await test.pause(160);return test.stage.diagnostics().frames===frames;});assert(idle,'Angle effect sleeps at rest');
  await page.screenshot({path:resolve(output,'angle-effects.png')});
  const remount=await page.evaluate(async()=>{
    const test=window.liveEffect,old=test.recordFor('first');await test.views[0].setQuality('poster');const disabled=old.disposed;const restored=await test.views[0].setQuality('standard');test.dispose();return {disabled,restored,records:test.records.map(record=>({disposed:record.disposed,width:record.instance.canvas.width,height:record.instance.canvas.height})),diagnostics:test.stage.diagnostics()};
  });
  assert.equal(remount.disabled,1);assert.equal(remount.restored.mode,'interactive');assert(remount.records.every(record=>record.disposed===1&&record.width===0&&record.height===0));assert.equal(remount.diagnostics.views,0);assert.equal(remount.diagnostics.assetReferences,0);
  checks.push('Independent Python-authored vector effect renders through real dotLottie/WASM and native WebGL compositing; tilt and keyboard change pixels, two instances stay independent, idle scheduling, poster disable/remount and disposal retain bounds');

  assert.equal((await page.evaluate(()=>window.liveEffect.mount('clock')))[0].mode,'interactive');
  await page.waitForFunction(()=>window.liveEffect.records.at(-1).updates>1);
  const clock=await page.evaluate(async()=>{const test=window.liveEffect,before=await test.pixels(test.views[0]);await test.pause(230);const after=await test.pixels(test.views[0]);return {before,after,record:test.records.at(-1).last};});assert.notEqual(clock.before.hash,clock.after.hash,'Clock mode changes actual rendered pixels');assert.equal(clock.record.staticMotion,false);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.liveEffect.records.at(-1).last?.staticMotion&&window.liveEffect.stage.diagnostics().scheduledFrames===0);
  const reduced=await page.evaluate(async()=>{const test=window.liveEffect,before=await test.pixels(test.views[0]);await test.pause(160);const after=await test.pixels(test.views[0]),record=test.records.at(-1).last;test.dispose();return {before,after,record};});assert.equal(reduced.before.hash,reduced.after.hash);assert.equal(reduced.record.angle,0.5);
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal((await page.evaluate(()=>window.liveEffect.mount('clock',{motion:'static'})))[0].mode,'interactive');
  const staticResult=await page.evaluate(async()=>{const test=window.liveEffect;test.views[0].setInputs({tilt:{x:1,y:1}});const before=await test.pixels(test.views[0]);await test.pause(160);const after=await test.pixels(test.views[0]),last=test.records.at(-1).last;test.dispose();return {before,after,last};});assert.equal(staticResult.before.hash,staticResult.after.hash);assert.equal(staticResult.last.staticMotion,true);
  checks.push('Explicit clock mode advances real vector pixels; reduced-motion and host static policy fix the middle frame and stop continuous work without running authored code');

  const fallback=await page.evaluate(async()=>{
    const test=window.liveEffect,missing=await test.mount('angle',{adapters:[]}),visible=!!document.querySelector('#first img:not([hidden])');test.dispose();
    // A fresh module instance cannot reuse an already initialized WASM runtime.
    const {dotLottieAdapter}=await import('/runtime/adapters.js?unavailable'),bad=dotLottieAdapter({wasmURL:'/runtime/missing.wasm'}),failed=await test.mount('angle',{adapters:[bad]}),failureVisible=!!document.querySelector('#first img:not([hidden])');test.dispose();return {missing,visible,failed,failureVisible};
  });
  assert.equal(fallback.missing[0].mode,'poster');assert(fallback.visible);assert.equal(fallback.failed[0].mode,'poster');assert(fallback.failureVisible);
  const late=await page.evaluate(async()=>{
    const test=window.liveEffect,real=test.adapter();let release,arrived;const gate=new Promise(resolve=>{release=resolve;}),created=new Promise(resolve=>{arrived=resolve;});
    const adapter={...real,async create(context,data){const instance=await real.create(context,data);arrived();await gate;return instance;}};
    const pending=test.mount('angle',{adapters:[adapter]});await created;const record=test.records.at(-1);test.dispose();release();const ready=await pending;return {ready,disposed:record.disposed,width:record.instance.canvas.width,diagnostics:test.stage.diagnostics()};
  });
  assert.equal(late.ready[0].mode,'cancelled');assert.equal(late.disposed,1);assert.equal(late.width,0);assert.equal(late.diagnostics.views,0);assert.equal(late.diagnostics.textureBytes,0);
  checks.push('Absent adapter and failed self-hosted WASM retain declared posters; a real asynchronously created runtime arriving after stage disposal is destroyed without mounting or retaining resources');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,checks,errors},null,2));console.log(JSON.stringify({engine,checks,errors}));
}finally{await browser?.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
