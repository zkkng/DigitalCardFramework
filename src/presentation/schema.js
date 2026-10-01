/** JSON Schema supplies editor hints. validateManifest/validateScene enforce semantic constraints. */
const number = { type: "number" },
  string = { type: "string" },
  boolean = { type: "boolean" },
  id = { type: "string", pattern: "^[a-zA-Z][\\w.-]{0,99}$" };
const object = (properties, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const array = (items, minItems = 0, maxItems = 512) => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const pair = { type: "array", items: number, minItems: 2, maxItems: 2 },
  rect = { type: "array", items: number, minItems: 4, maxItems: 4 };
const asset = object(
  {
    id,
    path: string,
    mediaType: {
      enum: [
        "image/png",
        "image/webp",
        "image/jpeg",
        "video/mp4",
        "video/webm",
        "audio/wav",
        "audio/mpeg",
        "model/gltf-binary",
        "application/x-rive",
        "application/zip",
      ],
    },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    bytes: { type: "integer", minimum: 1, maximum: 262144000 },
    width: { type: "integer", minimum: 1, maximum: 16384 },
    height: { type: "integer", minimum: 1, maximum: 16384 },
    duration: { type: "number", minimum: 0, maximum: 3600 },
    role: string,
  },
  ["id", "path", "mediaType", "sha256", "bytes", "role"],
);
const face = object({ scene: string, poster: id, description: string }, [
  "scene",
  "poster",
  "description",
]);
const quality = object(
  { maxEdge: { type: "number", minimum: 64, maximum: 4096 } },
  ["maxEdge"],
);
export const manifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://digital-card.invalid/schema/manifest-0.1.0.json",
  ...object(
    {
      format: { const: "digital-card" },
      contractVersion: { const: "0.1.0" },
      id,
      revision: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      summary: { type: "string", minLength: 1, maxLength: 4000 },
      profile: { const: "portable" },
      canvas: object({ width: number, height: number }, ["width", "height"]),
      faces: object({ front: face, back: face }, ["front", "back"]),
      assets: array(asset, 2, 2000),
      capabilities: object(
        {
          required: array(string, 0, 2000),
          optional: array(
            object(
              {
                id: string,
                fallback: {
                  enum: ["poster", "omit-decorative", "static-pose"],
                },
              },
              ["id", "fallback"],
            ),
            0,
            2000,
          ),
        },
        ["required", "optional"],
      ),
      quality: object(
        { poster: quality, lite: quality, standard: quality, ultra: quality },
        ["poster", "lite"],
      ),
      credits: {},
      inputs: {
        type: "object",
        additionalProperties: object(
          {
            type: { enum: ["number", "boolean"] },
            default: { anyOf: [number, boolean] },
            min: number,
            max: number,
          },
          ["type", "default"],
        ),
      },
      extensions: {},
    },
    [
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
    ],
  ),
};
const material = object(
  {
    kind: { enum: ["bloom", "water", "glitter", "spot", "foil"] },
    progress: number,
    angle: number,
    intensity: number,
    radius: number,
    feather: number,
    center: pair,
    sweep: number,
    size: number,
    density: number,
    seed: number,
    shape: { enum: ["circle", "hexagon", "shard", "star"] },
    color: string,
    flakeAsset: id,
    maskAsset: id,
    mode: { enum: ["surface", "overlay"] },
    roughness: number,
    variation: number,
  },
  ["kind"],
);
const frame = object(
  {
    asset: id,
    rect,
    x: number,
    y: number,
    width: number,
    height: number,
    duration: number,
    name: string,
  },
  ["asset", "rect", "x", "y", "width", "height", "duration"],
);
const expr = {
  oneOf: [number, { type: "array", minItems: 2, maxItems: 9, items: {} }],
};
const node = object(
  {
    id,
    name: string,
    type: { enum: ["image", "video", "audio", "group", "text", "adapter"] },
    sampling: { enum: ["linear", "nearest"] },
    asset: id,
    rect,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    scaleX: number,
    scaleY: number,
    pivotX: number,
    pivotY: number,
    opacity: { type: "number", minimum: 0, maximum: 1 },
    parallax: pair,
    brightness: number,
    saturation: number,
    blend: { enum: ["normal", "screen", "add", "multiply"] },
    mask: object({ asset: id, polygon: array(pair, 3, 64), invert: boolean }),
    material,
    bindings: { type: "object", additionalProperties: expr },
    animation: object(
      { progress: expr, loop: boolean, frames: array(frame, 2, 100) },
      ["progress", "frames"],
    ),
    children: array({ $ref: "#/$defs/node" }),
    text: string,
    font: string,
    color: string,
    video: object(
      {
        mode: { enum: ["autoplay-muted", "on-activate"] },
        loop: boolean,
        muted: { const: true },
        poster: id,
      },
      ["mode", "muted", "poster"],
    ),
    audio: object(
      { loop: boolean, volume: { type: "number", minimum: 0, maximum: 1 } },
      ["loop", "volume"],
    ),
    adapter: string,
    data: { type: "object" },
  },
  ["id", "type"],
);
export const sceneSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://digital-card.invalid/schema/scene2d-0.1.json",
  ...object(
    {
      dialect: { const: "dc.scene2d@0.1" },
      background: string,
      nodes: array({ $ref: "#/$defs/node" }),
    },
    ["dialect", "nodes"],
  ),
  $defs: { node },
};
