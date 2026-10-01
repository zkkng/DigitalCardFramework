import { parseLayeredSource } from "./layered-source.js";
const png = async (canvas) =>
  new Uint8Array(
    await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
  );
async function encodeRGBA(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas
    .getContext("2d")
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(bitmap.data),
        bitmap.width,
        bitmap.height,
      ),
      0,
      0,
    );
  const bytes = await png(canvas);
  canvas.width = canvas.height = 0;
  return bytes;
}
async function render(doc) {
  const scale = Math.min(1, 1536 / Math.max(doc.width, doc.height)),
    canvas = new OffscreenCanvas(
      Math.max(1, Math.round(doc.width * scale)),
      Math.max(1, Math.round(doc.height * scale)),
    ),
    ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  async function draw(nodes, opacity = 1, dx = 0, dy = 0) {
    for (const node of nodes) {
      if (node.children) {
        await draw(
          node.children,
          opacity * (node.opacity ?? 1),
          dx + (node.x ?? 0),
          dy + (node.y ?? 0),
        );
        continue;
      }
      const image = await createImageBitmap(
        new Blob([node.bytes], { type: "image/png" }),
      );
      ctx.globalAlpha = opacity * (node.opacity ?? 1);
      ctx.globalCompositeOperation = {
        normal: "source-over",
        screen: "screen",
        multiply: "multiply",
        add: "lighter",
      }[node.blend ?? "normal"];
      ctx.drawImage(
        image,
        dx + (node.x ?? 0),
        dy + (node.y ?? 0),
        node.width,
        node.height,
      );
      image.close();
    }
  }
  await draw(doc.layers);
  const bytes = await png(canvas);
  canvas.width = canvas.height = 0;
  return bytes;
}
self.onmessage = async (event) => {
  try {
    const { bytes, format } = event.data,
      doc = await parseLayeredSource(bytes, { format, encodeRGBA });
    doc.poster = await render(doc);
    self.postMessage({ ok: true, doc });
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error.code ?? "LAYER_IMPORT",
      message: error.message,
    });
  }
};
