import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { serveReference } from "../src/static.js";
const recipeOnly = process.argv[2] === "--recipe";
const typographyOnly = process.argv[2] === "--typography";
const selfHosted = recipeOnly || typographyOnly;
let server;
const [
  playwrightPath,
  base = "http://127.0.0.1:4173",
  out = "../PortableCardQA",
] = selfHosted ? [undefined, undefined, process.argv[3] ?? (typographyOnly ? "test-results/presentation-host-typography" : "test-results/presentation-host-recipe")] : process.argv.slice(2);
const engine = process.env.BROWSER_ENGINE ?? "chromium";
await mkdir(out, {recursive:true});
let origin = base;
if (selfHosted) {
  server = createServer(async (request,response) => {
    try {
      if (request.url === "/recipe" || request.url === "/typography") {response.setHeader("content-type","text/html");response.end('<!doctype html><html lang="en"><title>Presentation qualification</title><link rel="stylesheet" href="/src/presentation/studio.css"><body></body></html>');return;}
      const fonts = new Map([
        ["/typography-fonts/variable.woff2", "SourceSans3VF-Upright.ttf.woff2"],
        ["/typography-fonts/hebrew.ttf", "NotoSansHebrew-Full-Regular.ttf"],
      ]);
      if (typographyOnly && fonts.has(request.url)) {
        response.setHeader("content-type", request.url.endsWith("woff2") ? "font/woff2" : "font/ttf");
        response.end(await readFile(new URL("./fixtures/fonts/" + fonts.get(request.url), import.meta.url)));
        return;
      }
      if(await serveReference(request,response))return;response.writeHead(404);response.end();
    } catch {response.writeHead(500);response.end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  origin = "http://127.0.0.1:" + server.address().port;
}
let browser;
const errors = [];
try {
  const playwright = await import(playwrightPath ? pathToFileURL(path.resolve(playwrightPath)).href : "playwright");
  browser = await playwright[engine].launch({ headless: process.env.HEADED !== "1", ...(!selfHosted && engine === "chromium" ? {channel:"msedge"} : {}) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.goto(origin + (typographyOnly ? "/typography" : recipeOnly ? "/recipe" : "/library.html"));
  if (!selfHosted) {
  await page.waitForFunction(
    () => document.querySelectorAll("dc-portable-card img").length === 2,
  );
  await page.locator("dc-portable-card").first().click();
  await page.waitForFunction(() => document.querySelector("#viewer canvas"));
  await page.getByRole("button", { name: "Flip card", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await page.locator("#viewer canvas").count(), 0);
  }
  const moduleRoot = selfHosted ? "/src/presentation" : "/player";
  let typography, flat, custom, reducedMotion;
  if (typographyOnly) {
    typography = await page.evaluate(async moduleRoot => {
      const [{ imagePackage }, { createProject }, { addText }, { mountStudio }, { browserResolver }, { createPlayerStage }] = await Promise.all([
        import(moduleRoot + "/authoring.js"), import(moduleRoot + "/project.js"),
        import(moduleRoot + "/authoring-tools.js"), import(moduleRoot + "/studio.js"),
        import(moduleRoot + "/package.js"), import(moduleRoot + "/player.js"),
      ]);
      const style = document.createElement("style");
      style.textContent = ".dcs-region{width:300px!important;height:450px!important;aspect-ratio:auto;border:0!important;border-radius:0!important}";
      document.head.append(style);
      const source = document.createElement("canvas"); source.width = 300; source.height = 450;
      const background = source.getContext("2d"); background.fillStyle = "#111111"; background.fillRect(0, 0, 300, 450);
      const blob = await new Promise(resolve => source.toBlob(resolve, "image/png")),
        project = createProject(await imagePackage({ bytes: new Uint8Array(await blob.arrayBuffer()), mediaType: "image/png", id: "typography", title: "Typography" }));
      const variable = await project.addFont(await (await fetch("/typography-fonts/variable.woff2")).blob(), { id: "variable", license: "SIL Open Font License 1.1" }),
        hebrew = await project.addFont(await (await fetch("/typography-fonts/hebrew.ttf")).blob(), { id: "hebrew", license: "SIL Open Font License 1.1" });
      for (const [weight, y] of [[200, 20], [900, 105]]) addText(project, "front", {
        text: "Aé 123", x: 10, y, width: 280, height: 70, readingOrder: weight,
        typography: { fontAsset: variable.id, axes: { wght: weight }, size: 32, color: "#ff3333", overflow: "clip" },
      });
      addText(project, "front", { x: 10, y: 235, width: 280, height: 80, readingOrder: 0,
        runs: [{ text: "ABC ", color: "#ff0000" }, { text: "שלום ", color: "#0000ff" }, { text: "123", color: "#00ff00" }],
        typography: { fontAsset: hebrew.id, size: 28, direction: "rtl", language: "he", overflow: "clip" },
      });
      const studioRoot = document.createElement("div"); document.body.append(studioRoot);
      let studio, resolver, stage, view, target;
      try {
        studio = mountStudio(studioRoot, { initialPackage: await project.export() }); await studio.ready;
        const previewLabel = studioRoot.querySelector(".dcs-slot [aria-label]")?.getAttribute("aria-label") ?? studioRoot.querySelector(".dcs-slot")?.getAttribute("aria-label");
        await studio.capturePosters();
        const pkg = await studio.getProject().export(), front = pkg.manifest.assets.find(a => a.id === pkg.manifest.faces.front.poster),
          posterBlob = new Blob([pkg.files.get(front.path)], { type: front.mediaType });
        const sample = async blob => {
          const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close();
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let light = 0, heavy = 0, blue = 0, green = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const y = Math.floor(i / 4 / canvas.width);
            if (pixels[i] > 180 && pixels[i + 1] < 100 && pixels[i + 2] < 100) { if (y < 85) light++; else if (y < 190) heavy++; }
            if (pixels[i + 2] > 180 && pixels[i] < 100) blue++;
            if (pixels[i + 1] > 180 && pixels[i] < 100) green++;
          }
          const result = { width: canvas.width, height: canvas.height, hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels))].join(","), light, heavy, blue, green };
          canvas.width = canvas.height = 0; return result;
        };
        const previewPoster = await sample(posterBlob);
        target = document.createElement("div"); Object.assign(target.style, { width: "300px", height: "450px", position: "relative" }); document.body.prepend(target);
        resolver = browserResolver(pkg); stage = createPlayerStage({ root: target }); view = stage.mount(target, { resolver }, { quality: "standard" });
        const ready = await view.ready; view.setInputs({ tilt: { x: 0, y: 0 }, angle: 0.5 });
        const player = await sample(await view.snapshot()), playerLabel = view.element.getAttribute("aria-label");
        await view.setQuality("poster"); const image = view.element.querySelector("img"); await image.decode();
        const poster = await sample(await (await fetch(image.src)).blob()), posterLabel = image.alt, posterVisible = !image.hidden;
        view.dispose(); const released = stage.diagnostics();
        studio.dispose(); const studioDisposed = studioRoot.childElementCount === 0;
        return { ready, previewPoster, player, poster, previewLabel, playerLabel, posterLabel, posterVisible,
          released, studioDisposed, fontAssets: pkg.manifest.assets.filter(a => a.role === "font").length, png: [...new Uint8Array(await posterBlob.arrayBuffer())] };
      } finally {
        view?.dispose(); stage?.dispose(); resolver?.dispose(); studio?.dispose(); studioRoot.remove(); target?.remove();
        style.remove(); source.width = source.height = 0;
      }
    }, moduleRoot);
    const png = typography.png; delete typography.png;
    await writeFile(path.join(out, "typography-preview-poster.png"), new Uint8Array(png));
    assert.equal(typography.ready.mode, "interactive"); assert.equal(typography.fontAssets, 2);
    assert.deepEqual([typography.player.width, typography.player.height], [300, 450]);
    assert(typography.player.light > 0 && typography.player.heavy > typography.player.light);
    assert(typography.player.blue > 0 && typography.player.green > 0);
    assert.equal(typography.previewPoster.hash, typography.player.hash);
    assert.equal(typography.poster.hash, typography.player.hash);
    assert.equal(typography.previewLabel, typography.playerLabel); assert.equal(typography.posterLabel, typography.playerLabel);
    assert(typography.playerLabel.includes("ABC שלום 123. Aé 123. Aé 123"));
    assert(typography.posterVisible && typography.studioDisposed);
    assert.equal(typography.released.views, 0); assert.equal(typography.released.textures, 0); assert.equal(typography.released.assetReferences, 0);
  } else {
  flat = await page.evaluate(async moduleRoot => {
    const { createAuthoring } = await import(moduleRoot + "/authoring.js"),
      { browserResolver } = await import(moduleRoot + "/package.js"),
      { createPlayerStage } = await import(moduleRoot + "/player.js");
    const image = document.createElement("canvas");
    image.width = 300;
    image.height = 450;
    const ctx = image.getContext("2d");
    ctx.fillStyle = "#543b68";
    ctx.fillRect(0, 0, 300, 450);
    ctx.fillStyle = "#c39483";
    ctx.fillRect(75, 100, 150, 250);
    const blob = await new Promise((r) => image.toBlob(r, "image/jpeg"));
    const pkg = await createAuthoring().build({
      id: "one.jpg",
      source: {
        format: "image",
        mediaType: "image/jpeg",
        bytes: new Uint8Array(await blob.arrayBuffer()),
      },
      effects: [
        {
          id: "preset",
          node: "art",
          parameters: { name: "Chunky holo", size: 18, intensity: 3 },
        },
      ],
    });
    const root = document.createElement("div");
    Object.assign(root.style, { width: "300px", height: "450px" });
    document.body.prepend(root);
    const resolver = browserResolver(pkg),
      stage = createPlayerStage({ root }),
      view = stage.mount(root, { resolver }, { quality: "lite" });
    const ready = await view.ready;
    view.setInputs({ tilt: { x: -0.8, y: 0.2 } });
    const left = new Uint8Array(await (await view.snapshot()).arrayBuffer());
    view.setInputs({ tilt: { x: 0.8, y: -0.2 } });
    const right = new Uint8Array(await (await view.snapshot()).arrayBuffer());
    const different =
      left.length !== right.length || left.some((v, i) => v !== right[i]);
    view.dispose();
    const resources = stage.diagnostics();
    stage.dispose();
    resolver.dispose();
    root.remove();
    return { ready, different, resources };
  }, moduleRoot);
  assert.equal(flat.ready.mode, "interactive");
  assert(flat.different);
  assert.equal(flat.resources.textures, 0);
  custom = await page.evaluate(async moduleRoot => {
    const [{createAuthoring},{browserResolver},{createPlayerStage}] = await Promise.all([
      import(moduleRoot + "/authoring.js"),import(moduleRoot + "/package.js"),import(moduleRoot + "/player.js")
    ]);
    const source = document.createElement("canvas");source.width=128;source.height=192;
    const paint=source.getContext("2d");paint.fillStyle="#543b68";paint.fillRect(0,0,128,192);
    const blob=await new Promise(resolve=>source.toBlob(resolve,"image/png")),calls=[];
    const creator=createAuthoring({effects:{"mod.sparkle":(node,parameters,context)=>{
      calls.push({parameters:structuredClone(parameters),side:context.side,node:node.id});
      return {...node,material:{kind:"glitter",...parameters},bindings:{"material.angle":["input","angle"]}};
    }}}),parameters={size:18,density:0.5,shape:"star",seed:51,intensity:3};
    const pkg=await creator.build({id:"custom-sparkle",source:{format:"image",mediaType:"image/png",bytes:new Uint8Array(await blob.arrayBuffer())},effects:[{id:"mod.sparkle",node:"art",parameters}]});
    const node=pkg.scenes.get(pkg.manifest.faces.front.scene).nodes[0],root=document.createElement("div");Object.assign(root.style,{display:"flex",width:"520px",height:"384px",position:"relative"});document.body.prepend(root);
    const resolver=browserResolver(pkg),stage=createPlayerStage({root}),targets=[0,1].map(()=>{const target=document.createElement("div");Object.assign(target.style,{width:"256px",height:"384px",position:"relative"});root.append(target);return target;}),views=targets.map(target=>stage.mount(target,{resolver},{quality:"lite"}));
    const ready=await Promise.all(views.map(view=>view.ready));
    const capture=async view=>{const blob=await view.snapshot(),bitmap=await createImageBitmap(blob),canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext("2d");context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let painted=0;for(let index=3;index<pixels.length;index+=4)if(pixels[index])painted++;bitmap.close();canvas.width=canvas.height=0;return {painted,hash:[...new Uint8Array(await crypto.subtle.digest("SHA-256",pixels))].join(",")};};
    views[0].setInputs({angle:0.1});views[1].setInputs({angle:0.35});
    const before=await capture(views[0]),other=await capture(views[1]);views[0].setInputs({angle:0.9});const after=await capture(views[0]),unchanged=await capture(views[1]);
    await Promise.all(views.map(view=>view.setQuality("poster")));const poster={visible:views.every(view=>!view.element.querySelector("img").hidden),resources:stage.diagnostics()};
    let posterCaptureRejected=false;try{await views[0].snapshot();}catch{posterCaptureRejected=true;}
    const restored=await Promise.all(views.map(view=>view.setQuality("lite"))),remounted=await capture(views[0]);
    views.forEach(view=>view.dispose());const released=stage.diagnostics();stage.dispose();resolver.dispose();source.width=source.height=0;root.remove();
    return {calls,parameters,material:node.material,binding:node.bindings["material.angle"],ready,before,after,other,unchanged,poster,posterCaptureRejected,restored,remounted,released};
  }, moduleRoot);
  assert.deepEqual(custom.calls,[{parameters:custom.parameters,side:"front",node:"art"}]);
  assert.deepEqual(custom.material,{kind:"glitter",...custom.parameters});assert.deepEqual(custom.binding,["input","angle"]);
  assert(custom.ready.every(value=>value.mode==="interactive"));assert(custom.before.painted>100&&custom.after.painted>100);assert.notEqual(custom.before.hash,custom.after.hash);assert.equal(custom.other.hash,custom.unchanged.hash);
  assert(custom.poster.visible);assert.equal(custom.poster.resources.textures,0);assert.equal(custom.poster.resources.assetReferences,0);assert(custom.posterCaptureRejected);
  assert(custom.restored.every(value=>value.mode==="interactive"));assert(custom.remounted.painted>100);assert.equal(custom.released.views,0);assert.equal(custom.released.textures,0);assert.equal(custom.released.assetReferences,0);
  }
  if (recipeOnly) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const mounted = await page.evaluate(async moduleRoot => {
      const [{ createAuthoring }, { browserResolver }, { createPlayerStage }] = await Promise.all([
        import(moduleRoot + "/authoring.js"), import(moduleRoot + "/package.js"), import(moduleRoot + "/player.js"),
      ]);
      const source = document.createElement("canvas"); source.width = 32; source.height = 48;
      source.getContext("2d").fillRect(0, 0, 32, 48);
      const blob = await new Promise(resolve => source.toBlob(resolve, "image/png"));
      const creator = createAuthoring({ effects: { "qualify.motion": node => ({ ...node,
        material: { kind: "glitter", size: 18, density: 0.5, shape: "star", seed: 51, intensity: 3 },
        bindings: { "material.angle": ["input", "time.active"] },
      }) } });
      const pkg = await creator.build({ id: "motion-preference", source: { format: "image", mediaType: "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) }, effects: [{ id: "qualify.motion", node: "art", parameters: {} }] });
      const root = document.createElement("div"); Object.assign(root.style, { width: "300px", height: "450px" }); document.body.prepend(root);
      const resolver = browserResolver(pkg), stage = createPlayerStage({ root }), view = stage.mount(root, { resolver }, { quality: "lite" });
      const ready = await view.ready; source.width = source.height = 0;
      window.motionQualification = { stage, view, resolver, root };
      return { ready, resources: stage.diagnostics() };
    }, moduleRoot);
    assert.equal(mounted.ready.mode, "interactive");
    await page.waitForFunction(frames => motionQualification.stage.diagnostics().frames >= frames + 2, mounted.resources.frames);
    const moving = await page.evaluate(() => motionQualification.stage.diagnostics());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => motionQualification.stage.diagnostics());
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => motionQualification.stage.diagnostics());
    assert.equal(after.frames, before.frames, "Reduced motion must stop autonomous frames after real motion was observed");
    assert.equal(after.scheduledFrames, 0);
    const released = await page.evaluate(() => {
      const { stage, view, resolver, root } = motionQualification;
      view.dispose(); const resources = stage.diagnostics(); stage.dispose(); resolver.dispose(); root.remove(); delete window.motionQualification; return resources;
    });
    assert.equal(released.views, 0); assert.equal(released.textures, 0); assert.equal(released.assetReferences, 0);
    reducedMotion = { mounted, moving, before, after, released };
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "host-report.json"),
    JSON.stringify({ engine, library: selfHosted ? "not-run" : "passed", flatJpg: flat, customRecipe: custom, typography, reducedMotion, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ engine, library: selfHosted ? "not-run" : "passed", flatJpg: flat, customRecipe: custom, typography, reducedMotion, errors }, null, 2),
  );
} finally {
  await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
