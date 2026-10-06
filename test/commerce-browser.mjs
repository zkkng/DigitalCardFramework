import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import * as playwright from "playwright";
import { fixture, admin } from "./helpers.js";
import { createApiHandler } from "../src/http.js";
import {serveReference} from '../src/static.js';
const engine = process.env.BROWSER_ENGINE ?? "chromium",
  output = path.resolve(process.argv[2] ?? "../PortableCardQA/commerce");
const x = fixture(),
  seller = { ...x.alice, role: "admin" },
  shop = x.core.createShop(seller, {
    key: "shop",
    name: "Sky shop",
    kind: "admin",
  });
x.core.createListing(seller, {
  key: "stock",
  shopId: shop.id,
  title: "Dawn collector card",
  description: "A reserved card with immutable provenance.",
  price: { currencyId: "credits", amount: 20 },
  items: { kind: "mint-card", variantId: "dawn.standard", quantity: 2 },
});
let api;
const server = createServer(async (req, res) => {
  try {
    if (await api?.(req, res)) return;
    const name = new URL(req.url, "http://localhost").pathname.slice(1);
    if (!name) {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main id="root"></main><script type="module">
import {renderMarketplace} from '/src/marketplace-ui.js';import {createClient} from '/src/client.js';import {defaultCSS} from '/src/styles.js';
const client=createClient(),me=await client.me(),catalog=await client.catalog(),inventory=await client.inventory(),packs=await client.packs();const style=document.createElement('style');style.textContent=defaultCSS;document.head.append(style);const root=document.querySelector('#root');root.className='dc-root';window.view=renderMarketplace({me,catalog,inventory,packs},{client,cardRenderer:copy=>{const node=document.createElement('p');node.textContent=copy.definition.name+' · '+copy.id;return node;}});root.append(view.node);await view.ready;window.ready=true;
</script></body></html>`);
      return;
    }
    if(await serveReference(req,res))return;
    res.writeHead(404).end();
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
api = createApiHandler({
  framework: x.core,
  allowedOrigin: origin,
  resolveIdentity: () => x.bob,
});
let browser;
try {
  try {
    browser = await playwright[engine].launch({ headless: true });
  } catch (error) {
    if (engine !== "chromium" || process.platform !== "win32") throw error;
    browser = await playwright.chromium.launch({
      headless: true,
      channel: "msedge",
    });
  }
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
  assert.equal(x.core.wallet(x.bob).credits, 10000);
  await page
    .getByRole("button", { name: "Review purchase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .waitFor();
  assert.equal(x.core.wallet(x.bob).credits, 10000);
  await page
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.body.textContent.includes("1 available"),
  );
  assert.equal(x.core.wallet(x.bob).credits, 9980);
  assert.equal(x.core.inventory(x.bob).length, 1);
  assert.equal(x.core.audit(admin).ok, true);
  await page.getByText("Purchase and sale history", { exact: true }).click();
  await page.getByRole("button", { name: "Load orders" }).click();
  await page.waitForFunction(() =>
    document.body.textContent.includes("20 credits · complete"),
  );
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, engine + "-marketplace.png"),
    fullPage: true,
  });
  await page.evaluate(() => view.dispose());
  assert.equal(await page.locator("#root").innerText(), "");
  console.log(
    engine +
      ": mobile-width marketplace review, purchase, order history, no overflow and disposal passed.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  x.core.close();
}
