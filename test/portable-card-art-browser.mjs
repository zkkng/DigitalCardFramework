import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {authorizePresentation} from '../src/access.js';
import {createPresentationStore} from '../src/presentation/service.js';
import {createPresentationHandler} from '../src/presentation/node-http.js';
import {importPackage} from '../src/presentation/package.js';
import {validateApplicationShell} from '../src/application-shell.js';
import {validateEditorContribution} from '../src/presentation/editor-contributions.js';

// Real authoring, archive publication and catalog admission; the trusted identity
// resolver supplies the artist's explicit grants, then the collector's account.
async function keyTo(page,target,direction='Tab'){
 const visited=[];
 try{
  await target.waitFor({state:'visible'});
  const deadline=Date.now()+15000;
  const inspect=node=>({focused:node===document.activeElement,active:document.activeElement?.getAttribute('aria-label')??(document.activeElement?.tagName==='BUTTON'?document.activeElement.textContent?.slice(0,60):document.activeElement?.tagName)});
  let state=await target.evaluate(inspect);
  while(!state.focused){
    assert(Date.now()<deadline,'Keyboard traversal must reach the intended control');
    await page.keyboard.press(direction);state=await target.evaluate(inspect);visited.push(state.active);if(visited.length>12)visited.shift();
  }
  assert(await target.evaluate(node=>{const r=node.getBoundingClientRect();return node.matches(':focus-visible')&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}),'Keyboard target must have visible focus in the viewport');
 }catch(error){
  console.error('Artist keyboard failure',JSON.stringify({direction,visited,state:await target.evaluate(node=>({target:{tag:node.tagName,label:node.getAttribute('aria-label'),text:node.tagName==='BUTTON'?node.textContent:undefined,disabled:node.disabled,connected:node.isConnected,focused:node===document.activeElement,focusVisible:node.matches(':focus-visible'),rect:node.getBoundingClientRect().toJSON()},active:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')},documentFocus:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY}})).catch(()=>null)}));
  await page.screenshot({path:resolve(output,'artist-keyboard-failure.png'),fullPage:true}).catch(()=>{});throw error;
 }
}
async function keyActivate(page,target,key='Enter',direction='Tab'){await keyTo(page,target,direction);await page.keyboard.press(key);}
async function keyText(page,target,value,direction='Tab'){await keyTo(page,target,direction);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(value);}

const output=resolve(process.argv[2]??'test-results/portable-card-art'),engine=process.env.BROWSER_ENGINE??'chromium',language=process.env.DC_ART_LANGUAGE??'python';
assert(['python','go'].includes(language),'Unsupported card-art generator');
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'portable-card-art-')),x=fixture();
const artist={...x.alice,role:'artist',permissions:['catalog.read','catalog.preview','catalog.publish','card-policies.read','art.import','art.publish']};
let actor=artist,api,presentationHTTP,browser;
const checks=[],errors=[],requests=[];
let authoredShell,editorContribution;
const oldCopy=x.open()[0],oldInventory=structuredClone(x.core.inventory(x.alice));
const before=structuredClone(x.core.operatorCatalog(admin));
const server=createServer(async(request,response)=>{
  try{
    requests.push({method:request.method,path:new URL(request.url,'http://localhost').pathname});
    if(await api?.(request,response)||await presentationHTTP?.(request,response))return;
    if(request.url==='/artist-shell.json'){response.setHeader('content-type','application/json');response.end(JSON.stringify(authoredShell));return;}
    if(request.url==='/artist-harness'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      response.end('<!doctype html><html lang="en"><title>Portable card artist</title><style>body{font:16px system-ui;margin:24px}button,input{font:inherit}main{min-height:600px}</style><main id="root"></main></html>');return;
    }
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
try{
  const generate=(python,go,args=[])=>execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[fileURLToPath(new URL(python,import.meta.url)),...args]:['run',fileURLToPath(new URL(go,import.meta.url)),...args],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'}});
  authoredShell=validateApplicationShell(JSON.parse(generate('../examples/application-shell/generate.py','../examples/application-shell/generate.go',[language==='python'?'rail':'header'])));
  editorContribution=validateEditorContribution(JSON.parse(generate('../examples/plugins/python-editor-panel.py','../examples/plugins/go-editor-panel/main.go')));
  const packagePath=process.env.CARD_ART_PACKAGE?resolve(process.env.CARD_ART_PACKAGE):resolve(temp,'generated.dcard');
  if(!process.env.CARD_ART_PACKAGE){
    const source=fileURLToPath(new URL(language==='python'?'../examples/plugins/python-card-art.py':'../examples/plugins/go-card-art/main.go',import.meta.url));
    const stdout=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source,packagePath]:['run',source,packagePath],{windowsHide:true,timeout:60000,maxBuffer:16384,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'}});
    assert.equal(stdout.length,0,'Generator success must be silent');
  }
  const generated=await importPackage(new Uint8Array(await readFile(packagePath)));
  const front=generated.scenes.get(generated.manifest.faces.front.scene),emblem=front.nodes.find(node=>node.id==='front-emblem');
  assert.equal(emblem.x,0);assert.equal(emblem.material.kind,'foil');assert(emblem.bindings.rotation);assert(emblem.bindings['material.angle']);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
  const store=await createPresentationStore({root:resolve(temp,'store'),authorize:authorizePresentation,validatePublication:(principal,{archive})=>x.core.registerCardPresentation(principal,archive)});
  presentationHTTP=createPresentationHandler({store,resolveIdentity:()=>actor,allowedOrigin:origin});
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/artist-harness');
  await page.evaluate(async({archive,editorContribution})=>{
    const [{createClient},{renderStudio},{mountFramework},{loadApplicationShell},{mountStudio},{importPackage}]=await Promise.all([import('/src/client.js'),import('/src/studio-ui.js'),import('/src/ui.js'),import('/src/application-shell.js'),import('/src/presentation/studio.js'),import('/src/presentation/package.js')]);
    const client=createClient(),pkg=await importPackage(new Uint8Array(archive));window.artistPanelMode=true;
    window.artistView=mountFramework(document.querySelector('#root'),{client,sections:['studio'],shell:loadApplicationShell('/artist-shell.json'),views:{studio:(model,context)=>{
      if(!window.artistPanelMode)return renderStudio(model,context);
      const node=document.createElement('section'),studio=mountStudio(node,{initialPackage:pkg,editorContributions:[editorContribution],editorContributionGrants:{x:{minimum:-100,maximum:100}}});
      window.artistPanel=studio;return {node,dispose(){studio.dispose();}};
    }}});await window.artistView.ready;await window.artistView.shellReady;await window.artistPanel.ready;
  },{archive:Array.from(await readFile(packagePath)),editorContribution});
  await page.evaluate(()=>{
    const events=[],identities=new WeakMap();let nextIdentity=0;
    const identity=node=>{if(!node)return null;if(!identities.has(node))identities.set(node,++nextIdentity);return identities.get(node);};
    const record=(type,target)=>{
      const input=target?.matches?.('[data-editor-contribution] input')?target:document.querySelector('[data-editor-contribution] input');
      events.push({at:performance.now(),type,input:input?{identity:identity(input),label:input.getAttribute('aria-label'),value:input.value,valid:input.validity.valid,connected:input.isConnected,focused:document.activeElement===input}:null,selected:[...document.querySelectorAll('button.is-selected')].map(button=>button.textContent),busy:document.querySelector('.dcard-studio')?.getAttribute('aria-busy'),nodes:window.artistPanel.getProject().scenes.get('scenes/front.json').nodes.map(node=>({id:node.id,x:node.x,y:node.y,locked:node.locked}))});
      if(events.length>64)events.shift();
    };
    const controller=new AbortController();for(const type of ['input','change','blur','focus','keydown'])document.addEventListener(type,event=>{if(event.target?.matches?.('[data-editor-contribution] input'))record(type,event.target);},{capture:true,signal:controller.signal});
    const observer=new MutationObserver(()=>record('action-queue-busy',null));observer.observe(document.querySelector('.dcard-studio'),{attributes:true,attributeFilter:['aria-busy']});
    window.artistPanelTrace={events,stop(){controller.abort();observer.disconnect();},snapshot(){record('failure-snapshot',null);return {events,inputs:[...document.querySelectorAll('[data-editor-contribution] input')].map(input=>({identity:identity(input),label:input.getAttribute('aria-label'),value:input.value,valueAsNumber:input.valueAsNumber,min:input.min,max:input.max,step:input.step,valid:input.validity.valid,disabled:input.disabled,focused:document.activeElement===input})),status:[...document.querySelectorAll('[role="status"],.dcs-status')].map(node=>node.textContent)};}};
    record('before-selection',null);
  });
  const panel=page.locator('[data-editor-contribution="example.print-layout"]');
  try{
  await keyActivate(page,page.getByRole('button',{name:'Front emblem',exact:true}));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Front emblem'&&button.classList.contains('is-selected'))&&document.querySelector('.dcard-studio')?.getAttribute('aria-busy')!=='true');
  await panel.getByLabel('Horizontal position',{exact:true}).fill('17');
  await page.getByLabel('Card title',{exact:true}).click();
  await page.waitForFunction(()=>window.artistPanel.getProject().scenes.get('scenes/front.json').nodes.find(node=>node.id==='front-emblem').x===17);
  }catch(error){
    const diagnostic={engine,language,editorContribution,grants:{x:{minimum:-100,maximum:100}},trace:await page.evaluate(()=>window.artistPanelTrace.snapshot()).catch(()=>null)};
    await writeFile(resolve(output,'panel-edit-failure.json'),JSON.stringify(diagnostic,null,2)+'\n').catch(()=>{});console.error(JSON.stringify({panelEditFailure:diagnostic}));throw error;
  }finally{await page.evaluate(()=>window.artistPanelTrace.stop()).catch(()=>{});}
  const panelDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download editable project',exact:true}).click();const panelArchive=await panelDownload,panelPath=resolve(temp,'panel-edited.dcproject');await panelArchive.saveAs(panelPath);
  const panelSaved=await importPackage(new Uint8Array(await readFile(panelPath)));assert.equal(panelSaved.scenes.get('scenes/front.json').nodes.find(node=>node.id==='front-emblem').x,17);
  await page.evaluate(async()=>{window.artistPanelInput=document.querySelector('[data-editor-contribution] input');window.artistPanelMode=false;await window.artistView.refresh();});
  assert.equal(await panel.count(),0);assert(await page.evaluate(()=>!window.artistPanelInput.isConnected));
  checks.push('Authored shell hosts generated data-only panel; Download editable project and native file-chooser import hand off edited archive; view replacement disposes panel');
  const idle=()=>page.waitForFunction(()=>document.querySelector('.dcard-studio')?.getAttribute('aria-busy')!=='true');
  await page.getByRole('button',{name:'Open visual card editor',exact:true}).click();
  await page.getByRole('button',{name:'Open card',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Open visual card editor'&&!button.disabled));
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open card',exact:true}).click();await(await chooser).setFiles(panelPath);
  await page.getByRole('button',{name:'Front emblem',exact:true}).waitFor();await idle();
  assert.equal(await page.getByLabel('Card title',{exact:true}).inputValue(),generated.manifest.title);
  await page.getByRole('button',{name:'Front emblem',exact:true}).click();await idle();
  assert.equal(await page.getByLabel('x',{exact:true}).inputValue(),'17');
  await keyText(page,page.getByLabel('x',{exact:true}),'42');await page.getByLabel('x',{exact:true}).press('Tab');await idle();
  await keyText(page,page.getByLabel('Card title',{exact:true}),'Celestial Study · published','Shift+Tab');await page.getByLabel('Card title',{exact:true}).press('Tab');await idle();
  // The capture toolbar precedes the property fields in keyboard order.
  await keyActivate(page,page.getByRole('button',{name:'Capture preview images',exact:true}),'Enter','Shift+Tab');await idle();
  await page.getByText('Both face posters captured from the renderer.',{exact:true}).waitFor();
  assert.deepEqual(x.core.operatorCatalog(admin),before,'Editing/capture must not publish the catalog');
  checks.push('Generated portable archive opens through file chooser, retains foil/motion, and allows native layer editing and two-face capture');

  await keyActivate(page,page.getByRole('button',{name:'Publish',exact:true}));
  const reviewed=page.getByRole('button',{name:'Publish reviewed card',exact:true});await reviewed.waitFor();
  assert.deepEqual(x.core.operatorCatalog(admin),before,'Catalog admission requires the explicit reviewed publication');
  assert.equal(requests.filter(request=>request.path==='/api/operator/import/commit').length,0);
  const editedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Keep as draft',exact:true}).click();await idle();await page.getByRole('button',{name:'Download editable project',exact:true}).click();const edited=await editedDownload,editedPath=resolve(temp,'reviewed-edit.dcproject');await edited.saveAs(editedPath);
  await page.getByRole('button',{name:'Publish',exact:true}).click();await reviewed.waitFor();
  await page.evaluate(async()=>{window.staleReview=[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Publish reviewed card');await window.artistView.refresh();window.staleReview.click();});
  assert.equal(await reviewed.count(),0);assert.equal(requests.filter(request=>request.path==='/api/operator/import/commit').length,0);assert.deepEqual(x.core.operatorCatalog(admin),before);
  await page.getByRole('button',{name:'Open visual card editor',exact:true}).click();await page.getByRole('button',{name:'Open card',exact:true}).waitFor();
  const restoreChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open card',exact:true}).click();await(await restoreChooser).setFiles(editedPath);await page.getByRole('button',{name:'Front emblem',exact:true}).waitFor();await idle();
  await page.getByRole('button',{name:'Publish',exact:true}).click();await reviewed.waitFor();
  actor={...artist,permissions:artist.permissions.filter(permission=>permission!=='catalog.publish')};
  const deniedCommit=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operator/import/commit');await reviewed.click();assert.equal((await deniedCommit).status(),403);await idle();assert.deepEqual(x.core.operatorCatalog(admin),before);
  actor=artist;await page.keyboard.press('Shift+Tab');await keyActivate(page,page.getByRole('button',{name:'Publish',exact:true}));await reviewed.waitFor();
  const acceptedCommit=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operator/import/commit');
  await keyActivate(page,reviewed);assert.equal((await acceptedCommit).status(),200);
  await page.locator('#root .dc-status.is-success').waitFor();
  assert.equal(await reviewed.count(),0);assert.equal(await page.locator('.dcard-studio').count(),0);
  const published=x.core.operatorCatalog(admin),card=published.cards.find(card=>card.id==='dawn'),ref=card.presentation;
  assert.equal(card.name,'Celestial Study · published');assert.equal(published.version,before.version+1);assert(ref);
  assert.notEqual(ref.digest,generated.digest);assert.equal(ref.baseURL,origin+'/presentations/'+ref.digest+'/files/');
  assert.equal(requests.filter(request=>request.method==='POST'&&request.path==='/api/operator/import/commit').length,2);
  assert(requests.some(request=>request.method==='POST'&&/^\/presentations\/imports\/[^/]+\/publish$/.test(request.path)));
  const archiveResponse=await fetch(origin+'/presentations/'+ref.digest+'/download');assert.equal(archiveResponse.status,200);
  const saved=await importPackage(new Uint8Array(await archiveResponse.arrayBuffer()));assert.equal(saved.digest,ref.digest);
  const savedEmblem=saved.scenes.get(saved.manifest.faces.front.scene).nodes.find(node=>node.id==='front-emblem');
  assert.equal(savedEmblem.x,42);assert.deepEqual(savedEmblem.material,emblem.material);assert.deepEqual(savedEmblem.bindings,emblem.bindings);
  for(const side of ['front','back']){
    const originalPoster=generated.manifest.assets.find(asset=>asset.id===generated.manifest.faces[side].poster),capturedPoster=saved.manifest.assets.find(asset=>asset.id===saved.manifest.faces[side].poster);
    assert.notEqual(capturedPoster.sha256,originalPoster.sha256,'Published '+side+' poster must be the actual capture');
  }
  assert.deepEqual(x.core.inventory(x.alice).find(copy=>copy.id===oldCopy.id),oldInventory.find(copy=>copy.id===oldCopy.id));
  assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));checks.push('Keyboard layer/title editing, capture and review plus authorized review-to-publication complete under reduced motion; injected stale/revoked review legs remain separate');
  checks.push('Actual archive upload/publication and policy preview precede one explicit authorized catalog commit; published archive preserves edited layer and captured posters');
  checks.push('Disposed reviewed button cannot commit; revoked catalog.publish is rejected over HTTP; only the subsequent authorized review changes catalog');

  const newCopy=x.open()[0],inventory=x.core.inventory(x.alice),newView=inventory.find(copy=>copy.id===newCopy.id);
  assert.deepEqual(newView.definition.presentation,ref);assert.equal(newView.definition.name,card.name);
  assert.deepEqual(inventory.find(copy=>copy.id===oldCopy.id).definition,oldInventory.find(copy=>copy.id===oldCopy.id).definition);
  actor=x.alice;
  await page.evaluate(async()=>{
    window.artistView.dispose();document.querySelector('#root').replaceChildren();
    const [{createClient},{mountFramework}]=await Promise.all([import('/src/client.js'),import('/src/ui.js')]);
    window.collectorView=mountFramework(document.querySelector('#root'),{client:createClient(),sections:['collection']});await window.collectorView.ready;
  });
  const portable=page.locator('.dc-collection-grid dc-portable-card');await portable.waitFor();
  await page.waitForFunction(()=>{const image=document.querySelector('.dc-collection-grid dc-portable-card img');return image?.complete&&image.naturalWidth>0;});
  assert.equal(await portable.getAttribute('aria-label'),card.name+', common');
  await keyActivate(page,portable);
  const inspector=page.locator('.dc-inspector-dialog'),stage=inspector.locator('.dc-3d-stage'),canvas=inspector.locator('canvas');
  await page.waitForFunction(()=>{const canvas=document.querySelector('.dc-inspector-dialog canvas');return canvas?.width>1&&canvas.height>1;});
  const nextFrame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await nextFrame();const neutral=await canvas.screenshot({path:resolve(output,'collector-front.png')});
  await keyTo(page,stage);await page.keyboard.press('ArrowRight');assert.equal(await stage.getAttribute('data-yaw'),'15');await nextFrame();
  const tilted=await canvas.screenshot({path:resolve(output,'collector-tilted.png')});assert(!neutral.equals(tilted),'Native keyboard rotation must alter the interactive artwork');
  await keyActivate(page,inspector.getByRole('button',{name:'Flip',exact:true}));assert.equal(await stage.getAttribute('data-yaw'),'195');await nextFrame();
  const back=await canvas.screenshot({path:resolve(output,'collector-back.png')});assert(!tilted.equals(back),'Reverse face must visibly differ');
  assert(requests.some(request=>request.path.startsWith('/presentations/'+ref.digest+'/files/')));
  assert.equal(await inspector.getByText('Preview unavailable',{exact:true}).count(),0);
  await keyActivate(page,inspector.getByRole('button',{name:'Close inspection',exact:true}));await page.evaluate(()=>window.collectorView.dispose());
  assert.equal(await page.locator('#root').evaluate(root=>root.childNodes.length),0);
  checks.push('New issued copy retains the published digest; existing copy stays unchanged; default collector poster and keyboard-driven foil/rotation/reverse-face inspection use the real hosted archive');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,language,externalPackage:!!process.env.CARD_ART_PACKAGE,checks,errors},null,2));console.log(JSON.stringify({engine,language,checks,errors}));
}finally{
  await browser?.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));x.core.close();await rm(temp,{recursive:true,force:true});
}
