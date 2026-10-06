import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import * as pw from "playwright";
import { fixture, admin } from "./helpers.js";
import { fixture as artFixture, build, pngRGBA } from "./presentation-fixtures.mjs";
import { testFont } from "./font-fixture.mjs";
import { createApiHandler } from "../src/http.js";
import { serveReference } from "../src/static.js";
import { createPresentationStore } from "../src/presentation/service.js";
import { createPresentationHandler } from "../src/presentation/node-http.js";
import { authorizePresentation } from "../src/access.js";
const output = resolve(process.argv[2] ?? "test-results/card-authoring"),
  engine = process.env.BROWSER_ENGINE ?? "chromium";
await mkdir(output, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), "card-authoring-")),
  base = fileURLToPath(new URL("../", import.meta.url));
const { core, alice } = fixture(),
  actor = { ...admin, userId: alice.userId },
  pkg = await build(artFixture());
let api, presentationHTTP, browser;
const server = createServer(async (req, res) => {
  try {
    if ((await api?.(req, res)) || (await presentationHTTP?.(req, res))) return;
    if (req.url === "/fixture.dcard") {
      res.end(pkg.archive);
      return;
    }
    if (req.url === "/font.ttf") {
      res.end(testFont());
      return;
    }
    if (req.url === "/harness") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><html lang="en"><title>Card authoring</title><link rel="stylesheet" href="/src/presentation/studio.css"><style>body{margin:0;background:#101b2d;color:#edf1f7;font:16px system-ui}#root{min-height:800px}button,input,select,textarea{font:inherit}button{cursor:pointer}</style><div id="root"></div></html>',
      );
      return;
    }
    if (await serveReference(req, res)) return;
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
api = createApiHandler({
  framework: core,
  resolveIdentity: () => actor,
  allowedOrigin: origin,
  exposeOperators: true,
  requirePrincipal: true,
});
const store = await createPresentationStore({
  root: temp,
  authorize: authorizePresentation,
  validatePublication: (a, { archive }) =>
    core.registerCardPresentation(a, archive),
});
presentationHTTP = createPresentationHandler({
  store,
  resolveIdentity: () => actor,
  allowedOrigin: origin,
});
const checks = [],
  errors = [];
try {
  try {
    browser = await pw[engine].launch({ headless: process.env.HEADED !== "1" });
  } catch (error) {
    if (engine !== "chromium") throw error;
    browser = await pw.chromium.launch({ headless: true, channel: "msedge" });
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const idle = () => page.waitForFunction(() => document.querySelector(".dcard-studio")?.getAttribute("aria-busy") !== "true");
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/harness");
  const coverage = await page.evaluate(async () => {
    const {createWebGLRenderer} = await import("/src/presentation/webgl.js"), canvas=document.createElement("canvas"), gpu=createWebGLRenderer(canvas),
      source=document.createElement("canvas"), maskCanvas=document.createElement("canvas");
    source.width=4;source.height=2;source.getContext("2d").fillStyle="white";source.getContext("2d").fillRect(0,0,4,2);
    maskCanvas.width=4;maskCanvas.height=2;
    const ctx=maskCanvas.getContext("2d");ctx.fillStyle="rgba(255,255,255,0.5)";ctx.fillRect(2,0,2,2);
    const art={texture:gpu.texture(source),width:4,height:2}, mask={texture:gpu.texture(maskCanvas),width:4,height:2},
      draw=(clipping,material)=>{
        gpu.begin(100,100);gpu.draw({width:100,height:100,mask:clipping,material},art,[1,0,0,1,0,0],[0,0,100,100],clipping?.asset ? mask : undefined,undefined,material?.mask?.asset || material?.maskAsset ? mask : undefined);
        const p=new Uint8Array(4);gpu.gl.readPixels(50,50,1,1,gpu.gl.RGBA,gpu.gl.UNSIGNED_BYTE,p);return [...p];
      }, full=draw({asset:"mask"}),cropped=draw({asset:"mask",rect:[2,0,2,2]}),shifted=draw({asset:"mask",rect:[2,0,2,2],transform:{x:1}}),
      inverted=draw({asset:"mask",rect:[2,0,2,2],transform:{x:1},invert:true}),
      polygon=draw({polygon:[[0,0],[1,0],[1,1],[0,1]],transform:{x:1}}),
      effect=draw(undefined,{kind:"bloom",radius:0,mask:{polygon:[[0,0],[1,0],[1,1],[0,1]],transform:{x:1}}}),
      legacy=draw(undefined,{kind:"spot",radius:0.8,intensity:0.7,mode:"overlay",maskAsset:"mask"}),
      identity=draw(undefined,{kind:"spot",radius:0.8,intensity:0.7,mode:"overlay",mask:{asset:"mask"}});
    const pixel=(x,y)=>{const p=new Uint8Array(4);gpu.gl.readPixels(x,y,1,1,gpu.gl.RGBA,gpu.gl.UNSIGNED_BYTE,p);return [...p];},
      child=()=>gpu.draw({width:100,height:100},art,[1,0,0,1,0,0],[0,0,100,100]),
      composite=(surface,node={})=>gpu.draw({width:100,height:100,...node},surface,[1,0,0,1,0,0],[0,0,100,100]);
    gpu.begin(100,100);gpu.beginIsolation(100,100,100000);child();child();const surface=gpu.endIsolation();composite(surface,{opacity:0.5});const overlap=pixel(50,50);
    gpu.begin(100,100);gpu.beginIsolation(100,100,100000);gpu.beginIsolation(100,100,100000);child();child();const inner=gpu.endIsolation();composite(inner,{opacity:0.5});const outer=gpu.endIsolation();composite(outer,{opacity:0.5});const nested=pixel(50,50),pooled=gpu.diagnostics();
    gpu.begin(100,100);gpu.beginIsolation(100,100,100000);child();const masked=gpu.endIsolation();composite(masked,{mask:{polygon:[[0,0],[1,0],[1,1],[0,1]],transform:{x:0.5}}});const maskLeft=pixel(25,50),maskRight=pixel(75,50);
    const colors=document.createElement("canvas");colors.width=2;colors.height=2;const cc=colors.getContext("2d");cc.fillStyle="red";cc.fillRect(0,0,2,1);cc.fillStyle="blue";cc.fillRect(0,1,2,1);
    gpu.begin(100,100);gpu.beginIsolation(100,100,100000);gpu.draw({width:100,height:100},{texture:gpu.texture(colors),width:2,height:2},[1,0,0,1,0,0],[0,0,100,100]);const oriented=gpu.endIsolation();composite(oriented);const top=pixel(50,85),bottom=pixel(50,15);
    gpu.clearSurfaces();let budgetRejected=false,depthRejected=false;try{gpu.beginIsolation(100,100,39999);}catch(e){budgetRejected=e.code==="BUDGET";}
    for(let i=0;i<16;i++)gpu.beginIsolation(1,1,64);try{gpu.beginIsolation(1,1,64);}catch(e){depthRejected=e.code==="LIMIT";}finally{for(let i=0;i<16;i++)gpu.endIsolation();}
    gpu.begin(101,100);const resized=gpu.diagnostics();gpu.clearSurfaces();const cleared=gpu.diagnostics();
    gpu.dispose();return {full,cropped,shifted,inverted,polygon,effect,legacy,identity,overlap,nested,pooled,maskLeft,maskRight,top,bottom,budgetRejected,depthRejected,resized,cleared};
  });
  assert(coverage.cropped[3]>=126 && coverage.cropped[3]<=129);
  assert(coverage.full[3]<coverage.cropped[3]);
  assert.equal(coverage.shifted[3],0);assert.equal(coverage.polygon[3],0);
  assert.equal(coverage.inverted[3],255);assert.equal(coverage.effect[3],255);
  assert.deepEqual(coverage.legacy,coverage.identity);
  assert(coverage.legacy[3]>0 && coverage.legacy[3]<126);
  assert(coverage.overlap.every(value=>Math.abs(value-128)<=1));assert(coverage.nested.every(value=>Math.abs(value-64)<=1));
  assert.equal(coverage.pooled.surfaceBytes,80000);assert.equal(coverage.pooled.groupSurfaces,2);
  assert.equal(coverage.maskLeft[3],0);assert.equal(coverage.maskRight[3],255);
  assert(coverage.top[0]>240&&coverage.top[2]<15&&coverage.bottom[2]>240&&coverage.bottom[0]<15);
  assert(coverage.budgetRejected&&coverage.depthRejected);assert.equal(coverage.resized.surfaceBytes,0);assert.equal(coverage.cleared.groupSurfaces,0);
  checks.push("isolated nested overlap alpha, group mask transform, framebuffer orientation, pooled live bytes, depth/budget rejection and resize cleanup");
  checks.push("GPU atlas alpha crop, independent image/polygon transforms, inversion and structured effect coverage");
  const groupStage = await page.evaluate(async () => {
    const {importPackage,browserResolver}=await import("/src/presentation/package.js"),{createPlayerStage}=await import("/src/presentation/player.js"),
      pkg=await importPackage(new Uint8Array(await(await fetch("/fixture.dcard")).arrayBuffer()));
    pkg.manifest.canvas={width:100,height:100};pkg.manifest.capabilities.required.push("dc.group-isolation@0.2");
    const image={id:"a",type:"image",asset:"art",width:100,height:100},
      group={id:"outer",type:"group",isolate:true,width:100,height:100,opacity:0.5,children:[{id:"inner",type:"group",isolate:true,width:100,height:100,opacity:0.5,children:[image,{...image,id:"b"}]}]};
    pkg.scenes.get(pkg.manifest.faces.front.scene).nodes=[group];
    const root=document.createElement("div");Object.assign(root.style,{position:"absolute",top:"0",left:"0",width:"100px",height:"100px"});document.body.append(root);
    const resolver=browserResolver(pkg),events=[],stage=createPlayerStage({root}),view=stage.mount(root,{resolver},{onEvent:event=>events.push(event)});await view.ready;
    const sample=()=>new Promise(resolve=>requestAnimationFrame(()=>{const canvas=root.querySelector("canvas"),gl=canvas.getContext("webgl2"),pixel=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);resolve({pixel:[...pixel],...stage.diagnostics()});}));
    const rendered=await sample(),canvas=root.querySelector("canvas"),extension=canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
    if(!extension)throw new Error("Context loss test unavailable");
    const lost=new Promise(resolve=>canvas.addEventListener("webglcontextlost",resolve,{once:true}));extension.loseContext();await lost;
    const contextLost=stage.diagnostics();
    const restoredEvent=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Group graphics context did not restore")),3000);canvas.addEventListener("webglcontextrestored",()=>{clearTimeout(timeout);resolve();},{once:true});});
    await new Promise(resolve=>setTimeout(resolve,80));extension.restoreContext();await restoredEvent;
    for(let i=0;i<200&&stage.diagnostics().activeViews!==1;i++)await new Promise(resolve=>setTimeout(resolve,20));
    view.setInputs({angle:0.2});const restored=await sample();
    await stage.setBudget({estimatedGpuBytes:1024});await sample();const fallback={...stage.diagnostics(),posterVisible:!root.querySelector("img").hidden,events:events.filter(e=>e.type==="fallback").map(e=>e.reason)};
    view.dispose();const disposed=stage.diagnostics();stage.dispose();resolver.dispose();root.remove();return {rendered,contextLost,restored,fallback,disposed};
  });
  assert(Math.abs(groupStage.rendered.pixel[3]-64)<=1);
  assert.equal(groupStage.rendered.groupSurfaces,2);assert(groupStage.rendered.surfaceBytes>0);
  assert.equal(groupStage.contextLost.surfaceBytes,0);assert.equal(groupStage.contextLost.activeViews,0);
  assert.equal(groupStage.restored.activeViews,1);assert(Math.abs(groupStage.restored.pixel[3]-64)<=1);
  assert(groupStage.fallback.posterVisible&&groupStage.fallback.events.some(reason=>reason.includes("Group isolation")),JSON.stringify(groupStage.fallback));
  assert.equal(groupStage.fallback.surfaceBytes,0);assert.equal(groupStage.disposed.groupSurfaces,0);
  checks.push("player nested group compositing and total stage budget poster fallback release pooled surfaces");
  await page.evaluate(async () => {
    const { mountStudio } = await import("/src/presentation/studio.js"),
      { importPackage } = await import("/src/presentation/package.js"),
      { createMemoryLibrary } =
        await import("/src/presentation/authoring-tools.js");
    const pkg = await importPackage(
      new Uint8Array(await (await fetch("/fixture.dcard")).arrayBuffer()),
    );
    window.studio = mountStudio(document.querySelector("#root"), {
      initialPackage: pkg,
      library: createMemoryLibrary(),
    });
    await studio.ready;
  });
  await page.getByText("Arrange layers",{exact:true}).click();
  await page.getByRole("button",{name:"Group selected",exact:true}).click();await idle();
  await page.locator(".dcs-layers").getByRole("button",{name:"Group",exact:true}).click();await idle();
  await page.getByLabel("Isolate group",{exact:true}).selectOption("yes");await idle();
  assert(await page.evaluate(()=>window.studio.getProject().manifest.capabilities.required.includes("dc.group-isolation@0.2")));
  await page.getByLabel("width",{exact:true}).fill("0");await page.getByLabel("width",{exact:true}).press("Tab");await idle();
  assert(Number(await page.getByLabel("width",{exact:true}).inputValue())>0);
  await page.getByText("Clipping mask properties",{exact:true}).click();
  await page.getByLabel("Clipping mask source",{exact:true}).selectOption("polygon");await idle();
  await page.getByLabel("Isolate group",{exact:true}).selectOption("no");await idle();
  assert.equal(await page.getByLabel("Isolate group",{exact:true}).inputValue(),"yes");
  await page.getByText("Arrange layers",{exact:true}).click();
  await page.getByRole("button",{name:"Lock selected",exact:true}).click();await idle();
  assert(await page.getByLabel("Isolate group",{exact:true}).isDisabled());assert(await page.getByLabel("Clipping mask source",{exact:true}).isDisabled());
  await page.evaluate(async()=>{const {importPackage}=await import("/src/presentation/package.js");await window.studio.open(await importPackage(new Uint8Array(await(await fetch("/fixture.dcard")).arrayBuffer())));});
  checks.push("artist isolated group creation/bounds/capability, rejected downgrade recovery and locked mask controls");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await idle();
  await page
    .getByLabel("Text content", { exact: true })
    .fill("Collection title");
  await page.getByLabel("Text content", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() =>
    window.studio
      .getProject()
      .scenes.get("scenes/front.json")
      .nodes.some((n) => n.text === "Collection title"),
  );
  await page.getByText("Styled text spans", { exact: true }).click();
  await idle();
  await page.getByLabel("Span 1 text", { exact: true }).fill("<b>Hello</b>");
  await page.getByLabel("Span 1 text", { exact: true }).press("Tab");
  await idle();
  await page.getByRole("button", { name: "Add text span", exact: true }).click();
  await idle();
  await page.getByLabel("Span 2 text", { exact: true }).fill(" World");
  await page.getByLabel("Span 2 text", { exact: true }).press("Tab");
  await idle();
  const beforeInvalidSpan = await page.evaluate(() => window.studio.getProject().serialize());
  await page.getByLabel("Span 1 weight", { exact: true }).fill("2000");
  await page.getByLabel("Span 1 weight", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => document.querySelector(".dcs-status").textContent.includes("Invalid span weight"));
  assert.deepEqual(await page.evaluate(() => window.studio.getProject().serialize()), beforeInvalidSpan);
  await page.getByLabel("Span 1 weight", { exact: true }).fill("700");
  await page.getByLabel("Span 1 weight", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.runs)?.runs[0].weight === 700);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await idle();
  await page.waitForFunction(() => document.querySelector('[aria-label="Span 1 weight"]')?.value === "");
  assert.equal(await page.getByLabel("Span 1 weight", { exact: true }).inputValue(), "");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await idle();
  await page.waitForFunction(() => document.querySelector('[aria-label="Span 1 weight"]')?.value === "700");
  assert.equal(await page.getByLabel("Span 1 weight", { exact: true }).inputValue(), "700");
  assert.equal(await page.evaluate(async () => {
    const { importPackage } = await import("/src/presentation/package.js"),
      { createProject } = await import("/src/presentation/project.js"),
      restored = createProject(await importPackage((await window.studio.getProject().export({retainSources:true})).archive));
    return restored.scenes.get("scenes/front.json").nodes.find(n=>n.runs).runs[0].weight;
  }), 700);
  await page.getByLabel("Span 1 style", { exact: true }).selectOption("italic");
  await idle();
  await page.getByLabel("Span 1 color", { exact: true }).fill("#ff0000");
  await page.getByLabel("Span 1 color", { exact: true }).press("Tab");
  await idle();
  const inlineIcon = await page.evaluate(() => window.studio.getProject().manifest.assets.find(a=>a.mediaType.startsWith("image/")).id);
  await page.getByLabel("Span 1 icon", { exact: true }).selectOption(inlineIcon);
  await idle();
  await page.getByRole("button", { name: "Move span 1 later", exact: true }).click();
  await idle();
  await page.waitForFunction(() => document.querySelector('[aria-label="Span 1 text"]')?.value === " World");
  await page.getByRole("button", { name: "Reset span 2 formatting", exact: true }).click();
  await idle();
  await page.waitForFunction(() => {
    const span = window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.runs)?.runs[1];
    return span?.text === "<b>Hello</b>" && !Object.hasOwn(span,"weight") && !Object.hasOwn(span,"style") && !Object.hasOwn(span,"color") &&
      document.querySelector('[aria-label="Span 2 weight"]')?.value === "";
  });
  const spanSource = await page.evaluate(async () => {
    const p = window.studio.getProject(),
      { importPackage } = await import("/src/presentation/package.js"),
      decoded = await importPackage((await p.export({ retainSources: true })).archive);
    return decoded.scenes.get("scenes/front.json").nodes.find(n=>n.runs)?.runs;
  });
  assert.deepEqual(spanSource, [{ text: " World" }, { text: "<b>Hello</b>", icon: inlineIcon }]);
  await page.getByRole("button", { name: "Remove span 1", exact: true }).click();
  await idle();
  await page.waitForFunction(() => window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.runs)?.runs.length === 1 &&
    !document.querySelector('[aria-label="Span 2 text"]'));
  await page.screenshot({ path: resolve(output, "styled-spans.png"), fullPage: true });
  await page.getByRole("button", { name: "Convert spans to plain text", exact: true }).click();
  await idle();
  await page.waitForFunction(() => document.querySelector('[aria-label="Text content"]')?.value === "<b>Hello</b>" &&
    !window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.type === "text").runs);
  assert.equal(await page.getByLabel("Text content", { exact: true }).inputValue(), "<b>Hello</b>");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await idle();
  await page.waitForFunction(expected => document.querySelector('[aria-label="Span 1 icon"]')?.value === expected, inlineIcon);
  assert.equal(await page.getByLabel("Span 1 icon", { exact: true }).inputValue(), inlineIcon);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await idle();
  await page.waitForFunction(() => !window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.type === "text").runs &&
    document.querySelector('[aria-label="Span 1 icon"]')?.value === "");
  await page.getByLabel("Text content", { exact: true }).fill("Collection title");
  await page.getByLabel("Text content", { exact: true }).press("Tab");
  await idle();
  await page.evaluate(async () => {
    const p = window.studio.getProject();
    p.edit(() => { p.scenes.get("scenes/front.json").nodes.find(n=>n.type === "text").runs = Array.from({length:128}, ()=>({text:"x"})); });
    await window.studio.refreshPolicy();
  });
  assert(await page.getByRole("button", { name: "Add text span", exact: true }).isDisabled());
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await idle();
  await page.getByText("Arrange layers", { exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Lock selected", exact: true }).click();
  await idle();
  assert(await page.getByLabel("Span 1 text", { exact: true }).isDisabled());
  assert(await page.getByRole("button", { name: "Add text span", exact: true }).isDisabled());
  await page.getByText("Arrange layers", { exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Unlock selected", exact: true }).click();
  await idle();
  checks.push("artist spans, rejected-edit recovery, emphasis/icon/reorder/reset/remove, portable round trip, undo/redo and locked/bounded controls");
  await page.getByText("Define a custom field", { exact: true }).click();
  await idle();
  for (const [label, value] of [["Field key", "museum.price"], ["Field label", "Museum price"], ["Field help", "Printed ticket price"], ["Field unit", "USD"]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
    await idle();
  }
  await page.getByLabel("Field type", { exact: true }).selectOption("number");
  await idle();
  await page.getByLabel("Field scope", { exact: true }).selectOption("variant");
  await idle();
  await page.getByLabel("Allow null", { exact: true }).selectOption("yes");
  await idle();
  for (const [label, value] of [["Field minimum", "20"], ["Field maximum", "10"], ["Field decimal places", "2"]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
    await idle();
  }
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await idle();
  await page.waitForFunction(() => document.querySelector(".dcs-status").textContent.includes("Invalid field range"));
  assert.equal(await page.evaluate(() => window.studio.getProject().manifest.authoring?.fields?.length ?? 0), 0);
  await page.getByLabel("Field minimum", { exact: true }).fill("0");
  await page.getByLabel("Field minimum", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Field maximum", { exact: true }).fill("100");
  await page.getByLabel("Field maximum", { exact: true }).press("Tab");
  await idle();
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await idle();
  await page.getByLabel("Museum price", { exact: true }).fill("12.34");
  await page.getByLabel("Museum price", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.variant["museum.price"] === 12.34);
  assert.equal(await page.getByLabel("Museum price", { exact: true }).getAttribute("step"), "0.01");
  await page.getByText("Scope: variant · Source: author · Visibility: public · Unit: USD · Printed ticket price · Range: 0 to 100 · Decimal places: 2", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Set Museum price to null", exact: true }).click();
  await idle();
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.variant["museum.price"] === null);
  await page.getByText("Define a custom field", { exact: true }).click();
  await idle();
  await page.getByLabel("Field key", { exact: true }).fill("museum.category");
  await page.getByLabel("Field key", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Field label", { exact: true }).fill("Catalog style");
  await page.getByLabel("Field label", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Field type", { exact: true }).selectOption("string");
  await idle();
  await page.getByLabel("Field visibility", { exact: true }).selectOption("owner");
  await idle();
  for (const [label, value] of [["Minimum text length", "2"], ["Maximum text length", "10"]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
    await idle();
  }
  await page.getByRole("button", { name: "Add allowed choice", exact: true }).click();
  await idle();
  await page.getByLabel("Allowed choice 1", { exact: true }).fill("print");
  await page.getByLabel("Allowed choice 1", { exact: true }).press("Tab");
  await idle();
  await page.getByRole("button", { name: "Add allowed choice", exact: true }).click();
  await idle();
  await page.getByLabel("Allowed choice 2", { exact: true }).fill("photo");
  await page.getByLabel("Allowed choice 2", { exact: true }).press("Tab");
  await idle();
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await idle();
  await page.getByLabel("Catalog style", { exact: true }).selectOption('"photo"');
  await idle();
  assert.equal(await page.getByRole("button", { name: "Add Catalog style to card", exact: true }).count(), 0);
  assert(await page.evaluate(async () => !(await window.studio.getProject().export()).manifest.authoring.fields.some(f=>f.key === "museum.category")));
  await page.getByText("Define a custom field", { exact: true }).click();
  await idle();
  await page.getByLabel("Field key", { exact: true }).fill("museum.tags");
  await page.getByLabel("Field key", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Field label", { exact: true }).fill("Catalog tags");
  await page.getByLabel("Field label", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Field type", { exact: true }).selectOption("array");
  await idle();
  for (const [label, value] of [["Minimum list items", "1"], ["Maximum list items", "2"]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
    await idle();
  }
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await idle();
  await page.getByLabel("Catalog tags", { exact: true }).fill('[]');
  await page.getByLabel("Catalog tags", { exact: true }).press("Tab");
  await idle();
  await page.getByText("Catalog tags: List length is outside the permitted range", { exact: true }).waitFor();
  await page.getByLabel("Catalog tags", { exact: true }).fill('["featured"]');
  await page.getByLabel("Catalog tags", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.card["museum.tags"]?.[0] === "featured");
  await page.getByText("Define a custom field", { exact: true }).click();
  await idle();
  assert.deepEqual(await page.getByLabel("Field scope", { exact: true }).locator("option").evaluateAll(options=>options.map(o=>o.value)), ["card", "variant"]);
  await page.getByLabel("Field key", { exact: true }).fill("museum.price");
  await page.getByLabel("Field key", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Field label", { exact: true }).fill("Card price");
  await page.getByLabel("Field label", { exact: true }).press("Tab");
  await idle();
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await idle();
  await page.getByLabel("Card price", { exact: true }).fill("0");
  await page.getByLabel("Card price", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.card["museum.price"] === 0);
  assert.equal(await page.evaluate(() => window.studio.getProject().manifest.authoring.values.variant["museum.price"]), null);
  await page.screenshot({ path: resolve(output, "custom-fields.png"), fullPage: true });
  checks.push("type-aware numeric ranges/precision/nullability, scope/help/unit, enumerated private field and public-export privacy");
  await page.getByText("Clipping mask properties", { exact: true }).click();
  await idle();
  await page.getByLabel("Clipping mask source", { exact: true }).selectOption("polygon");
  await idle();
  await page.getByLabel("Mask vertex 1 x", { exact: true }).fill("2");
  await page.getByLabel("Mask vertex 1 x", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => document.querySelector(".dcs-status").textContent.includes("range"));
  assert.equal(await page.getByLabel("Mask vertex 1 x", { exact: true }).inputValue(), "0");
  await page.getByLabel("Mask vertex 1 x", { exact: true }).fill("0.25");
  await page.getByLabel("Mask vertex 1 x", { exact: true }).press("Tab");
  await idle();
  await page.getByLabel("Invert clipping mask", { exact: true }).selectOption("yes");
  await idle();
  await page.getByRole("button", { name: "Insert mask vertex after 1", exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Remove mask vertex 5", exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Remove mask vertex 4", exact: true }).click();
  await idle();
  await page.getByLabel("Mask vertex 3 y", {exact:true}).fill("1");
  await page.getByLabel("Mask vertex 3 y", {exact:true}).press("Tab");
  await idle();
  assert(await page.getByRole("button", { name: "Remove mask vertex 1", exact: true }).isDisabled());
  await page.getByLabel("Clipping mask scaleX", {exact:true}).fill("0");
  await page.getByLabel("Clipping mask scaleX", {exact:true}).press("Tab");await idle();
  assert.equal(await page.getByLabel("Clipping mask scaleX", {exact:true}).inputValue(),"1");
  await page.getByLabel("Clipping mask x", {exact:true}).fill("0.2");
  await page.getByLabel("Clipping mask x", {exact:true}).press("Tab");await idle();
  assert(await page.evaluate(()=>window.studio.getProject().manifest.capabilities.required.includes("dc.mask-layout@0.2")));
  await page.getByRole("button",{name:"Reset clipping mask transform",exact:true}).click();await idle();
  assert.equal(await page.getByLabel("Clipping mask x",{exact:true}).inputValue(),"0");
  await page.getByLabel("Library item name", { exact: true }).fill("Triangle window");
  await page.getByLabel("Library item name", { exact: true }).press("Tab");
  await idle();
  await page.getByRole("button", { name: "Save clipping mask", exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Apply Triangle window", exact: true }).click();
  await idle();
  await page.waitForFunction(() => Object.keys(window.studio.getProject().manifest.authoring.masks ?? {}).length === 1);
  const retainedMask = await page.evaluate(async () => {
    const p = window.studio.getProject(), node = p.scenes.get("scenes/front.json").nodes.find(n=>n.type === "text");
    window.maskLayerId = node.id;
    window.retainedMaskPackage = (await p.export({retainSources:true})).archive;
    return node.mask;
  });
  await page.getByLabel("Mask vertex 1 x", { exact: true }).fill("0.75");
  await page.getByLabel("Mask vertex 1 x", { exact: true }).press("Tab");
  await idle();
  assert.equal(await page.evaluate(() => Object.keys(window.studio.getProject().manifest.authoring.masks).length), 0);
  await page.getByRole("button", { name: "Apply Triangle window", exact: true }).click();
  await idle();
  assert.equal(await page.getByLabel("Mask vertex 1 x", { exact: true }).inputValue(), "0.25");
  assert.deepEqual(await page.evaluate(async () => {
    const {importPackage} = await import("/src/presentation/package.js"), restored = await importPackage(window.retainedMaskPackage);
    return restored.scenes.get("scenes/front.json").nodes.find(n=>n.id===window.maskLayerId).mask;
  }), retainedMask);
  await page.evaluate(async()=>{
    const p=window.studio.getProject();
    p.edit(()=>{p.scenes.get("scenes/front.json").nodes.find(n=>n.id===window.maskLayerId).mask.polygon=Array.from({length:64},(_,i)=>[0.5+0.5*Math.cos(i*Math.PI/32),0.5+0.5*Math.sin(i*Math.PI/32)]);});
    await window.studio.refreshPolicy();
  });
  assert(await page.getByRole("button",{name:"Insert mask vertex after 1",exact:true}).isDisabled());
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await idle();
  await page.waitForFunction(() => window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.id===window.maskLayerId).mask.polygon.length === 3 &&
    !document.querySelector('[aria-label="Mask vertex 4 x"]'));
  const rapidMaskUndo = await page.evaluate(async()=>{
    const p=window.studio.getProject(), before=p.serialize(), control=document.querySelector('[aria-label="Mask vertex 1 x"]'),
      undo=[...document.querySelectorAll("button")].find(button=>button.textContent === "Undo");
    control.value="0.6";
    const change=control.onchange(), revert=undo.onclick();
    await Promise.all([change,revert]);
    return {before,after:p.serialize()};
  });
  assert.deepEqual(rapidMaskUndo.after,rapidMaskUndo.before);
  await page.screenshot({path:resolve(output,"clipping-mask.png"),fullPage:true});
  const maskChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload clipping mask image", exact: true }).click();
  await idle();
  await (await maskChooser).setFiles({name:"alpha-mask.png",mimeType:"image/png",buffer:Buffer.from(
    pngRGBA(2,2,new Uint8Array([255,255,255,0,255,255,255,255,255,255,255,255,255,255,255,0])))});
  await page.waitForFunction(() => window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.id===window.maskLayerId).mask?.asset);
  await page.waitForFunction(() => document.querySelector('[aria-label="Clipping mask source"]')?.value.startsWith("image:"));
  assert((await page.getByLabel("Clipping mask source", {exact:true}).inputValue()).startsWith("image:"));
  await page.getByRole("button", {name:"Remove clipping mask",exact:true}).click();
  await idle();
  assert.equal(await page.getByLabel("Clipping mask source", {exact:true}).inputValue(),"none");
  await page.getByText("Arrange layers",{exact:true}).click();
  await idle();
  await page.getByRole("button",{name:"Lock selected",exact:true}).click();
  await idle();
  assert(await page.getByLabel("Clipping mask source",{exact:true}).isDisabled());
  assert(await page.getByRole("button",{name:"Upload clipping mask image",exact:true}).isDisabled());
  await page.getByText("Arrange layers",{exact:true}).click();
  await idle();
  await page.getByRole("button",{name:"Unlock selected",exact:true}).click();
  await idle();
  checks.push("polygon bounds/inversion/vertex counts, immutable named reuse, local-reference detachment and alpha-image upload/removal");
  const fontChooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Add custom font", exact: true })
    .click();
    await idle();
  await (
    await fontChooser
  ).setFiles({
    name: "Test.ttf",
    mimeType: "font/ttf",
    buffer: Buffer.from(testFont()),
  });
  await page.getByRole("dialog").waitFor();
  assert(await page.getByRole("button",{name:"Embed font with declared terms",exact:true}).isDisabled());
  await page.getByLabel("Font usage terms",{exact:true}).fill("Test fixture: permitted embedding and redistribution");
  await page.getByLabel("Font usage terms",{exact:true}).press("Tab");
  await idle();
  await page.getByRole("button",{name:"Embed font with declared terms",exact:true}).click();
  await idle();
  await page.waitForFunction(() =>
    window.studio.getProject().manifest.assets.some((a) => a.role === "font"),
  );
  await page.getByText("Embedded font assets",{exact:true}).click();
  const embeddedFontId=await page.evaluate(()=>window.studio.getProject().manifest.assets.find(a=>a.role==="font").id);
  assert.equal(await page.getByLabel("Usage terms for "+embeddedFontId,{exact:true}).inputValue(),"Test fixture: permitted embedding and redistribution");
  await page.getByText("Decoded family: Test Sans · Face: Regular · Style: normal · Weight: unavailable · Italic angle: 0",{exact:true}).waitFor();
  await page.getByText("Glyphs: 2 · Character-map entries: 256 · Units per em: 1000",{exact:true}).waitFor();
  await page.getByText("Variable axes: none",{exact:true}).waitFor();
  await page.getByLabel("Glyph coverage sample for "+embeddedFontId,{exact:true}).fill("A🙂");
  await page.getByLabel("Glyph coverage sample for "+embeddedFontId,{exact:true}).press("Tab");
  await idle();
  await page.getByText("Missing code points: U+1F642",{exact:true}).waitFor();
  await page.getByLabel("Usage terms for "+embeddedFontId,{exact:true}).fill("");
  await page.getByLabel("Usage terms for "+embeddedFontId,{exact:true}).press("Tab");
  await idle();
  assert.equal(await page.getByLabel("Usage terms for "+embeddedFontId,{exact:true}).inputValue(),"Test fixture: permitted embedding and redistribution");
  await page.getByLabel("Usage terms for "+embeddedFontId,{exact:true}).fill("Updated fixture embedding terms");
  await page.getByLabel("Usage terms for "+embeddedFontId,{exact:true}).press("Tab");
  await idle();
  assert.equal(await page.evaluate(()=>window.studio.getProject().manifest.assets.find(a=>a.role==="font").font.license),"Updated fixture embedding terms");
  assert.equal(await page.getByLabel("Glyph coverage sample for "+embeddedFontId,{exact:true}).inputValue(),"A🙂");
  await page.getByText("Missing code points: U+1F642",{exact:true}).waitFor();
  await page.screenshot({path:resolve(output,"font-assets.png"),fullPage:true});
  await page.getByText("Arrange layers",{exact:true}).click();
  await idle();
  await page.getByRole("button",{name:"Lock selected",exact:true}).click();
  await idle();
  const lockedFontChooser=page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Add custom font",exact:true}).click();
  await idle();
  await(await lockedFontChooser).setFiles({name:"Second.ttf",mimeType:"font/ttf",buffer:Buffer.from(testFont())});
  await page.getByLabel("Font usage terms",{exact:true}).fill("Second fixture: permitted embedding");
  await page.getByLabel("Font usage terms",{exact:true}).press("Tab");
  await idle();
  await page.getByRole("button",{name:"Embed font with declared terms",exact:true}).click();
  await idle();
  assert.equal(await page.evaluate(()=>window.studio.getProject().scenes.get("scenes/front.json").nodes.find(n=>n.type==="text").typography.fontAsset),embeddedFontId);
  await page.getByText("Arrange layers",{exact:true}).click();
  await idle();
  await page.getByRole("button",{name:"Unlock selected",exact:true}).click();
  await idle();
  checks.push("explicit font upload terms, editable declaration, exact decoded metrics/digest and missing-glyph sample");
  await page.getByLabel("Font size", { exact: true }).fill("24");
  await page.getByLabel("Font size", { exact: true }).press("Tab");
  await idle();
  await page.evaluate(async () => {
    const { configureAuthoring, addStatBlock, setStat } =
      await import("/src/presentation/authoring-tools.js");
    const p = window.studio.getProject();
    configureAuthoring(p, {
      policy: {
        defaults: {},
        fields: [{ key: "score", label: "Score", type: "integer", default: 0 }],
      },
    });
    setStat(p, "score", 42);
    addStatBlock(p, "back", ["score"]);
    const font = p.manifest.assets.find((a) => a.role === "font");
    p.edit(() => {
      p.scenes
        .get(p.manifest.faces.back.scene)
        .nodes.at(-1).typography.fontAsset = font.id;
    });
    await window.studio.open(await p.export({ retainSources: true }));
  });
  await page.getByRole("button", { name: "Front / back", exact: true }).click();
  await idle();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="img"]')
      ?.getAttribute("aria-label")
      ?.includes("42"),
  );
  await page.getByRole("spinbutton", { name: "Score", exact: true }).fill("57");
  await page
    .getByRole("spinbutton", { name: "Score", exact: true })
    .press("Tab");
    await idle();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="img"]')
      ?.getAttribute("aria-label")
      ?.includes("57"),
  );
  checks.push(
    "custom font upload, editable text, bound stat redraw and accessible text on both faces",
  );
  await page.evaluate(async () => {
    const p = window.studio.getProject();
    p.edit(() => {
      p.manifest.authoring.fields.push(
        { key: "score", label: "Variant score", type: "integer", scope: "variant" },
        { key: "enabled", label: "Enabled", type: "boolean", nullable: true },
        { key: "category", label: "Category", type: "string", enum: ["print", "photo"] },
      );
      p.manifest.authoring.values.variant.score = 99;
    });
    await window.studio.refreshPolicy();
  });
  assert.equal(await page.getByLabel("Enabled", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Category", { exact: true }).inputValue(), "");
  await page.getByLabel("Enabled", { exact: true }).selectOption("false");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.card.enabled === false);
  await page.getByLabel("Enabled", { exact: true }).selectOption("null");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.card.enabled === null);
  await page.getByLabel("Enabled", { exact: true }).selectOption("");
  await idle();
  await page.waitForFunction(() => !Object.hasOwn(window.studio.getProject().manifest.authoring.values.card, "enabled"));
  await page.getByRole("button", { name: "Add Variant score to card", exact: true }).click();
  await idle();
  await page.getByText("Styled text spans", { exact: true }).click();
  await idle();
  await page.getByText("Bound text comes from its stat field. Use the stat formatting controls to change its display.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add text span", exact: true }).count(), 0);
  await page.getByLabel("Stat label", { exact: true }).fill("Edition");
  await page.getByLabel("Stat label", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => document.querySelector('[role="img"]')?.getAttribute("aria-label")?.includes("Edition 99"));
  assert.equal(await page.getByLabel("Bound field", { exact: true }).inputValue(), '["variant","score"]');
  await page.getByLabel("Stat appearance", { exact: true }).selectOption("bar");
  await idle();
  await page.getByLabel("Bar maximum", { exact: true }).fill("200");
  await page.getByLabel("Bar maximum", { exact: true }).press("Tab");
  await idle();
  await page.waitForFunction(() => window.studio.getProject().scenes.get("scenes/back.json").nodes.some(n => n.stat?.maximum === 200));
  await page.getByRole("button", { name: "Copy text style", exact: true }).click();
  await idle();
  await page.getByText("Arrange layers", { exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Lock selected", exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "Paste text style", exact: true }).click();
  await idle();
  await page.waitForFunction(() => document.querySelector(".dcard-studio").textContent.includes("Unlock this layer to edit it"));
  checks.push("unset/false/null stat forms, scoped bindings, artist bar controls and locked-style protection");
  await page
    .getByRole("button", { name: "Save card as template", exact: true })
    .click();
    await idle();
  await page.waitForFunction(() =>
    document.querySelector(".dcs-authoring").textContent.includes("· template"),
  );
  const snapshot = await page.evaluate(async () => {
    const p = window.studio.getProject(),
      before = await p.export({ retainSources: true });
    await window.studio.capturePosters();
    const after = await p.export();
    return {
      before: before.digest,
      after: after.digest,
      fonts: after.manifest.assets.filter((a) => a.role === "font").length,
      back: after.manifest.faces.back.description,
    };
  });
  assert.equal(snapshot.fonts, 1);
  assert.notEqual(snapshot.before, snapshot.after);
  checks.push("template library save and poster capture retain embedded font");
  await page.screenshot({
    path: resolve(output, "editor.png"),
    fullPage: true,
  });
  const rendering = await page.evaluate(async () => {
    const { drawText, inspectFont } = await import("/src/presentation/text.js");
    const font = inspectFont(
      new Uint8Array(await (await fetch("/font.ttf")).arrayBuffer()),
      "font/ttf",
    ).font;
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    const icon = document.createElement("canvas");
    icon.width = icon.height = 16;
    icon.getContext("2d").fillRect(0, 0, 16, 16);
    const node = {
      id: "spans",
      width: 200,
      height: 80,
      text: "",
      typography: { size: 30 },
      runs: [
        { text: "AB", color: "#ff0000" },
        { text: "CD", color: "#0000ff", icon: "symbol" },
      ],
    };
    drawText(ctx, node, {}, font, new Map([["symbol", icon]]));
    const pixels = ctx.getImageData(0, 0, 200, 80).data;
    let red = 0,
      blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 200 && pixels[i + 2] < 30) red++;
      if (pixels[i + 2] > 200 && pixels[i] < 30) blue++;
    }
    return { red, blue };
  });
  assert(rendering.red > 0 && rendering.blue > 0);
  checks.push("rich span colors and inline icon render to pixels");

  await page.evaluate(async()=>{
    const {createCardRenderer}=await import("/src/presentation/card-view.js");
    const {importPackage,browserResolver}=await import("/src/presentation/package.js");
    const pkg=await importPackage(new Uint8Array(await(await fetch("/fixture.dcard")).arrayBuffer()));
    const renderer=createCardRenderer({resolve:async url=>{window.variantURL=url;return browserResolver(pkg);}});
    const ref={contract:"digital-card@0.1",digest:pkg.digest,baseURL:"/base/"};
    window.variantNode=renderer({definition:{name:"Variant design",presentation:ref},variant:{presentation:{...ref,baseURL:"/variant/"}}});
    Object.assign(window.variantNode.style,{position:"fixed",top:"0",left:"0",width:"100px",height:"140px"});document.body.append(window.variantNode);
  });
  await page.waitForFunction(()=>window.variantURL==="/variant/");
  await page.evaluate(()=>window.variantNode.remove());
  checks.push("variant-specific artwork overrides the base design in the public renderer");

  await page.evaluate(async () => {
    const { mountStudio } = await import("/src/presentation/studio.js"),
      { createProject } = await import("/src/presentation/project.js"),
      { addText, createMemoryLibrary } = await import("/src/presentation/authoring-tools.js"),
      { importPackage } = await import("/src/presentation/package.js");
    const p = createProject(await importPackage(new Uint8Array(await (await fetch("/fixture.dcard")).arrayBuffer())));
    const asset = await p.addFont(new File([await (await fetch("/font.ttf")).arrayBuffer()], "Test.ttf", { type: "font/ttf" }));
    addText(p, "front", { id: "foo", text: "Prefix layer" });
    addText(p, "front", { id: "foo.bar", text: "Short", width: 200, height: 100,
      typography: { fontAsset: asset.id, size: 12, overflow: "wrap" } });
    window.overflowLayer = addText(p, "back", { id: "foo.bar", text: "A title too long for its box", width: 10, height: 10,
      typography: { fontAsset: asset.id, size: 30, overflow: "wrap" } });
    window.studio.dispose();
    window.studio = mountStudio(document.querySelector("#root"), {
      initialPackage: await p.export({ retainSources: true }), library: createMemoryLibrary(),
      policyProvider: async () => ({ revision: 1, policy: {
        fields: [{ key: "museum.catalog", label: "Catalog number", type: "integer", required: true }],
        defaults: {}, requirements: { rejectOverflow: true, minimumFontSize: 20 }, provenance: {}, references: ["museum.cards@1"],
      } }),
    });
    await window.studio.ready;
    await window.studio.refreshPolicy();
  });
  await page.getByText("Card policy", { exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "foo.bar: Text is below the minimum size", exact: true }).click();
  await idle();
  await page.getByRole("dialog").getByText("This layer ID is used on multiple faces. Choose the layer to inspect.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Inspect front / Text", exact: true }).click();
  await idle();
  assert.equal(await page.getByLabel("Text content", { exact: true }).inputValue(), "Short");
  await page.getByText("Card policy", { exact: true }).click();
  await idle();
  const overflowId = await page.evaluate(() => window.overflowLayer);
  const overflowIssue = page.getByRole("button", { name: "back / " + overflowId + ": Text overflows its box", exact: true });
  assert.equal(await overflowIssue.count(), 1);
  await overflowIssue.focus();
  await overflowIssue.press("Enter");
  await page.getByRole("heading", { name: "Back layers", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Text content", { exact: true }).inputValue(), "A title too long for its box");
  await page.getByText("Card policy", { exact: true }).click();
  await idle();
  await page.getByRole("button", { name: "card.stats.museum.catalog: Required field is missing", exact: true }).click();
  await idle();
  const catalogInput = page.getByLabel("Catalog number *", { exact: true });
  assert.equal(await catalogInput.getAttribute("aria-invalid"), "true");
  assert(await catalogInput.evaluate(el => document.activeElement === el));
  assert(await catalogInput.getAttribute("aria-describedby"));
  await page.screenshot({ path: resolve(output, "policy-diagnostics.png"), fullPage: true });
  checks.push("face-specific overflow, exact dotted layer IDs, explicit duplicate-ID choice, keyboard navigation and focused required-field errors");

  await page.evaluate(async () => {
    window.studio.dispose();
    const { createClient } = await import("/src/client.js"),
      { mountVisualStudio } = await import("/src/visual-studio-ui.js");
    const client = createClient(),
      me = await client.me(),
      catalog = await client.operatorCatalog();
    window.client = client;
    window.visual = mountVisualStudio(document.querySelector("#root"), {
      client,
      model: { me, catalog },
    });
  });
  await page
    .getByRole("button", { name: "Open visual card editor", exact: true })
    .click();
    await idle();
  await page.waitForFunction(() => document.querySelector(".dcard-studio"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button=>button.textContent === "Open visual card editor" && !button.disabled));
  assert(await page.locator(".dcard-studio").evaluate(element=>!element.inert && element.getAttribute("aria-busy") !== "true"));
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await idle();
  await page
    .getByLabel("Text content", { exact: true })
    .fill("Published design");
  await page.getByLabel("Text content", { exact: true }).press("Tab");
  await idle();
  await page
    .getByRole("button", { name: "Capture posters", exact: true })
    .click();
    await idle();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("button", { name: "Publish reviewed card", exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Publish reviewed card", exact: true })
    .click();
    await idle();
  await page.getByText("Card published.", { exact: true }).waitFor();
  assert(core.operatorCatalog(admin).cards[0].presentation);
  checks.push(
    "visual editor uploads, registers, previews and commits through authenticated policy gate",
  );
  const oldProduct=core.operatorCatalog(admin).products[0],ownedBefore=core.purchase(alice,{...core.quote(alice,{productId:oldProduct.id,quantity:1}),key:"pack-art-before"}).packs[0];
  await page.getByLabel("Design destination",{exact:true}).selectOption("pack");
  await page.getByRole("button",{name:"Open visual pack editor",exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Open visual pack editor'&&!button.disabled));
  await page.getByLabel("Pack reveal artwork URL",{exact:true}).fill("/fixture.dcard");
  await page.getByLabel("Pack artwork description",{exact:true}).fill("Printed sky pack");
  await page.getByRole("button",{name:"Add text",exact:true}).click();await idle();
  await page.getByLabel("Text content",{exact:true}).fill("Pack jacket");await page.getByLabel("Text content",{exact:true}).press("Tab");await idle();
  await page.getByRole("button",{name:"Capture posters",exact:true}).click();await idle();
  await page.getByRole("button",{name:"Publish",exact:true}).click();
  await page.getByRole("button",{name:"Publish reviewed pack artwork",exact:true}).click();await idle();
  await page.getByText("Pack artwork published. Existing packs retain their artwork.",{exact:true}).waitFor();
  const publishedProduct=core.operatorCatalog(admin).products.find(product=>product.id===oldProduct.id);
  assert.equal(publishedProduct.revision,oldProduct.revision+1);assert(publishedProduct.artwork.design.digest);assert(publishedProduct.artwork.front.includes('/presentations/'));
  assert.deepEqual(core.packs(alice).find(pack=>pack.id===ownedBefore.id).product.artwork,oldProduct.artwork);
  const packRendererResult=await page.evaluate(async product=>{
    const {renderPack}=await import('/src/ui.js'),one=renderPack(product),two=renderPack(product);document.body.append(one.node,two.node);
    await Promise.all([one,two].map(pack=>new Promise((resolve,reject)=>{const image=pack.node.querySelector('img');if(image.complete&&image.naturalWidth)resolve();else{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',()=>reject(new Error('Published pack poster unavailable')),{once:true});}})));
    one.setSide('back');const independent=two.node.querySelector('img').src.endsWith(product.artwork.front);
    const retained=one.setSide;one.dispose();retained('front');const disposed=one.node.childNodes.length===0;
    const invalid=renderPack({...product,artwork:{front:'javascript:alert(1)'}}),fallback=invalid.node.dataset.artworkState;
    const broken=renderPack({...product,artwork:{front:'/fixture.dcard'}});document.body.append(broken.node);await new Promise(resolve=>broken.node.querySelector('img').addEventListener('error',resolve,{once:true}));
    const loadFailure=broken.node.dataset.artworkState;one.node.remove();two.dispose();two.node.remove();invalid.dispose();broken.dispose();broken.node.remove();return {independent,disposed,fallback,loadFailure};
  },publishedProduct);
  assert.deepEqual(packRendererResult,{independent:true,disposed:true,fallback:'fallback',loadFailure:'fallback'});
  const targetFencing=await page.evaluate(async()=>{
    const {mountVisualStudio}=await import('/src/visual-studio-ui.js'),catalog=await window.client.operatorCatalog(),me=await window.client.me(),root=document.createElement('div');document.body.append(root);
    let finishCatalog,policyCalls=0;const waiting=new Promise(resolve=>{finishCatalog=resolve;}),view=mountVisualStudio(root,{model:{me:{...me,role:'artist'},catalog},client:{operatorCatalog:()=>waiting,effectiveCardPolicy:()=>{policyCalls++;throw new Error('Stale destination policy requested');}}}),
      launch=[...root.querySelectorAll('button')].find(button=>button.textContent==='Open visual card editor'),opening=launch.onclick(),kind=root.querySelector('[aria-label="Design destination"]'),loadingLocked=kind.disabled;
    kind.value='pack';kind.onchange();finishCatalog(catalog);await opening;
    const switched={loadingLocked,policyCalls,editors:root.querySelectorAll('.dcard-studio').length,kind:kind.value};view.dispose();root.remove();
    const previewRoot=document.createElement('div');document.body.append(previewRoot);let finishPreview,previewStarted,previewCalls=0;
    const pending=new Promise(resolve=>{finishPreview=resolve;}),entered=new Promise(resolve=>{previewStarted=resolve;}),previewView=mountVisualStudio(previewRoot,{model:{me:{...me,role:'artist'},catalog},client:{...window.client,previewImport:()=>{previewCalls++;previewStarted();return pending;}}}),packKind=previewRoot.querySelector('[aria-label="Design destination"]');
    packKind.value='pack';packKind.onchange();await [...previewRoot.querySelectorAll('button')].find(button=>button.textContent==='Open visual pack editor').onclick();
    const publishing=[...previewRoot.querySelectorAll('button')].find(button=>button.textContent==='Publish').onclick();
    let timeout;await Promise.race([entered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Pack preview did not start: '+previewRoot.textContent)),30000);})]);clearTimeout(timeout);
    const reviewLocked=packKind.disabled;previewView.dispose();finishPreview({});await publishing;
    const disposed={previewCalls,reviewLocked,children:previewRoot.childElementCount,dialogs:previewRoot.querySelectorAll('dialog').length};previewRoot.remove();return {switched,disposed};
  });
  assert.deepEqual(targetFencing.switched,{loadingLocked:true,policyCalls:0,editors:0,kind:'pack'});
  assert.deepEqual(targetFencing.disposed,{previewCalls:1,reviewLocked:true,children:0,dialogs:0});
  checks.push("pack artist front/back publication, immutable allocated artwork, two independent public renderers and invalid/missing-image fallback");
  await page.getByLabel("Design destination",{exact:true}).selectOption("card");
  await page
    .getByText("Administrator card policies", { exact: true })
    .first()
    .click();
    await idle();
  const policy = {
    schemaVersion: 1,
    id: "browser.policy",
    revision: 1,
    name: "Browser policy",
    fields: [
      {
        key: "score",
        label: "Score",
        type: "integer",
        required: true,
        minimum: 0,
      },
    ],
    requirements: {},
  };
  await page
    .getByLabel("Policy document", { exact: true })
    .fill(JSON.stringify(policy));
  await page
    .getByRole("button", { name: "Save policy draft", exact: true })
    .click();
    await idle();
  await page.getByText("Policy library revision 1", { exact: true }).waitFor();
  await page
    .getByLabel("Policy assignments", { exact: true })
    .fill(
      JSON.stringify([{ scope: "installation", policy: "browser.policy@1" }]),
    );
  await page
    .getByRole("button", { name: "Preview policy impact", exact: true })
    .click();
    await idle();
  await page
    .getByLabel("I reviewed the policy changes and affected cards.")
    .check();
  await page
    .getByRole("button", { name: "Activate reviewed policy", exact: true })
    .click();
    await idle();
  await page.getByText("Policy library revision 2", { exact: true }).waitFor();
  checks.push(
    "administrator saves, reviews field-level impact and activates a policy using keyboard-accessible controls",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(output, "mobile.png"),
    fullPage: true,
  });
  const disposalQueue = await page.evaluate(async()=>{
    const {mountStudio}=await import("/src/presentation/studio.js"),
      {importPackage}=await import("/src/presentation/package.js"),
      {createMemoryLibrary}=await import("/src/presentation/authoring-tools.js"),
      root=document.createElement("div");
    document.body.append(root);
    const editor=mountStudio(root,{initialPackage:await importPackage(new Uint8Array(await(await fetch("/fixture.dcard")).arrayBuffer())),library:createMemoryLibrary()});
    await editor.ready;
    const before=editor.getProject().serialize(), buttons=[...root.querySelectorAll("button")], retainedAdd=buttons.find(button=>button.textContent==="Add text"),
      add=retainedAdd.onclick(), undo=buttons.find(button=>button.textContent==="Undo").onclick();
    editor.dispose();
    await Promise.all([add,undo]);
    await retainedAdd.onclick();
    const after=editor.getProject().serialize(),children=root.childElementCount,busy=root.getAttribute("aria-busy");
    root.remove();
    return {before,after,children,busy};
  });
  assert.deepEqual(disposalQueue.after,disposalQueue.before);
  assert.equal(disposalQueue.children,0);
  assert.equal(disposalQueue.busy,null);
  const visualDisposal=await page.evaluate(async()=>{
    const {mountVisualStudio}=await import("/src/visual-studio-ui.js"),root=document.createElement("div"),catalog=await window.client.operatorCatalog();
    document.body.append(root);
    let finish,catalogCalls=0,policyCalls=0;
    const pending=new Promise(resolve=>{finish=resolve;}),view=mountVisualStudio(root,{
      model:{me:{role:"artist"},catalog},client:{operatorCatalog:()=>{catalogCalls++;return pending;},effectiveCardPolicy:()=>{policyCalls++;throw new Error("Policy load after disposal");}},
    }),launch=[...root.querySelectorAll("button")].find(button=>button.textContent==="Open visual card editor"),opening=launch.onclick();
    view.dispose();finish(catalog);await opening;await launch.onclick();
    const children=root.childElementCount;
    root.remove();return{catalogCalls,policyCalls,children};
  });
  assert.deepEqual(visualDisposal,{catalogCalls:1,policyCalls:0,children:0});
  checks.push("shared authoring/undo queue preserves rapid edits and fences queued work after disposal");
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ engine, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ engine, checks: checks.length, errors }));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
    console.error((await page.locator("body").innerText()).slice(-7000));
    console.error(JSON.stringify(await page.evaluate(()=>({
      textLayers: window.studio?.getProject()?.scenes.get("scenes/front.json")?.nodes.filter(n=>n.type === "text").map(n=>({id:n.id,text:n.text,runs:n.runs})),
      spanControls: [...document.querySelectorAll('[aria-label^="Span "]')].map(control=>({label:control.getAttribute("aria-label"),value:control.value})),
    }))).slice(0,6000));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await store.close();
  core.close();
  await rm(temp, { recursive: true, force: true });
}
