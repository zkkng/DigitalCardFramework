import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import * as pw from "playwright";
import { fixture, admin } from "./helpers.js";
import { fixture as artFixture, build } from "./presentation-fixtures.mjs";
import { testFont } from "./font-fixture.mjs";
import { createApiHandler } from "../src/http.js";
import { serveReference } from "../src/static.js";
import { createPresentationStore } from "../src/presentation/service.js";
import { createPresentationHandler } from "../src/presentation/node-http.js";
import { authorizePresentation } from "../src/access.js";
const output = resolve(process.argv[2] ?? "test-results/card-authoring"),
  engine = process.env.BROWSER_ENGINE ?? "chromium";
await mkdir(output, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), "card-authoring-")),
  base = fileURLToPath(new URL("../", import.meta.url));
const { core, alice } = fixture(),
  actor = { ...admin, userId: alice.userId },
  pkg = await build(artFixture());
let api, presentationHTTP, browser;
const server = createServer(async (req, res) => {
  try {
    if ((await api?.(req, res)) || (await presentationHTTP?.(req, res))) return;
    if (req.url === "/fixture.dcard") {
      res.end(pkg.archive);
      return;
    }
    if (req.url === "/font.ttf") {
      res.end(testFont());
      return;
    }
    if (req.url === "/harness") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><html lang="en"><title>Card authoring</title><link rel="stylesheet" href="/src/presentation/studio.css"><style>body{margin:0;background:#101b2d;color:#edf1f7;font:16px system-ui}#root{min-height:800px}button,input,select,textarea{font:inherit}button{cursor:pointer}</style><div id="root"></div></html>',
      );
      return;
    }
    if (await serveReference(req, res)) return;
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
api = createApiHandler({
  framework: core,
  resolveIdentity: () => actor,
  allowedOrigin: origin,
  exposeOperators: true,
  requirePrincipal: true,
});
const store = await createPresentationStore({
  root: temp,
  authorize: authorizePresentation,
  validatePublication: (a, { archive }) =>
    core.registerCardPresentation(a, archive),
});
presentationHTTP = createPresentationHandler({
  store,
  resolveIdentity: () => actor,
  allowedOrigin: origin,
});
const checks = [],
  errors = [];
try {
  try {
    browser = await pw[engine].launch({ headless: process.env.HEADED !== "1" });
  } catch (error) {
    if (engine !== "chromium") throw error;
    browser = await pw.chromium.launch({ headless: true, channel: "msedge" });
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/harness");
  await page.evaluate(async () => {
    const { mountStudio } = await import("/src/presentation/studio.js"),
      { importPackage } = await import("/src/presentation/package.js"),
      { createMemoryLibrary } =
        await import("/src/presentation/authoring-tools.js");
    const pkg = await importPackage(
      new Uint8Array(await (await fetch("/fixture.dcard")).arrayBuffer()),
    );
    window.studio = mountStudio(document.querySelector("#root"), {
      initialPackage: pkg,
      library: createMemoryLibrary(),
    });
    await studio.ready;
  });
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Text content", { exact: true })
    .fill("Collection title");
  await page.getByLabel("Text content", { exact: true }).press("Tab");
  await page.waitForFunction(() =>
    window.studio
      .getProject()
      .scenes.get("scenes/front.json")
      .nodes.some((n) => n.text === "Collection title"),
  );
  const fontChooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Add custom font", exact: true })
    .click();
  await (
    await fontChooser
  ).setFiles({
    name: "Test.ttf",
    mimeType: "font/ttf",
    buffer: Buffer.from(testFont()),
  });
  await page.waitForFunction(() =>
    window.studio.getProject().manifest.assets.some((a) => a.role === "font"),
  );
  await page.getByLabel("Font size", { exact: true }).fill("24");
  await page.getByLabel("Font size", { exact: true }).press("Tab");
  await page.evaluate(async () => {
    const { configureAuthoring, addStatBlock, setStat } =
      await import("/src/presentation/authoring-tools.js");
    const p = window.studio.getProject();
    configureAuthoring(p, {
      policy: {
        defaults: {},
        fields: [{ key: "score", label: "Score", type: "integer", default: 0 }],
      },
    });
    setStat(p, "score", 42);
    addStatBlock(p, "back", ["score"]);
    const font = p.manifest.assets.find((a) => a.role === "font");
    p.edit(() => {
      p.scenes
        .get(p.manifest.faces.back.scene)
        .nodes.at(-1).typography.fontAsset = font.id;
    });
    await window.studio.open(await p.export({ retainSources: true }));
  });
  await page.getByRole("button", { name: "Front / back", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="img"]')
      ?.getAttribute("aria-label")
      ?.includes("42"),
  );
  await page.getByRole("spinbutton", { name: "Score", exact: true }).fill("57");
  await page
    .getByRole("spinbutton", { name: "Score", exact: true })
    .press("Tab");
  await page.waitForFunction(() =>
    document
      .querySelector('[role="img"]')
      ?.getAttribute("aria-label")
      ?.includes("57"),
  );
  checks.push(
    "custom font upload, editable text, bound stat redraw and accessible text on both faces",
  );
  await page.evaluate(async () => {
    const p = window.studio.getProject();
    p.edit(() => {
      p.manifest.authoring.fields.push(
        { key: "score", label: "Variant score", type: "integer", scope: "variant" },
        { key: "enabled", label: "Enabled", type: "boolean", nullable: true },
        { key: "category", label: "Category", type: "string", enum: ["print", "photo"] },
      );
      p.manifest.authoring.values.variant.score = 99;
    });
    await window.studio.refreshPolicy();
  });
  assert.equal(await page.getByLabel("Enabled", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Category", { exact: true }).inputValue(), "");
  await page.getByLabel("Enabled", { exact: true }).selectOption("false");
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.card.enabled === false);
  await page.getByLabel("Enabled", { exact: true }).selectOption("null");
  await page.waitForFunction(() => window.studio.getProject().manifest.authoring.values.card.enabled === null);
  await page.getByLabel("Enabled", { exact: true }).selectOption("");
  await page.waitForFunction(() => !Object.hasOwn(window.studio.getProject().manifest.authoring.values.card, "enabled"));
  await page.getByRole("button", { name: "Add Variant score to card", exact: true }).click();
  await page.getByLabel("Stat label", { exact: true }).fill("Edition");
  await page.getByLabel("Stat label", { exact: true }).press("Tab");
  await page.waitForFunction(() => document.querySelector('[role="img"]')?.getAttribute("aria-label")?.includes("Edition 99"));
  assert.equal(await page.getByLabel("Bound field", { exact: true }).inputValue(), '["variant","score"]');
  await page.getByLabel("Stat appearance", { exact: true }).selectOption("bar");
  await page.getByLabel("Bar maximum", { exact: true }).fill("200");
  await page.getByLabel("Bar maximum", { exact: true }).press("Tab");
  await page.waitForFunction(() => window.studio.getProject().scenes.get("scenes/back.json").nodes.some(n => n.stat?.maximum === 200));
  await page.getByRole("button", { name: "Copy text style", exact: true }).click();
  await page.getByText("Arrange layers", { exact: true }).click();
  await page.getByRole("button", { name: "Lock selected", exact: true }).click();
  await page.getByRole("button", { name: "Paste text style", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".dcard-studio").textContent.includes("Unlock this layer to edit it"));
  checks.push("unset/false/null stat forms, scoped bindings, artist bar controls and locked-style protection");
  await page
    .getByRole("button", { name: "Save card as template", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".dcs-authoring").textContent.includes("· template"),
  );
  const snapshot = await page.evaluate(async () => {
    const p = window.studio.getProject(),
      before = await p.export({ retainSources: true });
    await window.studio.capturePosters();
    const after = await p.export();
    return {
      before: before.digest,
      after: after.digest,
      fonts: after.manifest.assets.filter((a) => a.role === "font").length,
      back: after.manifest.faces.back.description,
    };
  });
  assert.equal(snapshot.fonts, 1);
  assert.notEqual(snapshot.before, snapshot.after);
  checks.push("template library save and poster capture retain embedded font");
  await page.screenshot({
    path: resolve(output, "editor.png"),
    fullPage: true,
  });
  const rendering = await page.evaluate(async () => {
    const { drawText, inspectFont } = await import("/src/presentation/text.js");
    const font = inspectFont(
      new Uint8Array(await (await fetch("/font.ttf")).arrayBuffer()),
      "font/ttf",
    ).font;
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    const icon = document.createElement("canvas");
    icon.width = icon.height = 16;
    icon.getContext("2d").fillRect(0, 0, 16, 16);
    const node = {
      id: "spans",
      width: 200,
      height: 80,
      text: "",
      typography: { size: 30 },
      runs: [
        { text: "AB", color: "#ff0000" },
        { text: "CD", color: "#0000ff", icon: "symbol" },
      ],
    };
    drawText(ctx, node, {}, font, new Map([["symbol", icon]]));
    const pixels = ctx.getImageData(0, 0, 200, 80).data;
    let red = 0,
      blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 200 && pixels[i + 2] < 30) red++;
      if (pixels[i + 2] > 200 && pixels[i] < 30) blue++;
    }
    return { red, blue };
  });
  assert(rendering.red > 0 && rendering.blue > 0);
  checks.push("rich span colors and inline icon render to pixels");

  await page.evaluate(async()=>{
    const {createCardRenderer}=await import("/src/presentation/card-view.js");
    const {importPackage,browserResolver}=await import("/src/presentation/package.js");
    const pkg=await importPackage(new Uint8Array(await(await fetch("/fixture.dcard")).arrayBuffer()));
    const renderer=createCardRenderer({resolve:async url=>{window.variantURL=url;return browserResolver(pkg);}});
    const ref={contract:"digital-card@0.1",digest:pkg.digest,baseURL:"/base/"};
    window.variantNode=renderer({definition:{name:"Variant design",presentation:ref},variant:{presentation:{...ref,baseURL:"/variant/"}}});
    Object.assign(window.variantNode.style,{position:"fixed",top:"0",left:"0",width:"100px",height:"140px"});document.body.append(window.variantNode);
  });
  await page.waitForFunction(()=>window.variantURL==="/variant/");
  await page.evaluate(()=>window.variantNode.remove());
  checks.push("variant-specific artwork overrides the base design in the public renderer");

  await page.evaluate(async () => {
    window.studio.dispose();
    const { createClient } = await import("/src/client.js"),
      { mountVisualStudio } = await import("/src/visual-studio-ui.js");
    const client = createClient(),
      me = await client.me(),
      catalog = await client.operatorCatalog();
    window.client = client;
    window.visual = mountVisualStudio(document.querySelector("#root"), {
      client,
      model: { me, catalog },
    });
  });
  await page
    .getByRole("button", { name: "Open visual card editor", exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector(".dcard-studio"));
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Text content", { exact: true })
    .fill("Published design");
  await page.getByLabel("Text content", { exact: true }).press("Tab");
  await page
    .getByRole("button", { name: "Capture posters", exact: true })
    .click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("button", { name: "Publish reviewed card", exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Publish reviewed card", exact: true })
    .click();
  await page.getByText("Card published.", { exact: true }).waitFor();
  assert(core.operatorCatalog(admin).cards[0].presentation);
  checks.push(
    "visual editor uploads, registers, previews and commits through authenticated policy gate",
  );
  await page
    .getByText("Administrator card policies", { exact: true })
    .first()
    .click();
  const policy = {
    schemaVersion: 1,
    id: "browser.policy",
    revision: 1,
    name: "Browser policy",
    fields: [
      {
        key: "score",
        label: "Score",
        type: "integer",
        required: true,
        minimum: 0,
      },
    ],
    requirements: {},
  };
  await page
    .getByLabel("Policy document", { exact: true })
    .fill(JSON.stringify(policy));
  await page
    .getByRole("button", { name: "Save policy draft", exact: true })
    .click();
  await page.getByText("Policy library revision 1", { exact: true }).waitFor();
  await page
    .getByLabel("Policy assignments", { exact: true })
    .fill(
      JSON.stringify([{ scope: "installation", policy: "browser.policy@1" }]),
    );
  await page
    .getByRole("button", { name: "Preview policy impact", exact: true })
    .click();
  await page
    .getByLabel("I reviewed the policy changes and affected cards.")
    .check();
  await page
    .getByRole("button", { name: "Activate reviewed policy", exact: true })
    .click();
  await page.getByText("Policy library revision 2", { exact: true }).waitFor();
  checks.push(
    "administrator saves, reviews field-level impact and activates a policy using keyboard-accessible controls",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(output, "mobile.png"),
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ engine, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ engine, checks: checks.length, errors }));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
    console.error((await page.locator("body").innerText()).slice(-7000));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await store.close();
  core.close();
  await rm(temp, { recursive: true, force: true });
}
