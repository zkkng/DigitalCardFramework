#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileDirectory, publishPackage, buildReport } from "./compiler.js";
import { importPackage } from "./package.js";
import { parseJSON, ensure } from "./data.js";

export async function batchBuild(jobs, { root = process.cwd(), signal } = {}) {
  ensure(
    Array.isArray(jobs) && jobs.length <= 1000,
    "BATCH",
    "Batch must contain at most 1000 jobs",
  );
  const results = [];
  for (const job of jobs) {
    signal?.throwIfAborted();
    try {
      ensure(
        typeof job.source === "string" && typeof job.output === "string",
        "BATCH",
        "Source and output required",
      );
      const result = await compileDirectory({
        root: path.resolve(root, job.source),
        out: path.resolve(root, job.output),
        archivePath: job.archive ? path.resolve(root, job.archive) : undefined,
        signal,
      });
      results.push({ id: job.id ?? job.source, ok: true, ...result.report });
    } catch (error) {
      results.push({
        id: job.id ?? job.source,
        ok: false,
        error: error.message,
      });
    }
  }
  return results;
}
export async function main(args) {
  const [command, input, output] = args;
  if (command === "validate" || command === "report") {
    const pkg = await importPackage(new Uint8Array(await readFile(input)));
    return { structurallyValid: true, ...buildReport(pkg) };
  }
  if (command === "build") {
    ensure(input && output, "CLI", "build SOURCE OUTPUT");
    return (
      await compileDirectory({
        root: path.resolve(input),
        out: path.resolve(output),
        archivePath: path.resolve(output) + ".dcard",
      })
    ).report;
  }
  if (command === "publish") {
    ensure(input && output, "CLI", "publish FILE CONTENT_ROOT");
    return publishPackage(new Uint8Array(await readFile(input)), {
      contentRoot: path.resolve(output),
    });
  }
  if (command === "batch") {
    const jobs = parseJSON(await readFile(input, "utf8")),
      results = await batchBuild(jobs, {
        root: path.dirname(path.resolve(input)),
      });
    if (output) await writeFile(output, JSON.stringify(results, null, 2));
    return results;
  }
  throw new Error(
    "Usage: cli.mjs validate|report FILE; build SOURCE OUTPUT; publish FILE CONTENT_ROOT; batch JOBS.json [REPORT.json]",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
