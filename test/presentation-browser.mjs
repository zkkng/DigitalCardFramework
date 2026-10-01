import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const [
  playwrightPath,
  url = "http://127.0.0.1:4173/portable.html",
  output = "../PortableCardQA",
] = process.argv.slice(2);
if (!playwrightPath)
  throw new Error(
    "Supply installed Playwright module path, preview URL and output folder",
  );
const { chromium } = await import(
  pathToFileURL(path.resolve(playwrightPath)).href
);
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
}
await mkdir(output, { recursive: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  if (m.type() === "warning") console.log("Browser warning:", m.text());
});
try {
  await page.goto(url);
  await page.waitForFunction(() => window.portableCards?.ready, {
    timeout: 60000,
  });
  await page.waitForTimeout(150);
  const base = await page.evaluate(() =>
    window.portableCards.stage.diagnostics(),
  );
  console.log("Initial renderer:", JSON.stringify(base));
  await page.screenshot({ path: path.join(output, "initial.png") });
  assert.equal(base.activeViews, 2, "Both cards must render");
  await page.screenshot({
    path: path.join(output, "migrated-neutral.png"),
    fullPage: true,
  });
  for (const [name, x] of [
    ["left", -0.9],
    ["right", 0.9],
  ]) {
    await page.evaluate((x) => window.portableCards.turn(x, 0), x);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(output, `migrated-${name}.png`) });
  }
  const settled = await page.evaluate(
    () => window.portableCards.stage.diagnostics().frames,
  );
  await page.waitForTimeout(350);
  assert.equal(
    await page.evaluate(() => window.portableCards.stage.diagnostics().frames),
    settled,
    "Input-only cards must settle idle",
  );
  const lifecycle = await page.evaluate(async () => {
    const { stage, resolvers } = window.portableCards,
      root = document.getElementById("panorama"),
      slot = document.createElement("div");
    Object.assign(slot.style, {
      position: "absolute",
      width: "200px",
      height: "300px",
      left: "0",
      top: "0",
    });
    root.append(slot);
    const before = stage.diagnostics();
    for (let i = 0; i < 100; i++) {
      const v = stage.mount(slot, {
        resolver: resolvers[0],
        title: "Lifecycle probe",
      });
      await v.ready;
      v.setInputs({ tilt: { x: 0.5, y: 0.2 } });
      v.dispose();
    }
    for (let i = 0; i < 10; i++) {
      const v = stage.mount(slot, {
        resolver: resolvers[0],
        title: "Aborted probe",
      });
      v.dispose();
      await v.ready;
    }
    slot.remove();
    await new Promise((r) => setTimeout(r, 100));
    return { before, after: stage.diagnostics() };
  });
  assert.equal(lifecycle.after.views, lifecycle.before.views);
  assert.equal(
    lifecycle.after.assetReferences,
    lifecycle.before.assetReferences,
  );
  assert.equal(lifecycle.after.textures, lifecycle.before.textures);
  assert.equal(lifecycle.after.requestedVideoDecoders, 0);
  const timing = await page.evaluate(async () => {
    const intervals = [];
    let last = performance.now();
    for (let i = 0; i < 180; i++) {
      window.portableCards.turn(Math.sin(i * 0.09), Math.cos(i * 0.07) * 0.2);
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      intervals.push(now - last);
      last = now;
    }
    intervals.sort((a, b) => a - b);
    return {
      samples: intervals.length,
      p50: intervals[90],
      p95: intervals[171],
      p99: intervals[178],
    };
  });
  assert.deepEqual(errors, [], "Browser errors");
  const result = {
    url,
    browser: browser.version(),
    base,
    lifecycle,
    timing,
    errors,
    note: "Desktop automation; not a physical iPhone performance result.",
  };
  await writeFile(
    path.join(output, "browser-report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
