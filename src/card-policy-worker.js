import { parentPort, workerData } from "node:worker_threads";
import { check } from "./catalog.js";
import { flattenNodes } from "./card-policy.js";
import { importPackage } from "./presentation/package.js";
import {
  inspectFont,
  fontMeasure,
  layoutText,
  textValue,
  fontDiagnostics,
} from "./presentation/text.js";
const archive = workerData;
try {
  const pkg = await importPackage(archive),
    fonts = new Map(),
    layouts = {},
    textIssues = [];
  for (const f of pkg.manifest.authoring?.fields ?? [])
    check(
      (f.visibility ?? "public") === "public" && f.scope !== "copy",
      "PRIVATE_SNAPSHOT",
      "Public packages cannot contain private field definitions",
    );
  for (const a of pkg.manifest.assets)
    if (a.mediaType.startsWith("font/"))
      fonts.set(a.id, inspectFont(pkg.files.get(a.path), a.mediaType).font);
  for (const [scenePath, scene] of pkg.scenes)
    for (const node of flattenNodes(scene.nodes))
      if (node.type === "text") {
        const font = fonts.get(node.typography?.fontAsset);
        if (font) {
          const text = textValue(node, pkg.manifest);
          const layout = layoutText(node, text, fontMeasure(font, node));
          layouts[scenePath + ":" + node.id] = { ...layout, nodeId: node.id };
          textIssues.push(...fontDiagnostics(font, node, text));
          if (layout.overflow)
            textIssues.push({
              code: "TEXT_OVERFLOW",
              nodeId: node.id,
              message: "Text exceeds its layout bounds",
            });
        } else
          textIssues.push({
            code: "TEXT_UNMEASURED",
            nodeId: node.id,
            message: "Embed a font for authoritative text layout",
          });
      }
  const record = {
    digest: pkg.digest,
    manifest: pkg.manifest,
    scenes: Object.fromEntries(pkg.scenes),
    layouts,
    textIssues,
  };
  parentPort.postMessage({ record });
} catch (error) {
  parentPort.postMessage({
    error: {
      code: error.code ?? "FONT",
      message: error.code ? error.message : "Presentation analysis failed",
    },
  });
}
