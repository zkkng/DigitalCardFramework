import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { sourceFixtures } from "./presentation-layered-fixtures.mjs";
const [
    playwrightPath,
    url = "http://127.0.0.1:4173/studio.html",
    out = "../PortableCardQA",
  ] = process.argv.slice(2),
  { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href),
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }),
  errors = [],
  reports = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.waitForFunction(() => window.cardStudio?.getProject());
  for (const [ext, bytes] of Object.entries(sourceFixtures())) {
    const upload = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import layered artwork", exact: true })
      .click();
    await (
      await upload
    ).setFiles({
      name: "fixture." + ext,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(bytes),
    });
    await page
      .getByText("Imported 2 layers in their original positions.", {
        exact: false,
      })
      .waitFor({ timeout: 30000 });
    const result = await page.evaluate(() => {
      const p = cardStudio.getProject();
      return {
        canvas: p.manifest.canvas,
        nodes: p.scenes
          .get("scenes/front.json")
          .nodes.map((n) => ({
            name: n.name,
            x: n.x,
            y: n.y,
            opacity: n.opacity,
          })),
      };
    });
    assert.deepEqual(result.canvas, { width: 6, height: 8 });
    assert.equal(result.nodes[0].name, "Background");
    assert.equal(result.nodes[1].x, 3);
    assert.equal(result.nodes[1].y, 4);
    reports.push({ format: ext, ...result });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "layered-import-report.json"),
    JSON.stringify({ reports, errors }, null, 2),
  );
  console.log(JSON.stringify({ reports, errors }, null, 2));
} catch (error) {
  console.log((await page.locator("body").innerText()).slice(-4000), errors);
  throw error;
} finally {
  await browser.close();
}
