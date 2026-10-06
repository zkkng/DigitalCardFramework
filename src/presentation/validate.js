import { ensure, safePath, canonical } from "./data.js";
import { validateExpression } from "./motion.js";
import { validateTypography } from "./text.js";
import { validateField, reference } from "../card-policy.js";
export const CONTRACT = "0.1.0";
export const CAPABILITIES = [
  "dc.scene2d@0.1",
  "dc.motion@0.1",
  "dc.materials@0.1",
  "dc.frames@0.1",
  "dc.video@0.1",
  "dc.text@0.1",
  "dc.text@0.2",
  "dc.audio@0.1",
];
const id = (value) =>
  ensure(
    typeof value === "string" && /^[a-zA-Z][\w.-]{0,99}$/.test(value),
    "ID",
    "Invalid identifier",
  );
const number = (v, min = -1e6, max = 1e6) =>
  ensure(
    Number.isFinite(v) && v >= min && v <= max,
    "NUMBER",
    "Numeric field out of range",
  );
const keys = (o, allowed) => {
  ensure(
    o && typeof o === "object" && !Array.isArray(o),
    "TYPE",
    "Expected object",
  );
  for (const k of Object.keys(o))
    ensure(allowed.includes(k), "FIELD", "Unknown field " + k);
};
const string = (v, max = 4000) =>
  ensure(
    typeof v === "string" && v.length > 0 && v.length <= max,
    "STRING",
    "Invalid string",
  );
