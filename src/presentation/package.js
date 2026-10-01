import {
  ensure,
  safePath,
  parseJSON,
  canonical,
  utf8,
  text,
  sha256,
} from "./data.js";
import { validateManifest, validateScene } from "./validate.js";
import { rasterDimensions } from "./media.js";
import { inspectGLB, inspectDotLottie } from "./advanced-media.js";
export const DEFAULT_LIMITS = Object.freeze({
  compressed: 250 * 1024 * 1024,
  inflated: 1024 * 1024 * 1024,
  entries: 2000,
  entry: 250 * 1024 * 1024,
  ratio: 200,
});
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
function header(size) {
  const bytes = new Uint8Array(size);
  return { bytes, v: new DataView(bytes.buffer) };
}
/** Deterministic ZIP store writer: interoperable, no dependency or executable payload. */
export function writeZip(files) {
  ensure(
    files instanceof Map && files.size <= 65535,
    "ZIP",
    "Invalid archive file map",
  );
  let offset = 0;
  const locals = [],
    centrals = [],
    paths = new Set();
  for (const [path, bytes] of [...files].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    safePath(path);
    ensure(
      !paths.has(path.toLowerCase()),
      "DUPLICATE",
      "Colliding archive path",
    );
    paths.add(path.toLowerCase());
    ensure(
      bytes instanceof Uint8Array && bytes.length < 0xffffffff,
      "ZIP",
      "Invalid archive payload",
    );
    const name = utf8(path),
      crc = crc32(bytes),
      l = header(30),
      c = header(46);
    l.v.setUint32(0, 0x04034b50, true);
    l.v.setUint16(4, 20, true);
    l.v.setUint16(6, 0x800, true);
    l.v.setUint16(12, 33, true);
    l.v.setUint32(14, crc, true);
    l.v.setUint32(18, bytes.length, true);
    l.v.setUint32(22, bytes.length, true);
    l.v.setUint16(26, name.length, true);
    c.v.setUint32(0, 0x02014b50, true);
    c.v.setUint16(4, 20, true);
    c.v.setUint16(6, 20, true);
    c.v.setUint16(8, 0x800, true);
    c.v.setUint16(14, 33, true);
    c.v.setUint32(16, crc, true);
    c.v.setUint32(20, bytes.length, true);
    c.v.setUint32(24, bytes.length, true);
    c.v.setUint16(28, name.length, true);
    c.v.setUint32(42, offset, true);
    locals.push(l.bytes, name, bytes);
    centrals.push(c.bytes, name);
    offset += 30 + name.length + bytes.length;
  }
  const central = concat(centrals),
    end = header(22);
  ensure(
    offset + central.length < 0xffffffff,
    "LIMIT",
    "ZIP64 export not supported",
  );
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, files.size, true);
  end.v.setUint16(10, files.size, true);
  end.v.setUint32(12, central.length, true);
  end.v.setUint32(16, offset, true);
  return concat([...locals, central, end.bytes]);
}
async function inflate(bytes, maximum) {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { inflateRawSync } = await import("node:zlib");
    return new Uint8Array(
      inflateRawSync(bytes, { maxOutputLength: Math.max(1, maximum) }),
    );
  }
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      ensure(total <= maximum, "LIMIT", "Inflated entry exceeds limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return concat(chunks);
}
/** Validate the entire central/local directory before allocating decompressed payloads. */
export async function readZip(bytes, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  ensure(
    bytes instanceof Uint8Array &&
      bytes.length <= limits.compressed &&
      bytes.length >= 22,
    "LIMIT",
    "Archive size limit",
  );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      v.getUint32(p, true) === 0x06054b50 &&
      p + 22 + v.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  ensure(end >= 0, "ZIP", "Missing end record");
  ensure(
    v.getUint16(end + 4, true) === 0 && v.getUint16(end + 6, true) === 0,
    "ZIP",
    "Split archives not supported",
  );
  const count = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    start = v.getUint32(end + 16, true);
  ensure(
    count === v.getUint16(end + 8, true) &&
      count > 0 &&
      count <= limits.entries &&
      start + size === end,
    "ZIP",
    "Invalid archive directory",
  );
  const entries = [],
    paths = new Set(),
    ranges = [];
  let p = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    ensure(
      p + 46 <= end && v.getUint32(p, true) === 0x02014b50,
      "ZIP",
      "Invalid directory entry",
    );
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      crc = v.getUint32(p + 16, true),
      compressed = v.getUint32(p + 20, true),
      inflated = v.getUint32(p + 24, true),
      nl = v.getUint16(p + 28, true),
      el = v.getUint16(p + 30, true),
      cl = v.getUint16(p + 32, true),
      local = v.getUint32(p + 42, true),
      mode = v.getUint32(p + 38, true) >>> 16;
    ensure(p + 46 + nl + el + cl <= end, "ZIP", "Truncated directory");
    const originalPath = text(bytes.subarray(p + 46, p + 46 + nl)),
      directory = !!options.sourceArchive && originalPath.endsWith("/"),
      path = safePath(directory ? originalPath.slice(0, -1) : originalPath);
    ensure(
      !paths.has(path.toLowerCase()),
      "DUPLICATE",
      "Duplicate archive entry",
    );
    paths.add(path.toLowerCase());
    ensure(
      (flags & ~(options.sourceArchive ? 0x80e : 0x800)) === 0 &&
        [0, 8].includes(method) &&
        v.getUint16(p + 34, true) === 0,
      "ZIP",
      "Unsupported encrypted/descriptor/split ZIP",
    );
    ensure(
      (mode & 0xf000) === 0 ||
        (mode & 0xf000) === 0x8000 ||
        (directory && (mode & 0xf000) === 0x4000),
      "ZIP",
      "Links and special files are forbidden",
    );
    total += inflated;
    ensure(
      inflated <= limits.entry &&
        total <= limits.inflated &&
        inflated / Math.max(1, compressed) <= limits.ratio,
      "LIMIT",
      "Inflation limit",
    );
    ensure(
      local + 30 <= start && v.getUint32(local, true) === 0x04034b50,
      "ZIP",
      "Invalid local entry",
    );
    const lnl = v.getUint16(local + 26, true),
      lel = v.getUint16(local + 28, true),
      data = local + 30 + lnl + lel;
    ensure(
      data + compressed <= start &&
        text(bytes.subarray(local + 30, local + 30 + lnl)) === originalPath,
      "ZIP",
      "Local/central mismatch",
    );
    ensure(
      v.getUint16(local + 6, true) === flags &&
        v.getUint16(local + 8, true) === method &&
        ((options.sourceArchive && flags & 8) ||
          (v.getUint32(local + 14, true) === crc &&
            v.getUint32(local + 18, true) === compressed &&
            v.getUint32(local + 22, true) === inflated)),
      "ZIP",
      "Local/central metadata mismatch",
    );
    ranges.push([local, data + compressed]);
    ensure(!directory || inflated === 0, "ZIP", "Directory contains data");
    entries.push({ path, data, compressed, inflated, crc, method, directory });
    p += 46 + nl + el + cl;
  }
  ensure(p === end, "ZIP", "Unparsed directory bytes");
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++)
    ensure(ranges[i][0] >= ranges[i - 1][1], "ZIP", "Overlapping entries");
  const out = new Map();
  for (const e of entries) {
    const source = bytes.subarray(e.data, e.data + e.compressed),
      data =
        e.method === 0 ? source.slice() : await inflate(source, e.inflated);
    ensure(
      data.length === e.inflated && crc32(data) === e.crc,
      "ZIP",
      "Entry size/CRC mismatch",
      e.path,
    );
    if (!e.directory) out.set(e.path, data);
  }
  return out;
}
async function indexFiles(files) {
  const entries = [];
  for (const [path, data] of [...files].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (path === "integrity.json" || path.startsWith("signatures/")) continue;
    entries.push({ path, bytes: data.length, sha256: await sha256(data) });
  }
  const descriptor = {
    format: "digital-card-integrity",
    version: 1,
    files: entries,
  };
  return {
    ...descriptor,
    digest:
      "sha256:" +
      (await sha256(utf8("digital-card-package-v1\n" + canonical(descriptor)))),
  };
}
export function sniff(asset, bytes) {
  if (asset.mediaType.startsWith("image/")) {
    const size = rasterDimensions(bytes, asset.mediaType);
    ensure(
      size.width === asset.width && size.height === asset.height,
      "MEDIA",
      "Raster dimensions mismatch",
    );
    return;
  }
  const head = String.fromCharCode(...bytes.subarray(0, 16)),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (asset.mediaType === "image/png") {
    ensure(
      bytes.length >= 24 && head.startsWith("\x89PNG\r\n\x1a\n"),
      "MEDIA",
      "Invalid PNG",
    );
    ensure(
      v.getUint32(16) === asset.width && v.getUint32(20) === asset.height,
      "MEDIA",
      "PNG dimensions mismatch",
    );
  } else if (asset.mediaType === "image/webp")
    ensure(
      head.startsWith("RIFF") && head.slice(8, 12) === "WEBP",
      "MEDIA",
      "Invalid WebP",
    );
  else if (asset.mediaType === "image/jpeg")
    ensure(
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "MEDIA",
      "Invalid JPEG",
    );
  else if (asset.mediaType === "video/mp4")
    ensure(head.slice(4, 8) === "ftyp", "MEDIA", "Invalid MP4");
  else if (asset.mediaType === "video/webm")
    ensure(
      bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3,
      "MEDIA",
      "Invalid WebM",
    );
  else if (asset.mediaType === "model/gltf-binary")
    ensure(
      head.startsWith("glTF") &&
        v.getUint32(4, true) === 2 &&
        v.getUint32(8, true) === bytes.length,
      "MEDIA",
      "Invalid GLB",
    );
  else if (asset.mediaType === "application/x-rive")
    ensure(head.startsWith("RIVE"), "MEDIA", "Invalid Rive");
  else if (asset.mediaType === "application/zip")
    ensure(
      bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4,
      "MEDIA",
      "Invalid animation archive",
    );
  else if (asset.mediaType === "audio/mpeg")
    ensure(
      head.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224),
      "MEDIA",
      "Invalid MP3",
    );
  else if (asset.mediaType === "audio/wav")
    ensure(
      head.startsWith("RIFF") && head.slice(8, 12) === "WAVE",
      "MEDIA",
      "Invalid WAV",
    );
  else
    ensure(false, "MEDIA", "Media adapter not installed: " + asset.mediaType);
}
export async function validatePackage(files, { verifyMedia = true } = {}) {
  ensure(
    files.has("card.json") && files.has("integrity.json"),
    "PACKAGE",
    "Manifest/integrity missing",
  );
  const expected = parseJSON(text(files.get("integrity.json"))),
    actual = await indexFiles(files);
  ensure(
    canonical(expected) === canonical(actual),
    "INTEGRITY",
    "Package integrity mismatch",
  );
  const manifest = parseJSON(text(files.get("card.json")));
  validateManifest(manifest);
  const allowed = new Set(["card.json", "integrity.json"]),
    scenes = new Map();
  for (const asset of manifest.assets) {
    const data = files.get(asset.path);
    ensure(
      data &&
        data.length === asset.bytes &&
        (await sha256(data)) === asset.sha256,
      "ASSET",
      "Asset size/hash mismatch",
      asset.path,
    );
    if (verifyMedia) {
      sniff(asset, data);
      if (asset.mediaType === "model/gltf-binary") inspectGLB(data);
      if (asset.mediaType === "application/zip")
        await inspectDotLottie(data, readZip);
    }
    allowed.add(asset.path);
  }
  for (const face of Object.values(manifest.faces)) {
    const bytes = files.get(face.scene);
    ensure(bytes, "SCENE", "Missing scene", face.scene);
    const scene = parseJSON(text(bytes));
    validateScene(scene, manifest);
    scenes.set(face.scene, scene);
    allowed.add(face.scene);
  }
  let signatures = 0;
  for (const [path, data] of files) {
    if (path.startsWith("signatures/")) {
      ensure(
        ++signatures <= 16 &&
          data.length <= 4096 &&
          /^signatures\/[a-zA-Z][\w.-]{0,99}\.json$/.test(path),
        "SIGNATURE",
        "Invalid signature envelope",
      );
      const sig = parseJSON(text(data));
      ensure(
        Object.keys(sig).sort().join(",") ===
          "algorithm,digest,keyId,signature,version" &&
          sig.version === 1 &&
          sig.algorithm === "Ed25519" &&
          sig.digest === actual.digest &&
          path === `signatures/${sig.keyId}.json` &&
          /^[A-Za-z0-9+/]{86}==$/.test(sig.signature),
        "SIGNATURE",
        "Invalid detached signature",
      );
      allowed.add(path);
    }
    ensure(allowed.has(path), "PACKAGE", "Undeclared payload " + path);
  }
  return { digest: actual.digest, manifest, scenes, files };
}
export async function buildPackage(manifest, scenes, assets, options = {}) {
  const m = structuredClone(manifest),
    files = new Map();
  for (const a of m.assets) {
    const bytes = assets.get(a.path);
    ensure(bytes, "ASSET", "Missing export asset " + a.path);
    a.bytes = bytes.length;
    a.sha256 = await sha256(bytes);
    files.set(a.path, bytes);
  }
  files.set("card.json", utf8(canonical(m)));
  for (const [path, scene] of scenes) files.set(path, utf8(canonical(scene)));
  files.set("integrity.json", utf8(canonical(await indexFiles(files))));
  const checked = await validatePackage(files, options);
  return { ...checked, archive: writeZip(files) };
}
export async function importPackage(bytes, options = {}) {
  return validatePackage(await readZip(bytes, options.limits), options);
}
export function browserResolver(pkg) {
  const urls = new Map();
  let disposed = false;
  return {
    manifest: pkg.manifest,
    scenes: pkg.scenes,
    digest: pkg.digest,
    async asset(id) {
      ensure(!disposed, "DISPOSED", "Resolver is disposed");
      const a = pkg.manifest.assets.find((a) => a.id === id);
      ensure(a, "ASSET", "Unknown asset " + id);
      if (!urls.has(id))
        urls.set(
          id,
          URL.createObjectURL(
            new Blob([pkg.files.get(a.path)], { type: a.mediaType }),
          ),
        );
      return { ...a, url: urls.get(id) };
    },
    dispose() {
      disposed = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
    diagnostics() {
      return { objectURLs: urls.size };
    },
  };
}
