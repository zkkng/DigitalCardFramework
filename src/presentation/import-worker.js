import { readFile, stat } from "node:fs/promises";
import { importPackage, DEFAULT_LIMITS } from "./package.js";
import { buildReport, publishPackage } from "./compiler.js";
import { PresentationError } from "./data.js";
async function execute(data) {
  let result;
  try {
    if (data.operation === "probe") return { ok: true, environmentKeys: Object.keys(process.env).sort() };
    const limits = { ...DEFAULT_LIMITS, ...data.limits };
    if ((await stat(data.path)).size > limits.compressed)
      throw Object.assign(new Error("Upload too large"), { code: "LIMIT" });
    const bytes = new Uint8Array(await readFile(data.path));
    if (data.operation === "publish") {
      const publication = await publishPackage(bytes, { contentRoot: data.contentRoot, limits, performance: data.performance, expectedDigest: data.expectedDigest, stagingPath: data.stagingPath, temporaryBytes: data.temporaryBytes });
      return { ok: true, ...publication };
    }
    const pkg = await importPackage(bytes, {
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
      safeError: error instanceof PresentationError,
    };
  }
  return result;
}
if (process.argv.includes("--stdio")) {
  process.stderr.write("DC_IMPORT_STAGE:worker-started\n");
  let request = "", bytes = 0;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) process.exit(125);
    request += chunk;
  });
  process.stdin.once("end", async () => {
    process.stderr.write("DC_IMPORT_STAGE:request-end\n");
    let result;
    try { result = await execute(JSON.parse(request)); }
    catch { result = { ok: false, code: "IMPORT", message: "Invalid import worker request" }; }
    process.stderr.write("DC_IMPORT_STAGE:result-writing\n");
    process.stdout.write(JSON.stringify(result), () => process.exit(0));
  });
} else process.once("message", async (data) => {
  process.send?.(await execute(data), () => process.disconnect());
});
