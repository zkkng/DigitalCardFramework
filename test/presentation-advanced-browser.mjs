import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const [
    playwrightPath,
    url = "http://127.0.0.1:4173/portable.html",
    out = "../PortableCardQA",
  ] = process.argv.slice(2),
  { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href),
  browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.waitForFunction(() => window.portableCards?.ready);
  const rive = Buffer.from(await readFile(path.join(out, "ball.riv"))).toString(
    "base64",
  );
  const result = await page.evaluate(async (rive) => {
    const { createPlayerStage } = await import("/player/player.js"),
      { buildPackage, browserResolver, writeZip } =
        await import("/player/package.js"),
      { blankPackage } = await import("/player/project.js"),
      { gltfAdapter, riveAdapter, dotLottieAdapter } =
        await import("/player/adapters-bundle.js");
    window.portableCards.stage.dispose();
    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "relative",
      width: "300px",
      height: "450px",
    });
    document.body.prepend(root);
    const base = await blankPackage();
    base.manifest.quality.lite.maxEdge = 512;
    const encode = (o) => new TextEncoder().encode(JSON.stringify(o));
    const geometry = new Float32Array([-0.8, -0.7, 0, 0.8, -0.7, 0, 0, 0.8, 0]),
      json = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
        ],
        materials: [
          {
            doubleSided: true,
            pbrMetallicRoughness: {
              baseColorFactor: [1, 0.2, 0.4, 1],
              metallicFactor: 0,
              roughnessFactor: 0.5,
            },
          },
        ],
        buffers: [{ byteLength: geometry.byteLength }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: geometry.byteLength },
        ],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [-0.8, -0.7, 0],
            max: [0.8, 0.8, 0],
          },
        ],
      };
    const j = encode(json),
      padded = new Uint8Array(Math.ceil(j.length / 4) * 4);
    padded.fill(32);
    padded.set(j);
    const glb = new Uint8Array(28 + padded.length + geometry.byteLength),
      v = new DataView(glb.buffer);
    v.setUint32(0, 0x46546c67, true);
    v.setUint32(4, 2, true);
    v.setUint32(8, glb.length, true);
    v.setUint32(12, padded.length, true);
    v.setUint32(16, 0x4e4f534a, true);
    glb.set(padded, 20);
    v.setUint32(20 + padded.length, geometry.byteLength, true);
    v.setUint32(24 + padded.length, 0x004e4942, true);
    glb.set(new Uint8Array(geometry.buffer), 28 + padded.length);
    const lottie = {
      v: "5.7.0",
      fr: 30,
      ip: 0,
      op: 60,
      w: 300,
      h: 450,
      nm: "Synthetic circle",
      ddd: 0,
      assets: [],
      layers: [
        {
          ddd: 0,
          ind: 1,
          ty: 4,
          nm: "Circle",
          sr: 1,
          ks: {
            o: { a: 0, k: 100 },
            r: { a: 0, k: 0 },
            p: { a: 0, k: [150, 225, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
          },
          shapes: [
            {
              ty: "el",
              p: { a: 0, k: [0, 0] },
              s: { a: 0, k: [160, 160] },
              nm: "Circle",
            },
            {
              ty: "fl",
              c: { a: 0, k: [0.1, 0.8, 0.7, 1] },
              o: { a: 0, k: 100 },
              r: 1,
            },
          ],
          ip: 0,
          op: 60,
          st: 0,
          bm: 0,
        },
      ],
    };
    const dot = writeZip(
      new Map([
        [
          "manifest.json",
          encode({ version: "2", animations: [{ id: "main" }] }),
        ],
        ["a/main.json", encode(lottie)],
      ]),
    );
    const reports = [];
    async function probe(name, bytes, type, adapterFactory, data = {}) {
      const manifest = structuredClone(base.manifest),
        assets = new Map(
          base.manifest.assets.map((a) => [a.path, base.files.get(a.path)]),
        );
      manifest.assets.push({
        id: "extra",
        path: "assets/extra.bin",
        mediaType: type,
        sha256: "0".repeat(64),
        bytes: bytes.length,
        role: "interactive",
      });
      assets.set("assets/extra.bin", bytes);
      const scene = {
          dialect: "dc.scene2d@0.1",
          nodes: [
            {
              id: "effect",
              type: "adapter",
              adapter: name,
              x: 0,
              y: 0,
              width: 1000,
              height: 1500,
              data: { asset: "extra", ...data },
            },
          ],
        },
        pkg = await buildPackage(
          manifest,
          new Map([
            ["scenes/front.json", scene],
            ["scenes/back.json", base.scenes.get("scenes/back.json")],
          ]),
          assets,
        ),
        resolver = browserResolver(pkg),
        stage = createPlayerStage({
          root,
          adapters: [adapterFactory(pkg.digest)],
          budget: { estimatedGpuBytes: 96 * 1024 * 1024 },
        }),
        view = stage.mount(root, { resolver });
      const ready = await view.ready;
      if (ready.mode !== "interactive")
        throw new Error(name + ": " + JSON.stringify(ready));
      view.setInputs({ tilt: { x: 0.7, y: 0.2 } });
      await new Promise((r) => setTimeout(r, 150));
      const snapshot = await view.snapshot(),
        image = await createImageBitmap(snapshot),
        canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 20) painted++;
      image.close();
      if (painted < 100) throw new Error(name + " did not paint");
      const frames = stage.diagnostics().frames;
      await new Promise((r) => setTimeout(r, 100));
      const idle = stage.diagnostics().frames === frames;
      view.dispose();
      const after = stage.diagnostics();
      stage.dispose();
      resolver.dispose();
      reports.push({ name, painted, idle, after });
    }
    await probe("dc.gltf", glb, "model/gltf-binary", () => gltfAdapter());
    await probe("dc.dotlottie", dot, "application/zip", () =>
      dotLottieAdapter({ wasmURL: "/player/wasm/dotlottie.wasm" }),
    );
    await probe(
      "dc.rive",
      Uint8Array.from(atob(rive), (c) => c.charCodeAt(0)),
      "application/x-rive",
      (digest) =>
        riveAdapter({
          wasmURL: "/player/wasm/rive.wasm",
          approvedDigests: [digest],
        }),
    );
    // Generate a real browser-encoded video; no binary test art is stored in Git.
    const videoCanvas = document.createElement("canvas");
    videoCanvas.width = 64;
    videoCanvas.height = 64;
    const stream = videoCanvas.captureStream(12),
      chunks = [],
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    for (let i = 0; i < 6; i++) {
      const ctx = videoCanvas.getContext("2d");
      ctx.fillStyle = i % 2 ? "#eeaa33" : "#3366cc";
      ctx.fillRect(0, 0, 64, 64);
      await new Promise((r) => setTimeout(r, 90));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    const bytes = new Uint8Array(
        await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
      ),
      manifest = structuredClone(base.manifest),
      assets = new Map(
        base.manifest.assets.map((a) => [a.path, base.files.get(a.path)]),
      );
    manifest.assets.push({
      id: "clip",
      path: "assets/clip.webm",
      mediaType: "video/webm",
      sha256: "0".repeat(64),
      bytes: bytes.length,
      role: "back-video",
      width: 64,
      height: 64,
    });
    assets.set("assets/clip.webm", bytes);
    const scenes = structuredClone(base.scenes);
    scenes.get("scenes/back.json").nodes = [
      {
        id: "clip",
        type: "video",
        asset: "clip",
        x: 0,
        y: 0,
        width: 1000,
        height: 1500,
        video: {
          mode: "autoplay-muted",
          muted: true,
          loop: true,
          poster: "back",
        },
      },
    ];
    const pkg = await buildPackage(manifest, scenes, assets),
      resolver = browserResolver(pkg),
      stage = createPlayerStage({ root }),
      view = stage.mount(root, { resolver }, { side: "back" });
    await view.ready;
    await new Promise((r) => setTimeout(r, 400));
    const playing = stage.diagnostics();
    view.setVisibility("hidden");
    await new Promise((r) => setTimeout(r, 100));
    const paused = stage.diagnostics();
    view.dispose();
    const released = stage.diagnostics();
    stage.dispose();
    resolver.dispose();
    root.remove();
    return { reports, video: { playing, paused, released } };
  }, rive);
  for (const report of result.reports) {
    assert.equal(report.idle, true);
    assert.equal(report.after.textures, 0);
    assert.equal(report.after.assetReferences, 0);
  }
  assert.equal(result.video.playing.requestedVideoDecoders, 1);
  assert.equal(result.video.paused.requestedVideoDecoders, 0);
  assert.equal(result.video.released.textures, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "advanced-report.json"),
    JSON.stringify({ browser: browser.version(), ...result, errors }, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
