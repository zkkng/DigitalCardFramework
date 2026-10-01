/** Optional bundle: import only when the host enables these pinned adapters. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RuntimeLoader } from "@rive-app/canvas";
import { DotLottie } from "@lottiefiles/dotlottie-web";
import { ensure, clamp } from "./data.js";
import { inspectGLB, inspectDotLottie } from "./advanced-media.js";
import { readZip } from "./package.js";

function surface(context) {
  const canvas = document.createElement("canvas");
  canvas.width = context.width;
  canvas.height = context.height;
  return canvas;
}
async function source(context, data) {
  const resource = await context.asset(data.asset);
  const response = await fetch(resource.url, { signal: context.signal });
  const bytes = new Uint8Array(await response.arrayBuffer());
  context.signal.throwIfAborted();
  return bytes;
}
const moduleInfo = (id, capability) => ({
  id,
  version: "0.1.0",
  apiVersion: "0.1.0",
  trust: "host-installed",
  capabilities: [capability],
  provides: [id],
  fallback: "poster",
  estimate: ({ width = 512, height = 768 } = {}) => width * height * 12,
});

export function gltfAdapter() {
  return {
    ...moduleInfo("dc.gltf", "dc.gltf@0.1"),
    async create(context, data) {
      const bytes = await source(context, data);
      inspectGLB(bytes);
      const canvas = surface(context),
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
          preserveDrawingBuffer: true,
        });
      renderer.setSize(canvas.width, canvas.height, false);
      renderer.setPixelRatio(1);
      let gltf;
      try {
        gltf = await new GLTFLoader().parseAsync(bytes.buffer, "");
        context.signal.throwIfAborted();
      } catch (error) {
        renderer.dispose();
        renderer.forceContextLoss();
        throw error;
      }
      const scene = new THREE.Scene();
      scene.add(gltf.scene);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x526077, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(2, 3, 4);
      scene.add(light);
      const box = new THREE.Box3().setFromObject(gltf.scene),
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3()),
        radius = Math.max(size.x, size.y, size.z, 1);
      gltf.scene.position.sub(center);
      const camera = new THREE.PerspectiveCamera(
        40,
        canvas.width / canvas.height,
        0.01,
        1000,
      );
      camera.position.set(0, 0, radius * 2.5);
      camera.lookAt(0, 0, 0);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
      const duration = Math.max(...gltf.animations.map((a) => a.duration), 1);
      return {
        canvas,
        update({ inputs, activeTimeSeconds, staticMotion }) {
          const angle = clamp(inputs.angle ?? 0.5);
          gltf.scene.rotation.y = (angle - 0.5) * (data.turnRadians ?? 0.8);
          gltf.scene.rotation.x = (inputs["tilt.y"] ?? 0) * 0.15;
          mixer.setTime(
            data.clock && !staticMotion
              ? activeTimeSeconds
              : angle * (data.duration ?? duration),
          );
          return { needsTime: !!data.clock && !staticMotion };
        },
        render() {
          renderer.render(scene, camera);
        },
        dispose() {
          mixer.stopAllAction();
          mixer.uncacheRoot(gltf.scene);
          const textures = new Set();
          gltf.scene.traverse((obj) => {
            obj.geometry?.dispose();
            for (const m of Array.isArray(obj.material)
              ? obj.material
              : obj.material
                ? [obj.material]
                : []) {
              for (const v of Object.values(m))
                if (v?.isTexture) textures.add(v);
              m.dispose();
            }
          });
          for (const t of textures) {
            t.source?.data?.close?.();
            t.dispose();
          }
          renderer.dispose();
          renderer.forceContextLoss();
          canvas.width = canvas.height = 0;
        },
      };
    },
  };
}

export function riveAdapter({ wasmURL, approvedDigests = [] } = {}) {
  ensure(wasmURL, "RIVE", "Self-hosted WASM URL required");
  RuntimeLoader.setWasmUrl(wasmURL);
  RuntimeLoader.setWasmFallbackUrl(null);
  return {
    ...moduleInfo("dc.rive", "dc.rive@0.1"),
    async create(context, data) {
      // Rive supports programmable features; hosts approve exact packages for this adapter.
      ensure(
        approvedDigests.includes(context.digest),
        "RIVE_REVIEW",
        "This Rive package has not been approved by the host",
      );
      const bytes = await source(context, data),
        runtime = await RuntimeLoader.awaitInstance();
      context.signal.throwIfAborted();
      const file = await runtime.load(bytes, undefined, false);
      ensure(file, "RIVE", "Unable to load Rive file");
      const artboard = data.artboard
        ? file.artboardByName(data.artboard)
        : file.defaultArtboard();
      ensure(artboard, "RIVE", "Missing artboard");
      artboard.volume = 0;
      const timeline = data.animation
          ? artboard.animationByName(data.animation)
          : artboard.animationByIndex(0),
        animation = timeline
          ? new runtime.LinearAnimationInstance(timeline, artboard)
          : null,
        canvas = surface(context),
        renderer = runtime.makeRenderer(canvas);
      return {
        canvas,
        update({ inputs, activeTimeSeconds, staticMotion }) {
          if (animation) {
            animation.time =
              data.clock && !staticMotion
                ? activeTimeSeconds
                : clamp(inputs.angle ?? 0.5) * (data.duration ?? 1);
            animation.apply(1);
          }
          artboard.advance(0);
          return { needsTime: !!data.clock && !staticMotion };
        },
        render() {
          renderer.clear();
          renderer.save();
          renderer.align(
            runtime.Fit.contain,
            runtime.Alignment.center,
            { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height },
            artboard.bounds,
          );
          artboard.draw(renderer);
          renderer.restore();
          runtime.resolveAnimationFrame();
        },
        dispose() {
          animation?.delete();
          artboard.delete();
          file.delete();
          renderer.delete();
          canvas.width = canvas.height = 0;
        },
      };
    },
  };
}

export function dotLottieAdapter({ wasmURL } = {}) {
  ensure(wasmURL, "LOTTIE", "Self-hosted WASM URL required");
  DotLottie.setWasmUrl(wasmURL);
  return {
    ...moduleInfo("dc.dotlottie", "dc.dotlottie@0.1"),
    async create(context, data) {
      const bytes = await source(context, data);
      await inspectDotLottie(bytes, readZip);
      const canvas = surface(context),
        player = new DotLottie({
          canvas,
          data: bytes.buffer,
          autoplay: false,
          loop: false,
          animationId: data.animation,
          renderConfig: {
            autoResize: false,
            devicePixelRatio: 1,
            freezeOnOffscreen: false,
          },
        });
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
              () => reject(new Error("Animation load timeout")),
              10000,
            ),
            abort = () => reject(new DOMException("Disposed", "AbortError"));
          context.signal.addEventListener("abort", abort, { once: true });
          player.addEventListener("load", () => {
            clearTimeout(timeout);
            context.signal.removeEventListener("abort", abort);
            resolve();
          });
          player.addEventListener("loadError", () => {
            clearTimeout(timeout);
            context.signal.removeEventListener("abort", abort);
            reject(new Error("Unable to load animation"));
          });
        });
        context.signal.throwIfAborted();
      } catch (error) {
        player.destroy();
        throw error;
      }
      return {
        canvas,
        update({ inputs, activeTimeSeconds, staticMotion }) {
          const progress =
            data.clock && !staticMotion
              ? (activeTimeSeconds / (data.duration ?? 1)) % 1
              : clamp(inputs.angle ?? 0.5);
          player.setFrame(progress * Math.max(0, player.totalFrames - 1));
          return { needsTime: !!data.clock && !staticMotion };
        },
        render() {},
        dispose() {
          player.destroy();
          canvas.width = canvas.height = 0;
        },
      };
    },
  };
}
