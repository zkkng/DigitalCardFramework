import { buildPackage, importPackage } from "./package.js";
import { validateManifest, validateScene } from "./validate.js";
import { ensure, sha256 } from "./data.js";
import { rasterDimensions } from "./media.js";
export const materialPresets = Object.freeze({
  "Fine silver": {
    kind: "glitter",
    size: 2,
    density: 0.65,
    intensity: 1.8,
    roughness: 0.45,
    variation: 0.5,
    shape: "circle",
    color: "#e8edff",
    seed: 19,
  },
  "Chunky holo": {
    kind: "glitter",
    size: 12,
    density: 0.45,
    intensity: 2.6,
    roughness: 0.2,
    variation: 0.4,
    shape: "shard",
    seed: 23,
  },
  "Gold stars": {
    kind: "glitter",
    size: 18,
    density: 0.25,
    intensity: 2.2,
    roughness: 0.3,
    variation: 0.25,
    shape: "star",
    color: "#ffd47a",
    seed: 31,
  },
  "Soft foil": {
    kind: "foil",
    angle: 0.5,
    radius: 0.25,
    intensity: 0.7,
    mode: "surface",
  },
  "Lake reflection": {
    kind: "water",
    sweep: 0.5,
    radius: 0.2,
    intensity: 0.45,
    mode: "surface",
  },
  "Feathered bloom": {
    kind: "bloom",
    progress: 1,
    feather: 0.28,
    center: [0.5, 0.5],
  },
});
export function createProject(pkg) {
  let revision = 0;
  const project = {
    manifest: structuredClone(pkg.manifest),
    scenes: structuredClone(pkg.scenes),
    assets: new Map(
      pkg.manifest.assets.map((a) => [a.path, pkg.files.get(a.path).slice()]),
    ),
    undo: [],
    redo: [],
  };
  const snapshot = () => ({
    manifest: structuredClone(project.manifest),
    scenes: structuredClone(project.scenes),
    assets: structuredClone(project.assets),
  });
  const restore = (s) => {
    project.manifest = s.manifest;
    project.scenes = s.scenes;
    project.assets = s.assets;
  };
  return Object.assign(project, {
    getRevision: () => revision,
    edit(fn) {
      const previous = snapshot();
      try {
        fn(project);
        validateManifest(project.manifest);
        for (const s of project.scenes.values())
          validateScene(s, project.manifest);
      } catch (error) {
        restore(previous);
        throw error;
      }
      project.undo.push(previous);
      if (project.undo.length > 30) project.undo.shift();
      project.redo = [];
      revision++;
    },
    undoEdit() {
      if (!project.undo.length) return false;
      project.redo.push(snapshot());
      restore(project.undo.pop());
      revision++;
      return true;
    },
    redoEdit() {
      if (!project.redo.length) return false;
      project.undo.push(snapshot());
      restore(project.redo.pop());
      revision++;
      return true;
    },
    async export({ retainSources = false } = {}) {
      const manifest = structuredClone(project.manifest),
        scenes = structuredClone(
          new Map(
            [...project.scenes].filter(([path]) =>
              Object.values(manifest.faces).some((f) => f.scene === path),
            ),
          ),
        ),
        assets = structuredClone(project.assets);
      if (!retainSources) {
        const used = new Set(
          Object.values(manifest.faces).map((f) => f.poster),
        );
        function collect(nodes) {
          for (const n of nodes) {
            for (const id of [
              n.asset,
              n.mask?.asset,
              n.material?.maskAsset,
              n.material?.flakeAsset,
              n.video?.poster,
              n.data?.asset,
              ...(n.animation?.frames ?? []).map((f) => f.asset),
            ])
              if (id) used.add(id);
            if (n.children) collect(n.children);
          }
        }
        for (const s of scenes.values()) collect(s.nodes);
        manifest.assets = manifest.assets.filter((a) => used.has(a.id));
      }
      return buildPackage(manifest, scenes, assets);
    },
    async addMedia(
      blob,
      {
        id = "media-" + crypto.randomUUID().replaceAll("-", ""),
        width,
        height,
        duration,
        role = "media",
      } = {},
    ) {
      ensure(
        [
          "video/webm",
          "video/mp4",
          "audio/wav",
          "audio/mpeg",
          "model/gltf-binary",
          "application/x-rive",
          "application/zip",
        ].includes(blob.type),
        "MEDIA",
        "Unsupported media",
      );
      ensure(blob.size <= 64 * 1024 * 1024, "LIMIT", "Media exceeds 64 MiB");
      const bytes = new Uint8Array(await blob.arrayBuffer()),
        asset = {
          id,
          path: `assets/${id}.bin`,
          mediaType: blob.type,
          bytes: bytes.length,
          sha256: await sha256(bytes),
          role,
          ...(width ? { width, height } : {}),
          ...(duration ? { duration } : {}),
        };
      project.edit((p) => {
        p.manifest.assets.push(asset);
        p.assets.set(asset.path, bytes);
      });
      return asset;
    },
    async addImage(
      blob,
      {
        id = "image-" + crypto.randomUUID().replaceAll("-", ""),
        role = "color",
      } = {},
    ) {
      ensure(
        ["image/png", "image/webp", "image/jpeg"].includes(blob.type),
        "MEDIA",
        "Use PNG, WebP or JPEG",
      );
      ensure(blob.size <= 32 * 1024 * 1024, "LIMIT", "Image exceeds 32 MiB");
      const bytes = new Uint8Array(await blob.arrayBuffer()),
        { width, height } = rasterDimensions(bytes, blob.type);
      const extension = {
          "image/png": "png",
          "image/webp": "webp",
          "image/jpeg": "jpg",
        }[blob.type],
        asset = {
          id,
          path: `assets/${id}.${extension}`,
          mediaType: blob.type,
          bytes: bytes.length,
          sha256: await sha256(bytes),
          width,
          height,
          role,
        };
      project.edit((p) => {
        p.manifest.assets.push(asset);
        p.assets.set(asset.path, bytes);
      });
      return asset;
    },
    async setPosters(posters) {
      const expected = revision,
        additions = [];
      for (const [side, blob] of Object.entries(posters)) {
        ensure(["front", "back"].includes(side), "SIDE", "Unknown face");
        ensure(
          ["image/png", "image/jpeg", "image/webp"].includes(blob.type) &&
            blob.size <= 32 * 1024 * 1024,
          "MEDIA",
          "Invalid poster",
        );
        const bytes = new Uint8Array(await blob.arrayBuffer()),
          dimensions = rasterDimensions(bytes, blob.type),
          id = "poster-" + crypto.randomUUID().replaceAll("-", ""),
          extension = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
          }[blob.type];
        additions.push({
          side,
          bytes,
          asset: {
            id,
            path: `previews/${id}.${extension}`,
            mediaType: blob.type,
            ...dimensions,
            role: "poster",
            bytes: bytes.length,
            sha256: await sha256(bytes),
          },
        });
      }
      ensure(
        revision === expected,
        "CONFLICT",
        "Project changed while preparing posters; capture again",
      );
      project.edit((p) => {
        for (const { side, bytes, asset } of additions) {
          p.manifest.assets.push(asset);
          p.assets.set(asset.path, bytes);
          p.manifest.faces[side].poster = asset.id;
        }
      });
    },
    async saveDraft(key = "digital-card-studio") {
      const state = snapshot();
      const db = await openDrafts();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("projects", "readwrite");
          tx.objectStore("projects").put(state, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    serialize() {
      return snapshot();
    },
  });
}
export async function openProject(bytes) {
  return createProject(await importPackage(bytes));
}
function openDrafts() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("digital-card-authoring", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("projects");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function loadDraft(key = "digital-card-studio") {
  const db = await openDrafts();
  try {
    const state = await new Promise((resolve, reject) => {
      const req = db.transaction("projects").objectStore("projects").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!state) return null;
    validateManifest(state.manifest);
    for (const s of state.scenes.values()) validateScene(s, state.manifest);
    return createProject({ ...state, files: state.assets });
  } finally {
    db.close();
  }
}

export async function blankPackage() {
  const canvas = document.createElement("canvas");
  canvas.width = 500;
  canvas.height = 750;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#182030";
  ctx.fillRect(0, 0, 500, 750);
  const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    ),
    bytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = canvas.height = 0;
  const manifest = {
    format: "digital-card",
    contractVersion: "0.1.0",
    id: "card." + crypto.randomUUID().replaceAll("-", ""),
    revision: 1,
    title: "Untitled card",
    summary: "An editable card project.",
    profile: "portable",
    canvas: { width: 1000, height: 1500 },
    faces: {
      front: {
        scene: "scenes/front.json",
        poster: "front",
        description: "Front of the card",
      },
      back: {
        scene: "scenes/back.json",
        poster: "back",
        description: "Back of the card",
      },
    },
    assets: ["front", "back"].map((id) => ({
      id,
      path: `assets/${id}.png`,
      mediaType: "image/png",
      sha256: "0".repeat(64),
      bytes: bytes.length,
      width: 500,
      height: 750,
      role: "poster",
    })),
    capabilities: {
      required: ["dc.scene2d@0.1", "dc.motion@0.1", "dc.materials@0.1"],
      optional: [],
    },
    quality: {
      poster: { maxEdge: 750 },
      lite: { maxEdge: 768 },
      standard: { maxEdge: 1536 },
    },
  };
  const scenes = new Map(
    ["front", "back"].map((side) => [
      `scenes/${side}.json`,
      {
        dialect: "dc.scene2d@0.1",
        nodes: [
          {
            id: "background",
            type: "image",
            asset: side,
            x: 0,
            y: 0,
            width: 1000,
            height: 1500,
          },
        ],
      },
    ]),
  );
  return buildPackage(
    manifest,
    scenes,
    new Map(manifest.assets.map((a) => [a.path, bytes])),
  );
}
