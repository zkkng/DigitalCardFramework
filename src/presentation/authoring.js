import { ensure } from "./data.js";
import { rasterDimensions } from "./media.js";
import { buildPackage, importPackage } from "./package.js";
import { createProject, materialPresets } from "./project.js";
import { validatePresentationReference } from "./integration.js";

/** A flat image uses exactly the same scene/material contract as layered art. */
export async function imagePackage({
  bytes,
  mediaType,
  id = "card." + crypto.randomUUID().replaceAll("-", ""),
  title = "Untitled card",
  back,
}) {
  const front = { bytes, mediaType },
    faces = {},
    assets = [],
    files = new Map(),
    scenes = new Map();
  const canvas = rasterDimensions(bytes, mediaType);
  for (const [side, image] of Object.entries({ front, back: back ?? front })) {
    const dimensions = rasterDimensions(image.bytes, image.mediaType);
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[image.mediaType];
    ensure(extension, "MEDIA", "Use JPEG, PNG or WebP");
    const asset = {
      id: side,
      path: `assets/${side}.${extension}`,
      mediaType: image.mediaType,
      ...dimensions,
      role: "poster",
      bytes: image.bytes.length,
      sha256: "0".repeat(64),
    };
    assets.push(asset);
    files.set(asset.path, image.bytes);
    faces[side] = {
      scene: `scenes/${side}.json`,
      poster: side,
      description: `${title} (${side})`,
    };
    scenes.set(faces[side].scene, {
      dialect: "dc.scene2d@0.1",
      nodes: [{ id: "art", type: "image", asset: side, x: 0, y: 0, ...canvas }],
    });
  }
  return buildPackage(
    {
      format: "digital-card",
      contractVersion: "0.1.0",
      id,
      revision: 1,
      title,
      summary: title,
      profile: "portable",
      canvas,
      faces,
      assets,
      capabilities: {
        required: ["dc.scene2d@0.1", "dc.materials@0.1", "dc.motion@0.1"],
        optional: [],
      },
      quality: {
        poster: { maxEdge: 768 },
        lite: { maxEdge: 768 },
        standard: { maxEdge: 1536 },
        ultra: { maxEdge: 2048 },
      },
    },
    scenes,
    files,
  );
}

const defaultEffects = {
  material(node, parameters) {
    return { ...node, material: structuredClone(parameters) };
  },
  preset(node, { name, ...overrides }) {
    ensure(materialPresets[name], "EFFECT", "Unknown material preset " + name);
    const material = {
      ...structuredClone(materialPresets[name]),
      ...overrides,
    };
    const target =
      material.kind === "water"
        ? "material.sweep"
        : material.kind === "bloom"
          ? "material.progress"
          : "material.angle";
    return {
      ...node,
      material,
      bindings: { ...node.bindings, [target]: ["input", "angle"] },
    };
  },
};