export function validateManifest(m) {
  keys(m, [
    "format",
    "contractVersion",
    "id",
    "revision",
    "title",
    "summary",
    "profile",
    "canvas",
    "faces",
    "assets",
    "capabilities",
    "quality",
    "credits",
    "inputs",
    "extensions",
    "authoring",
  ]);
  ensure(
    m.format === "digital-card" && m.contractVersion === CONTRACT,
    "VERSION",
    "Unsupported card contract",
  );
  id(m.id);
  number(m.revision, 1, 1e9);
  ensure(
    Number.isInteger(m.revision),
    "VERSION",
    "Revision must be an integer",
  );
  string(m.title, 200);
  string(m.summary);
  ensure(
    m.profile === "portable",
    "PROFILE",
    "Only self-contained portable packages are accepted",
  );
  keys(m.canvas, ["width", "height"]);
  number(m.canvas.width, 1, 10000);
  number(m.canvas.height, 1, 10000);
  ensure(
    Array.isArray(m.assets) && m.assets.length >= 2 && m.assets.length <= 2000,
    "ASSETS",
    "Invalid asset list",
  );
  const assets = new Map(),
    paths = new Set();
  for (const a of m.assets) {
    keys(a, [
      "id",
      "path",
      "mediaType",
      "sha256",
      "bytes",
      "width",
      "height",
      "duration",
      "role",
      "font",
    ]);
    id(a.id);
    safePath(a.path);
    ensure(
      a.path.startsWith("assets/") || a.path.startsWith("previews/"),
      "PATH",
      "Asset outside content directory",
    );
    ensure(
      !assets.has(a.id) && !paths.has(a.path.toLowerCase()),
      "DUPLICATE",
      "Duplicate asset or path",
    );
    ensure(/^[0-9a-f]{64}$/.test(a.sha256), "HASH", "Invalid asset hash");
    number(a.bytes, 1, 250 * 1024 * 1024);
    ensure(Number.isSafeInteger(a.bytes), "SIZE", "Invalid byte length");
    ensure(
      [
        "image/png",
        "image/webp",
        "image/jpeg",
        "video/mp4",
        "video/webm",
        "audio/mpeg",
        "audio/wav",
        "model/gltf-binary",
        "application/x-rive",
        "application/zip",
        "font/woff2",
        "font/woff",
        "font/ttf",
        "font/otf",
      ].includes(a.mediaType),
      "MEDIA",
      "Unsupported media type",
    );
    if (a.width !== undefined) number(a.width, 1, 16384);
    if (a.height !== undefined) number(a.height, 1, 16384);
    if (a.duration !== undefined) number(a.duration, 0, 3600);
    if (a.mediaType.startsWith("image/") || a.mediaType.startsWith("video/"))
      ensure(
        Number.isInteger(a.width) && Number.isInteger(a.height),
        "MEDIA",
        "Integer media dimensions required",
      );
    if (a.font) {
      ensure(
        a.mediaType.startsWith("font/"),
        "FONT",
        "Font metadata requires a font asset",
      );
      keys(a.font, ["family", "face", "license", "axes"]);
      string(a.font.family, 200);
      string(a.font.face, 200);
      string(a.font.license, 2000);
      for (const [axis, range] of Object.entries(a.font.axes ?? {})) {
        ensure(/^[A-Za-z]{4}$/.test(axis), "FONT", "Invalid font axis");
        keys(range, ["name", "min", "max", "default"]);
        string(range.name, 200);
        number(range.min, -10000, 10000);
        number(range.max, -10000, 10000);
        number(range.default, range.min, range.max);
      }
    }
    string(a.role, 60);
    assets.set(a.id, a);
    paths.add(a.path.toLowerCase());
  }
  ensure(
    m.assets
      .filter((a) => a.mediaType.startsWith("font/"))
      .reduce((sum, a) => sum + a.bytes, 0) <=
      32 * 1024 * 1024,
    "FONT_LIMIT",
    "Embedded fonts exceed 32 MiB",
  );
  keys(m.faces, ["front", "back"]);
  for (const side of ["front", "back"]) {
    const f = m.faces[side];
    keys(f, ["scene", "poster", "description"]);
    safePath(f.scene);
    ensure(
      f.scene.startsWith("scenes/") && f.scene.endsWith(".json"),
      "SCENE",
      "Invalid scene path",
    );
    ensure(
      assets.get(f.poster)?.role === "poster",
      "POSTER",
      "Missing face poster",
    );
    string(f.description);
  }
  keys(m.capabilities, ["required", "optional"]);
  ensure(
    Array.isArray(m.capabilities.required) &&
      Array.isArray(m.capabilities.optional),
    "CAPABILITY",
    "Invalid capabilities",
  );
  const caps = new Set();
  for (const c of [
    ...m.capabilities.required,
    ...m.capabilities.optional.map((c) => c.id),
  ]) {
    ensure(
      typeof c === "string" &&
        /^[a-z][a-z0-9.-]+@[0-9]+\.[0-9]+$/.test(c) &&
        !caps.has(c),
      "CAPABILITY",
      "Invalid or duplicate capability",
    );
    caps.add(c);
  }
  for (const c of m.capabilities.optional) {
    keys(c, ["id", "fallback"]);
    ensure(
      ["poster", "omit-decorative", "static-pose"].includes(c.fallback),
      "FALLBACK",
      "Missing fallback",
    );
  }
  keys(m.quality, ["poster", "lite", "standard", "ultra"]);
  ensure(
    m.quality.poster && m.quality.lite,
    "QUALITY",
    "Poster and lite renditions required",
  );
  for (const q of Object.values(m.quality)) {
    keys(q, ["maxEdge"]);
    number(q.maxEdge, 64, 4096);
  }
  if (m.inputs)
    for (const [name, input] of Object.entries(m.inputs)) {
      ensure(
        /^host\.[a-z][\w.-]+$/.test(name),
        "INPUT",
        "Host input must be namespaced",
      );
      keys(input, ["type", "default", "min", "max"]);
      ensure(
        ["number", "boolean"].includes(input.type),
        "INPUT",
        "Unsupported host input type",
      );
      ensure(
        typeof input.default === input.type,
        "INPUT",
        "Wrong input default type",
      );
      if (input.min !== undefined) number(input.min);
      if (input.max !== undefined) number(input.max);
      if (input.type === "number") {
        number(input.default);
        ensure(
          (input.min ?? -1e6) <= (input.max ?? 1e6) &&
            input.default >= (input.min ?? -1e6) &&
            input.default <= (input.max ?? 1e6),
          "INPUT",
          "Invalid host input bounds/default",
        );
      } else
        ensure(
          input.min === undefined && input.max === undefined,
          "INPUT",
          "Boolean inputs cannot have numeric bounds",
        );
    }
  if (m.authoring) {
    const a = m.authoring;
    keys(a, [
      "context",
      "fields",
      "values",
      "template",
      "masks",
      "policyRevision",
    ]);
    if (a.context) {
      keys(a.context, ["cardId", "lineId", "type", "variantId"]);
      for (const value of Object.values(a.context)) id(value);
    }
    if (a.fields) {
      ensure(
        Array.isArray(a.fields) && a.fields.length <= 128,
        "STAT",
        "Too many fields",
      );
      a.fields.forEach((f) => validateField(f));
      ensure(
        new Set(a.fields.map((f) => (f.scope ?? "card") + ":" + f.key)).size ===
          a.fields.length,
        "STAT",
        "Duplicate fields",
      );
    }
    if (a.values) {
      keys(a.values, ["card", "variant"]);
      for (const value of Object.values(a.values)) {
        ensure(
          value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.keys(value).length <= 128,
          "STAT",
          "Invalid snapshot values",
        );
      }
    }
    if (a.template)
      ensure(reference(a.template), "TEMPLATE", "Invalid template revision");
    if (a.masks) {
      ensure(
        Object.keys(a.masks).length <= 1024,
        "MASK",
        "Too many mask references",
      );
      for (const value of Object.values(a.masks))
        ensure(reference(value), "MASK", "Invalid mask revision");
    }
    if (a.policyRevision !== undefined) {
      number(a.policyRevision, 0, 1e9);
      ensure(
        Number.isInteger(a.policyRevision),
        "POLICY",
        "Invalid policy revision",
      );
    }
  }
  ensure(canonical(m).length <= 8 * 1024 * 1024, "LIMIT", "Manifest too large");
  return { assets, capabilities: caps };
}
const nodeFields = [
  "id",
  "name",
  "sampling",
  "type",
  "asset",
  "rect",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "scaleX",
  "scaleY",
  "pivotX",
  "pivotY",
  "opacity",
  "parallax",
  "brightness",
  "saturation",
  "blend",
  "mask",
  "material",
  "bindings",
  "animation",
  "children",
  "text",
  "typography",
  "runs",
  "stat",
  "locked",
  "readingOrder",
  "font",
  "color",
  "video",
  "audio",
  "adapter",
  "data",
];
const mutable = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "scaleX",
  "scaleY",
  "opacity",
  "brightness",
  "saturation",
  "material.progress",
  "material.angle",
  "material.intensity",
  "material.radius",
  "material.sweep",
];
export function validateScene(scene, manifest) {
  keys(scene, ["dialect", "nodes", "background"]);
  ensure(
    scene.dialect === "dc.scene2d@0.1",
    "DIALECT",
    "Unsupported scene dialect",
  );
  ensure(
    Array.isArray(scene.nodes) && scene.nodes.length <= 512,
    "LIMIT",
    "Scene node limit",
  );
  if (scene.background !== undefined)
    ensure(
      scene.background === "transparent" ||
        /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(scene.background),
      "COLOR",
      "Invalid scene background",
    );
  const { assets } = validateManifest(manifest),
    ids = new Set();
  let count = 0,
    textCharacters = 0,
    ops = 0;
  const expression = (e) => {
    ops += validateExpression(e, {
      hostInputs: Object.keys(manifest.inputs ?? {}),
    });
    ensure(ops <= 16384, "GRAPH_LIMIT", "Scene motion graph budget");
  };
  const rect = (r, a) => {
    ensure(
      Array.isArray(r) && r.length === 4,
      "RECT",
      "Invalid source rectangle",
    );
    r.forEach((v) => number(v, 0, 16384));
    ensure(
      r[2] > 0 && r[3] > 0 && r[0] + r[2] <= a.width && r[1] + r[3] <= a.height,
      "RECT",
      "Crop exceeds asset bounds",
    );
  };
  function visit(n, depth) {
    ensure(depth <= 16 && ++count <= 512, "LIMIT", "Scene complexity limit");
    keys(n, nodeFields);
    id(n.id);
    ensure(!ids.has(n.id), "DUPLICATE", "Duplicate node ID");
    ids.add(n.id);
    ensure(
      ["image", "video", "audio", "group", "text", "adapter"].includes(n.type),
      "NODE",
      "Unsupported node type",
    );
    for (const f of [
      "x",
      "y",
      "rotation",
      "scaleX",
      "scaleY",
      "pivotX",
      "pivotY",
    ])
      if (n[f] !== undefined) number(n[f]);
    for (const f of ["width", "height"])
      if (!["group", "audio"].includes(n.type)) number(n[f], 0.001, 20000);
    if (n.type === "group")
      ensure(
        !n.mask && !n.material && (!n.blend || n.blend === "normal"),
        "GROUP_COMPOSITING",
        "Isolated group masks/materials/blends require a prebaked image or a host adapter",
      );
    if (n.opacity !== undefined) number(n.opacity, 0, 1);
    if (n.brightness !== undefined) number(n.brightness, 0, 10);
    if (n.saturation !== undefined) number(n.saturation, 0, 10);
    if (n.sampling !== undefined)
      ensure(
        ["linear", "nearest"].includes(n.sampling),
        "SAMPLING",
        "Unknown sampling mode",
      );
    if (n.parallax) {
      ensure(n.parallax.length === 2, "NODE", "Invalid parallax");
      n.parallax.forEach((v) => number(v, -1000, 1000));
    }
    if (["image", "video"].includes(n.type)) {
      ensure(assets.has(n.asset), "REFERENCE", "Unknown asset " + n.asset);
      ensure(
        assets
          .get(n.asset)
          .mediaType.startsWith(n.type === "image" ? "image/" : "video/"),
        "MEDIA",
        "Node asset has wrong media type",
      );
      if (n.rect) rect(n.rect, assets.get(n.asset));
    }
    if (n.blend)
      ensure(
        ["normal", "screen", "add", "multiply"].includes(n.blend),
        "BLEND",
        "Unsupported blend",
      );
    if (n.mask) {
      keys(n.mask, ["asset", "polygon", "invert"]);
      if (n.mask.invert !== undefined)
        ensure(typeof n.mask.invert === "boolean", "MASK", "Mask inversion must be boolean");
      ensure(
        !(n.mask.asset && n.mask.polygon),
        "MASK",
        "Choose one mask source per node",
      );
      ensure(n.mask.asset || n.mask.polygon, "MASK", "Missing mask");
      if (n.mask.asset)
        ensure(
          assets.get(n.mask.asset)?.mediaType.startsWith("image/"),
          "MASK",
          "Unknown mask image",
        );
      if (n.mask.polygon) {
        ensure(
          Array.isArray(n.mask.polygon) &&
            n.mask.polygon.length >= 3 &&
            n.mask.polygon.length <= 64,
          "MASK",
          "Invalid polygon",
        );
        for (const point of n.mask.polygon) {
          ensure(point.length === 2, "MASK", "Invalid point");
          point.forEach((v) => number(v, 0, 1));
        }
      }
    }
    if (n.material) {
      keys(n.material, [
        "kind",
        "progress",
        "angle",
        "intensity",
        "radius",
        "feather",
        "center",
        "sweep",
        "size",
        "density",
        "seed",
        "shape",
        "color",
        "flakeAsset",
        "flakeColor",
        "maskAsset",
        "mode",
        "roughness",
        "variation",
      ]);
      ensure(
        ["bloom", "water", "glitter", "spot", "foil"].includes(n.material.kind),
        "MATERIAL",
        "Unknown material",
      );
      for (const key of ["size", "radius", "feather"])
        if (n.material[key] !== undefined)
          number(n.material[key], 0.0001, 10000);
      for (const key of ["density", "roughness", "variation"])
        if (n.material[key] !== undefined) number(n.material[key], 0, 1);
      for (const [k, v] of Object.entries(n.material))
        if (
          ![
            "kind",
            "center",
            "shape",
            "color",
            "flakeAsset",
            "flakeColor",
            "maskAsset",
            "mode",
          ].includes(k)
        )
          number(v, -100, 1e6);
      if (n.material.center) {
        ensure(n.material.center.length === 2, "MATERIAL", "Invalid center");
        n.material.center.forEach((v) => number(v, 0, 1));
      }
      for (const key of ["flakeAsset", "maskAsset"])
        if (n.material[key])
          ensure(
            assets.get(n.material[key])?.mediaType.startsWith("image/"),
            "MATERIAL",
            "Unknown material image",
          );
      if (n.material.flakeColor !== undefined)
        ensure(
          ["holo", "texture"].includes(n.material.flakeColor),
          "MATERIAL",
          "Invalid flake color mode",
        );
      if (n.material.shape)
        ensure(
          ["circle", "hexagon", "shard", "star"].includes(n.material.shape),
          "MATERIAL",
          "Unknown flake shape",
        );
      if (n.material.mode)
        ensure(
          ["overlay", "surface"].includes(n.material.mode),
          "MATERIAL",
          "Unknown material mode",
        );
      if (n.material.color)
        ensure(
          /^#[0-9a-f]{6}$/i.test(n.material.color),
          "COLOR",
          "Invalid material color",
        );
    }
    if (n.bindings)
      for (const [property, e] of Object.entries(n.bindings)) {
        ensure(
          mutable.includes(property),
          "BINDING",
          "Property cannot be animated: " + property,
        );
        if (property.startsWith("material."))
          ensure(n.material, "BINDING", "Missing target material");
        expression(e);
      }
    if (n.animation) {
      keys(n.animation, ["progress", "loop", "frames"]);
      expression(n.animation.progress);
      ensure(
        Array.isArray(n.animation.frames) &&
          n.animation.frames.length >= 2 &&
          n.animation.frames.length <= 100,
        "FRAMES",
        "Invalid frames",
      );
      for (const f of n.animation.frames) {
        keys(f, [
          "asset",
          "rect",
          "x",
          "y",
          "width",
          "height",
          "duration",
          "name",
        ]);
        ensure(
          assets.get(f.asset)?.mediaType.startsWith("image/"),
          "FRAME",
          "Missing frame image",
        );
        rect(f.rect, assets.get(f.asset));
        for (const k of ["x", "y", "width", "height", "duration"])
          number(
            f[k],
            k === "duration" ? 1 : -20000,
            k === "duration" ? 3600000 : 20000,
          );
      }
    }
    if (n.video) {
      keys(n.video, ["mode", "loop", "muted", "poster"]);
      ensure(
        ["autoplay-muted", "on-activate"].includes(n.video.mode) &&
          n.video.muted === true,
        "VIDEO",
        "Invalid playback policy",
      );
      ensure(
        assets.get(n.video.poster)?.role === "poster",
        "VIDEO",
        "Video poster required",
      );
    }
    if (n.type === "video") ensure(n.video, "VIDEO", "Video policy required");
    if (n.type === "audio") {
      ensure(
        assets.get(n.asset)?.mediaType.startsWith("audio/"),
        "AUDIO",
        "Missing audio asset",
      );
      keys(n.audio, ["loop", "volume"]);
      ensure(typeof n.audio.loop === "boolean", "AUDIO", "Invalid audio loop");
      number(n.audio.volume, 0, 1);
    }
    if (n.locked !== undefined)
      ensure(typeof n.locked === "boolean", "NODE", "Invalid layer lock");
    if (n.type === "text") {
      textCharacters +=
        n.runs?.reduce(
          (sum, r) => sum + (r.text?.length ?? 0) + (r.icon ? 1 : 0),
          0,
        ) ??
        n.text?.length ??
        0;
      ensure(
        textCharacters <= 50000,
        "TEXT_LIMIT",
        "A face may contain at most 50000 text characters",
      );
      ensure(
        typeof n.text === "string" && n.text.length <= 10000,
        "TEXT",
        "Invalid text",
      );
      validateTypography(n, assets);
      ensure(
        !n.font || /^[\w ,.-]{1,100}$/.test(n.font),
        "FONT",
        "Invalid font family",
      );
      ensure(
        !n.color || /^#[0-9a-f]{6,8}$/i.test(n.color),
        "COLOR",
        "Invalid text color",
      );
    }
    if (n.type === "adapter") {
      string(n.adapter, 100);
      if (n.data?.asset)
        ensure(assets.has(n.data.asset), "REFERENCE", "Unknown adapter asset");
      ensure(
        canonical(n.data ?? {}).length <= 32768,
        "LIMIT",
        "Adapter data too large",
      );
    }
    if (n.children) {
      ensure(
        n.type === "group" && Array.isArray(n.children),
        "CHILDREN",
        "Only groups contain children",
      );
      n.children.forEach((c) => visit(c, depth + 1));
    }
  }
  scene.nodes.forEach((n) => visit(n, 0));
  return { nodes: count, operations: ops };
}
