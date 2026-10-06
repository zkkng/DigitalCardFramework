import { ensure, sha256 } from "./data.js";
import { buildPackage, importPackage } from "./package.js";
import {
  flattenNodes,
  policyDefaults,
  deriveStats,
  inspectCardPolicy,
} from "../card-policy.js";

const uid = (prefix) => prefix + "-" + crypto.randomUUID().replaceAll("-", "");
export function addText(project, side = "front", options = {}) {
  const node = {
    id: uid("text"),
    name: "Text",
    type: "text",
    text: "New text",
    x: 80,
    y: 80,
    width: project.manifest.canvas.width - 160,
    height: 100,
    color: "#ffffff",
    typography: { size: 48, lineHeight: 1.2, overflow: "wrap" },
    ...structuredClone(options),
  };
  project.edit((p) => {
    p.scenes.get(p.manifest.faces[side].scene).nodes.push(node);
    if (!p.manifest.capabilities.required.includes("dc.text@0.2"))
      p.manifest.capabilities.required.push("dc.text@0.2");
  });
  return node.id;
}
export function configureAuthoring(
  project,
  { policy, context, policyRevision } = {},
) {
  project.edit((p) => {
    p.manifest.authoring ??= { values: { card: {}, variant: {} } };
    const a = p.manifest.authoring;
    if (context) a.context = structuredClone(context);
    if (policy) {
      const custom =
        policy.requirements?.allowUnknownStats !== false
          ? (a.fields ?? []).filter(
              (f) =>
                (f.source ?? "author") === "author" &&
                !policy.fields.some(
                  (g) =>
                    g.key === f.key &&
                    (g.scope ?? "card") === (f.scope ?? "card"),
                ),
            )
          : [];
      a.fields = structuredClone([...policy.fields, ...custom]);
      a.values ??= { card: {}, variant: {} };
      a.values.card = { ...policyDefaults(policy), ...a.values.card };
      a.values.variant = {
        ...policyDefaults(policy, "variant"),
        ...a.values.variant,
      };
      for (const scope of ["card", "variant"])
        try {
          a.values[scope] = deriveStats(a.fields, a.values[scope], scope);
        } catch (error) {
          if (error.code !== "STAT_DEPENDENCY") throw error;
        }
    }
    if (policyRevision !== undefined) a.policyRevision = policyRevision;
  });
}
export function setStat(project, key, value, scope = "card") {
  const f = project.manifest.authoring?.fields?.find(
    (f) => f.key === key && (f.scope ?? "card") === scope,
  );
  ensure(f, "STAT", "Unknown stat field");
  ensure(
    (f.source ?? "author") === "author" && !Object.hasOwn(f, "fixed"),
    "STAT_AUTHORITY",
    "This field is managed by policy",
  );
  project.edit((p) => {
    const a = p.manifest.authoring;
    a.values ??= { card: {}, variant: {} };
    a.values[scope] ??= {};
    if (value === undefined) delete a.values[scope][key];
    else a.values[scope][key] = value;
    a.values[scope] = deriveStats(a.fields, a.values[scope], scope);
  });
}
export function addStatBlock(
  project,
  side,
  keys,
  {
    view = "text",
    x = 80,
    y = 250,
    width = 360,
    rowHeight = 70,
    columns = 1,
  } = {},
) {
  const ids = [];
  ensure(Array.isArray(keys), "STAT", "Stat fields must be an array");
  const fields = keys.map((reference) => {
    ensure(
      typeof reference === "string" ||
        (reference && typeof reference === "object" && !Array.isArray(reference) &&
          typeof reference.key === "string" && ["card", "variant", "copy"].includes(reference.scope)),
      "STAT", "Invalid scoped stat reference",
    );
    const key = typeof reference === "string" ? reference : reference.key,
      scope = typeof reference === "string" ? undefined : reference.scope,
      matches = (project.manifest.authoring?.fields ?? []).filter(
        (f) => f.key === key && (scope === undefined || (f.scope ?? "card") === scope),
      );
    ensure(matches.length === 1, "STAT", "Stat field must resolve to one scope");
    const field = matches[0];
    ensure(
      (field.visibility ?? "public") === "public" && (field.scope ?? "card") !== "copy",
      "STAT",
      "Only public snapshot fields can be placed in card art",
    );
    return field;
  });
  for (const [index, field] of fields.entries()) {
    ids.push(
      addText(project, side, {
        name: field.label,
        text: "",
        x: x + (index % columns) * width,
        y: y + Math.floor(index / columns) * rowHeight,
        width: width - 12,
        height: rowHeight - 8,
        typography: {
          size: 32,
          lineHeight: 1.2,
          overflow: "shrink",
          minSize: 12,
        },
        stat: {
          key: field.key,
          scope: field.scope ?? "card",
          label: field.label,
          unit: field.unit ?? "",
          view,
          ...(field.precision !== undefined
            ? { precision: field.precision }
            : {}),
        },
      }),
    );
  }
  return ids;
}
function parentList(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return nodes;
    const found = node.children && parentList(node.children, id);
    if (found) return found;
  }
  return null;
}
export function transformSelection(project, side, ids, command, value) {
  project.edit((p) => {
    const scene = p.scenes.get(p.manifest.faces[side].scene),
      nodes = flattenNodes(scene.nodes).filter((n) => ids.includes(n.id));
    ensure(nodes.length, "SELECTION", "Choose layers first");
    ensure(
      nodes.every((n) => !n.locked) || command === "unlock",
      "LAYER_LOCKED",
      "Unlock selected layers before editing",
    );
    if (command === "lock" || command === "unlock") {
      nodes.forEach((n) => (n.locked = command === "lock"));
      return;
    }
    const roots = nodes.filter(
      (n) =>
        !nodes.some(
          (parent) =>
            parent !== n && flattenNodes(parent.children ?? []).includes(n),
        ),
    );
    if (command === "forward" || command === "backward") {
      for (const n of roots) {
        const list = parentList(scene.nodes, n.id),
          index = list.indexOf(n),
          next = Math.max(
            0,
            Math.min(list.length - 1, index + (command === "forward" ? 1 : -1)),
          );
        list.splice(index, 1);
        list.splice(next, 0, n);
      }
      return;
    }
    if (command === "delete") {
      for (const n of roots) {
        const list = parentList(scene.nodes, n.id);
        list.splice(list.indexOf(n), 1);
      }
      return;
    }
    if (command === "duplicate") {
      for (const n of roots) {
        const copy = structuredClone(n);
        const reId = (node) => {
          node.id = uid("layer");
          for (const child of node.children ?? []) reId(child);
        };
        reId(copy);
        copy.x = (copy.x ?? 0) + 20;
        copy.y = (copy.y ?? 0) + 20;
        parentList(scene.nodes, n.id).push(copy);
      }
      return;
    }
    if (command === "group") {
      ensure(
        nodes.every((n) => scene.nodes.includes(n)),
        "GROUP",
        "Select top-level layers to group",
      );
      const first = Math.min(...nodes.map((n) => scene.nodes.indexOf(n)));
      scene.nodes = scene.nodes.filter((n) => !ids.includes(n.id));
      scene.nodes.splice(first, 0, {
        id: uid("group"),
        name: "Group",
        type: "group",
        x: 0,
        y: 0,
        children: nodes,
      });
      return;
    }
    if (command === "ungroup") {
      for (const n of nodes) {
        ensure(
          n.type === "group" && !(n.rotation || n.scaleX || n.scaleY),
          "GROUP",
          "Reset group rotation and scale before ungrouping",
        );
        const list = parentList(scene.nodes, n.id),
          children = n.children.map((c) => ({
            ...c,
            x: (c.x ?? 0) + (n.x ?? 0),
            y: (c.y ?? 0) + (n.y ?? 0),
          }));
        list.splice(list.indexOf(n), 1, ...children);
      }
      return;
    }
    const left = Math.min(...nodes.map((n) => n.x ?? 0)),
      top = Math.min(...nodes.map((n) => n.y ?? 0)),
      right = Math.max(...nodes.map((n) => (n.x ?? 0) + (n.width ?? 0))),
      bottom = Math.max(...nodes.map((n) => (n.y ?? 0) + (n.height ?? 0)));
    for (const n of nodes) {
      if (command === "left") n.x = left;
      if (command === "right") n.x = right - n.width;
      if (command === "top") n.y = top;
      if (command === "bottom") n.y = bottom - n.height;
      if (command === "center")
        n.x = (project.manifest.canvas.width - n.width) / 2;
      if (command === "snap") {
        const grid = value ?? 10;
        n.x = Math.round((n.x ?? 0) / grid) * grid;
        n.y = Math.round((n.y ?? 0) / grid) * grid;
      }
    }
  });
}

