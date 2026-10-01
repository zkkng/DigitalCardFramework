import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { importPackage } from "./package.js";
import { buildReport } from "./compiler.js";
try {
  const pkg = await importPackage(
    new Uint8Array(await readFile(workerData.path)),
    { limits: workerData.limits },
  );
  parentPort.postMessage({
    ok: true,
    digest: pkg.digest,
    report: buildReport(pkg),
    capabilities: pkg.manifest.capabilities,
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: error.code ?? "IMPORT",
    message: error.message,
  });
}
