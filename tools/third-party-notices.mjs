import { createRequire } from "node:module";
import { readFile, readdir, writeFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  seen = new Set(),
  sections = [];
const mit = (
  await readFile(
    join(root, "node_modules/.pnpm/clone@2.1.2/node_modules/clone/LICENSE"),
    "utf8",
  )
).split("Permission is hereby granted")[1];
async function collect(name, from) {
  const require = createRequire(from);
  let folder = dirname(await realpath(require.resolve(name))),
    pkg;
  for (;;) {
    try {
      const candidate = JSON.parse(
        await readFile(join(folder, "package.json"), "utf8"),
      );
      if (candidate.name === name) {
        pkg = candidate;
        break;
      }
    } catch {}
    const parent = dirname(folder);
    if (parent === folder) throw new Error("Missing package metadata: " + name);
    folder = parent;
  }
  const key = pkg.name + "@" + pkg.version;
  if (seen.has(key)) return;
  seen.add(key);
  const files = (await readdir(folder)).filter((n) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(n),
  );
  let text =
    key +
    "\nSource: " +
    (typeof pkg.repository === "string"
      ? pkg.repository
      : (pkg.repository?.url ?? pkg.homepage ?? "npm:" + pkg.name)) +
    "\nDeclared license: " +
    (typeof pkg.license === "string"
      ? pkg.license
      : JSON.stringify(pkg.license)) +
    "\n\n";
  if (files.length)
    for (const file of files)
      text += file + "\n" + (await readFile(join(folder, file), "utf8")) + "\n";
  else if (pkg.license === "MIT") {
    const author =
      typeof pkg.author === "string"
        ? pkg.author.replace(/<[^>]*>/g, "").trim()
        : (pkg.author?.name ?? "the package contributors");
    text +=
      "Attribution: " +
      author +
      "\nThe distributed package declares MIT licensing in its metadata and README.\n\nPermission is hereby granted" +
      mit +
      "\n";
  } else throw new Error("Missing license text: " + key);
  sections.push(text);
  for (const dep of Object.keys(pkg.dependencies ?? {}))
    await collect(dep, join(folder, "package.json"));
}
await collect("fontkit", join(root, "package.json"));
for (const name of ["ag-psd", "gifuct-js", "@xmldom/xmldom"])
  await collect(name, join(root, "src/presentation/package.json"));
const apache = await readFile(
  join(
    root,
    "node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers/LICENSE",
  ),
  "utf8",
);
sections.push(
  "Brotli decoder source: Copyright 2013 Google Inc. All Rights Reserved.\nThe decoder files in brotli/dec are licensed under Apache License 2.0.\n\n" +
    apache,
);
await writeFile(
  join(root, "THIRD_PARTY_NOTICES.txt"),
  "Third-party notices for generated font and layered-artwork browser modules.\nOriginal notices are retained in generated code where supplied.\n\n" +
    sections.sort().join("\n----------------------------------------\n\n").trimEnd() + "\n",
);
console.log("Recorded notices for " + seen.size + " dependency versions.");
