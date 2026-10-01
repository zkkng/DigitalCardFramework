import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { importPackage } from "../src/presentation/package.js";
const [
  playwrightPath,
  url = "http://127.0.0.1:4173/studio.html",
  output = "../PortableCardQA",
] = process.argv.slice(2);
const { chromium } = await import(
  pathToFileURL(path.resolve(playwrightPath)).href
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir(output, { recursive: true });
try {
  await page.goto(url);
  await page.waitForFunction(() => window.cardStudio?.getProject());
  await page.getByRole("button", { name: "petal-0", exact: true }).waitFor();
  await page.getByRole("button", { name: "petal-0", exact: true }).click();
  await page.getByLabel("Finish", { exact: true }).selectOption("Chunky holo");
  await page.getByLabel("Flake size", { exact: true }).fill("18");
  await page.getByLabel("Flake size", { exact: true }).blur();
  assert.equal(
    await page.evaluate(
      () =>
        window.cardStudio
          .getProject()
          .scenes.get("scenes/front.json")
          .nodes.find((n) => n.id === "petal-0").material.size,
    ),
    18,
  );
  await page
    .getByRole("button", { name: "Paint effect area", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Paint effect area" }).waitFor();
  const mask = page.locator(".dcs-mask"),
    box = await mask.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, {
    steps: 10,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "Apply painted mask" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(
    () =>
      !!window.cardStudio
        .getProject()
        .scenes.get("scenes/front.json")
        .nodes.find((n) => n.id === "petal-0").material.maskAsset,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByText("Draft saved on this device.", { exact: true })
    .waitFor();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export .dcard", exact: true })
    .click();
  const download = await pending,
    target = path.join(output, "studio-export.dcard");
  await download.saveAs(target);
  const checked = await importPackage(new Uint8Array(await readFile(target)));
  const petal = checked.scenes
    .get("scenes/front.json")
    .nodes.find((n) => n.id === "petal-0");
  assert.equal(petal.material.size, 18);
  assert(petal.material.maskAsset);
  assert(
    checked.manifest.assets.some((a) => a.id === petal.material.maskAsset),
  );
  await page.screenshot({
    path: path.join(output, "studio.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "New card", exact: true }).click();
  await page.getByText(/Untitled card ·/).waitFor();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await page.getByRole("button", { name: "petal-0", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.cardStudio
          .getProject()
          .scenes.get("scenes/front.json")
          .nodes.find((n) => n.id === "petal-0").material.size,
    ),
    18,
  );
  assert.deepEqual(errors, []);
  const result = {
    editor: "passed",
    mask: "painted and exported",
    draft: "saved and restored",
    digest: checked.digest,
    assets: checked.manifest.assets.length,
    errors,
  };
  await writeFile(
    path.join(output, "studio-report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({
    path: path.join(output, "studio-failure.png"),
    fullPage: true,
  });
  console.log("Studio status:", await page.locator(".dcs-status").innerText());
  console.log("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
