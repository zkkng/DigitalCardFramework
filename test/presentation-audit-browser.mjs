/** Standalone audit: synthetic assets only; no Site checkout or game art required. */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { build, fixture } from "./presentation-fixtures.mjs";
const [
  modulePath,
  output = "../PortableCardQA",
  engine = process.env.BROWSER_ENGINE ?? "chromium",
] = process.argv.slice(2);
const pw = await import(
  modulePath ? pathToFileURL(path.resolve(modulePath)).href : "playwright"
);
const base = fileURLToPath(new URL("../", import.meta.url));
const pkg = await build(fixture());
const { gifFixture } = await import("./gif-fixture.mjs");
const { build: bundle } =
  await import("../src/presentation/node_modules/esbuild/lib/main.js");
const workerBundle = await bundle({
  entryPoints: [path.join(base, "src/presentation/layered-worker.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["node:*"],
  write: false,
});
const special = new Map([
  ["/synthetic.gif", gifFixture(3)],
  ["/worker.js", workerBundle.outputFiles[0].contents],
]);
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://test").pathname,
    );
    if (pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.setHeader("set-cookie", "card_session=browser-audit; HttpOnly; SameSite=Lax; Path=/");
      res.end(
        '<!doctype html><title>Framework audit</title><style>body{margin:0}#root{width:240px;height:360px;position:relative}</style><div id="root"></div>',
      );
      return;
    }
    if (pathname.startsWith("/card/") && !req.headers.cookie?.includes("card_session=browser-audit")) {
      res.writeHead(401);
      res.end("Sign in to load this card");
      return;
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    const relative = pathname.slice(1),
      resolved = path.resolve(base, relative);
    if (!resolved.startsWith(base) || relative.includes(".."))
      throw Error("path");
    const data = special.has(pathname)
      ? special.get(pathname)
      : pathname.startsWith("/card/")
        ? pkg.files.get(pathname.slice(6))
        : await readFile(resolved);
    if (!data) throw Error("missing");
    res.setHeader(
      "content-type",
      pathname.endsWith(".js")
        ? "text/javascript"
        : pathname.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const crossRequests = [];
const crossServer = createServer((req, res) => {
  crossRequests.push({ path: req.url, cookie: req.headers.cookie ?? null });
  res.setHeader("access-control-allow-origin", "*");
  const data = pkg.files.get(new URL(req.url, "http://test").pathname.slice(1));
  res.writeHead(data ? 200 : 404);
  res.end(data);
});
await new Promise((r) => crossServer.listen(0, "127.0.0.1", r));
let browser;
const checks = [],
  errors = [];
try {
  try {
    browser = await pw[engine].launch({ headless: process.env.HEADED !== "1" });
  } catch (error) {
    if (engine !== "chromium") throw error;
    browser = await pw.chromium.launch({ headless: true, channel: "msedge" });
  }
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  const denied = await fetch(`http://127.0.0.1:${server.address().port}/card/integrity.json`);
  assert.equal(denied.status, 401);
  checks.push({ name: "private card files reject anonymous requests", passed: true });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async ({ crossOrigin }) => {
    const { createPlayerStage } = await import("/src/presentation/player.js");
    const { directoryResolver } = await import("/src/presentation/resolver.js");
    const { createWebGLRenderer } = await import("/src/presentation/webgl.js");
    const { createCardRenderer } =
      await import("/src/presentation/card-view.js");
    const { mountProgram } = await import("/src/presentation/program.js");
    const check = (condition, name, detail) => {
        if (!condition) throw Error(name + ": " + JSON.stringify(detail));
        return { name, passed: true, detail };
      },
      results = [];
    const settle = () => new Promise((r) => setTimeout(r, 80)),
      root = document.getElementById("root");
    const resolver = await directoryResolver("/card/");
    results.push(check(Boolean(resolver.manifest), "directory resolver loads session-protected card metadata"));
    const external = await directoryResolver(crossOrigin);
    await external.asset("art");
    external.dispose();
    results.push(check(true, "public cross-origin card metadata and artwork still load"));
    const diagnostics=[],stage = createPlayerStage({ root,onDiagnostic:event=>diagnostics.push(event) });
    let view = stage.mount(root, { resolver });
    const initialReady = await view.ready;
    await settle();
    results.push(
      check(
        stage.diagnostics().activeViews === 1,
        "initial synthetic activation",
        { initialReady, diagnostics, requiredCapabilities:resolver.manifest.capabilities.required, ...stage.diagnostics() },
      ),
    );
    for (let i = 0; i < 100; i++) {
      const v = stage.mount(root, { resolver });
      await v.ready;
      v.setInputs({ tilt: { x: 0.9, y: -0.4 } });
      await v.setSide("back");
      v.dispose();
      await v.setQuality("ultra");
      v.setVisibility("visible");
      v.activate();
    }
    await settle();
    results.push(
      check(
        stage.diagnostics().views === 1 &&
          stage.diagnostics().assetReferences === 1,
        "100 mount/flip/dispose cycles and disposed mutators",
        stage.diagnostics(),
      ),
    );
    const before = stage.diagnostics().frames;
    await settle();
    results.push(
      check(
        stage.diagnostics().frames === before,
        "input-driven idle schedules no continuous frames",
      ),
    );
    for (let i = 0; i < 20; i++) {
      const v = stage.mount(root, { resolver });
      v.dispose();
      await v.ready;
    }
    await settle();
    results.push(
      check(
        stage.diagnostics().assetReferences === 1 &&
          stage.diagnostics().pendingJobs === 0,
        "cancel during load cannot attach resources",
        stage.diagnostics(),
      ),
    );
    view.dispose();
    await settle();
    results.push(
      check(
        stage.diagnostics().assetReferences === 0 &&
          stage.diagnostics().textures === 0,
        "release returns to white-texture baseline",
        stage.diagnostics(),
      ),
    );
    // Text must be admitted under the same budget as raster and adapter surfaces.
    const textResolver = { ...resolver, scenes: new Map(resolver.scenes) };
    textResolver.scenes.set("scenes/front.json", {
      dialect: "dc.scene2d@0.1",
      nodes: [
        {
          id: "caption",
          type: "text",
          text: "A",
          width: 1800,
          height: 1800,
          x: 0,
          y: 0,
        },
      ],
    });
    await stage.setBudget({ estimatedGpuBytes: 256 * 1024 });
    view = stage.mount(root, { resolver: textResolver });
    const textReady = await view.ready;
    await settle();
    results.push(
      check(
        stage.diagnostics().activeViews === 0 &&
          stage.diagnostics().estimatedGpuBytes <= 256 * 1024,
        "oversized text falls back within global budget",
        { textReady, ...stage.diagnostics() },
      ),
    );
    view.dispose();
    await stage.setBudget({ estimatedGpuBytes: 1024 });
    view = stage.mount(root, { resolver });
    await view.ready;
    await settle();
    results.push(
      check(
        stage.diagnostics().estimatedGpuBytes <= 1024,
        "tiny valid budget includes framebuffer",
        stage.diagnostics(),
      ),
    );
    view.dispose();
    stage.dispose();
    resolver.dispose();
    results.push(
      check(
        stage.diagnostics().textures === 0 &&
          stage.diagnostics().scheduledFrames === 0,
        "stage disposal releases GPU and scheduler",
        stage.diagnostics(),
      ),
    );
    // Optional media fallback must never execute an unavailable adapter.
    const optional = await directoryResolver("/card/");
    optional.manifest.capabilities.optional = [
      { id: "mod.decor@0.1", fallback: "omit-decorative" },
    ];
    optional.scenes.get("scenes/front.json").nodes.push({
      id: "decor",
      type: "adapter",
      adapter: "mod.decor",
      width: 100,
      height: 100,
      data: {},
    });
    const os = createPlayerStage({ root }),
      ov = os.mount(root, { resolver: optional });
    await ov.ready;
    await settle();
    results.push(
      check(
        os.diagnostics().activeViews === 1,
        "unavailable optional decoration is omitted",
      ),
    );
    ov.dispose();
    optional.manifest.capabilities.optional[0].fallback = "static-pose";
    const staticView = os.mount(root, { resolver: optional });
    const staticReady = await staticView.ready;
    results.push(
      check(
        staticReady.mode === "poster",
        "unavailable optional static pose uses declared poster",
      ),
    );
    staticView.dispose();
    os.dispose();
    optional.dispose();
    // Reusing one image as two video posters should acquire exactly one lease per view.
    const videoResolver = await directoryResolver("/card/");
    videoResolver.manifest.assets.push({
      id: "video",
      mediaType: "video/webm",
      width: 2,
      height: 2,
      path: "assets/video.webm",
      bytes: 1,
      sha256: "0".repeat(64),
      role: "media",
    });
    const imageAsset = videoResolver.asset.bind(videoResolver);
    const invalidVideo = URL.createObjectURL(
      new Blob([new Uint8Array([1])], { type: "video/webm" }),
    );
    videoResolver.asset = (id) =>
      id === "video"
        ? Promise.resolve({
            id,
            url: invalidVideo,
            width: 2,
            height: 2,
            mediaType: "video/webm",
          })
        : imageAsset(id);
    videoResolver.scenes.set("scenes/front.json", {
      dialect: "dc.scene2d@0.1",
      nodes: [0, 1].map((i) => ({
        id: "v" + i,
        type: "video",
        asset: "video",
        width: 100,
        height: 150,
        video: { poster: "front", mode: "on-activate", muted: true },
      })),
    });
    // Player validates scenes on edits; mount fixtures use the normal trusted-resolver contract.
    const vs = createPlayerStage({ root }),
      vv = vs.mount(root, { resolver: videoResolver });
    const vr = await vv.ready;
    await settle();
    results.push(
      check(
        vs.diagnostics().assetReferences === 1,
        "two video nodes share one poster lease",
        { vr, ...vs.diagnostics() },
      ),
    );
    vv.dispose();
    await settle();
    results.push(
      check(
        vs.diagnostics().assetReferences === 0,
        "video poster lease releases completely",
        vs.diagnostics(),
      ),
    );
    vs.dispose();
    videoResolver.dispose();
    URL.revokeObjectURL(invalidVideo);
    // Pixel probes bypass screenshots and read the actual WebGL output.
    const canvas = document.createElement("canvas"),
      gpu = createWebGLRenderer(canvas);
    const art = document.createElement("canvas");
    art.width = 2;
    art.height = 1;
    const ctx = art.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = "blue";
    ctx.fillRect(1, 0, 1, 1);
    const texture = gpu.texture(art),
      asset = { texture, width: 2, height: 1 },
      node = { x: 0, y: 0, width: 128, height: 128 };
    const draw = (n, mask, flake) => {
      gpu.begin(128, 128);
      gpu.draw(
        { ...node, ...n },
        asset,
        [1, 0, 0, 1, 0, 0],
        [0, 0, 128, 128],
        mask,
        flake,
      );
      const pixels = new Uint8Array(128 * 128 * 4);
      gpu.gl.readPixels(
        0,
        0,
        128,
        128,
        gpu.gl.RGBA,
        gpu.gl.UNSIGNED_BYTE,
        pixels,
      );
      return (x, y) => [
        ...pixels.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4),
      ];
    };
    const nearest = draw({ sampling: "nearest" })(60, 64),
      linear = draw({ sampling: "linear" })(60, 64);
    results.push(
      check(
        nearest[0] > 250 && nearest[2] < 5 && linear[0] > 80 && linear[2] > 80,
        "per-layer nearest and linear sampling",
        { nearest, linear },
      ),
    );
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = 2;
    maskCanvas.height = 1;
    maskCanvas.getContext("2d").fillRect(0, 0, 1, 1);
    const mask = { texture: gpu.texture(maskCanvas) };
    const normal = draw({ mask: { asset: "mask" } }, mask)(20, 64),
      inverse = draw({ mask: { asset: "mask", invert: true } }, mask)(20, 64);
    results.push(
      check(normal[3] > 240 && inverse[3] < 15, "alpha-mask inversion", {
        normal,
        inverse,
      }),
    );
    const cropped = draw({
      rect: [1, 0, 1, 1],
      mask: {
        polygon: [
          [0, 0],
          [0.5, 0],
          [0.5, 1],
          [0, 1],
        ],
      },
    });
    results.push(
      check(
        cropped(20, 64)[3] > 240 && cropped(100, 64)[3] < 15,
        "polygon mask stays in local coordinates after atlas crop",
      ),
    );
    gpu.begin(128, 128);
    gpu.background("#00ff00", [1, 0, 0, 1, 0, 0], [0, 0, 128, 128], 128, 128);
    const green = new Uint8Array(4);
    gpu.gl.readPixels(64, 64, 1, 1, gpu.gl.RGBA, gpu.gl.UNSIGNED_BYTE, green);
    results.push(
      check(
        green[1] === 255 && green[0] === 0,
        "scene background draws inside card viewport",
        [...green],
      ),
    );
    const flakeCanvas = document.createElement("canvas");
    flakeCanvas.width = flakeCanvas.height = 1;
    const fc = flakeCanvas.getContext("2d");
    fc.fillStyle = "#00ff00";
    fc.fillRect(0, 0, 1, 1);
    const flakeTexture = gpu.texture(flakeCanvas),
      flakeAsset = { texture: flakeTexture, width: 1, height: 1 };
    const mat = {
      kind: "glitter",
      size: 12,
      density: 1,
      intensity: 2,
      roughness: 1,
      angle: 0.5,
      color: "#ff0000",
    };
    const tinted = draw(
      { material: { ...mat, flakeColor: "holo" } },
      undefined,
      flakeAsset,
    );
    const textured = draw(
      { material: { ...mat, flakeColor: "texture" } },
      undefined,
      flakeAsset,
    );
    let gain = 0;
    for (let y = 0; y < 128; y += 4)
      for (let x = 0; x < 128; x += 4)
        gain += textured(x, y)[1] - tinted(x, y)[1];
    results.push(
      check(
        gain > 1000,
        "custom flake artwork contributes its own color to GPU glitter",
        { greenGain: gain },
      ),
    );
    gpu.release(flakeTexture);
    gpu.dispose();
    // A real 1,000-card DOM gallery must not resolve all packages on connect.
    let loads = 0,
      live = 0,
      peak = 0;
    const render = createCardRenderer({
      preloadMargin: "0px",
      resolve: async () => {
        loads++;
        live++;
        peak = Math.max(peak, live);
        return {
          manifest: { faces: { front: { poster: "x", description: "card" } } },
          asset: async () => ({
            url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
          }),
          dispose() {
            live--;
          },
        };
      },
    });
    const gallery = document.createElement("div");
    gallery.style.cssText =
      "display:grid;grid-template-columns:repeat(5,100px);gap:10px";
    document.body.append(gallery);
    const copy = {
      definition: {
        name: "Card",
        presentation: {
          contract: "digital-card@0.1",
          digest: "sha256:" + "0".repeat(64),
          baseURL: "https://example.invalid/card/",
        },
      },
    };
    for (let i = 0; i < 1000; i++) gallery.append(render(copy));
    await settle();
    const initialLoads = loads;
    window.scrollTo(0, document.body.scrollHeight);
    await settle();
    const endLoads = loads;
    results.push(
      check(
        initialLoads < 60 && endLoads < 100 && live < 60,
        "1000-card album only loads viewport posters",
        { initialLoads, endLoads, peak, live },
      ),
    );
    for (const n of gallery.children) n.dispose();
    gallery.remove();
    await settle();
    results.push(
      check(live === 0, "gallery disposal releases all resolvers", { live }),
    );
    window.scrollTo(0, 0);
    // Document visibility changes cannot override a host-hidden program.
    const program = mountProgram(root, {
      programId: "test",
      registry: new Map([
        [
          "test",
          { approved: true, version: "1", url: "http://127.0.0.1:1/program" },
        ],
      ]),
    });
    program.setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    results.push(
      check(
        !root.querySelector("iframe"),
        "host-hidden program stays suspended after visibility event",
      ),
    );
    program.dispose();
    const { importLayeredFile } =
      await import("/src/presentation/layered-import.js");
    const { browserResolver } = await import("/src/presentation/package.js");
    const gif = new File(
      [await (await fetch("/synthetic.gif")).arrayBuffer()],
      "test.gif",
      { type: "image/gif" },
    );
    const converted = await importLayeredFile(gif, { workerURL: "/worker.js" });
    const animated = await converted.build();
    const gr = browserResolver(animated),
      gs = createPlayerStage({ root });
    const gv = gs.mount(root, { resolver: gr });
    const ready = await gv.ready;
    const hashes = [];
    for (const x of [-1, 0, 1]) {
      gv.setInputs({ tilt: { x, y: 0 } });
      await settle();
      hashes.push(
        await (
          await gv.snapshot()
        )
          .arrayBuffer()
          .then((b) => crypto.subtle.digest("SHA-256", b))
          .then((b) => [...new Uint8Array(b)].join(",")),
      );
    }
    results.push(
      check(
        ready.mode === "interactive" &&
          hashes[0] !== hashes[1] &&
          hashes[0] === hashes[2],
        "worker GIF transparency/disposal survives angle-driven GPU rendering",
      ),
    );
    const idleFrames = gs.diagnostics().frames;
    await settle();
    results.push(
      check(
        gs.diagnostics().frames === idleFrames,
        "angle-driven GIF has no idle animation loop",
      ),
    );
    gv.dispose();
    gs.dispose();
    gr.dispose();
    const { mountAssembly } = await import("/src/presentation/integration.js");
    const ar = await directoryResolver("/card/");
    const ref = {
      contract: "digital-card@0.1",
      digest: ar.digest,
      baseURL: "/card/",
    };
    ar.dispose();
    const as = createPlayerStage({ root });
    const assembly = await mountAssembly({
      stage: as,
      root,
      interaction: { rotate: true },
      descriptor: {
        version: 1,
        members: [
          {
            id: "left",
            presentation: ref,
            bounds: [0, 0, 50, 100],
            motion: { syncGroup: "pair" },
          },
          {
            id: "right",
            presentation: ref,
            bounds: [50, 0, 50, 100],
            motion: {
              syncGroup: "pair",
              limits: { x: [-0.25, 0.25], y: [-0.5, 0.5] },
            },
          },
        ],
      },
    });
    await Promise.all(assembly.views.map((v) => v.ready));
    const left = root.querySelector('[data-member="left"]');
    left.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    assembly.setMemberInputs("left", { tilt: { x: 1, y: 1 } });
    results.push(
      check(
        assembly.snapshot().left.tilt.x === 1 &&
          assembly.snapshot().right.tilt.x === 0.25 &&
          root
            .querySelector('[data-member="right"]')
            .style.transform.includes("3deg"),
        "assembly mounts independently owned cards with bounded synchronized rotation",
      ),
    );
    assembly.dispose();
    as.dispose();
    results.push(
      check(
        !root.querySelector("[data-member]") && as.diagnostics().textures === 0,
        "assembly disposal releases slots and GPU resources",
      ),
    );
    const { starFieldAdapter } =
      await import("/examples/custom-card-effects.js");
    const mr = await directoryResolver("/card/");
    mr.manifest.capabilities.optional = [
      { id: "example.stars@0.1", fallback: "omit-decorative" },
    ];
    mr.scenes
      .get("scenes/front.json")
      .nodes.push({
        id: "mod-stars",
        type: "adapter",
        adapter: "example.stars",
        width: 1000,
        height: 1500,
        data: { count: 20 },
      });
    const ms = createPlayerStage({ root, adapters: [starFieldAdapter()] });
    const mv = ms.mount(root, { resolver: mr });
    const modReady = await mv.ready;
    mv.setInputs({ tilt: { x: 0.7, y: 0 } });
    await settle();
    results.push(
      check(
        modReady.mode === "interactive",
        "host-installed custom effect executes through public adapter API",
      ),
    );
    mv.dispose();
    ms.dispose();
    mr.dispose();
    results.push(
      check(
        ms.diagnostics().estimatedGpuBytes === 0,
        "custom effect disposal releases its resources",
      ),
    );
    return results;
  }, { crossOrigin: `http://127.0.0.1:${crossServer.address().port}/` });
  checks.push(...result);
  assert.ok(crossRequests.length >= 4);
  assert.ok(
    crossRequests.every((request) => request.cookie === null),
    JSON.stringify(crossRequests.map(({ path, cookie }) => ({
      path, cookieLength: cookie?.length ?? null,
    }))),
  );
  checks.push({ name: "cross-origin metadata and artwork receive no session cookies", passed: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ browser: browser.version(), engine, checks }, null, 2),
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, `audit-browser-${engine}.json`),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        engine,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, `audit-browser-${engine}.json`),
    JSON.stringify(
      { engine, checks, errors: [...errors, error.message], passed: false },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  crossServer.closeAllConnections();
  await new Promise((r) => crossServer.close(r));
}
