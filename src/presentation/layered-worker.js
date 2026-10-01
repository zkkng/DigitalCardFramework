import { renderLayeredPoster } from "./layered-poster.js";
import { encodePNG as encodeRGBA } from "./png-encode.js";
import { parseLayeredSource } from "./layered-source.js";
self.onmessage = async (event) => {
  try {
    const { bytes, format } = event.data,
      doc = await parseLayeredSource(bytes, { format, encodeRGBA });
    if (!doc.poster && typeof OffscreenCanvas !== "undefined")
      doc.poster = await renderLayeredPoster(doc);
    self.postMessage({ ok: true, doc });
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error.code ?? "LAYER_IMPORT",
      message: error.message,
    });
  }
};
