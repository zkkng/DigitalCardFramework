import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const [
    playwrightPath,
    url = "http://127.0.0.1:4173/portable.html",
    out = "../PortableCardQA",
  ] = process.argv.slice(2),
  { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href),
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.waitForFunction(() => window.portableCards?.ready);
  await page.waitForTimeout(100);
  const baseline = await page.evaluate(() => portableCards.stage.diagnostics());
  assert.equal(baseline.activeViews, 2);
  assert.ok(baseline.estimatedGpuBytes < 96 * 1024 * 1024);
  await page.screenshot({
    path: path.join(out, "mobile-emulation.png"),
    fullPage: true,
  });
  const trace = await page.evaluate(async () => {
    const intervals = [];
    let previous = performance.now();
    const started = performance.now();
    for (let i = 0; performance.now() - started < 60000; i++) {
      portableCards.turn(Math.sin(i * 0.04), Math.cos(i * 0.03) * 0.4);
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
    }
    const summarize = (a) => {
      a.sort((a, b) => a - b);
      return {
        p50: a[Math.floor(a.length * 0.5)],
        p95: a[Math.floor(a.length * 0.95)],
        p99: a[Math.floor(a.length * 0.99)],
      };
    };
    return {
      elapsedMs: performance.now() - started,
      frames: intervals.length,
      first: summarize(intervals.slice(0, 300)),
      last: summarize(intervals.slice(-300)),
      resources: portableCards.stage.diagnostics(),
    };
  });
  assert.equal(trace.resources.textures, baseline.textures);
  assert.equal(trace.resources.assetReferences, baseline.assetReferences);
  await page.evaluate(() => {
    window.loss = document
      .querySelector("#panorama > canvas")
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context");
    loss.loseContext();
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => portableCards.stage.diagnostics().activeViews),
    0,
  );
  await page.evaluate(() => loss.restoreContext());
  await page.waitForFunction(
    () => portableCards.stage.diagnostics().activeViews === 2,
  );
  assert.equal(
    await page.evaluate(() => portableCards.stage.diagnostics().textures),
    baseline.textures,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const before = await page.evaluate(
    () => portableCards.stage.diagnostics().frames,
  );
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => portableCards.stage.diagnostics().frames),
    before,
  );
  const races = await page.evaluate(async () => {
    const { createPlayerStage } = await import("/player/player.js"),
      { browserResolver, buildPackage } = await import("/player/package.js"),
      { blankPackage } = await import("/player/project.js");
    const root = document.createElement("div");
    Object.assign(root.style, {
      width: "200px",
      height: "300px",
      position: "relative",
    });
    document.body.append(root);
    const base = await blankPackage(),
      scene = {
        dialect: "dc.scene2d@0.1",
        nodes: [
          {
            id: "custom",
            type: "adapter",
            adapter: "test.effect",
            x: 0,
            y: 0,
            width: 1000,
            height: 1500,
            data: {},
          },
        ],
      },
      pkg = await buildPackage(
        base.manifest,
        new Map([
          ["scenes/front.json", scene],
          ["scenes/back.json", base.scenes.get("scenes/back.json")],
        ]),
        new Map(
          base.manifest.assets.map((a) => [a.path, base.files.get(a.path)]),
        ),
      ),
      resolver = browserResolver(pkg);
    let created = 0,
      disposed = 0;
    const stage = createPlayerStage({
      root,
      adapters: [
        {
          id: "test.effect",
          estimate: () => 65536,
          async create() {
            created++;
            await new Promise((r) => setTimeout(r, 30));
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 64;
            return {
              canvas,
              update: () => ({ needsTime: false }),
              render() {},
              dispose() {
                disposed++;
                canvas.width = canvas.height = 0;
              },
            };
          },
        },
      ],
    });
    const view = stage.mount(root, { resolver });
    await new Promise((r) => setTimeout(r, 10));
    view.dispose();
    await view.ready;
    await new Promise((r) => setTimeout(r, 50));
    const result = { created, disposed, diagnostics: stage.diagnostics() };
    stage.dispose();
    resolver.dispose();
    root.remove();
    return result;
  });
  assert.equal(races.created, races.disposed);
  assert.equal(races.diagnostics.textures, 0);
  assert.equal(races.diagnostics.assetReferences, 0);
  assert.deepEqual(errors, []);
  const report = {
    browser: browser.version(),
    profile: "390x844, DPR3, touch emulation; not physical iPhone evidence",
    baseline,
    trace,
    contextRecovery: true,
    reducedMotion: true,
    races,
    errors,
  };
  await writeFile(
    path.join(out, "resilience-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
