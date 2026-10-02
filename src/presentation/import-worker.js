import { readFile, stat } from "node:fs/promises";
import { importPackage, DEFAULT_LIMITS } from "./package.js";
import { buildReport } from "./compiler.js";
process.once("message", async (data) => {
  let result;
  try {
    const limits = { ...DEFAULT_LIMITS, ...data.limits };
    if ((await stat(data.path)).size > limits.compressed)
      throw Object.assign(new Error("Upload too large"), { code: "LIMIT" });
    const pkg = await importPackage(new Uint8Array(await readFile(data.path)), {
      limits,
    });
    result = {
      ok: true,
      digest: pkg.digest,
      report: buildReport(pkg, data.performance),
      capabilities: pkg.manifest.capabilities,
    };
  } catch (error) {
    result = {
      ok: false,
      code: error.code ?? "IMPORT",
      message: String(error.message).slice(0, 1000),
    };
  }
  process.send?.(result, () => process.disconnect());
});
