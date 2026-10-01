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
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://test").pathname,
    );
    if (pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><title>Framework audit</title><style>body{margin:0}#root{width:240px;height:360px;position:relative}</style><div id="root"></div>',
      );
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
    const data = pathname.startsWith("/card/")
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
let browser;
const checks = [],
  errors = [];
try {
  try {
    browser = await pw[engine].launch({ headless: true });
  } catch (error) {
    if (engine !== "chromium") throw error;
    browser = await pw.chromium.launch({ headless: true, channel: "msedge" });
  }
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
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
    const stage = createPlayerStage({ root });
    let view = stage.mount(root, { resolver });
    await view.ready;
    await settle();
    results.push(
      check(
        stage.diagnostics().activeViews === 1,
        "initial synthetic activation",
        stage.diagnostics(),
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
    optional.scenes
      .get("scenes/front.json")
      .nodes.push({
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
    const draw = (n, mask) => {
      gpu.begin(128, 128);
      gpu.draw(
        { ...node, ...n },
        asset,
        [1, 0, 0, 1, 0, 0],
        [0, 0, 128, 128],
        mask,
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
    return results;
  });
  checks.push(...result);
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
}
