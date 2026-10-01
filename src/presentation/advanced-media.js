import { ensure, parseJSON, text } from "./data.js";

/** Core GLB profile: embedded buffers/images, bounded geometry, no executable extensions. */
export function inspectGLB(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  ensure(
    bytes.length >= 20 &&
      v.getUint32(0, true) === 0x46546c67 &&
      v.getUint32(4, true) === 2 &&
      v.getUint32(8, true) === bytes.length,
    "GLTF",
    "Invalid GLB header",
  );
  const length = v.getUint32(12, true);
  ensure(
    length <= 8 * 1024 * 1024 &&
      20 + length <= bytes.length &&
      v.getUint32(16, true) === 0x4e4f534a,
    "GLTF",
    "Invalid GLB JSON",
  );
  const json = parseJSON(text(bytes.subarray(20, 20 + length)).trim());
  ensure(json.asset?.version === "2.0", "GLTF", "Unsupported glTF");
  const supported = [
    "KHR_materials_unlit",
    "KHR_texture_transform",
    "KHR_materials_clearcoat",
    "KHR_materials_ior",
    "KHR_materials_transmission",
    "KHR_materials_specular",
    "KHR_materials_sheen",
    "KHR_materials_emissive_strength",
    "KHR_materials_volume",
    "KHR_materials_iridescence",
    "KHR_materials_anisotropy",
    "KHR_materials_dispersion",
    "KHR_mesh_quantization",
  ];
  for (const id of json.extensionsRequired ?? [])
    ensure(
      supported.includes(id),
      "GLTF_EXTENSION",
      "Unsupported required extension " + id,
    );
  ensure(
    !(json.extensionsUsed ?? []).includes("KHR_interactivity"),
    "GLTF_EXTENSION",
    "KHR_interactivity requires a separately reviewed execution adapter",
  );
  ensure(
    (json.nodes?.length ?? 0) <= 2048 &&
      (json.meshes?.length ?? 0) <= 512 &&
      (json.animations?.length ?? 0) <= 64,
    "LIMIT",
    "GLB scene complexity",
  );
  let vertices = 0;
  for (const accessor of json.accessors ?? []) {
    ensure(
      Number.isInteger(accessor.count) &&
        accessor.count >= 0 &&
        accessor.count <= 1000000,
      "LIMIT",
      "GLB accessor limit",
    );
    vertices += accessor.count;
  }
  ensure(vertices <= 4000000, "LIMIT", "GLB geometry budget");
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])])
    ensure(
      resource.uri === undefined,
      "GLTF_URI",
      "GLB must embed resources in buffer views",
    );
  return json;
}

/** Animation JSON is data only. Reject expressions, URLs and nested programs. */
export function inspectLottie(json) {
  ensure(
    Number.isFinite(json.w) &&
      json.w > 0 &&
      json.w <= 4096 &&
      Number.isFinite(json.h) &&
      json.h > 0 &&
      json.h <= 4096 &&
      Number.isFinite(json.ip) &&
      Number.isFinite(json.op) &&
      json.op > json.ip &&
      json.op - json.ip <= 36000,
    "LOTTIE",
    "Animation dimensions/frame limit",
  );
  let count = 0;
  function walk(value, depth = 0) {
    ensure(
      ++count <= 100000 && depth <= 64,
      "LIMIT",
      "Animation complexity limit",
    );
    if (!value || typeof value !== "object") return;
    for (const [k, v] of Object.entries(value)) {
      ensure(
        !(["x", "expression", "script"].includes(k) && typeof v === "string"),
        "LOTTIE_EXPRESSION",
        "Expressions are not in the passive animation profile",
      );
      if (k === "u" || k === "p")
        ensure(
          typeof v !== "string" ||
            v === "" ||
            /^data:image\/(png|jpeg|webp);base64,/.test(v),
          "LOTTIE_URI",
          "External animation assets are not supported",
        );
      walk(v, depth + 1);
    }
  }
  walk(json);
  return json;
}

export async function inspectDotLottie(bytes, readZip) {
  const files = await readZip(bytes, {
    compressed: 32 * 1024 * 1024,
    inflated: 64 * 1024 * 1024,
    entry: 16 * 1024 * 1024,
    entries: 128,
    ratio: 200,
  });
  ensure(files.has("manifest.json"), "LOTTIE", "Missing animation manifest");
  const manifest = parseJSON(text(files.get("manifest.json")));
  ensure(
    Array.isArray(manifest.animations) &&
      manifest.animations.length > 0 &&
      manifest.animations.length <= 32,
    "LOTTIE",
    "Invalid animation list",
  );
  // State-machine execution is a separate capability; passive timeline packages only here.
  ensure(
    !manifest.stateMachines?.length,
    "LOTTIE_STATE",
    "State-machine packages need a reviewed adapter",
  );
  const paths = new Set(["manifest.json"]);
  for (const a of manifest.animations) {
    ensure(/^[\w-]{1,100}$/.test(a.id), "LOTTIE", "Invalid animation ID");
    const name = files.has(`a/${a.id}.json`)
      ? `a/${a.id}.json`
      : `animations/${a.id}.json`;
    ensure(files.has(name), "LOTTIE", "Missing animation");
    inspectLottie(parseJSON(text(files.get(name))));
    paths.add(name);
  }
  for (const path of files.keys())
    ensure(paths.has(path), "LOTTIE", "Undeclared nested asset " + path);
  return { manifest, files };
}