/** Host-installed functions are trusted. Uploaded configuration contains data only. */
export function createAuthoring({
  importers = {},
  effects = {},
  transform = async () => {},
  publish,
  commitCatalog,
  validateCatalog = () => {},
  onEvent = () => {},
} = {}) {
  const sources = {
    image: (source) => imagePackage(source),
    dcard: (source) => importPackage(source.bytes),
    ...importers,
  };
  const recipes = { ...defaultEffects, ...effects };
  // Observers cannot make a successful publication appear to fail and trigger a duplicate retry.
  const emit = (event) => {
    try {
      Promise.resolve(onEvent(Object.freeze(event))).catch(() => {});
    } catch {}
  };
  async function build(request, { signal } = {}) {
    const operationId = request.id ?? crypto.randomUUID();
    emit({ type: "build.started", operationId });
    try {
      signal?.throwIfAborted();
      const importer = sources[request.source?.format ?? "image"];
      ensure(
        typeof importer === "function",
        "IMPORTER",
        "No importer registered for this source format",
      );
      let pkg = await importer(
        {
          ...request.source,
          ...(request.id ? { id: request.id } : {}),
          ...(request.title ? { title: request.title } : {}),
        },
        { signal, request },
      );
      signal?.throwIfAborted();
      const project = createProject(pkg);
      project.edit((p) => {
        if (request.id) p.manifest.id = request.id;
        if (request.title) p.manifest.title = request.title;
        for (const effect of request.effects ?? []) {
          const recipe = recipes[effect.id];
          ensure(
            typeof recipe === "function",
            "EFFECT",
            "Unknown effect recipe " + effect.id,
          );
          const side = effect.side ?? "front";
          ensure(p.manifest.faces[side], "EFFECT", "Unknown face");
          let found = false;
          const visit = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
              const n = nodes[i];
              if (n.id === effect.node) {
                ensure(!found, "EFFECT", "Ambiguous target");
                found = true;
                const result = recipe(
                  structuredClone(n),
                  structuredClone(effect.parameters ?? {}),
                  { manifest: structuredClone(p.manifest), side },
                );
                ensure(
                  result && typeof result === "object" && !result.then,
                  "EFFECT",
                  "Effect recipes must return nodes synchronously",
                );
                nodes.splice(
                  i,
                  1,
                  ...(Array.isArray(result) ? result : [result]),
                );
                break;
              }
              if (n.children) visit(n.children);
            }
          };
          visit(p.scenes.get(p.manifest.faces[side].scene).nodes);
          ensure(found, "EFFECT", "No layer named " + effect.node);
        }
      });
      await transform(project, { request, signal });
      signal?.throwIfAborted();
      pkg = await project.export();
      emit({ type: "build.completed", operationId, digest: pkg.digest });
      return pkg;
    } catch (error) {
      emit({
        type: "build.failed",
        operationId,
        code: error.code ?? "ERROR",
        message: error.message,
      });
      throw error;
    }
  }
  async function buildBatch(requests, options = {}) {
    ensure(
      Array.isArray(requests) && requests.length > 0 && requests.length <= 1000,
      "BATCH",
      "Provide 1–1000 cards",
    );
    const ids = new Set();
    for (const r of requests) {
      ensure(
        typeof r.id === "string" && !ids.has(r.id),
        "BATCH",
        "Batch cards need unique stable IDs",
      );
      ids.add(r.id);
    }
    const result = [];
    for (const request of requests) result.push(await build(request, options));
    return result;
  }
  async function publishPack({ cards, catalog, key }, { signal } = {}) {
    ensure(
      typeof publish === "function" && typeof commitCatalog === "function",
      "PUBLISHER",
      "Provide presentation and catalog publishers",
    );
    ensure(
      typeof key === "string" && key.length > 0 && key.length <= 200,
      "IDEMPOTENCY",
      "A stable publication key is required",
    );
    ensure(
      catalog && Array.isArray(catalog.cards),
      "CATALOG",
      "Supply a complete host catalog",
    );
    const ids = new Set(catalog.cards.map((c) => c.id));
    ensure(
      ids.size === catalog.cards.length,
      "CATALOG",
      "Duplicate catalog card ID",
    );
    for (const card of cards)
      ensure(
        ids.has(card.id),
        "CATALOG",
        "Missing catalog definition for " + card.id,
      );
    const packages = await buildBatch(cards, { signal }),
      next = structuredClone(catalog);
    // Validate all content before any publication. Placeholder locations are replaced below.
    for (const pkg of packages)
      next.cards.find((c) => c.id === pkg.manifest.id).presentation = {
        contract: "digital-card@0.1",
        digest: pkg.digest,
        baseURL: "https://unpublished.invalid/" + pkg.digest.slice(7) + "/",
      };
    await validateCatalog(next);
    for (const pkg of packages) {
      signal?.throwIfAborted();
      const ref = validatePresentationReference(
        await publish(pkg, { signal, key: key + ":" + pkg.manifest.id }),
      );
      ensure(
        ref.digest === pkg.digest,
        "INTEGRITY",
        "Publisher returned a different card digest",
      );
      next.cards.find((c) => c.id === pkg.manifest.id).presentation = ref;
      emit({
        type: "presentation.published",
        key,
        id: pkg.manifest.id,
        digest: pkg.digest,
      });
    }
    signal?.throwIfAborted();
    await validateCatalog(next);
    const result = await commitCatalog(next, { signal, key });
    emit({
      type: "catalog.committed",
      key,
      digests: packages.map((p) => p.digest),
    });
    return { catalog: next, result, digests: packages.map((p) => p.digest) };
  }
  return {
    build,
    buildBatch,
    publishPack,
    describe: () => ({
      apiVersion: "0.1.0",
      importers: Object.keys(sources),
      effects: Object.keys(recipes),
      publication: !!publish && !!commitCatalog,
    }),
  };
}
