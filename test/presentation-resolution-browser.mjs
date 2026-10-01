import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import * as pw from "playwright";
import { fixture, build, pngRGBA } from "./presentation-fixtures.mjs";
const f = fixture(),
  size = 1024,
  pixels = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4,
      v = Math.floor(x / 2) % 2 ? 255 : 0;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
    pixels[i + 3] = 255;
  }
const png = pngRGBA(size, size, pixels);
for (const a of f.manifest.assets) {
  a.width = a.height = size;
  f.assets.set(a.path, png);
}
f.manifest.canvas = { width: 1024, height: 1024 };
f.manifest.quality.standard = { maxEdge: 1536 };
for (const s of f.scenes.values()) {
  Object.assign(s.nodes[0], { width: 1024, height: 1024 });
  delete s.nodes[0].bindings;
}
const pkg = await build(f),
  base = fileURLToPath(new URL("../", import.meta.url)),
  engine = process.env.BROWSER_ENGINE ?? "chromium";
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (name === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{width:240px;height:240px}</style><div id="root"></div>',
      );
      return;
    }
    const file = path.resolve(base, "." + name);
    if (!file.startsWith(base)) throw Error();
    const bytes = name.startsWith("/card/")
      ? pkg.files.get(name.slice(6))
      : await readFile(file);
    res.setHeader(
      "content-type",
      name.endsWith(".js")
        ? "text/javascript"
        : name.endsWith(".json")
          ? "application/json"
          : "image/png",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  try {
    browser = await pw[engine].launch({ headless: true });
  } catch (e) {
    if (engine !== "chromium" || process.platform !== "win32") throw e;
    browser = await pw.chromium.launch({ headless: true, channel: "msedge" });
  }
  const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      ...(engine === "firefox" ? {} : { isMobile: true }),
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.evaluate(async () => {
    const { createPlayerStage } = await import("/src/presentation/player.js"),
      { directoryResolver } = await import("/src/presentation/resolver.js");
    window.resolver = await directoryResolver("/card/");
    window.renderDiagnostics = [];
    window.stage = createPlayerStage({
      root: document.querySelector("#root"),
      onDiagnostic: (e) => renderDiagnostics.push(e),
    });
    window.view = stage.mount(document.querySelector("#root"), { resolver });
    await view.ready;
  });
  await page.waitForFunction(
    () => stage.diagnostics().resolution?.width === 720,
  );
  const normal = await page.evaluate(() => stage.diagnostics());
  assert.equal(normal.textureBytes, 1024 * 1024 * 4);
  // A DOM scale is a host policy, not inferred from perspective bounds on every frame.
  await page.evaluate(() => stage.setBudget({ renderScale: 2 }));
  await page.waitForFunction(
    () => stage.diagnostics().resolution?.width === 1440,
  );
  await page.evaluate(() => stage.setBudget({ renderScale: 1 }));
  let zoom = null;
  if (engine === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 3 });
    await page.waitForFunction(
      () => stage.diagnostics().resolution?.width === 2160,
    );
    zoom = await page.evaluate(() => stage.diagnostics());
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await page.waitForFunction(
      () => stage.diagnostics().resolution?.width === 720,
    );
  }
  await page.evaluate(() => stage.setBudget({ maxCanvasPixels: 90000 }));
  await page.waitForFunction(
    () => stage.diagnostics().resolution?.width === 300,
  );
  assert.equal(
    await page.evaluate(() => stage.diagnostics().resolution.limited),
    true,
  );
  await page.evaluate(() => stage.setBudget({ maxCanvasPixels: 8388608 }));
  await page.waitForFunction(
    () => stage.diagnostics().resolution?.width === 720,
  );
  await page.evaluate(() =>
    stage.setBudget({ estimatedGpuBytes: 2 * 1024 * 1024 }),
  );
  await page.waitForFunction(() => stage.diagnostics().activeViews === 0);
  await page.evaluate(() =>
    stage.setBudget({ estimatedGpuBytes: 96 * 1024 * 1024 }),
  );
  await page.waitForFunction(
    () =>
      stage.diagnostics().activeViews === 1 &&
      stage.diagnostics().resolution?.width === 720,
  );
  assert.equal(
    await page.evaluate(() => stage.diagnostics().textureBytes),
    1024 * 1024 * 4,
  );
  await page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
    let clock = 100000;
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => (clock += 30),
    });
    try {
      for (let i = 0; i < 100; i++) {
        view.setInputs({ tilt: { x: i % 2 ? 0.1 : 0, y: 0 } });
        await new Promise(requestAnimationFrame);
      }
    } finally {
      if (descriptor) Object.defineProperty(performance, "now", descriptor);
      else delete performance.now;
    }
  });
  assert.equal(await page.evaluate(() => stage.diagnostics().limits.maxDpr), 3);
  assert.equal(
    await page.evaluate(() => stage.diagnostics().resolution.width),
    720,
  );
  assert(
    await page.evaluate(() =>
      renderDiagnostics.some((e) => e.type === "renderCost"),
    ),
  );
  const contrast = await page.evaluate(async () => {
    const blob = await view.snapshot(),
      image = await createImageBitmap(blob),
      c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d").drawImage(image, 0, 0);
    const row = c.getContext("2d").getImageData(40, 360, 640, 1).data;
    let low = 0,
      high = 0;
    for (let i = 0; i < row.length; i += 4) {
      if (row[i] < 40) low++;
      if (row[i] > 215) high++;
    }
    image.close();
    return { low, high };
  });
  assert(contrast.low > 100 && contrast.high > 100, JSON.stringify(contrast));
  await page.evaluate(() => {
    document.querySelector("#root").style.width = "177px";
    stage.invalidateLayout();
  });
  await page.waitForFunction(
    () => stage.diagnostics().resolution?.width === 531,
  );
  await page.waitForTimeout(100);
  await page.waitForFunction(() => stage.diagnostics().scheduledFrames === 0);
  const idle = await page.evaluate(() => stage.diagnostics().frames);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => stage.diagnostics().frames), idle);
  await page.evaluate(() => {
    view.dispose();
    stage.dispose();
    resolver.dispose();
    dispatchEvent(new Event("resize"));
  });
  assert.equal(await page.locator("canvas").count(), 0);
  assert.deepEqual(errors, []);
  const output = path.resolve(
    process.argv[2] ?? "../PortableCardQA/resolution",
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, engine + ".json"),
    JSON.stringify({ engine, normal, zoom, contrast, errors }, null, 2),
  );
  console.log(
    engine +
      ": density, texture detail, zoom, bounds/recovery, resize, contrast and disposal passed",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
