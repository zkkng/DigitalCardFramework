import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import * as pw from 'playwright';
import {serveReference} from '../src/static.js';
import {build,fixture} from './presentation-fixtures.mjs';
import {validateEditorContribution} from '../src/presentation/editor-contributions.js';

const output=resolve(process.argv[2]??'test-results/editor-contributions'),engine=process.env.BROWSER_ENGINE??'chromium',language=process.env.DC_EDITOR_LANGUAGE??'python';
assert(['python','go'].includes(language),'Unsupported editor-panel generator');
const source=fileURLToPath(new URL(language==='python'?'../examples/plugins/python-editor-panel.py':'../examples/plugins/go-editor-panel/main.go',import.meta.url));
const manifest=validateEditorContribution(JSON.parse(execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source]:['run',source],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16384,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'}}))),pkg=await build(fixture()),errors=[];
await mkdir(output,{recursive:true});
const server=createServer(async(request,response)=>{
 try{if(request.url==='/editor-harness'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html lang="en"><title>Editor contributions</title><link rel="stylesheet" href="/src/presentation/studio.css"><style>body{font:16px system-ui}main{width:900px;min-height:900px;margin-bottom:32px}button,input,select{font:inherit;min-height:32px}</style><main id="first"></main><main id="second"></main><main id="invalid"></main></html>');return;}if(await serveReference(request,response))return;response.writeHead(404);response.end();}catch{response.writeHead(500);response.end();}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:process.env.HEADED!=='1',channel:'msedge'});}
 const page=await browser.newPage({viewport:{width:1200,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
 await page.goto('http://127.0.0.1:'+server.address().port+'/editor-harness');
 await page.evaluate(async({archive,manifest})=>{
  const {mountStudio}=await import('/src/presentation/studio.js'),{importPackage}=await import('/src/presentation/package.js'),pkg=await importPackage(new Uint8Array(archive));
  window.editorStudios=[mountStudio(document.querySelector('#first'),{initialPackage:pkg,editorContributions:[manifest],editorContributionGrants:{x:{minimum:-100,maximum:100},rotation:{minimum:-90,maximum:90}}}),mountStudio(document.querySelector('#second'),{initialPackage:pkg,editorContributions:[manifest]}),mountStudio(document.querySelector('#invalid'),{initialPackage:pkg,editorContributions:[{...manifest,script:'synthetic-rejected'}]})];await Promise.all(window.editorStudios.map(studio=>studio.ready));
 },{archive:Array.from(pkg.archive),manifest});
 const first=page.locator('#first'),second=page.locator('#second'),controls=first.locator('[data-editor-contribution="example.print-layout"]');
 await controls.getByLabel('Horizontal position',{exact:true}).waitFor();assert.equal(await controls.locator('input').count(),2);assert.equal(await second.locator('[data-editor-contribution] input').count(),3);
 assert(await page.locator('#invalid').getByText('An editor contribution was rejected. The ordinary editor remains available.').isVisible());assert.equal(await page.locator('#invalid [data-editor-contribution]').count(),0);assert(await page.locator('#invalid').getByRole('button',{name:'Download editable project',exact:true}).isVisible());
 const idle=()=>page.waitForFunction(()=>document.querySelector('#first').getAttribute('aria-busy')!=='true');
 await controls.getByLabel('Horizontal position',{exact:true}).fill('75');await controls.getByLabel('Horizontal position',{exact:true}).press('Tab');await idle();
 await page.waitForFunction(()=>window.editorStudios[0].getProject().scenes.get('scenes/front.json').nodes[0].x===75);assert.equal(await page.evaluate(()=>window.editorStudios[1].getProject().scenes.get('scenes/front.json').nodes[0].x),0);assert(await first.locator('.dcs-slot canvas,.dcs-slot img').count()>0);
 await first.getByRole('button',{name:'Undo',exact:true}).click();await idle();assert.equal(await page.evaluate(()=>window.editorStudios[0].getProject().scenes.get('scenes/front.json').nodes[0].x),0);await first.getByRole('button',{name:'Redo',exact:true}).click();await idle();assert.equal(await page.evaluate(()=>window.editorStudios[0].getProject().scenes.get('scenes/front.json').nodes[0].x),75);
 const downloadPromise=page.waitForEvent('download');await first.getByRole('button',{name:'Download editable project',exact:true}).click();const downloaded=await downloadPromise,bytes=await readFile(await downloaded.path());
 await page.evaluate(()=>{window.editorProjectBeforeOpen=window.editorStudios[0].getProject();window.editorInputBeforeOpen=document.querySelector('#first [data-editor-contribution] input');});
 const chooserPromise=page.waitForEvent('filechooser');await first.getByRole('button',{name:'Open card',exact:true}).click();await(await chooserPromise).setFiles({name:'synthetic.dcproject',mimeType:'application/octet-stream',buffer:bytes});
 await page.waitForFunction(()=>{const project=window.editorStudios[0].getProject(),input=document.querySelector('#first [data-editor-contribution] input');return project!==window.editorProjectBeforeOpen&&input&&input!==window.editorInputBeforeOpen&&project.scenes.get('scenes/front.json').nodes[0].x===75;});await idle();
 await page.evaluate(async()=>{const studio=window.editorStudios[0],project=studio.getProject();project.edit(()=>project.scenes.get('scenes/front.json').nodes[0].locked=true);await studio.open(await project.export({retainSources:true}));});assert(await controls.getByLabel('Horizontal position',{exact:true}).isDisabled());
 await page.evaluate(()=>{const input=document.querySelector('#first [data-editor-contribution] input');input.value='20';input.dispatchEvent(new Event('change'));});await idle();assert.equal(await page.evaluate(()=>window.editorStudios[0].getProject().scenes.get('scenes/front.json').nodes[0].x),75);
 await page.evaluate(async()=>{const studio=window.editorStudios[0],project=studio.getProject();project.edit(()=>project.scenes.get('scenes/front.json').nodes[0].locked=false);await studio.open(await project.export({retainSources:true}));const input=document.querySelector('#first [data-editor-contribution] input');input.value='20';input.dispatchEvent(new Event('change'));studio.setEditorContributionEnabled('example.print-layout',false);});await idle();assert.equal(await controls.count(),0);assert.equal(await page.evaluate(()=>window.editorStudios[0].getProject().scenes.get('scenes/front.json').nodes[0].x),75);
 await page.evaluate(()=>window.editorStudios[0].setEditorContributionEnabled('example.print-layout',true));await controls.getByLabel('Horizontal position',{exact:true}).waitFor();
 await page.evaluate(()=>{window.editorStudios[0].dispose();});assert.equal(await first.locator('*').count(),0);assert.equal(await second.locator('[data-editor-contribution] input').count(),3);
 await second.locator('[data-editor-contribution]').getByLabel('Vertical position',{exact:true}).fill('30');await second.locator('[data-editor-contribution]').getByLabel('Vertical position',{exact:true}).press('Tab');await page.waitForFunction(()=>window.editorStudios[1].getProject().scenes.get('scenes/front.json').nodes[0].y===30);
 await page.evaluate(()=>{for(const studio of window.editorStudios)studio.dispose();});assert.equal(await page.locator('main input').count(),0);assert.deepEqual(errors,[]);
 await writeFile(join(output,'results.json'),JSON.stringify({engine,language,checks:['Generated manifest standard host installation','scoped controls and live preview','two independent studios','undo redo visible save and reopen','locked layer and disable fences','invalid contribution ordinary editor fallback','terminal disposal'],pageErrors:errors},null,2));console.log('Editor contribution browser workflow passed ('+engine+', '+language+')');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
