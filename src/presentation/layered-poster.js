export async function renderLayeredPoster(doc) {
  const scale = Math.min(1, 1536 / Math.max(doc.width, doc.height)),
    canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
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
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/png" })
    : await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = canvas.height = 0;
  return bytes;
}
