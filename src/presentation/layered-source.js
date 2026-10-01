/** Authoring import only. Converts sources to the same portable scene contract. */
import { parseGIFSource } from "./gif-source.js";
import { readPsd, initializeCanvas } from "ag-psd";
import { DOMParser } from "@xmldom/xmldom";
import { ensure, parseJSON, text, safePath } from "./data.js";
import { readZip } from "./package.js";
import { rasterDimensions } from "./media.js";

const LIMITS = {
  bytes: 64 * 1024 * 1024,
  pixels: 32 * 1024 * 1024,
  edge: 8192,
  layers: 512,
  depth: 16,
};
const blends = {
  normal: "normal",
  "pass through": "normal",
  screen: "screen",
  multiply: "multiply",
  "linear dodge": "add",
  "svg:src-over": "normal",
  "svg:screen": "screen",
  "svg:multiply": "multiply",
  "svg:plus": "add",
};
function checker(limits) {
  let pixels = 0,
    layers = 0;
  return {
    dimensions(w, h) {
      ensure(
        Number.isInteger(w) &&
          Number.isInteger(h) &&
          w > 0 &&
          h > 0 &&
          w <= limits.edge &&
          h <= limits.edge,
        "LAYER_SIZE",
        "Layer dimensions exceed the import profile",
      );
      pixels += w * h;
      ensure(
        pixels <= limits.pixels,
        "LAYER_LIMIT",
        "Decoded layer pixels exceed the import budget",
      );
    },
    layer(depth) {
      ensure(
        ++layers <= limits.layers && depth <= limits.depth,
        "LAYER_LIMIT",
        "Too many layers or nested groups",
      );
    },
  };
}
function issue(report, layer, code, message) {
  report.issues.push({ layer, code, message });
}
function mode(value, report, name) {
  if (Object.hasOwn(blends,value ?? "normal")) return blends[value ?? "normal"];
  issue(
    report,
    name,
    "BLEND",
    `Unsupported blend “${value}”; supported-layer import uses normal blending.`,
  );
  return "normal";
}
const children = (element) =>
  Array.from(element.childNodes ?? []).filter((n) => n.nodeType === 1);
const numeric = (value, fallback) =>
  value === null || value === "" || value === undefined
    ? fallback
    : Number(value);