export function createSharedLibrary({ client, upload, download }) {
  let revision = 0;
  return {
    async list() {
      const r = await client.cardPolicies();
      revision = r.revision;
      return r.resources
        .filter((x) => !x.retired)
        .map((x) => ({
          ...x,
          key: x.document.id + "@" + x.document.revision,
          shared: true,
        }));
    },
    async get(key) {
      const row = (await this.list()).find((e) => e.key === key);
      if (row?.document.packageDigest)
        row.archive = await download(row.document.packageDigest);
      return row;
    },
    async put(entry) {
      if (entry.archive) await upload(await importPackage(entry.archive));
      const registry = await client.cardPolicies();
      revision = registry.revision;
      return client.saveCardResource({
        key: crypto.randomUUID(),
        expectedRevision: revision,
        resource: { kind: entry.kind, document: entry.document },
      });
    },
  };
}
export function combineLibraries(personal, shared, { canShare = false } = {}) {
  return {
    async list() {
      return [...(await personal.list()), ...(await shared.list())];
    },
    async get(key, sharedEntry = false) {
      return sharedEntry
        ? shared.get(key)
        : ((await personal.get(key)) ?? shared.get(key));
    },
    put: (entry) => personal.put(entry),
    ...(canShare ? { share: (entry) => shared.put(entry) } : {}),
  };
}
export async function saveTextStyle(
  project,
  node,
  library,
  { id = uid("style"), revision = 1, name = "Text style", tags = [] } = {},
) {
  const pkg = await project.export(),
    document = {
      id,
      revision,
      name,
      tags,
      typography: structuredClone(node.typography ?? {}),
      packageDigest: pkg.digest,
    };
  const entry = {
    key: id + "@" + revision,
    kind: "style",
    document,
    archive: pkg.archive,
  };
  await library.put(entry);
  return entry;
}
export async function applyTextStyle(project, side, nodeId, entry) {
  const pkg = entry.archive ? await importPackage(entry.archive) : null;
  if (pkg)
    ensure(
      pkg.digest === entry.document.packageDigest,
      "INTEGRITY",
      "Style source changed",
    );
  const style = structuredClone(entry.document.typography),
    font =
      style.fontAsset &&
      pkg?.manifest.assets.find((a) => a.id === style.fontAsset);
  if (font) style.fontAsset = "font-" + font.sha256.slice(0, 32);
  project.edit((p) => {
    const node = flattenNodes(
      p.scenes.get(p.manifest.faces[side].scene).nodes,
    ).find((n) => n.id === nodeId);
    ensure(
      node?.type === "text" && !node.locked,
      "TEXT",
      "Select an unlocked text layer",
    );
    if (font && !p.manifest.assets.some((a) => a.id === style.fontAsset)) {
      const path =
        "assets/" + style.fontAsset + "." + font.mediaType.split("/")[1];
      p.manifest.assets.push({ ...font, id: style.fontAsset, path });
      p.assets.set(path, pkg.files.get(font.path));
    }
    node.typography = style;
  });
}
export async function previewTemplateMigration(project, entry) {
  const before = await project.export({ retainSources: true }),
    target = await loadTemplate(entry),
    changes = [];
  for (const [face, f] of Object.entries(target.manifest.faces)) {
    const old = flattenNodes(
      before.scenes.get(before.manifest.faces[face].scene).nodes,
    );
    const slots = entry.document.slots.filter(
      (s) => (s.face ?? "front") === face,
    );
    for (const node of flattenNodes(target.scenes.get(f.scene).nodes)) {
      const prior = old.find((n) => n.id === node.id),
        slot = slots.find((s) => s.nodeId === node.id);
      if (prior && prior.type === node.type)
        for (const key of [
          "text",
          "runs",
          "stat",
          "typography",
          "asset",
          "rect",
        ])
          if (
            !Object.hasOwn(slot?.fixed ?? {}, key) &&
            Object.hasOwn(prior, key)
          )
            node[key] = structuredClone(prior[key]);
      changes.push({
        face,
        nodeId: node.id,
        change: prior ? "updated" : "added",
      });
    }
    for (const node of old)
      if (
        !flattenNodes(target.scenes.get(f.scene).nodes).some(
          (n) => n.id === node.id,
        )
      )
        changes.push({ face, nodeId: node.id, change: "removed" });
  }
  for (const asset of before.manifest.assets)
    if (!target.manifest.assets.some((a) => a.id === asset.id)) {
      target.manifest.assets.push(asset);
      target.files.set(asset.path, before.files.get(asset.path));
    }
  target.manifest.authoring = {
    ...before.manifest.authoring,
    template: entry.key,
  };
  return {
    beforeDigest: before.digest,
    template: entry.key,
    changes,
    package: await buildPackage(target.manifest, target.scenes, target.files),
  };
}
export async function applyTemplateMigration(project, preview) {
  ensure(
    (await project.export({ retainSources: true })).digest ===
      preview.beforeDigest,
    "STALE_DRAFT",
    "Draft changed; preview the migration again",
  );
  project.edit((p) => {
    p.manifest = structuredClone(preview.package.manifest);
    p.scenes = structuredClone(preview.package.scenes);
    p.assets = new Map(
      preview.package.manifest.assets.map((a) => [
        a.path,
        preview.package.files.get(a.path),
      ]),
    );
  });
}
export async function previewTemplateBatch(projects, entry) {
  const results = [];
  for (const project of projects)
    try {
      results.push({
        id: project.manifest.id,
        preview: await previewTemplateMigration(project, entry),
      });
    } catch (error) {
      results.push({
        id: project.manifest.id,
        error: { code: error.code ?? "MIGRATION", message: error.message },
      });
    }
  return results;
}

