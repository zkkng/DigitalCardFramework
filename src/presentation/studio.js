import { analyzePerformance, enforcePerformance } from "./performance.js";
import {
  createProject,
  loadDraft,
  materialPresets,
  blankPackage,
} from "./project.js";
import { importPackage, browserResolver } from "./package.js";
import { imagePackage } from "./authoring.js";
import { importLayeredFile } from "./layered-import.js";
import { createPlayerStage } from "./player.js";
import { mountAuthoringTools } from "./studio-tools.js";

const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const allNodes = (nodes) =>
  nodes.flatMap((n) => [n, ...allNodes(n.children ?? [])]);

/** Optional creator UI. Uses exactly the public player and compiler contracts. */
export function mountStudio(
  root,
  {
    initialPackage,
    onPublish,
    performance = {},
    presets = materialPresets,
    library, policyProvider, context = {}, panels = [],
  } = {},
) {
  presets = { ...presets };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("dcard-finish:"))
        try {
          presets[key.slice(13)] = JSON.parse(localStorage.getItem(key));
        } catch {}
    }
  } catch {}
  root.classList.add("dcard-studio");
  let project,
    view,
    resolver,
    stage,
    selected,
    side = "front",
    disposed = false,
    paintCanvas,
    paintDialog,
    painting = false,
    rebuildRevision = 0,
    actionTail = Promise.resolve();
  const events = new AbortController(),
    toolbar = el("div"),
    layout = el("div"),
    layers = el("aside"),
    center = el("section"),
    region = el("div"),
    slot = el("div"),
    properties = el("aside"),
    status = el("p"),
    diagnostics = el("details"),
    scrub = el("input");
  toolbar.className = "dcs-toolbar";
  layout.className = "dcs-layout";
  layers.className = "dcs-layers";
  center.className = "dcs-center";
  region.className = "dcs-region";
  properties.className = "dcs-properties";
  status.className = "dcs-status";
  status.setAttribute("role", "status");
  slot.className = "dcs-slot";
  region.append(slot);
  center.append(region);
  layout.append(layers, center, properties);
  root.append(toolbar, layout, diagnostics, status);
  function showPerformance(pkg) {
    const result = analyzePerformance(pkg, performance);
    diagnostics.replaceChildren(
      el("summary", `Mobile performance: ${result.issues.length} warnings`),
    );
    diagnostics.append(el("p", result.caveat));
    for (const issue of result.issues)
      button(
        `${issue.face}${issue.path}: ${issue.message} ${issue.remedy}`,
        async () => {
          side = issue.face;
          selected = issue.layerId;
          await rebuild();
        },
        diagnostics,
      );
    return result;
  }
  const report = (message) => (status.textContent = message);
  function button(label, fn, parent = toolbar) {
    const b = el("button", label);
    b.type = "button";
    b.onclick = () => {
      actionTail = actionTail
        .then(() => (disposed ? undefined : fn()))
        .catch((e) => report(e.message));
      return actionTail;
    };
    parent.append(b);
    return b;
  }
  function upload(accept, fn) {
    const file = el("input");
    file.type = "file";
    file.accept = accept;
    file.onchange = () => {
      if (file.files[0])
        Promise.resolve(fn(file.files[0])).catch((e) => report(e.message));
    };
    file.click();
  }
  function scene() {
    return project.scenes.get(project.manifest.faces[side].scene);
  }
  function current() {
    return allNodes(scene().nodes).find((n) => n.id === selected);
  }
  function sync() {
    if (!project) return;
    resolver.manifest = project.manifest;
    resolver.scenes = project.scenes;
    view.updateScene(scene()).catch((e) => report(e.message));
    renderLayers();
  }
  function edit(fn) {
    project.edit(fn);
    sync();
  }
  async function rebuild() {
    const revision = ++rebuildRevision;
    view?.dispose();
    stage?.dispose();
    resolver?.dispose();
    paintDialog?.remove();
    paintCanvas = null;
    const pkg = await project.export();
    if (disposed || revision !== rebuildRevision) return;
    resolver = browserResolver(pkg);
    slot.style.aspectRatio = `${project.manifest.canvas.width}/${project.manifest.canvas.height}`;
    stage = createPlayerStage({
      root: region,
      budget: { estimatedGpuBytes: 192 * 1024 * 1024, maxDpr: 3 },
    });
    view = stage.mount(
      slot,
      { title: project.manifest.title, resolver },
      {
        side,
        quality: "standard",
        inputMode: "drag",
        onEvent: (e) => {
          if (e.type === "fallback") report(e.reason);
        },
      },
    );
    await view.ready;
    if (disposed || revision !== rebuildRevision) return;
    renderLayers();
    renderProperties();
    showPerformance(pkg);
    report(
      `${project.manifest.title} · ${project.manifest.assets.length} assets`,
    );
  }
  async function open(pkg) {
    project = createProject(pkg);
    selected = project.scenes.get(project.manifest.faces.front.scene).nodes[0]
      ?.id;
    side = "front";
    await rebuild();
  }
  async function importArtwork(file) {
    report("Reading the layered artwork…");
    const conversion = await importLayeredFile(file, { signal: events.signal });
    if (!conversion.report.issues.length) {
      await open(await conversion.build());
      report(
        `Imported ${conversion.report.layerCount} layers in their original positions. ${conversion.report.notes.length ? "Stored raster appearances preserved; source-only text/vector editing is not retained." : ""}`,
      );
      return;
    }
    const dialog = el("dialog");
    dialog.className = "dcs-import-report";
    dialog.append(
      el("h2", "Review this import"),
      el(
        "p",
        `${conversion.report.layerCount} raster layers found. These source features need attention:`,
      ),
    );
    const list = el("ul");
    for (const item of conversion.report.issues.slice(0, 30))
      list.append(el("li", `${item.layer}: ${item.message}`));
    dialog.append(list);
    root.append(dialog);
    button(
      "Import supported layers",
      async () => {
        dialog.close();
        dialog.remove();
        await open(await conversion.build());
        report(
          "Imported supported layers. Source features listed in the import report may look different.",
        );
      },
      dialog,
    );
    if (conversion.canFlatten)
      button(
        "Keep original flattened appearance",
        async () => {
          dialog.close();
          dialog.remove();
          await open(await conversion.build({ flatten: true }));
          report(
            "Imported the source preview as one layer. Use a rasterized layered source to edit individual parts.",
          );
        },
        dialog,
      );
    button(
      "Cancel import",
      () => {
        dialog.close();
        dialog.remove();
        report("Import cancelled. Your current card is intact.");
      },
      dialog,
    );
    dialog.showModal();
  }
  button("Import layered artwork", () =>
    upload(".psd,.ora,.zip,.gif", importArtwork),
  );
  button("Make card from image", () =>
    upload("image/png,image/webp,image/jpeg", async (file) =>
      open(
        await imagePackage({
          bytes: new Uint8Array(await file.arrayBuffer()),
          mediaType: file.type,
          title: file.name.replace(/\.[^.]+$/, ""),
        }),
      ),
    ),
  );
  button("New card", async () => open(await blankPackage()));
  button("Open card", () =>
    upload(".dcard,.dcproject", async (f) =>
      open(await importPackage(new Uint8Array(await f.arrayBuffer()))),
    ),
  );
  button("Add image", () =>
    upload("image/png,image/webp,image/jpeg", async (f) => {
      if (!project) throw new Error("Open a card first");
      const a = await project.addImage(f);
      const scale = Math.min(1, 600 / a.width, 900 / a.height),
        node = {
          id: a.id,
          name: f.name,
          type: "image",
          asset: a.id,
          x: 100,
          y: 200,
          width: a.width * scale,
          height: a.height * scale,
        };
      project.edit(() => scene().nodes.push(node));
      selected = node.id;
      await rebuild();
    }),
  );
  button("Add animated GIF layer", () =>
    upload(".gif,image/gif", async (file) => {
      if (!project) throw new Error("Open a card first");
      const conversion = await importLayeredFile(file),
        pkg = await conversion.build();
      const prefix = "gif-" + crypto.randomUUID().replaceAll("-", "") + "-";
      const node = structuredClone(
        pkg.scenes.get(pkg.manifest.faces.front.scene).nodes[0],
      );
      project.edit((p) => {
        for (const asset of pkg.manifest.assets) {
          const next = {
            ...asset,
            id: prefix + asset.id,
            path: "assets/" + prefix + asset.id + ".png",
          };
          p.manifest.assets.push(next);
          p.assets.set(next.path, pkg.files.get(asset.path));
        }
        node.id = prefix + node.id;
        node.asset = prefix + node.asset;
        for (const frame of node.animation?.frames ?? [])
          frame.asset = prefix + frame.asset;
        scene().nodes.push(node);
      });
      selected = node.id;
      await rebuild();
    }),
  );
  button("Import layers", () => {
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/webp,image/jpeg";
    file.multiple = true;
    file.onchange = async () => {
      try {
        for (const f of file.files) {
          const a = await project.addImage(f);
          project.edit(() =>
            scene().nodes.push({
              id: a.id,
              name: f.name,
              type: "image",
              asset: a.id,
              x: 0,
              y: 0,
              width: project.manifest.canvas.width,
              height: project.manifest.canvas.height,
            }),
          );
        }
        await rebuild();
      } catch (error) {
        report(error.message);
      }
    };
    file.click();
  });
  button("Add video", () =>
    upload("video/mp4,video/webm", async (f) => {
      const video = document.createElement("video"),
        url = URL.createObjectURL(f);
      try {
        video.preload = "metadata";
        video.src = url;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () =>
            reject(new Error("This browser cannot decode the video"));
        });
        const a = await project.addMedia(f, {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
        });
        project.edit(() =>
          scene().nodes.push({
            id: a.id,
            name: f.name,
            type: "video",
            asset: a.id,
            x: 0,
            y: 0,
            width: project.manifest.canvas.width,
            height: project.manifest.canvas.height,
            video: {
              mode: "autoplay-muted",
              loop: true,
              muted: true,
              poster: project.manifest.faces[side].poster,
            },
          }),
        );
        selected = a.id;
        await rebuild();
      } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
    }),
  );
  button("Save project", async () => {
    const pkg = await project.export({ retainSources: true }),
      url = URL.createObjectURL(new Blob([pkg.archive]));
    const a = el("a");
    a.href = url;
    a.download = project.manifest.id + ".dcproject";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report("Editable project saved, including unused imported assets.");
  });
  button("Undo", async () => {
    if (project?.undoEdit()) await rebuild();
  });
  button("Redo", async () => {
    if (project?.redoEdit()) await rebuild();
  });
  button("Front / back", async () => {
    if (!project) return;
    side = side === "front" ? "back" : "front";
    selected = scene().nodes[0]?.id;
    await rebuild();
  });
  button("Save draft", async () => {
    await project.saveDraft();
    report("Draft saved on this device.");
  });
  button("Restore draft", async () => {
    const draft = await loadDraft();
    if (draft) {
      project = draft;
      selected = scene().nodes[0]?.id;
      await rebuild();
    } else report("No saved draft on this device.");
  });
  async function capturePosters() {
    if (!project || disposed) throw new Error("No active project");
    const original = project,
      revision = project.getRevision(),
      captures = {};
    await view.setQuality("standard");
    try {
      for (const face of ["front", "back"]) {
        await view.setSide(face);
        view.setInputs({ tilt: { x: 0, y: 0 }, angle: 0.5 });
        if (stage.diagnostics().activeViews !== 1)
          throw new Error(
            "This face needs a supplied poster because interactive rendering is unavailable",
          );
        captures[face] = await view.snapshot();
      }
      if (project !== original || project.getRevision() !== revision)
        throw new Error("Project changed during capture; capture again");
      await project.setPosters(captures);
    } finally {
      if (!disposed) await view.setSide(side);
    }
    await rebuild();
    report("Both face posters captured from the renderer.");
  }
  button("Capture posters", capturePosters);
  button("Export .dcard", async () => {
    const pkg = await project.export();
    enforcePerformance(showPerformance(pkg));
    const url = URL.createObjectURL(
        new Blob([pkg.archive], { type: "application/zip" }),
      ),
      a = el("a");
    a.href = url;
    a.download = `${project.manifest.id}.dcard`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report(
      `Exported ${Math.round(pkg.archive.length / 1024)} KiB · ${pkg.digest.slice(0, 23)}…`,
    );
  });
  if (onPublish)
    button("Publish", async () => {
      const pkg = await project.export();
      enforcePerformance(showPerformance(pkg));
      const result=await onPublish(pkg);
      report(result===false?"Kept as draft.":"Published.");
    });
  scrub.type = "range";
  scrub.min = "-100";
  scrub.max = "100";
  scrub.value = "0";
  scrub.setAttribute("aria-label", "Preview card turn");
  scrub.oninput = () =>
    view?.setInputs({ tilt: { x: Number(scrub.value) / 100, y: 0 } });
  center.append(scrub);
  pick(
    "Preview quality",
    ["poster", "lite", "standard", "ultra"],
    "standard",
    (value) => view?.setQuality(value),
    center,
  );
  function field(
    label,
    value,
    change,
    { min, max, step = 1, type = "number", parent = properties } = {},
  ) {
    const wrap = el("label", label),
      input = el("input");
    input.setAttribute("aria-label", label);
    input.type = type;
    input.value = String(
      type === "number" ? Math.round(value * 1000) / 1000 : value,
    );
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    input.step = step;
    input.onchange = () => {
      try {
        change(type === "number" ? Number(input.value) : input.value);
      } catch (e) {
        report(e.message);
        input.value = String(value);
      }
    };
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function pick(label, values, value, change, parent = properties) {
    const wrap = el("label", label),
      select = el("select");
    select.setAttribute("aria-label", label);
    for (const v of values) {
      const option = el("option", v);
      option.value = v;
      select.append(option);
    }
    select.value = value;
    select.onchange = () => {
      try {
        change(select.value);
      } catch (e) {
        report(e.message);
      }
    };
    wrap.append(select);
    parent.append(wrap);
    return select;
  }
  function renderLayers() {
    layers.replaceChildren(
      el("h2", side === "front" ? "Front layers" : "Back layers"),
    );
    if (!project) return;
    for (const node of [...allNodes(scene().nodes)].reverse()) {
      const b = button(
        node.name ?? node.id,
        () => {
          selected = node.id;
          renderLayers();
          renderProperties();
        },
        layers,
      );
      b.className = node.id === selected ? "is-selected" : "";
    }
  }
  function setProp(key, value) {
    const n = current();
    if (!n) return;
    if (n.locked) throw new Error("Unlock this layer to edit it");
    edit(() => {
      const previous = n[key] ?? 0;
      n[key] = value;
      if (n.bindings?.[key])
        n.bindings[key] = ["add", n.bindings[key], value - previous];
      if (n.animation && ["x", "y"].includes(key))
        for (const frame of n.animation.frames) frame[key] += value - previous;
    });
  }
  function renderProperties() {
    authoring.render();
    properties.replaceChildren(el("h2", "Selected layer"));
    field(
      "Card title",
      project?.manifest.title ?? "",
      (value) => edit(() => (project.manifest.title = value)),
      { type: "text" },
    );
    field(
      "Face description",
      project?.manifest.faces[side].description ?? "",
      (value) => edit(() => (project.manifest.faces[side].description = value)),
      { type: "text" },
    );
    if (!project) return;
    const n = current();
    if (!n) {
      properties.append(el("p", "Choose a layer."));
      return;
    }
    field(
      "Name",
      n.name ?? n.id,
      (v) => {
        edit(() => (n.name = v));
      },
      { type: "text" },
    );
    const position = el("div");
    position.className = "dcs-position";
    properties.append(position);
    for (const key of ["x", "y", "width", "height", "rotation"])
      field(key, n[key] ?? 0, (v) => setProp(key, v), {
        step: 0.1,
        parent: position,
      });
    const row = el("div");
    row.className = "dcs-row";
    properties.append(row);
    for (const [label, delta] of [
      ["Bring forward", 1],
      ["Send back", -1],
    ])
      button(
        label,
        () => {
          edit(() => {
            const list = scene().nodes,
              index = list.indexOf(n);
            if (index >= 0) {
              const next = Math.max(
                0,
                Math.min(list.length - 1, index + delta),
              );
              list.splice(index, 1);
              list.splice(next, 0, n);
            }
          });
        },
        row,
      );
    pick(
      "Finish",
      ["None", "Custom", ...Object.keys(presets)],
      Object.keys(presets).find(
        (k) => JSON.stringify(presets[k]) === JSON.stringify(n.material),
      ) ?? (n.material ? "Custom" : "None"),
      (name) => {
        if (name === "Custom") return;
        edit(() => {
          if (name === "None") {
            delete n.material;
            for (const key of Object.keys(n.bindings ?? {}))
              if (key.startsWith("material.")) delete n.bindings[key];
          } else {
            n.material = structuredClone(presets[name]);
            n.bindings = {
              ...n.bindings,
              [n.material.kind === "water"
                ? "material.sweep"
                : n.material.kind === "bloom"
                  ? "material.progress"
                  : "material.angle"]: ["input", "angle"],
            };
          }
        });
        renderProperties();
      },
    );
    if (n.material) {
      const m = n.material;
      field(
        "Intensity",
        m.intensity ?? 1,
        (v) => edit(() => (m.intensity = v)),
        { min: 0, max: 8, step: 0.1 },
      );
      if (m.kind === "glitter")
        field("Flake size", m.size ?? 4, (v) => edit(() => (m.size = v)), {
          min: 0.5,
          max: 100,
          step: 0.5,
        });
      button("Paint effect area", () => beginPaint(n), properties);
      button(
        "Upload effect mask",
        () =>
          upload("image/png,image/webp", async (f) => {
            const a = await project.addImage(f, { role: "mask" });
            project.edit(() => (n.material.maskAsset = a.id));
            await rebuild();
          }),
        properties,
      );
      const advanced = el("details"),
        summary = el("summary", "Advanced material controls");
      advanced.append(summary);
      properties.append(advanced);
      if (m.kind === "glitter") {
        for (const [key, label, min, max, step] of [
          ["density", "Density", 0, 1, 0.05],
          ["roughness", "Roughness", 0, 1, 0.05],
          ["variation", "Size variation", 0, 1, 0.05],
          ["seed", "Scatter seed", 0, 1000000, 1],
        ])
          field(label, m[key] ?? 0.3, (v) => edit(() => (m[key] = v)), {
            min,
            max,
            step,
            parent: advanced,
          });
        pick(
          "Flake shape",
          ["circle", "hexagon", "shard", "star"],
          m.shape ?? "circle",
          (v) => edit(() => (m.shape = v)),
          advanced,
        );
        pick(
          "Custom flake coloring",
          ["holo", "texture"],
          m.flakeColor ?? "holo",
          (v) => edit(() => (m.flakeColor = v)),
          advanced,
        );
        button(
          "Use my flake design",
          () =>
            upload("image/png,image/webp", async (f) => {
              const a = await project.addImage(f);
              project.edit(() => (m.flakeAsset = a.id));
              await rebuild();
            }),
          advanced,
        );
        field(
          "Flake color",
          m.color ?? "#ffffff",
          (v) => edit(() => (m.color = v)),
          { type: "color", parent: advanced },
        );
        button("Use rainbow holo", () => edit(() => delete m.color), advanced);
      }
      for (const key of ["radius", "feather"])
        if (m[key] !== undefined)
          field(key, m[key], (v) => edit(() => (m[key] = v)), {
            min: 0.001,
            max: 2,
            step: 0.01,
            parent: advanced,
          });
      button(
        "Save finish preset",
        () => {
          const name = prompt("Name this finish");
          if (name) {
            const saved = structuredClone(m);
            delete saved.maskAsset;
            delete saved.flakeAsset;
            localStorage.setItem("dcard-finish:" + name, JSON.stringify(saved));
            presets[name] = saved;
            report("Finish saved on this device.");
            renderProperties();
          }
        },
        advanced,
      );
    }
    const motionPanel = el("details");
    motionPanel.append(el("summary", "Motion and layers"));
    properties.append(motionPanel);
    for (const [index, label] of [
      [0, "Horizontal parallax"],
      [1, "Vertical parallax"],
    ])
      field(
        label,
        n.parallax?.[index] ?? 0,
        (v) =>
          edit(() => {
            n.parallax ??= [0, 0];
            n.parallax[index] = v;
          }),
        { min: -1000, max: 1000, step: 1, parent: motionPanel },
      );
    if (n.type === "image")
      button(
        "Add pose images",
        () => {
          const input = el("input");
          input.type = "file";
          input.accept = "image/png,image/webp";
          input.multiple = true;
          input.onchange = async () => {
            try {
              const frames = n.animation?.frames ?? [
                {
                  asset: n.asset,
                  rect: n.rect ?? [
                    0,
                    0,
                    project.manifest.assets.find((a) => a.id === n.asset).width,
                    project.manifest.assets.find((a) => a.id === n.asset)
                      .height,
                  ],
                  x: n.x ?? 0,
                  y: n.y ?? 0,
                  width: n.width,
                  height: n.height,
                  duration: 100,
                  name: "Original",
                },
              ];
              for (const f of input.files) {
                const a = await project.addImage(f);
                frames.push({
                  asset: a.id,
                  rect: [0, 0, a.width, a.height],
                  x: n.x ?? 0,
                  y: n.y ?? 0,
                  width: n.width,
                  height: n.height,
                  duration: 100,
                  name: f.name,
                });
              }
              project.edit(
                () =>
                  (n.animation = {
                    frames,
                    progress: ["input", "angle"],
                    loop: false,
                  }),
              );
              await rebuild();
            } catch (error) {
              report(error.message);
            }
          };
          input.click();
        },
        motionPanel,
      );
    const graph = el("textarea");
    graph.setAttribute("aria-label", "Motion bindings JSON");
    graph.value = JSON.stringify(n.bindings ?? {}, null, 2);
    motionPanel.append(graph);
    button(
      "Apply motion graph",
      () => {
        const bindings = JSON.parse(graph.value);
        edit(() => (n.bindings = bindings));
        report("Motion graph validated.");
      },
      motionPanel,
    );
    if (n.animation) {
      const panel = el("details");
      panel.append(el("summary", "Animation frames"));
      properties.append(panel);
      for (const [index, frame] of n.animation.frames.entries()) {
        const item = el("div");
        item.append(el("h3", frame.name ?? `Frame ${index + 1}`));
        panel.append(item);
        field(
          "Duration",
          frame.duration,
          (v) => edit(() => (frame.duration = v)),
          { min: 1, max: 20000, parent: item },
        );
        field("Ground X", frame.x, (v) => edit(() => (frame.x = v)), {
          step: 0.1,
          parent: item,
        });
        field("Ground Y", frame.y, (v) => edit(() => (frame.y = v)), {
          step: 0.1,
          parent: item,
        });
        button(
          "Preview this pose",
          () => {
            const copy = structuredClone(scene()),
              target = allNodes(copy.nodes).find((x) => x.id === n.id);
            Object.assign(target, frame);
            delete target.animation;
            view.updateScene(copy);
          },
          item,
        );
      }
      button("Resume angle animation", sync, panel);
    }
    button(
      "Remove layer",
      () => {
        edit(() => {
          const index = scene().nodes.indexOf(n);
          if (index >= 0) scene().nodes.splice(index, 1);
        });
        selected = scene().nodes[0]?.id;
        renderProperties();
      },
      motionPanel,
    );
  }
  async function beginPaint(node) {
    paintDialog?.remove();
    paintDialog = el("dialog");
    paintDialog.className = "dcs-paint-dialog";
    paintDialog.setAttribute("aria-label", "Paint effect area");
    paintDialog.append(
      el("h2", "Paint effect area"),
      el(
        "p",
        "White marks where this finish appears. The art underneath stays intact.",
      ),
    );
    root.append(paintDialog);
    const surface = el("div");
    surface.className = "dcs-paint-surface";
    surface.style.aspectRatio = `${node.width}/${node.height}`;
    const base = el("canvas");
    paintCanvas = el("canvas");
    paintCanvas.width = base.width = Math.max(
      1,
      Math.round(Math.min(512, (768 * node.width) / node.height)),
    );
    paintCanvas.height = base.height = Math.max(
      1,
      Math.round((paintCanvas.width * node.height) / node.width),
    );
    paintCanvas.className = "dcs-mask";
    surface.append(base, paintCanvas);
    paintDialog.append(surface);
    const source = await resolver.asset(node.asset),
      img = new Image();
    img.src = source.url;
    await img.decode();
    const rect = node.rect ?? [0, 0, source.width, source.height];
    base
      .getContext("2d")
      .drawImage(img, ...rect, 0, 0, base.width, base.height);
    img.src = "";
    const ctx = paintCanvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.strokeStyle = "white";
    ctx.lineWidth = 38;
    ctx.lineCap = "round";
    let last;
    if (node.material.maskAsset) {
      const mask = await resolver.asset(node.material.maskAsset),
        image = new Image();
      image.src = mask.url;
      await image.decode();
      ctx.drawImage(image, 0, 0, paintCanvas.width, paintCanvas.height);
      image.src = "";
    }
    const point = (e) => {
      const r = paintCanvas.getBoundingClientRect();
      return [
        ((e.clientX - r.left) / r.width) * paintCanvas.width,
        ((e.clientY - r.top) / r.height) * paintCanvas.height,
      ];
    };
    paintCanvas.onpointerdown = (e) => {
      painting = true;
      paintCanvas.setPointerCapture(e.pointerId);
      last = point(e);
      ctx.beginPath();
      ctx.arc(last[0], last[1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    };
    paintCanvas.onpointermove = (e) => {
      if (!painting) return;
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(...last);
      ctx.lineTo(...p);
      ctx.stroke();
      last = p;
    };
    paintCanvas.onpointerup = () => (painting = false);
    button(
      "Brush",
      () => (ctx.globalCompositeOperation = "source-over"),
      paintDialog,
    );
    button(
      "Erase",
      () => (ctx.globalCompositeOperation = "destination-out"),
      paintDialog,
    );
    field("Brush size", 38, (v) => (ctx.lineWidth = v), {
      min: 2,
      max: 150,
      parent: paintDialog,
    });
    button(
      "Apply painted mask",
      async () => {
        const blob = await new Promise((resolve) =>
            paintCanvas.toBlob(resolve, "image/png"),
          ),
          a = await project.addImage(blob, { role: "mask" });
        project.edit(() => (node.material.maskAsset = a.id));
        paintDialog.close();
        paintDialog.remove();
        paintCanvas = null;
        await rebuild();
      },
      paintDialog,
    );
    button(
      "Cancel painting",
      () => {
        paintDialog.close();
        paintDialog.remove();
        paintCanvas = null;
      },
      paintDialog,
    );
    paintDialog.showModal();
  }
  root.addEventListener("dragover", (e) => e.preventDefault(), {
    signal: events.signal,
  });
  root.addEventListener(
    "drop",
    async (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f)
        try {
          if (/\.(psd|ora|zip|gif)$/i.test(f.name)) await importArtwork(f);
          else if (/\.(dcard|dcproject)$/i.test(f.name))
            await open(
              await importPackage(new Uint8Array(await f.arrayBuffer())),
            );
        } catch (error) {
          report(error.message);
        }
    },
    { signal: events.signal },
  );
  const authoring = mountAuthoringTools({toolbar,getProject:()=>project,getSide:()=>side,getSelected:()=>selected,select:id=>{selected=id;},rebuild,open,report,library,policyProvider,context,panels});
  root.append(authoring.root);
  const ready = initialPackage
    ? open(initialPackage)
    : Promise.resolve(report("Open a .dcard file to begin."));
  return {
    ready,
    getProject: () => project,
    capturePosters,
    open,
    refreshPolicy: authoring.refreshPolicy,
    dispose() {
      disposed = true;
      events.abort();
      authoring.dispose();
      view?.dispose();
      stage?.dispose();
      resolver?.dispose();
      root.replaceChildren();
      root.classList.remove("dcard-studio");
    },
  };
}
