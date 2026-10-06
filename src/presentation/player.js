import { ensure, clamp } from "./data.js";
import { CAPABILITIES, validateScene } from "./validate.js";
import { evaluate, normalizedInputs, selectFrame } from "./motion.js";
import { createWebGLRenderer } from "./webgl.js";
import { surfaceResolution } from "./resolution.js";
import { inspectFont, drawText, textValue, fontDiagnostics, layoutText, textMeasure, accessibleText } from "./text.js";

function validateBudget(value) {
  const fields = {
    estimatedGpuBytes: [1024, 2 ** 32],
    maxDpr: [0.1, 4],
    maxZoom: [1, 8],
    renderScale: [0.1, 4],
    maxCanvasPixels: [1, 33554432],
    maxTextureEdge: [64, 16384],
    activeVideoDecoders: [0, 16],
    maxGraphOperationsPerUpdate: [1, 1000000],
  };
  for (const [key, n] of Object.entries(value)) {
    const range = fields[key];
    ensure(
      range &&
        Number.isFinite(n) &&
        n >= range[0] &&
        n <= range[1] &&
        (["maxDpr", "maxZoom", "renderScale"].includes(key) ||
          Number.isInteger(n)),
      "BUDGET",
      "Invalid stage budget " + key,
    );
  }
}
const qualities = ["poster", "lite", "standard", "ultra"];
const compose = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const flatten = (nodes) =>
  nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
const resourceSignature = (scene,manifest) =>
  JSON.stringify(manifest.authoring?.values??{})+JSON.stringify(
    flatten(scene.nodes).map((n) => ({
      id: n.id,
      type: n.type,
      asset: n.asset,
      mask: n.mask?.asset,
      flake: n.material?.flakeAsset,
      effectMask: n.material?.mask?.asset ?? n.material?.maskAsset,
      frames: n.animation?.frames?.map((f) => f.asset),
      text:
        n.type === "text"
          ? [n.text, n.font, n.color, n.width, n.height, n.typography, n.runs, n.stat]
          : undefined,
      adapter: n.adapter,
      data: n.data,
      video: n.video,
      audio: n.audio,
    })),
  );

