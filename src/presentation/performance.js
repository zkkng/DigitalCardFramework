import { ensure } from "./data.js";

const MiB = 1024 * 1024;
/** Conservative authoring heuristics, not a prediction for a particular phone. */
export const mobilePerformanceDefaults = Object.freeze({
  mode: "warn",
  quality: "standard",
  layerTextureBytes: 8 * MiB,
  faceTextureBytes: 48 * MiB,
  layerDownloadBytes: 4 * MiB,
  drawLayers: 40,
  fullCanvasPasses: 12,
  animationFrames: 48,
  animatedPixels: 16 * 1024 * 1024,
  decoders: 1,
});

export function performancePolicy(overrides = {}) {
  ensure(
    overrides && typeof overrides === "object" && !Array.isArray(overrides),
    "PERFORMANCE_POLICY",
    "Invalid performance policy",
  );
  for (const key of Object.keys(overrides))
    ensure(
      Object.hasOwn(mobilePerformanceDefaults, key),
      "PERFORMANCE_POLICY",
      "Unknown performance option: " + key,
    );
  const policy = { ...mobilePerformanceDefaults, ...overrides };
  ensure(
    ["warn", "reject", "off"].includes(policy.mode),
    "PERFORMANCE_POLICY",
    "Use warn, reject or off",
  );
  ensure(
    ["poster", "lite", "standard", "ultra"].includes(policy.quality),
    "PERFORMANCE_POLICY",
    "Unknown analysis quality",
  );
  for (const [key, value] of Object.entries(policy))
    if (!["mode", "quality"].includes(key))
      ensure(
        Number.isFinite(value) && value > 0,
        "PERFORMANCE_POLICY",
        "Invalid threshold: " + key,
      );
  return Object.freeze(policy);
}