export function createMemoryLibrary() {
  const entries = new Map();
  return {
    async list() {
      return structuredClone([...entries.values()]);
    },
    async get(id) {
      return structuredClone(entries.get(id));
    },
    async put(entry) {
      ensure(
        !entries.has(entry.key),
        "LIBRARY_IMMUTABLE",
        "Choose a new library revision",
      );
      entries.set(entry.key, structuredClone(entry));
    },
    async remove(key) {
      entries.delete(key);
    },
  };
}
export function createLocalLibrary(name = "digital-card-library") {
  async function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("entries", { keyPath: "key" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function request(mode, operation) {
    const database = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction("entries", mode),
          r = operation(tx.objectStore("entries"));
        let result;
        r.onsuccess = () => {
          result = r.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? r.error);
        tx.onabort = () =>
          reject(tx.error ?? new Error("Library transaction aborted"));
      });
    } finally {
      database.close();
    }
  }
  return {
    list: () => request("readonly", (s) => s.getAll()),
    get: (key) => request("readonly", (s) => s.get(key)),
    put: (entry) => request("readwrite", (s) => s.add(entry)),
    remove: (key) => request("readwrite", (s) => s.delete(key)),
  };
}
export async function saveTemplate(
  project,
  library,
  {
    id = uid("template"),
    revision = 1,
    name = "Card template",
    tags = [],
  } = {},
) {
  const pkg = await project.export(),
    slots = [];
  for (const [face, description] of Object.entries(pkg.manifest.faces))
    for (const node of flattenNodes(pkg.scenes.get(description.scene).nodes)) {
      const fixed = { type: node.type };
      for (const key of [
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "scaleX",
        "scaleY",
        "pivotX",
        "pivotY",
        "opacity",
        "visible",
        "mask",
        "motion",
        "animation",
      ])
        fixed[key] = structuredClone(node[key] ?? null);
      if (node.locked)
        for (const [key, value] of Object.entries(node))
          if (!["name", "children", "locked"].includes(key))
            fixed[key] = structuredClone(value);
      slots.push({ face, nodeId: node.id, fixed });
    }
  const shape = (nodes) =>
    nodes.map((n) => ({
      id: n.id,
      ...(n.children ? { children: shape(n.children) } : {}),
    }));
  const document = {
    id,
    revision,
    name,
    canvas: pkg.manifest.canvas,
    packageDigest: pkg.digest,
    slots,
    tags,
    structure: Object.fromEntries(
      Object.entries(pkg.manifest.faces).map(([face, f]) => [
        face,
        shape(pkg.scenes.get(f.scene).nodes),
      ]),
    ),
    assetDigests: Object.fromEntries(
      pkg.manifest.assets
        .filter((a) =>
          slots.some((s) =>
            Object.values(s.fixed).some((v) => v === a.id || v?.asset === a.id),
          ),
        )
        .map((a) => [a.id, a.sha256]),
    ),
  };
  const entry = {
    key: id + "@" + revision,
    kind: "template",
    document,
    archive: pkg.archive,
  };
  await library.put(entry);
  return entry;
}
export async function loadTemplate(entry) {
  ensure(entry?.kind === "template", "TEMPLATE", "Choose a template");
  const pkg = await importPackage(entry.archive);
  ensure(
    pkg.digest === entry.document.packageDigest,
    "INTEGRITY",
    "Template content changed",
  );
  pkg.manifest.authoring ??= { values: { card: {}, variant: {} } };
  pkg.manifest.authoring.template = entry.key;
  return buildPackage(pkg.manifest, pkg.scenes, pkg.files);
}
export async function saveMask(
  project,
  side,
  nodeId,
  library,
  {
    id = uid("mask"),
    revision = 1,
    name = "Reusable mask",
    use = "clip",
    tags = [],
  } = {},
) {
  const node = flattenNodes(
    project.scenes.get(project.manifest.faces[side].scene).nodes,
  ).find((n) => n.id === nodeId);
  const mask =
    use === "clip"
      ? node?.mask
      : node?.material?.mask ?? (node?.material?.maskAsset
        ? { asset: node.material.maskAsset }
        : null);
  ensure(mask, "MASK", "The selected layer has no " + use + " mask");
  const pkg = await project.export(),
    entry = {
      key: id + "@" + revision,
      kind: "mask",
      document: {
        id,
        revision,
        name,
        tags,
        use,
        mask: structuredClone(mask),
        packageDigest: pkg.digest,
      },
      archive: pkg.archive,
    };
  await library.put(entry);
  return entry;
}
export async function applyMask(project, side, nodeId, entry) {
  ensure(entry?.kind === "mask", "MASK", "Choose a mask");
  const source = await importPackage(entry.archive);
  ensure(
    source.digest === entry.document.packageDigest,
    "INTEGRITY",
    "Mask source changed",
  );
  const mask = structuredClone(entry.document.mask);
  let addition;
  if (mask.asset) {
    const a = source.manifest.assets.find((a) => a.id === mask.asset),
      bytes = source.files.get(a.path),
      id = "mask-" + (await sha256(bytes)).slice(0, 32);
    addition = {
      asset: {
        ...a,
        id,
        path: "assets/" + id + "." + a.path.split(".").at(-1),
      },
      bytes,
    };
    mask.asset = id;
  }
  project.edit((p) => {
    const node = flattenNodes(
      p.scenes.get(p.manifest.faces[side].scene).nodes,
    ).find((n) => n.id === nodeId);
    ensure(node && !node.locked, "MASK", "Choose an unlocked layer");
    if (
      addition &&
      !p.manifest.assets.some((a) => a.id === addition.asset.id)
    ) {
      p.manifest.assets.push(addition.asset);
      p.assets.set(addition.asset.path, addition.bytes);
    }
    if (entry.document.use === "effect") {
      ensure(
        node.material,
        "MASK",
        "An effect mask needs a material",
      );
      node.material.mask = mask;
      delete node.material.maskAsset;
    } else node.mask = mask;
    if (entry.document.use === "effect" || mask.rect || mask.transform) {
      if (!p.manifest.capabilities.required.includes("dc.mask-layout@0.2")) p.manifest.capabilities.required.push("dc.mask-layout@0.2");
    }
    p.manifest.authoring ??= { values: { card: {}, variant: {} } };
    p.manifest.authoring.masks ??= {};
    p.manifest.authoring.masks[side + ":" + nodeId] = entry.key;
  });
}
export function inspectProject(project, policy) {
  const a = project.manifest.authoring ?? {};
  return inspectCardPolicy(policy, {
    card: { ...a.context, stats: a.values?.card ?? {} },
    variant: { id: a.context?.variantId, stats: a.values?.variant ?? {} },
    presentation: { manifest: project.manifest, scenes: project.scenes },
    templates: [],
  });
}
