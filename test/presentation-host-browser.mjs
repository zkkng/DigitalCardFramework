import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const [
  playwrightPath,
  base = "http://127.0.0.1:4173",
  out = "../PortableCardQA",
] = process.argv.slice(2);
const { chromium } = await import(
    pathToFileURL(path.resolve(playwrightPath)).href
  ),
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base + "/library.html");
  await page.waitForFunction(
    () => document.querySelectorAll("dc-portable-card img").length === 2,
  );
  await page.locator("dc-portable-card").first().click();
  await page.waitForFunction(() => document.querySelector("#viewer canvas"));
  await page.getByRole("button", { name: "Flip card", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await page.locator("#viewer canvas").count(), 0);
  const flat = await page.evaluate(async () => {
    const { createAuthoring } = await import("/player/authoring.js"),
      { browserResolver } = await import("/player/package.js"),
      { createPlayerStage } = await import("/player/player.js");
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
  });
  assert.equal(flat.ready.mode, "interactive");
  assert(flat.different);
  assert.equal(flat.resources.textures, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "host-report.json"),
    JSON.stringify({ library: "passed", flatJpg: flat, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ library: "passed", flatJpg: flat, errors }, null, 2),
  );
} finally {
  await browser.close();
}