/** Accepts a validated package or project. No media decode, network or DOM required. */
export function analyzePerformance({ manifest, scenes }, overrides = {}) {
  const policy = performancePolicy(overrides),
    issues = [],
    layers = [],
    faces = {};
  const assets = new Map(manifest.assets.map((a) => [a.id, a]));
  const edge = (
    manifest.quality[policy.quality] ??
    manifest.quality.lite ??
    manifest.quality.poster
  ).maxEdge;
  const cost = (id) => {
    const a = assets.get(id);
    if (!a) return { bytes: 0, download: 0, pixels: 0 };
    const pixels = (a.width ?? 0) * (a.height ?? 0);
    const ratio = Math.min(1, edge / Math.max(a.width ?? 1, a.height ?? 1));
    return {
      bytes:
        Math.ceil((a.width ?? 0) * ratio) *
        Math.ceil((a.height ?? 0) * ratio) *
        4,
      download: a.bytes ?? 0,
      pixels,
    };
  };
  const warn = (layer, code, measured, threshold, message, remedy) => {
    if (policy.mode !== "off")
      issues.push({
        severity: "warning",
        face: layer.face,
        layerId: layer.layerId,
        path: layer.path,
        assetIds: layer.assetIds,
        code,
        measured,
        threshold,
        message,
        remedy,
      });
  };
  for (const [face, ref] of Object.entries(manifest.faces)) {
    const seen = new Set(),
      own = [],
      summary = {
        estimatedTextureBytes: 0,
        drawLayers: 0,
        fullCanvasPasses: 0,
        decoders: 0,
      };
    function visit(nodes, parent = "") {
      for (const n of nodes) {
        const path = parent + "/" + n.id;
        if (n.children) {
          visit(n.children, path);
          continue;
        }
        const ids = [
          ...new Set(
            [
              n.asset,
              n.typography?.fontAsset,
              ...(n.runs??[]).map(r=>r.icon),
              n.data?.asset,
              n.mask?.asset,
              n.video?.poster,
              n.material?.maskAsset,
              n.material?.mask?.asset,
              n.material?.flakeAsset,
              ...(n.animation?.frames ?? []).map((f) => f.asset),
            ].filter(Boolean),
          ),
        ];
        const values = ids.map(cost);
        const layer = {
          face,
          layerId: n.id,
          path,
          assetIds: ids,
          estimatedTextureBytes: values.reduce((s, a) => s + a.bytes, 0),
          downloadBytes: values.reduce((s, a) => s + a.download, 0),
        };
        if (n.type === "text") {
          const ratio = Math.min(
            1,
            edge / Math.max(n.width ?? 1, n.height ?? 1),
          );
          const textBytes =
            Math.ceil((n.width ?? 0) * ratio) *
            Math.ceil((n.height ?? 0) * ratio) *
            4;
          layer.estimatedTextureBytes += textBytes;
          summary.estimatedTextureBytes += textBytes;
        }
        layers.push(layer);
        own.push(layer);
        for (const id of ids)
          if (!seen.has(id)) {
            seen.add(id);
            summary.estimatedTextureBytes += cost(id).bytes;
          }
        summary.drawLayers++;
        summary.fullCanvasPasses += Math.min(
          1,
          Math.abs(
            (n.width ?? manifest.canvas.width) *
              (n.height ?? manifest.canvas.height),
          ) /
            (manifest.canvas.width * manifest.canvas.height),
        );
        if (["video", "audio", "adapter"].includes(n.type)) {
          summary.decoders++;
          warn(
            layer,
            "ADAPTER_COST_UNKNOWN",
            null,
            null,
            "Animated/programmable layer requires device profiling; media buffers and custom shader cost cannot be inferred reliably.",
            "Supply a lightweight fallback and measure this layer on target devices.",
          );
        }
        for (const [field, limit, code, remedy] of [
          [
            "estimatedTextureBytes",
            "layerTextureBytes",
            "LAYER_TEXTURE",
            "Reduce resolution, crop transparent margins, or reduce simultaneously resident frame assets.",
          ],
          [
            "downloadBytes",
            "layerDownloadBytes",
            "LAYER_DOWNLOAD",
            "Compress the source or supply a smaller quality variant.",
          ],
        ])
          if (layer[field] > policy[limit])
            warn(
              layer,
              code,
              layer[field],
              policy[limit],
              "Layer exceeds the configured mobile " + field + " threshold.",
              remedy,
            );
        const frames = n.animation?.frames ?? [];
        if (frames.length > policy.animationFrames)
          warn(
            layer,
            "ANIMATION_FRAMES",
            frames.length,
            policy.animationFrames,
            "Many animation frames increase loading and memory pressure.",
            "Use a shorter sequence or a bounded video adapter.",
          );
        const pixels = values.reduce((s, a) => s + a.pixels, 0);
        if (frames.length && pixels > policy.animatedPixels)
          warn(
            layer,
            "ANIMATION_PIXELS",
            pixels,
            policy.animatedPixels,
            "Decoded animation pixels exceed the mobile threshold.",
            "Reduce frame dimensions or frame count.",
          );
      }
    }
    visit(scenes.get(ref.scene).nodes);
    faces[face] = summary;
    // Aggregate warnings point to each contributing layer, not an arbitrary scapegoat.
    for (const [field, limit, code] of [
      ["estimatedTextureBytes", "faceTextureBytes", "FACE_TEXTURE"],
      ["drawLayers", "drawLayers", "FACE_LAYERS"],
      ["fullCanvasPasses", "fullCanvasPasses", "FACE_OVERDRAW"],
      ["decoders", "decoders", "FACE_DECODERS"],
    ]) {
      if (summary[field] > policy[limit])
        for (const layer of own)
          warn(
            layer,
            code,
            summary[field],
            policy[limit],
            "This layer contributes to a face that exceeds the " +
              field +
              " threshold.",
            "Inspect contributing layers; crop, merge static layers, lower quality or reduce concurrent animations.",
          );
    }
  }
  return {
    version: 1,
    policy,
    issues,
    layers,
    faces,
    accepted: policy.mode !== "reject" || issues.length === 0,
    caveat:
      "Estimates exclude driver overhead, framebuffer allocation and unknown adapter internals. These are configurable heuristics, not an iPhone benchmark.",
  };
}

export function enforcePerformance(report) {
  if (!report.accepted) {
    const error = new Error(
      "Performance policy rejected the upload: " +
        report.issues
          .map((i) => `${i.face}${i.path}: ${i.code}`)
          .slice(0, 8)
          .join("; "),
    );
    error.code = "PERFORMANCE_POLICY";
    error.report = report;
    throw error;
  }
  return report;
}
