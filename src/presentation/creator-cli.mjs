#!/usr/bin/env node
/** Local trusted build job. Network publication is an injected host API, never package code. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAuthoring } from "./authoring.js";
import { parseJSON, ensure } from "./data.js";
import { readWithin, publishPackage } from "./compiler.js";
import { validateCatalog } from "../catalog.js";

export async function createFromConfiguration(configPath, output) {
  const root = path.dirname(path.resolve(configPath)),
    config = parseJSON(await readFile(configPath, "utf8"));
  ensure(
    config.version === 1 && Array.isArray(config.cards),
    "CONFIG",
    "Use creator configuration version 1",
  );
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".dcard": "application/zip",
  };
  const cards = [];
  for (const card of config.cards) {
    const mediaType = types[path.extname(card.file).toLowerCase()];
    ensure(
      mediaType,
      "MEDIA",
      "CLI accepts JPG, PNG, WebP and .dcard; use a layered importer for PSD/ORA",
    );
    cards.push({
      id: card.id,
      title: card.title,
      effects: card.effects,
      source: {
        format: mediaType === "application/zip" ? "dcard" : "image",
        mediaType,
        bytes: await readWithin(root, card.file),
      },
    });
  }
  const contentRoot = path.resolve(output),
    baseURL = new URL(config.publicBaseURL);
  ensure(
    ["https:", "http:"].includes(baseURL.protocol) &&
      !baseURL.search &&
      !baseURL.hash,
    "CONFIG",
    "Supply an HTTP(S) publicBaseURL",
  );
  if (!baseURL.pathname.endsWith("/")) baseURL.pathname += "/";
  const creator = createAuthoring({
    validateCatalog,
    publish: async (pkg) => {
      const p = await publishPackage(pkg.archive, { contentRoot });
      return {
        contract: "digital-card@0.1",
        digest: p.digest,
        baseURL: new URL(p.digest.slice(7) + "/", baseURL).href,
      };
    },
    commitCatalog: async (catalog) => {
      await writeFile(
        path.join(contentRoot, "catalog.json"),
        JSON.stringify(catalog, null, 2),
      );
      return {
        path: path.join(contentRoot, "catalog.json"),
        state: "prepared",
      };
    },
  });
  await mkdir(contentRoot, { recursive: true });
  return creator.publishPack({
    cards,
    catalog: config.catalog,
    key: config.key ?? "local-build-v1",
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    const [config, output] = process.argv.slice(2);
    ensure(config && output, "CLI", "creator-cli.mjs CONFIG.json OUTPUT");
    const result = await createFromConfiguration(config, output);
    console.log(
      JSON.stringify(
        { digests: result.digests, result: result.result },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
