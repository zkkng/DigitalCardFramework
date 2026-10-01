import {
  parseJSON,
  text,
  utf8,
  sha256,
  canonical,
  ensure,
  safePath,
} from "./data.js";
import { validateManifest, validateScene } from "./validate.js";
import { rasterDimensions } from "./media.js";
import { sniff, readZip } from "./package.js";
import { inspectGLB, inspectDotLottie } from "./advanced-media.js";
/** Fetch a compiled directory without downloading/unzipping media for every card. */
export async function directoryResolver(base, { digest, signal } = {}) {
  const controller = new AbortController(),
    requestSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
  const root = new URL(base, globalThis.location?.href);
  ensure(
    ["http:", "https:"].includes(root.protocol),
    "URL",
    "Unsupported content origin",
  );
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  async function bytes(path, max = 8 * 1024 * 1024) {
    safePath(path);
    const response = await fetch(new URL(path, root), {
      signal: requestSignal,
      // Private host content needs its existing session. Cross-origin card
      // servers still receive no ambient credentials, and redirects stay blocked.
      credentials: "same-origin",
      redirect: "error",
    });
    ensure(response.ok, "HTTP", "Unable to load " + path);
    ensure(
      Number(response.headers.get("content-length") ?? 0) <= max,
      "LIMIT",
      "Content exceeds limit",
    );
    const reader = response.body.getReader(),
      chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        ensure(total <= max, "LIMIT", "Content exceeds limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return data;
  }
  const integrity = parseJSON(text(await bytes("integrity.json"))),
    { digest: found, ...index } = integrity;
  ensure(
    found ===
      "sha256:" +
        (await sha256(utf8("digital-card-package-v1\n" + canonical(index)))),
    "INTEGRITY",
    "Invalid content index",
  );
  if (digest)
    ensure(found === digest, "INTEGRITY", "Unexpected presentation digest");
  ensure(
    index.format === "digital-card-integrity" &&
      index.version === 1 &&
      Array.isArray(index.files) &&
      index.files.length <= 2000,
    "INTEGRITY",
    "Invalid content index",
  );
  let total = 0;
  const seen = new Set();
  for (const e of index.files) {
    safePath(e.path);
    ensure(
      !seen.has(e.path.toLowerCase()) &&
        Number.isSafeInteger(e.bytes) &&
        e.bytes > 0 &&
        e.bytes <= 250 * 1024 * 1024 &&
        /^[a-f0-9]{64}$/.test(e.sha256),
      "INTEGRITY",
      "Invalid content entry",
    );
    seen.add(e.path.toLowerCase());
    total += e.bytes;
  }
  ensure(total <= 1024 * 1024 * 1024, "LIMIT", "Content limit");
  const entries = new Map(index.files.map((x) => [x.path, x]));
  async function verified(path) {
    const entry = entries.get(path);
    ensure(entry, "INTEGRITY", "Unlisted content " + path);
    const data = await bytes(
      path,
      path.endsWith(".json")
        ? Math.min(entry.bytes, 8 * 1024 * 1024)
        : entry.bytes,
    );
    ensure(
      data.length === entry.bytes && (await sha256(data)) === entry.sha256,
      "INTEGRITY",
      "Changed content " + path,
    );
    return data;
  }
  const manifest = parseJSON(text(await verified("card.json")));
  validateManifest(manifest);
  const scenes = new Map();
  for (const face of Object.values(manifest.faces)) {
    if (!scenes.has(face.scene)) {
      const scene = parseJSON(text(await verified(face.scene)));
      validateScene(scene, manifest);
      scenes.set(face.scene, scene);
    }
  }
  const declared = new Set([
    "card.json",
    ...Object.values(manifest.faces).map((f) => f.scene),
    ...manifest.assets.map((a) => a.path),
  ]);
  ensure(
    entries.size === declared.size &&
      [...entries.keys()].every((p) => declared.has(p)),
    "PACKAGE",
    "Undeclared or missing directory payload",
  );
  for (const asset of manifest.assets) {
    const entry = entries.get(asset.path);
    ensure(
      entry?.bytes === asset.bytes && entry.sha256 === asset.sha256,
      "INTEGRITY",
      "Manifest and directory asset disagree",
    );
  }
  let disposed = false;
  const urls = new Map();
  return {
    digest: found,
    manifest,
    scenes,
    async asset(id) {
      ensure(!disposed, "DISPOSED", "Resolver disposed");
      const asset = manifest.assets.find((a) => a.id === id);
      ensure(asset, "ASSET", "Unknown asset " + id);
      if (!urls.has(id))
        urls.set(
          id,
          (async () => {
            const data = await verified(asset.path);
            ensure(
              data.length === asset.bytes &&
                (await sha256(data)) === asset.sha256,
              "INTEGRITY",
              "Manifest asset mismatch",
            );
            sniff(asset, data);
            if (asset.mediaType === "model/gltf-binary") inspectGLB(data);
            if (asset.mediaType === "application/zip")
              await inspectDotLottie(data, readZip);
            ensure(!disposed, "DISPOSED", "Resolver disposed");
            return URL.createObjectURL(
              new Blob([data], { type: asset.mediaType }),
            );
          })(),
        );
      return { ...asset, url: await urls.get(id) };
    },
    dispose() {
      disposed = true;
      controller.abort();
      for (const promise of urls.values())
        promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
      urls.clear();
    },
    diagnostics() {
      return { objectURLs: urls.size };
    },
  };
}