export async function parseLayeredSource(
  bytes,
  { format, encodeRGBA, limits: overrides = {} },
) {
  if (format === "gif") return parseGIFSource(bytes, { encodeRGBA, limits: overrides });
  const limits = { ...LIMITS, ...overrides };
  ensure(
    bytes instanceof Uint8Array && bytes.length <= limits.bytes,
    "LAYER_LIMIT",
    "Layered source exceeds 64 MiB",
  );
  const check = checker(limits),
    report = { format, issues: [], notes: [], layerCount: 0 };
  let doc;
  if (format === "psd") {
    ensure(
      bytes.length >= 26 && text(bytes.subarray(0, 4)) === "8BPS",
      "PSD",
      "Not a PSD file",
    );
    const header = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    ensure(
      header.getUint16(4) === 1,
      "PSD",
      "PSB is not supported; export an RGB PSD or OpenRaster file",
    );
    ensure(
      header.getUint16(22) === 8 && header.getUint16(24) === 3,
      "PSD",
      "Import requires an 8-bit RGB PSD; export a converted copy from the art application",
    );
    check.dimensions(header.getUint32(18), header.getUint32(14));
    initializeCanvas(
      () => {
        throw new Error("Unexpected canvas decode");
      },
      (width, height) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
    );
    const metadata = readPsd(bytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      useImageData: true,
    });
    function preflight(nodes, depth = 0) {
      for (const layer of nodes ?? []) {
        check.layer(depth);
        const w = (layer.right ?? 0) - (layer.left ?? 0),
          h = (layer.bottom ?? 0) - (layer.top ?? 0);
        if (w > 0 && h > 0) check.dimensions(w, h);
        for (const mask of [layer.mask, layer.realMask])
          if (mask) {
            const mw = (mask.right ?? 0) - (mask.left ?? 0),
              mh = (mask.bottom ?? 0) - (mask.top ?? 0);
            if (mw > 0 && mh > 0) check.dimensions(mw, mh);
          }
        preflight(layer.children, depth + 1);
      }
    }
    preflight(metadata.children);
    const psd = readPsd(bytes, {
      skipThumbnail: true,
      useImageData: true,
      throwForMissingFeatures: false,
    });
    let serial = 0;
    async function convert(nodes) {
      const result = [];
      for (const layer of [...(nodes ?? [])].reverse()) {
        const name = layer.name ?? `Layer ${++serial}`,
          id = "layer-" + ++serial,
          base = {
            id,
            name,
            x: layer.left ?? 0,
            y: layer.top ?? 0,
            opacity: layer.hidden ? 0 : (layer.opacity ?? 1),
            blend: mode(layer.blendMode, report, name),
          };
        for (const [key, label] of [
          ["adjustment", "Adjustment layer"],
          ["effects", "Layer effects"],
          ["vectorMask", "Vector mask"],
          ["clipping", "Clipping group"],
        ])
          if (layer[key] && !(key === "effects" && layer.effects.disabled))
            issue(
              report,
              name,
              key,
              `${label} needs baking in the source application for an exact layered appearance.`,
            );
        if (layer.text || layer.placedLayer || layer.vectorFill)
          report.notes.push({
            layer: name,
            message:
              "Imported the stored raster appearance; source text/vector/smart-object editing is not retained.",
          });
        if (layer.children) {
          if (
            (layer.opacity ?? 1) !== 1 ||
            !["normal", "pass through", undefined].includes(layer.blendMode)
          )
            issue(
              report,
              name,
              "GROUP_COMPOSITE",
              "This group needs isolated compositing; supported-layer import preserves its children with inherited opacity.",
            );
          result.push({
            ...base,
            x: 0,
            y: 0,
            type: "group",
            children: await convert(layer.children),
          });
          continue;
        }
        const bitmap = layer.imageData;
        if (!bitmap) {
          issue(
            report,
            name,
            "NO_PIXELS",
            "This layer has no stored raster pixels.",
          );
          continue;
        }
        ensure(
          bitmap.data instanceof Uint8ClampedArray ||
            bitmap.data instanceof Uint8Array,
          "PSD",
          "Unexpected pixel format",
        );
        if (layer.mask && !layer.mask.disabled) {
          const mask = layer.mask,
            im = mask.imageData;
          if (im) {
            const mx =
                (mask.left ?? 0) + (mask.positionRelativeToLayer ? base.x : 0),
              my =
                (mask.top ?? 0) + (mask.positionRelativeToLayer ? base.y : 0),
              density = mask.userMaskDensity ?? 1;
            for (let y = 0; y < bitmap.height; y++)
              for (let x = 0; x < bitmap.width; x++) {
                const xx = base.x + x - mx,
                  yy = base.y + y - my,
                  value =
                    xx >= 0 && yy >= 0 && xx < im.width && yy < im.height
                      ? im.data[(yy * im.width + xx) * 4]
                      : (mask.defaultColor ?? 255);
                bitmap.data[(y * bitmap.width + x) * 4 + 3] *=
                  1 - density + (density * value) / 255;
              }
            if (mask.userMaskFeather)
              issue(
                report,
                name,
                "MASK_FEATHER",
                "Mask pixels were applied; extra source feather settings need a baked source mask.",
              );
          } else issue(report, name, "MASK", "Mask lacks raster pixels.");
        }
        result.push({
          ...base,
          type: "image",
          width: bitmap.width,
          height: bitmap.height,
          bytes: await encodeRGBA(bitmap),
        });
      }
      return result;
    }
    doc = {
      width: psd.width,
      height: psd.height,
      title: "Imported layered artwork",
      layers: await convert(psd.children),
      merged: psd.imageData ? await encodeRGBA(psd.imageData) : null,
    };
  } else {
    const files = await readZip(bytes, {
      compressed: limits.bytes,
      inflated: 256 * 1024 * 1024,
      entry: 64 * 1024 * 1024,
      entries: 2000,
      ratio: 200,
      sourceArchive: true,
    });
    if (format === "ora") {
      ensure(
        text(files.get("mimetype") ?? new Uint8Array()) ===
          "image/openraster" && files.has("stack.xml"),
        "ORA",
        "Missing OpenRaster header or layer stack",
      );
      const xml = text(files.get("stack.xml"));
      ensure(
        xml.length <= 4 * 1024 * 1024 && !/<!DOCTYPE|<!ENTITY/i.test(xml),
        "ORA_XML",
        "Document types and entities are not allowed",
      );
      let parseError = false;
      const document = new DOMParser({
          onError: () => {
            parseError = true;
          },
        }).parseFromString(xml, "text/xml"),
        root = document.documentElement;
      ensure(
        !parseError && root.tagName === "image",
        "ORA_XML",
        "Invalid layer stack XML",
      );
      const width = Number(root.getAttribute("w")),
        height = Number(root.getAttribute("h"));
      check.dimensions(width, height);
      let serial = 0;
      function convert(parent, depth = 0) {
        const result = [];
        for (const element of children(parent).reverse()) {
          check.layer(depth);
          const name = element.getAttribute("name") || `Layer ${++serial}`,
            base = {
              id: "layer-" + ++serial,
              name,
              x: numeric(element.getAttribute("x"), 0),
              y: numeric(element.getAttribute("y"), 0),
              opacity:
                element.getAttribute("visibility") === "hidden"
                  ? 0
                  : numeric(element.getAttribute("opacity"), 1),
              blend: mode(
                element.getAttribute("composite-op") || "svg:src-over",
                report,
                name,
              ),
            };
          if (element.tagName === "stack") {
            const nested = convert(element, depth + 1);
            if (
              base.opacity !== 1 ||
              base.blend !== "normal" ||
              (element.getAttribute("isolation") !== "auto" &&
                nested.some((n) => n.blend !== "normal"))
            )
              issue(
                report,
                name,
                "GROUP_COMPOSITE",
                "Isolated group compositing needs a baked source group for exact appearance.",
              );
            result.push({
              ...base,
              x: 0,
              y: 0,
              type: "group",
              children: nested,
            });
          } else if (element.tagName === "layer") {
            const source = element.getAttribute("src");
            safePath(source);
            const data = files.get(source);
            ensure(
              data && source.toLowerCase().endsWith(".png"),
              "ORA_LAYER",
              "OpenRaster layers must reference embedded PNG files",
            );
            const size = rasterDimensions(data, "image/png");
            check.dimensions(size.width, size.height);
            result.push({ ...base, type: "image", ...size, bytes: data });
          } else
            issue(
              report,
              name,
              "ELEMENT",
              "Unsupported OpenRaster element " + element.tagName,
            );
        }
        return result;
      }
      const stack = children(root).find((n) => n.tagName === "stack");
      ensure(stack, "ORA_XML", "No layer stack");
      doc = {
        width,
        height,
        title: root.getAttribute("name") || "Imported layered artwork",
        layers: convert(stack),
        merged: files.get("mergedimage.png") ?? null,
      };
    } else {
      ensure(
        format === "layer-zip" && files.has("layers.json"),
        "LAYER_ZIP",
        "Expected layers.json and embedded PNG layers",
      );
      const m = parseJSON(text(files.get("layers.json")));
      ensure(
        m.version === 1 &&
          m.order === "bottom-to-top" &&
          Array.isArray(m.layers),
        "LAYER_ZIP",
        "Use layer bundle version 1 with bottom-to-top order",
      );
      check.dimensions(m.width, m.height);
      let serial = 0;
      function convert(nodes, depth = 0) {
        return nodes.map((layer) => {
          check.layer(depth);
          const allowed = [
            "id",
            "name",
            "file",
            "x",
            "y",
            "opacity",
            "visible",
            "blend",
            "children",
            "parallax",
            "material",
            "bindings",
          ];
          ensure(
            Object.keys(layer).every((k) => allowed.includes(k)),
            "LAYER_ZIP",
            "Unknown layer field",
          );
          const base = {
            id: layer.id ?? "layer-" + ++serial,
            name: layer.name ?? layer.file ?? "Group",
            x: layer.x ?? 0,
            y: layer.y ?? 0,
            opacity: layer.visible === false ? 0 : (layer.opacity ?? 1),
            blend: mode(layer.blend, report, layer.name),
            ...(layer.parallax ? { parallax: layer.parallax } : {}),
            ...(layer.material ? { material: layer.material } : {}),
            ...(layer.bindings ? { bindings: layer.bindings } : {}),
          };
          if (layer.children)
            return {
              ...base,
              type: "group",
              children: convert(layer.children, depth + 1),
            };
          safePath(layer.file);
          const data = files.get(layer.file);
          ensure(data, "LAYER_ZIP", "Missing embedded image " + layer.file);
          const size = rasterDimensions(data, "image/png");
          check.dimensions(size.width, size.height);
          return { ...base, type: "image", ...size, bytes: data };
        });
      }
      doc = {
        width: m.width,
        height: m.height,
        title: m.title ?? "Imported layered artwork",
        layers: convert(m.layers),
        merged: m.preview ? files.get(safePath(m.preview)) : null,
      };
    }
  }
  function count(nodes) {
    for (const n of nodes) {
      if (n.children) count(n.children);
      else report.layerCount++;
    }
  }
  count(doc.layers);
  ensure(report.layerCount > 0, "LAYERS", "No supported raster layers found");
  return { ...doc, report };
}
