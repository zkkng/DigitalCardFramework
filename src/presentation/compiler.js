/** Node content tooling. Media processing is injected; no art or tool path in core. */
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  lstat,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensure, parseJSON, text, safePath, canonical, utf8 } from "./data.js";
import { buildPackage, importPackage } from "./package.js";

export async function readWithin(root, relative) {
  safePath(relative);
  const base = await realpath(root),
    candidate = path.resolve(base, relative),
    actual = await realpath(candidate);
  ensure(
    actual.startsWith(base + path.sep) &&
      !(await lstat(candidate)).isSymbolicLink(),
    "PATH",
    "Asset escapes project root",
  );
  return new Uint8Array(await readFile(actual));
}
export async function compileDirectory({
  root,
  out,
  archivePath,
  maxEdge = 1536,
  imageProcessor,
  signal,
}) {
  const manifest = parseJSON(text(await readWithin(root, "card.json"))),
    scenes = new Map(),
    assets = new Map(),
    ratios = new Map();
  for (const face of Object.values(manifest.faces))
    scenes.set(face.scene, parseJSON(text(await readWithin(root, face.scene))));
  for (const asset of manifest.assets) {
    signal?.throwIfAborted();
    let bytes = await readWithin(root, asset.path);
    if (imageProcessor && asset.mediaType.startsWith("image/")) {
      const result = await imageProcessor(bytes, {
        maxEdge,
        mediaType: asset.mediaType,
      });
      ensure(
        result.bytes instanceof Uint8Array &&
          result.width > 0 &&
          result.height > 0,
        "COMPILER",
        "Invalid image processor output",
      );
      ratios.set(asset.id, [
        result.width / asset.width,
        result.height / asset.height,
      ]);
      asset.width = result.width;
      asset.height = result.height;
      asset.mediaType = result.mediaType;
      bytes = result.bytes;
    }
    assets.set(asset.path, bytes);
  }
  function remap(nodes) {
    for (const node of nodes) {
      if (node.rect && ratios.has(node.asset)) {
        const [x, y] = ratios.get(node.asset);
        node.rect = node.rect.map((v, i) => v * (i % 2 ? y : x));
      }
      for (const frame of node.animation?.frames ?? []) {
        if (frame.rect && ratios.has(frame.asset)) {
          const [x, y] = ratios.get(frame.asset);
          frame.rect = frame.rect.map((v, i) => v * (i % 2 ? y : x));
        }
      }
      if (node.children) remap(node.children);
    }
  }
  for (const scene of scenes.values()) remap(scene.nodes);
  const result = await buildPackage(manifest, scenes, assets);
  await writeCompiled(result, { out, archivePath });
  return { ...result, report: buildReport(result) };
}
export async function writeCompiled(pkg, { out, archivePath }) {
  await mkdir(out, { recursive: true });
  for (const [relative, bytes] of pkg.files) {
    safePath(relative);
    const target = path.join(out, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  if (archivePath) {
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, pkg.archive);
  }
}
export function buildReport(pkg) {
  const assets = pkg.manifest.assets;
  const report = {
    digest: pkg.digest,
    downloadBytes: [...pkg.files.values()].reduce(
      (sum, b) => sum + b.length,
      0,
    ),
    assets: assets.length,
    profiles: {},
    warnings: [],
  };
  for (const [name, { maxEdge }] of Object.entries(pkg.manifest.quality)) {
    let textureBytes = 0;
    for (const a of assets.filter((a) => a.mediaType.startsWith("image/"))) {
      const ratio = Math.min(1, maxEdge / Math.max(a.width, a.height));
      textureBytes +=
        Math.round(a.width * ratio) * Math.round(a.height * ratio) * 4;
    }
    report.profiles[name] = { estimatedTextureBytes: textureBytes, maxEdge };
  }
  if (report.downloadBytes > 8 * 1024 * 1024)
    report.warnings.push(
      "Whole-package download exceeds 8 MiB; use the directory resolver for selective loading.",
    );
  report.warnings.push(
    "Texture estimates exclude driver overhead, video buffers and render targets.",
  );
  return report;
}
/** Content-addressed publication; importing content never creates an owned copy. */
export async function publishPackage(bytes, { contentRoot, limits }) {
  const pkg = await importPackage(bytes, { limits }),
    folder = path.join(contentRoot, pkg.digest.slice(7)),
    staging = path.join(contentRoot, ".pending-" + randomUUID());
  const report = buildReport(pkg);
  await mkdir(contentRoot, { recursive: true });
  try {
    await writeCompiled(
      { ...pkg, archive: bytes },
      { out: staging, archivePath: path.join(staging, "download.dcard") },
    );
    await writeFile(
      path.join(staging, "build-report.json"),
      utf8(canonical(report)),
    );
    try {
      await rename(staging, folder);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      const existing = await importPackage(
        new Uint8Array(await readFile(path.join(folder, "download.dcard"))),
        { limits },
      );
      ensure(
        existing.digest === pkg.digest,
        "INTEGRITY",
        "Existing content differs",
      );
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { digest: pkg.digest, folder, report };
}
