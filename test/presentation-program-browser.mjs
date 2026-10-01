import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { programHeaders } from "../src/presentation/program.js";
const [
    playwrightPath,
    url = "http://127.0.0.1:4173/portable.html",
    out = "../PortableCardQA",
  ] = process.argv.slice(2),
  { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href);
let requests = 0;
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  for (const [key, value] of Object.entries(
    programHeaders("http://127.0.0.1:4173"),
  ))
    res.setHeader(key, value);
  if (req.url === "/") {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><script type="module" src="/main.js"></script>');
  } else if (req.url === "/main.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(
      `import {connectProgram} from '/program.js';const bridge=await connectProgram();try{parent.document.body.dataset.breached='yes';}catch{bridge.intent('isolated');}try{await fetch('/forbidden');}catch{bridge.intent('network-blocked');}bridge.intent('unauthorized');`,
    );
  } else if (["/program.js", "/data.js"].includes(req.url)) {
    res.setHeader("content-type", "text/javascript");
    res.end(
      await readFile(new URL("../src/presentation" + req.url, import.meta.url)),
    );
  } else {
    requests++;
    res.end("unexpected");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const programURL = `http://127.0.0.1:${server.address().port}/`,
  browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.portableCards?.ready);
  const result = await page.evaluate(async (programURL) => {
    const { mountProgram } = await import("/player/program.js"),
      root = document.createElement("div");
    document.body.append(root);
    const intents = [],
      program = mountProgram(root, {
        programId: "reviewed",
        registry: new Map([
          [
            "reviewed",
            {
              approved: true,
              version: "1",
              url: programURL,
              intents: ["isolated", "network-blocked"],
            },
          ],
        ]),
        onIntent: (e) => intents.push(e.intent),
      });
    window.postMessage({ type: "ready", nonce: "spoofed", version: 1 }, "*");
    await new Promise((r) => setTimeout(r, 500));
    const frames = root.querySelectorAll("iframe").length;
    program.dispose();
    root.remove();
    return {
      intents,
      frames,
      breached: document.body.dataset.breached ?? false,
    };
  }, programURL);
  assert.deepEqual(result.intents, ["isolated", "network-blocked"]);
  assert.equal(
    result.frames,
    0,
    "Unauthorized intent must terminate the program",
  );
  assert.equal(result.breached, false);
  assert.equal(requests, 0);
  await writeFile(
    path.join(out, "program-report.json"),
    JSON.stringify({ ...result, blockedNetworkRequests: requests }, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