/** A shared GPU surface. Host DOM owns layout; views own explicit resource leases. */
export function createPlayerStage({
  root,
  budget = {},
  motion = "respect-preference",
  adapters = [],
  onDiagnostic = () => {},
}) {
  ensure(
    root instanceof HTMLElement,
    "ROOT",
    "A stage root element is required",
  );
  validateBudget(budget);
  const limits = {
    estimatedGpuBytes: 96 * 1024 * 1024,
    maxDpr: 3,
    maxZoom: 3,
    renderScale: 1,
    maxCanvasPixels: 8388608,
    maxTextureEdge: 4096,
    activeVideoDecoders: 1,
    maxGraphOperationsPerUpdate: 16384,
    ...budget,
  };
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "1",
  });
  canvas.setAttribute("aria-hidden", "true");
  const priorPosition = root.style.position;
  if (getComputedStyle(root).position === "static")
    root.style.position = "relative";
  root.append(canvas);
  let gpu;
  try {
    gpu = createWebGLRenderer(canvas);
  } catch (error) {
    onDiagnostic({ type: "fallback", reason: error.message });
  }
  const views = new Set(),
    cache = new Map(),
    cleanup = new AbortController();
  let disposed = false,
    raf = 0,
    frames = 0,
    lastTime = 0,
    bytes = 0,
    decoders = 0,
    slow = 0,
    lastWarning = -Infinity,
    resolution = null,
    layoutDirty = true;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const staticMotion = () => motion === "static" || reduced.matches;
  const emit = (view, event) => {
    try {
      view.onEvent?.(event);
    } catch (error) {
      onDiagnostic({ type: "callbackError", message: error.message });
    }
  };
  function wake() {
    if (!disposed && !raf && !document.hidden) {
      raf = requestAnimationFrame(draw);
    }
  }
  const textureEdge = (view) =>
    Math.min(
      view.resolver.manifest.quality[view.quality]?.maxEdge ??
        view.resolver.manifest.quality.lite?.maxEdge ??
        768,
      limits.maxTextureEdge,
      gpu?.maxTextureSize ?? 4096,
    );
  async function lease(view, id, generation = view.generation) {
    const asset = await view.resolver.asset(id);
    if (view.disposed || generation !== view.generation)
      throw new DOMException("View disposed or replaced", "AbortError");
    const maxEdge = textureEdge(view),
      key = `${view.resolver.digest}:${id}:${maxEdge}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = { key, refs: 0, texture: null, bytes: 0 };
      cache.set(key, entry);
      entry.promise = (async () => {
        const response = await fetch(asset.url, { signal: cleanup.signal });
        ensure(response.ok, "ASSET", "Asset fetch failed");
        const blob = await response.blob();
        const ratio = Math.min(
          1,
          maxEdge / Math.max(asset.width ?? maxEdge, asset.height ?? maxEdge),
        );
        const width = Math.max(1, Math.round((asset.width ?? maxEdge) * ratio)),
          height = Math.max(1, Math.round((asset.height ?? maxEdge) * ratio)),
          cost = width * height * 4;
        ensure(
          bytes + cost + canvas.width * canvas.height * 4 <=
            limits.estimatedGpuBytes,
          "BUDGET",
          "Stage texture budget exceeded",
        );
        bytes += cost;
        entry.bytes = cost;
        let bitmap;
        try {
          bitmap = await createImageBitmap(blob, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: "high",
            premultiplyAlpha: "none",
          });
          ensure(
            !disposed && entry.refs > 0,
            "DISPOSED",
            "Asset no longer referenced",
          );
          entry.texture = gpu.texture(bitmap);
          entry.value = { ...asset, texture: entry.texture,textureWidth:bitmap.width,textureHeight:bitmap.height };
          return entry.value;
        } catch (error) {
          bytes -= entry.bytes;
          entry.bytes = 0;
          if (cache.get(key) === entry) cache.delete(key);
          throw error;
        } finally {
          bitmap?.close();
        }
      })();
    }
    if (!view.leases.has(entry)) {
      entry.refs++;
      view.leases.add(entry);
    }
    return entry.promise;
  }
  function release(entry) {
    if (--entry.refs <= 0) {
      if (cache.get(entry.key) === entry) cache.delete(entry.key);
      if (entry.texture) gpu?.release(entry.texture);
      bytes -= entry.bytes;
      entry.bytes = 0;
    }
  }
  function stopVideo(media) {
    if (media.frameCallback) {
      media.video.cancelVideoFrameCallback?.(media.frameCallback);
      media.frameCallback = 0;
    }
    if (media.active) {
      media.video.pause();
      media.active = false;
      decoders--;
    }
  }
  function unload(view) {
    view.loadAbort?.abort();
    view.loadAbort = new AbortController();
    for (const media of view.media.values()) {
      stopVideo(media);
      media.video.removeAttribute("src");
      media.video.load();
      if (media.texture) gpu?.release(media.texture);
      bytes -= media.cost ?? 0;
      if (media.frameCallback)
        media.video.cancelVideoFrameCallback?.(media.frameCallback);
    }
    view.media.clear();
    for (const audio of view.audio.values()) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    view.audio.clear();
    for (const entry of view.leases) release(entry);
    view.leases.clear();
    view.assets.clear();
    for (const t of view.textures) gpu?.release(t);
    view.textures.clear();
    bytes -= view.textBytes ?? 0;
    view.textBytes = 0;
    for (const a of view.adapterInstances) {
      a.instance.dispose();
      if (a.texture) gpu?.release(a.texture);
      bytes -= a.cost;
    }
    view.adapterInstances = [];
  }
  async function loadSide(view, sceneOverride) {
    if (disposed || view.disposed) return { mode: "cancelled" };
    const generation = ++view.generation;
    unload(view);
    view.readyToDraw = false;
    const manifest = view.resolver.manifest,
      face = manifest.faces[view.side];
    const description=face.description+". "+accessibleText(manifest,sceneOverride??view.resolver.scenes.get(face.scene));
    view.poster.alt = description;
    view.element.setAttribute("aria-label",description);
    try {
      const poster = await view.resolver.asset(face.poster);
      if (view.disposed || generation !== view.generation) return;
      view.poster.src = poster.url;
      view.poster.hidden = false;
      if (
        !gpu ||
        view.quality === "poster" ||
        manifest.capabilities.required.some(
          (c) =>
            !CAPABILITIES.includes(c) &&
            !adapters.some((a) => a.capabilities?.includes(c)),
        )
      ) {
        emit(view, {
          type: "fallback",
          reason: "Static preview selected",
          side: view.side,
        });
        return { mode: "poster", quality: "poster" };
      }
      let scene = sceneOverride ?? view.resolver.scenes.get(face.scene);
      const missingOptional = manifest.capabilities.optional.filter(
        (c) =>
          !CAPABILITIES.includes(c.id) &&
          !adapters.some((a) => a.capabilities?.includes(c.id)),
      );
      if (missingOptional.some((c) => c.fallback !== "omit-decorative")) {
        emit(view, {
          type: "fallback",
          reason:
            "Optional capability unavailable; using declared static fallback",
          side: view.side,
        });
        return { mode: "poster", quality: "poster" };
      }
      if (missingOptional.length) {
        const omit = new Set(missingOptional.map((c) => c.id.split("@")[0]));
        const filter = (nodes) =>
          nodes
            .filter((n) => !(n.type === "adapter" && omit.has(n.adapter)))
            .map((n) =>
              n.children ? { ...n, children: filter(n.children) } : n,
            );
        scene = { ...scene, nodes: filter(scene.nodes) };
        emit(view, { type: "capabilityFallback", omitted: [...omit] });
      }
      validateScene(scene, manifest);
      view.scene = scene;
      view.resourceSignature = resourceSignature(scene, view.resolver.manifest);
      view.usesTime = JSON.stringify(scene).includes("time.active");
      const nodes = flatten(scene.nodes),
        assetIds = new Set();
      for (const node of nodes) {
        if (node.type === "image") assetIds.add(node.asset);
        if (node.mask?.asset) assetIds.add(node.mask.asset);
        if (node.material?.flakeAsset) assetIds.add(node.material.flakeAsset);
        if (node.material?.maskAsset) assetIds.add(node.material.maskAsset);
        if (node.material?.mask?.asset) assetIds.add(node.material.mask.asset);
        for (const frame of node.animation?.frames ?? [])
          assetIds.add(frame.asset);
      }
      // Sequential admission avoids simultaneous bitmap allocations exceeding the budget.
      for (const id of assetIds) {
        const value = await lease(view, id, generation);
        if (view.disposed || generation !== view.generation) return;
        view.assets.set(id, value);
      }
      const fonts = new Map();
      for (const node of nodes) {
        if (node.type === "video") {
          const source = await view.resolver.asset(node.asset),
            poster = await lease(view, node.video.poster, generation);
          if (view.disposed || generation !== view.generation) return;
          view.assets.set(node.video.poster, poster);
          const video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.loop = !!node.video.loop;
          video.preload = "metadata";
          video.src = source.url;
          const media = {
            video,
            source,
            node,
            active: false,
            texture: null,
            last: -1,
            cost: 0,
            dirty: true,
          };
          const frame = () => {
            media.dirty = true;
            wake();
            if (media.active)
              media.frameCallback = video.requestVideoFrameCallback?.(frame);
          };
          media.onFrame = frame;
          video.addEventListener(
            "ended",
            () => {
              stopVideo(media);
              media.ended = true;
              wake();
            },
            { signal: view.loadAbort.signal },
          );
          view.media.set(node.id, media);
          video.addEventListener("loadeddata", wake, {
            signal: view.loadAbort.signal,
          });
          video.addEventListener(
            "error",
            () =>
              emit(view, {
                type: "assetError",
                assetId: node.asset,
                code: "VIDEO",
              }),
            { signal: view.loadAbort.signal },
          );
        }
        if (node.type === "audio") {
          const source = await view.resolver.asset(node.asset);
          if (view.disposed || generation !== view.generation) return;
          const audio = new Audio();
          audio.preload = "none";
          audio.src = source.url;
          audio.loop = node.audio.loop;
          audio.volume = node.audio.volume;
          view.audio.set(node.id, audio);
        }
        if (node.type === "text") {
          let font;
          if (node.typography?.fontAsset) {
            const id = node.typography.fontAsset;
            if (!fonts.has(id)) {
              const source = await view.resolver.asset(id);
              const response = await fetch(source.url, {signal:view.loadAbort.signal});
              ensure(response.ok, "FONT", "Font could not be loaded");
              const data = new Uint8Array(await response.arrayBuffer());
              if (view.disposed || generation !== view.generation) return;
              fonts.set(id, inspectFont(data, source.mediaType).font);
            }
            font = fonts.get(id);
            for (const diagnostic of fontDiagnostics(font, node, textValue(node, manifest))) emit(view, diagnostic);
          }
          const measureContext=document.createElement("canvas").getContext("2d");
          const measured=layoutText(node,textValue(node,manifest),textMeasure(measureContext,node,font));
          const icons=new Map();
          for(const run of node.runs??[])if(run.icon&&!icons.has(run.icon)){
            const source=await view.resolver.asset(run.icon),response=await fetch(source.url,{signal:view.loadAbort.signal});
            ensure(response.ok,"TEXT_ICON","Inline icon could not be loaded");
            icons.set(run.icon,await createImageBitmap(await response.blob(),{resizeWidth:256,resizeHeight:256}));
          }
          const edge = textureEdge(view);
          const ratio = Math.min(1,edge / Math.max(node.width, measured.renderHeight));
          const width = Math.max(1, Math.ceil(node.width * ratio)),
            height = Math.max(1, Math.ceil(measured.renderHeight * ratio)),
            cost = width * height * 4;
          ensure(
            bytes + cost + canvas.width * canvas.height * 4 <=
              limits.estimatedGpuBytes,
            "BUDGET",
            "Text surface budget exceeded",
          );
          const surface = document.createElement("canvas");
          surface.width = width;
          surface.height = height;
          const ctx = surface.getContext("2d");
          ctx.scale(ratio, ratio);
          let layout;
          try{layout=drawText(ctx,node,manifest,font,icons);}finally{for(const bitmap of icons.values())bitmap.close();}
          if (layout.overflow) emit(view, {type:"textOverflow", nodeId:node.id});
          const texture = gpu.texture(surface);
          bytes += cost;
          view.textBytes = (view.textBytes ?? 0) + cost;
          view.textures.add(texture);
          view.assets.set(`text:${node.id}`, {
            texture,
            width: surface.width,
            height: surface.height,
            layoutHeight: measured.renderHeight,
          });
          surface.width = surface.height = 0;
        }
        if (node.type === "adapter") {
          const adapter = adapters.find((a) => a.id === node.adapter);
          ensure(adapter, "ADAPTER", "Required adapter not installed");
          const edge = textureEdge(view),
            ratio = Math.min(1, edge / Math.max(node.width, node.height)),
            width = Math.max(1, Math.round(node.width * ratio)),
            height = Math.max(1, Math.round(node.height * ratio)),
            cost = adapter.estimate({ width, height });
          ensure(
            Number.isFinite(cost) &&
              cost > 0 &&
              bytes + cost + canvas.width * canvas.height * 4 <=
                limits.estimatedGpuBytes,
            "BUDGET",
            "Adapter surface budget exceeded",
          );
          bytes += cost;
          let instance;
          try {
            instance = await adapter.create(
              {
                signal: view.loadAbort.signal,
                invalidate: wake,
                width,
                height,
                digest: view.resolver.digest,
                asset: (id) => view.resolver.asset(id),
                backend: { id: "dc.webgl2", apiVersion: "0.1.0", port: gpu },
              },
              node.data,
            );
          } catch (error) {
            bytes -= cost;
            throw error;
          }
          if (view.disposed || generation !== view.generation) {
            instance.dispose();
            bytes -= cost;
            return;
          }
          view.adapterInstances.push({
            id: node.id,
            instance,
            cost,
            texture: null,
          });
        }
      }
      if (view.disposed || generation !== view.generation) return;
      view.readyToDraw = true;
      view.poster.hidden = true;
      wake();
      return { mode: "interactive", quality: view.quality };
    } catch (error) {
      if (!view.disposed && generation === view.generation) {
        unload(view);
        view.poster.hidden = false;
        if (error.code === "BUDGET" && qualities.indexOf(view.quality) > 1) {
          const from = view.quality;
          view.quality = qualities[qualities.indexOf(from) - 1];
          emit(view, {
            type: "qualityChanged",
            from,
            to: view.quality,
            reason: "Stage texture budget",
          });
          return loadSide(view, sceneOverride);
        }
        emit(view, {
          type: "fallback",
          reason: error.message,
          side: view.side,
        });
        return {
          mode: "poster",
          quality: "poster",
          fallbackReason: error.message,
        };
      }
    }
  }
  function layout() {
    const r = root.getBoundingClientRect(),
      factorX = root.clientWidth / (r.width || 1),
      factorY = root.clientHeight / (r.height || 1);
    for (const v of views) {
      const b = v.element.getBoundingClientRect();
      v.rect = [
        (b.left - r.left) * factorX,
        (b.top - r.top) * factorY,
        b.width * factorX,
        b.height * factorY,
      ];
    }
    layoutDirty = false;
  }
  function draw(now) {
    raf = 0;
    if (disposed || document.hidden || !gpu) return;
    const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    const started = performance.now();
    if (layoutDirty) layout();
    resolution = surfaceResolution({
      width: root.clientWidth,
      height: root.clientHeight,
      deviceDpr: window.devicePixelRatio,
      zoom: window.visualViewport?.scale,
      displayScale: limits.renderScale,
      maxDpr: limits.maxDpr,
      maxZoom: limits.maxZoom,
      maxPixels: limits.maxCanvasPixels,
      maxDimension: gpu.maxSurfaceDimension,
      availableBytes: limits.estimatedGpuBytes - bytes,
    });
    gpu.begin(resolution.width, resolution.height);
    let needsTime = false;
    for (const view of views) {
      if (
        !view.readyToDraw ||
        view.visibility !== "visible" ||
        !view.intersecting
      )
        continue;
      let viewNeedsTime = false;
      const inputs = normalizedInputs({ ...view.inputs, time: view.time });
      if (staticMotion()) {
        inputs["tilt.x"] = inputs["tilt.y"] = 0;
        inputs.angle = 0.5;
      }
      const viewport = view.rect.map(
          (v, i) => v * (i % 2 ? resolution.scaleY : resolution.scaleX),
        ),
        [x, y, vw, vh] = viewport,
        card = view.resolver.manifest.canvas;
      const flip = Math.abs(
        Math.cos(
          (view.inputs.flipProgress ?? (view.side === "back" ? 1 : 0)) *
            Math.PI,
        ),
      );
      const matrix = [
          (vw / card.width) * flip,
          0,
          0,
          vh / card.height,
          x + (vw * (1 - flip)) / 2,
          y,
        ],
        operations = { remaining: limits.maxGraphOperationsPerUpdate };
      function drawNodes(
        nodes,
        parent,
        inherited = { opacity: 1, brightness: 1, saturation: 1 },
      ) {
        for (const source of nodes) {
          if (view.hiddenNodes.has(source.id)) continue;
          const node = {
            ...source,
            material: source.material ? { ...source.material } : undefined,
          };
          if (node.animation)
            Object.assign(
              node,
              selectFrame(node.animation, inputs, operations),
            );
          for (const [path, expr] of Object.entries(node.bindings ?? {})) {
            const value = evaluate(expr, inputs, operations);
            if (path.startsWith("material."))
              node.material[path.slice(9)] = value;
            else node[path] = value;
          }
          node.x = (node.x ?? 0) + (node.parallax?.[0] ?? 0) * inputs["tilt.x"];
          node.y = (node.y ?? 0) + (node.parallax?.[1] ?? 0) * inputs["tilt.y"];
          node.opacity = (node.opacity ?? 1) * inherited.opacity;
          node.brightness = (node.brightness ?? 1) * inherited.brightness;
          node.saturation = (node.saturation ?? 1) * inherited.saturation;
          if (node.type === "group") {
            const a = ((node.rotation ?? 0) * Math.PI) / 180,
              c = Math.cos(a),
              s = Math.sin(a),
              sx = node.scaleX ?? 1,
              sy = node.scaleY ?? 1,
              px = node.pivotX ?? 0,
              py = node.pivotY ?? 0;
            drawNodes(
              node.children ?? [],
              compose(parent, [
                c * sx,
                s * sx,
                -s * sy,
                c * sy,
                node.x + px - c * sx * px + s * sy * py,
                node.y + py - s * sx * px - c * sy * py,
              ]),
              {
                opacity: node.opacity,
                brightness: node.brightness,
                saturation: node.saturation,
              },
            );
            continue;
          }
          if (node.type === "audio") continue;
          if (node.type === "adapter") {
            const a = view.adapterInstances.find((x) => x.id === node.id);
            if (a) {
              const result = a.instance.update({
                inputs,
                activeTimeSeconds: view.time,
                deltaSeconds: delta,
                quality: view.quality,
                staticMotion: staticMotion(),
              });
              a.instance.render();
              if (!a.texture) a.texture = gpu.texture(a.instance.canvas);
              else gpu.updateTexture(a.texture, a.instance.canvas);
              gpu.draw(
                node,
                {
                  texture: a.texture,
                  width: a.instance.canvas.width,
                  height: a.instance.canvas.height,
                },
                parent,
                viewport,
                view.assets.get(node.mask?.asset),
                view.assets.get(node.material?.flakeAsset),
                view.assets.get(node.material?.mask?.asset ?? node.material?.maskAsset),
              );
              if (result?.needsTime && !staticMotion()) {
                viewNeedsTime = true;
              }
            }
            continue;
          }
          let asset = view.assets.get(
            node.type === "text" ? `text:${node.id}` : node.asset,
          );
          if (node.type === "video") {
            const media = view.media.get(node.id);
            if (!media) continue;
            const allowed =
              !staticMotion() &&
              (node.video.mode === "autoplay-muted" || view.activated);
            if (
              allowed &&
              !media.failed &&
              !media.ended &&
              !media.active &&
              decoders < limits.activeVideoDecoders
            ) {
              media.active = true;
              decoders++;
              media.frameCallback = media.video.requestVideoFrameCallback?.(
                media.onFrame,
              );
              media.video.play().catch(() => {
                stopVideo(media);
                media.failed = true;
                emit(view, {
                  type: "fallback",
                  reason: "Tap to play video",
                  side: view.side,
                });
              });
            }
            if (!allowed) stopVideo(media);
            asset = view.assets.get(node.video.poster);
            if (media.video.readyState >= 2) {
              if (!media.texture) {
                const cost =
                  media.video.videoWidth * media.video.videoHeight * 4 * 4;
                ensure(
                  bytes + cost + canvas.width * canvas.height * 4 <=
                    limits.estimatedGpuBytes,
                  "BUDGET",
                  "Video buffer budget exceeded",
                );
                bytes += cost;
                media.cost = cost;
                media.texture = gpu.texture(media.video);
              } else if (
                media.dirty ||
                (!media.video.requestVideoFrameCallback &&
                  media.last !== media.video.currentTime)
              )
                gpu.updateTexture(media.texture, media.video);
              media.dirty = false;
              media.last = media.video.currentTime;
              asset = { ...media.source, texture: media.texture };
            }
            if (media.active && !media.video.requestVideoFrameCallback)
              needsTime = true;
          }
          if (asset)
            gpu.draw(
              node.type==="text"&&asset.layoutHeight?{...node,height:asset.layoutHeight}:node,
              asset,
              parent,
              viewport,
              view.assets.get(node.mask?.asset),
              view.assets.get(node.material?.flakeAsset),
              view.assets.get(node.material?.mask?.asset ?? node.material?.maskAsset),
            );
        }
      }
      try {
        gpu.background(
          view.scene.background,
          matrix,
          viewport,
          card.width,
          card.height,
        );
        drawNodes(view.scene.nodes, matrix);
      } catch (error) {
        view.readyToDraw = false;
        unload(view);
        view.poster.hidden = false;
        emit(view, {
          type: "fallback",
          reason: error.message,
          side: view.side,
        });
      }
      if (
        (view.usesTime || viewNeedsTime) &&
        view.readyToDraw &&
        !staticMotion()
      ) {
        view.time += delta;
        needsTime = true;
      }
    }
    frames++;
    const duration = performance.now() - started;
    if (duration > 25) slow++;
    else slow = Math.max(0, slow - 1);
    if (slow > 90 && now - lastWarning >= 10000) {
      lastWarning = now;
      slow = 0;
      onDiagnostic({
        type: "renderCost",
        reason: "Sustained CPU submission cost",
        durationMs: duration,
      });
    }
    if (needsTime) wake();
  }
  function viewportChanged() {
    layoutDirty = true;
    wake();
  }
  window.addEventListener("resize", viewportChanged, {
    signal: cleanup.signal,
  });
  window.visualViewport?.addEventListener("resize", viewportChanged, {
    signal: cleanup.signal,
  });
  let densityQuery;
  function densityChanged() {
    densityQuery?.removeEventListener("change", densityChanged);
    densityQuery = matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    densityQuery.addEventListener("change", densityChanged);
    viewportChanged();
  }
  densityChanged();
  cleanup.signal.addEventListener(
    "abort",
    () => densityQuery?.removeEventListener("change", densityChanged),
    { once: true },
  );
  const resize = new ResizeObserver(() => {
    layoutDirty = true;
    wake();
  });
  resize.observe(root);
  const intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const view = [...views].find((v) => v.element === entry.target);
      if (view) {
        view.intersecting = entry.isIntersecting;
        if (!entry.isIntersecting) {
          for (const media of view.media.values()) stopVideo(media);
          for (const audio of view.audio.values()) audio.pause();
        }
      }
    }
    wake();
  });
  document.addEventListener(
    "visibilitychange",
    () => {
      lastTime = 0;
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        for (const view of views) {
          for (const media of view.media.values()) stopVideo(media);
          for (const audio of view.audio.values()) audio.pause();
        }
      } else wake();
    },
    { signal: cleanup.signal },
  );
  window.addEventListener(
    "scroll",
    () => {
      layoutDirty = true;
      wake();
    },
    { signal: cleanup.signal, passive: true },
  );
  reduced.addEventListener("change", wake, { signal: cleanup.signal });
  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      if (disposed) return;
      gpu = createWebGLRenderer(canvas);
      for (const view of views) loadSide(view);
      wake();
    },
    { signal: cleanup.signal },
  );
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      for (const view of views) {
        view.readyToDraw = false;
        unload(view);
        view.poster.hidden = false;
        emit(view, {
          type: "fallback",
          reason: "Graphics context lost",
          side: view.side,
        });
      }
      cancelAnimationFrame(raf);
      raf = 0;
    },
    { signal: cleanup.signal },
  );
  return {
    mount(
      target,
      model,
      {
        resolver = model.resolver,
        quality = "standard",
        side = "front",
        inputMode = "host",
        onEvent,
      } = {},
    ) {
      ensure(
        !disposed && root.contains(target) && resolver,
        "MOUNT",
        "Mount requires a live stage descendant and resolver",
      );
      ensure(qualities.includes(quality), "QUALITY", "Unknown quality");
      const element = document.createElement("div");
      Object.assign(element.style, {
        position: "relative",
        width: "100%",
        height: "100%",
        aspectRatio: `${resolver.manifest.canvas.width}/${resolver.manifest.canvas.height}`,
      });
      element.tabIndex = 0;
      element.setAttribute("role", "img");
      element.setAttribute(
        "aria-label",
        model.title ?? resolver.manifest.title,
      );
      const poster = document.createElement("img");
      Object.assign(poster.style, {
        width: "100%",
        height: "100%",
        objectFit: "fill",
        position: "absolute",
        inset: "0",
      });
      element.append(poster);
      target.append(element);
      const view = {
        element,
        poster,
        resolver,
        quality,
        requestedQuality: quality,
        side,
        onEvent,
        inputs: { tilt: { x: 0, y: 0 } },
        visibility: "visible",
        intersecting: true,
        leases: new Set(),
        assets: new Map(),
        media: new Map(),
        audio: new Map(),
        textures: new Set(),
        adapterInstances: [],
        hiddenNodes: new Set(),
        time: 0,
        rect: [0, 0, 1, 1],
        generation: 0,
        disposed: false,
        activated: false,
        readyToDraw: false,
      };
      views.add(view);
      resize.observe(element);
      intersection.observe(element);
      layoutDirty = true;
      const events = new AbortController();
      const setInputs = (input) => {
        if (view.disposed) return;
        view.inputs = { ...view.inputs, ...input };
        let pending;
        const flip = view.inputs.flipProgress;
        if (flip !== undefined) {
          const wanted = flip >= 0.5 ? "back" : "front";
          if (wanted !== view.side) {
            view.side = wanted;
            pending = loadSide(view);
          }
        }
        wake();
        return pending;
      };
      if (inputMode !== "host") {
        const point = (e) => {
          const r = element.getBoundingClientRect();
          setInputs({
            tilt: {
              x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
              y: clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1),
            },
          });
        };
        element.addEventListener(
          "pointerdown",
          (e) => {
            view.activated = true;
            element.setPointerCapture(e.pointerId);
            point(e);
          },
          { signal: events.signal },
        );
        element.addEventListener(
          "pointermove",
          (e) => {
            if (
              e.pointerType === "mouse" ||
              element.hasPointerCapture(e.pointerId)
            )
              point(e);
          },
          { signal: events.signal },
        );
        element.addEventListener(
          "pointerleave",
          () => setInputs({ tilt: { x: 0, y: 0 } }),
          { signal: events.signal },
        );
      }
      element.addEventListener(
        "keydown",
        (e) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
            ].includes(e.key)
          ) {
            e.preventDefault();
            const tilt = { ...view.inputs.tilt };
            if (e.key === "Home") tilt.x = tilt.y = 0;
            else if (e.key === "ArrowLeft") tilt.x -= 0.15;
            else if (e.key === "ArrowRight") tilt.x += 0.15;
            else if (e.key === "ArrowUp") tilt.y -= 0.15;
            else tilt.y += 0.15;
            setInputs({ tilt });
          }
        },
        { signal: events.signal },
      );
      const handle = {
        element,
        ready: loadSide(view).then((result) => {
          if (!view.disposed) emit(view, { type: "ready", result });
          return result ?? { mode: "cancelled" };
        }),
        setInputs,
        setVisibility(state) {
          if (view.disposed) return;
          ensure(
            ["visible", "prewarm", "hidden"].includes(state),
            "VISIBILITY",
            "Invalid visibility",
          );
          view.visibility = state;
          if (state !== "visible") {
            for (const media of view.media.values()) stopVideo(media);
            for (const audio of view.audio.values()) audio.pause();
          }
          wake();
        },
        setAudio({ enabled = false, volume = 1 } = {}) {
          ensure(!view.disposed, "DISPOSED", "View disposed");
          for (const [id, audio] of view.audio) {
            audio.volume =
              clamp(volume) *
              (flatten(view.scene.nodes).find((n) => n.id === id)?.audio
                .volume ?? 1);
            if (enabled && view.visibility === "visible" && !document.hidden)
              audio.play().catch(() =>
                emit(view, {
                  type: "fallback",
                  reason: "Sound requires a direct user gesture",
                }),
              );
            else audio.pause();
          }
        },
        setQuality(value) {
          if (view.disposed) return;
          ensure(qualities.includes(value), "QUALITY", "Unknown quality");
          view.requestedQuality = value;
          if (view.quality !== value || !view.readyToDraw) {
            const from = view.quality;
            view.quality = value;
            const pending = loadSide(view);
            emit(view, {
              type: "qualityChanged",
              from,
              to: value,
              reason: "Host selected",
            });
            return pending;
          }
        },
        setSide(value) {
          ensure(["front", "back"].includes(value), "SIDE", "Unknown face");
          return setInputs({ flipProgress: value === "back" ? 1 : 0 });
        },
        setLayerVisible(id, visible) {
          if (view.disposed) return;
          visible ? view.hiddenNodes.delete(id) : view.hiddenNodes.add(id);
          wake();
        },
        updateScene(scene) {
          ensure(!view.disposed, "DISPOSED", "View disposed");
          validateScene(scene, view.resolver.manifest);
          const resourcesChanged =
            view.resourceSignature !== resourceSignature(scene, view.resolver.manifest);
          view.scene = scene;
          view.usesTime = JSON.stringify(scene).includes("time.active");
          const missing = flatten(scene.nodes).some((n) =>
            [
              n.type === "image" ? n.asset : null,
              n.mask?.asset,
              n.material?.maskAsset,
              n.material?.mask?.asset,
              n.material?.flakeAsset,
              ...(n.animation?.frames ?? []).map((f) => f.asset),
            ]
              .filter(Boolean)
              .some((id) => !view.assets.has(id)),
          );
          if (missing || resourcesChanged) return loadSide(view, scene);
          wake();
          return Promise.resolve({
            mode: "interactive",
            quality: view.quality,
          });
        },
        activate() {
          if (view.disposed) return;
          view.activated = true;
          for (const media of view.media.values()) {
            media.failed = false;
            media.ended = false;
          }
          wake();
        },
        async snapshot() {
          ensure(!view.disposed && !disposed, "DISPOSED", "View disposed");
          ensure(
            view.readyToDraw,
            "SNAPSHOT",
            "Interactive face is not ready for capture",
          );
          cancelAnimationFrame(raf);
          raf = 0;
          draw(performance.now());
          const r = view.rect,
            scaleX = canvas.width / root.clientWidth,
            scaleY = canvas.height / root.clientHeight,
            out = document.createElement("canvas");
          out.width = Math.max(1, r[2] * scaleX);
          out.height = Math.max(1, r[3] * scaleY);
          out
            .getContext("2d")
            .drawImage(
              canvas,
              r[0] * scaleX,
              r[1] * scaleY,
              r[2] * scaleX,
              r[3] * scaleY,
              0,
              0,
              out.width,
              out.height,
            );
          return new Promise((resolve, reject) =>
            out.toBlob((b) => {
              out.width = out.height = 0;
              b ? resolve(b) : reject(new Error("Snapshot failed"));
            }, "image/png"),
          );
        },
        dispose() {
          if (view.disposed) return;
          view.disposed = true;
          view.generation++;
          events.abort();
          unload(view);
          views.delete(view);
          resize.unobserve(element);
          intersection.unobserve(element);
          element.remove();
          emit(view, { type: "disposed" });
          wake();
        },
      };
      view.handle = handle;
      return handle;
    },
    async setBudget(next) {
      ensure(!disposed, "DISPOSED", "Stage disposed");
      validateBudget(next);
      Object.assign(limits, next);
      const live = [...views];
      for (const view of live) {
        view.readyToDraw = false;
        unload(view);
        view.poster.hidden = false;
      }
      canvas.width = canvas.height = 1;
      for (const view of live) {
        view.quality = view.requestedQuality;
        await loadSide(view);
      }
      wake();
    },
    invalidateLayout() {
      layoutDirty = true;
      wake();
    },
    diagnostics() {
      return {
        resolution: resolution ? { ...resolution } : null,
        textureBytes: bytes,
        limits: { ...limits },
        views: views.size,
        pendingJobs: [...cache.values()].filter((e) => !e.texture).length,
        activeViews: [...views].filter(
          (v) => v.readyToDraw && v.visibility === "visible",
        ).length,
        scheduledFrames: raf ? 1 : 0,
        frames,
        estimatedGpuBytes: bytes + canvas.width * canvas.height * 4,
        assetReferences: [...cache.values()].reduce(
          (sum, e) => sum + e.refs,
          0,
        ),
        requestedVideoDecoders: decoders,
        ...gpu?.diagnostics(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      for (const view of [...views]) view.handle.dispose();
      cleanup.abort();
      resize.disconnect();
      intersection.disconnect();
      gpu?.dispose();
      canvas.remove();
      canvas.width = canvas.height = 0;
      root.style.position = priorPosition;
    },
  };
}
