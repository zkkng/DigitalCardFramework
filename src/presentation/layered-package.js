import { ensure, sha256 } from "./data.js";
import { rasterDimensions } from "./media.js";
import { buildPackage } from "./package.js";
/** No composition template is imposed; the original source coordinates become card units. */
export async function layeredPackage(doc, { poster, flatten = false } = {}) {
  ensure(
    poster instanceof Uint8Array,
    "POSTER",
    "A rendered PNG poster is required",
  );
  const posterSize = rasterDimensions(poster, "image/png"),
    assets = [],
    files = new Map(),
    front = flatten
      ? [
          {
            id: "flattened",
            name: "Original flattened appearance",
            type: "image",
            x: 0,
            y: 0,
            width: doc.width,
            height: doc.height,
            bytes: poster,
          },
        ]
      : structuredClone(doc.layers);
  async function asset(id, bytes, role) {
    const size = rasterDimensions(bytes, "image/png"),
      path = `assets/${id}.png`;
    assets.push({
      id,
      path,
      mediaType: "image/png",
      width: size.width,
      height: size.height,
      role,
      bytes: bytes.length,
      sha256: await sha256(bytes),
    });
    files.set(path, bytes);
  }
  await asset("poster-front", poster, "poster");
  await asset("poster-back", poster, "poster");
  let index = 0;
  async function convert(nodes) {
    for (const n of nodes) {
      if (n.children) {
        await convert(n.children);
        continue;
      }
      const id = "raster-" + ++index;
      await asset(id, n.bytes, "color");
      n.asset = id;
      delete n.bytes;
      for (const frame of n.animation?.frames ?? []) {
        const frameId = "raster-" + ++index;
        await asset(frameId, frame.bytes, "color");
        frame.asset = frameId;
        delete frame.bytes;
      }
    }
  }
  await convert(front);
  const manifest = {
    format: "digital-card",
    contractVersion: "0.1.0",
    id: "import." + crypto.randomUUID().replaceAll("-", ""),
    revision: 1,
    title: doc.title.slice(0, 200),
    summary: "Imported layered artwork",
    profile: "portable",
    canvas: { width: doc.width, height: doc.height },
    faces: {
      front: {
        scene: "scenes/front.json",
        poster: "poster-front",
        description: doc.title.slice(0, 4000),
      },
      back: {
        scene: "scenes/back.json",
        poster: "poster-back",
        description: "Back of " + doc.title.slice(0, 3900),
      },
    },
    assets,
    capabilities: {
      required: ["dc.scene2d@0.1", "dc.motion@0.1", "dc.materials@0.1"],
      optional: [],
    },
    quality: {
      poster: { maxEdge: 768 },
      lite: { maxEdge: 768 },
      standard: { maxEdge: 1536 },
      ultra: { maxEdge: 2048 },
    },
  };
  return buildPackage(
    manifest,
    new Map([
      ["scenes/front.json", { dialect: "dc.scene2d@0.1", nodes: front }],
      [
        "scenes/back.json",
        {
          dialect: "dc.scene2d@0.1",
          nodes: [
            {
              id: "back",
              type: "image",
              asset: "poster-back",
              x: 0,
              y: 0,
              width: doc.width,
              height: doc.height,
            },
          ],
        },
      ],
    ]),
    files,
  );
}
