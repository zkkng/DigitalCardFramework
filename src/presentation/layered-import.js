import { ensure } from "./data.js";
import { layeredPackage } from "./layered-package.js";
/** One source file, bounded worker, a reviewable conversion report, then a normal .dcard. */
export async function importLayeredFile(
  file,
  {
    workerURL = new URL("./layered-worker-bundle.js", import.meta.url),
    signal,
    timeoutMs = 30000,
  } = {},
) {
  ensure(
    file.size <= 64 * 1024 * 1024,
    "LAYER_LIMIT",
    "Layered file exceeds 64 MiB",
  );
  const ext = file.name.toLowerCase().split(".").at(-1),
    format = { psd: "psd", ora: "ora", zip: "layer-zip" }[ext];
  ensure(format, "LAYER_FORMAT", "Use PSD, OpenRaster (.ora), or a layer ZIP");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  const doc = await new Promise((resolve, reject) => {
    const worker = new Worker(workerURL, { type: "module" });
    let finished = false;
    const end = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => end(new DOMException("Import cancelled", "AbortError")),
      timer = setTimeout(
        () =>
          end(
            new Error("Layer import timed out; reduce the source dimensions"),
          ),
        timeoutMs,
      );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => end(new Error(e.message));
    worker.onmessage = (e) =>
      e.data.ok
        ? end(null, e.data.doc)
        : end(Object.assign(new Error(e.data.message), { code: e.data.code }));
    worker.postMessage({ bytes, format }, [bytes.buffer]);
    if (signal?.aborted) abort();
  });
  return {
    report: doc.report,
    sourceSize: { width: doc.width, height: doc.height },
    canFlatten: !!doc.merged,
    async build({ flatten = false } = {}) {
      ensure(
        !flatten || doc.merged,
        "LAYER_FLATTEN",
        "Source does not contain a merged preview",
      );
      return layeredPackage(doc, {
        poster: flatten ? doc.merged : doc.poster,
        flatten,
      });
    },
  };
}
