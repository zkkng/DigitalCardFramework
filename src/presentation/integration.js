import { createAlbumMotion } from "./album-motion.js";
import { ensure, clamp } from "./data.js";
import { directoryResolver } from "./resolver.js";

export function validatePresentationReference(ref) {
  ensure(
    ref &&
      ref.contract === "digital-card@0.1" &&
      /^sha256:[0-9a-f]{64}$/.test(ref.digest),
    "REFERENCE",
    "Invalid pinned presentation",
  );
  ensure(
    typeof ref.baseURL === "string" && ref.baseURL.length <= 2048,
    "REFERENCE",
    "Missing presentation location",
  );
  const url = new URL(ref.baseURL, "https://local.invalid/");
  ensure(
    ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "REFERENCE",
    "Unsafe presentation location",
  );
  ensure(
    Object.keys(ref).every((k) =>
      ["contract", "digest", "baseURL"].includes(k),
    ),
    "REFERENCE",
    "Unknown presentation reference field",
  );
  return ref;
}

/** Public binding filter. Never pass the owned-copy record or secret attributes to a renderer. */
export function publicInputs(manifest, values = {}) {
  const out = {};
  for (const [key, rule] of Object.entries(manifest.inputs ?? {})) {
    let value = values[key];
    if (
      typeof value !== rule.type ||
      (rule.type === "number" && !Number.isFinite(value))
    )
      value = rule.default;
    out[key] =
      rule.type === "number"
        ? clamp(value, rule.min ?? -1e6, rule.max ?? 1e6)
        : value;
  }
  return out;
}

/** Mount an inspector/pack reveal using a pinned definition or issued-copy snapshot. */
export async function mountPresentation({
  stage,
  target,
  definition,
  resolve = directoryResolver,
  quality = "standard",
  hostInputs = {},
  onEvent,
  inputMode = "drag",
  signal,
}) {
  const ref = validatePresentationReference(definition.presentation);
  signal?.throwIfAborted();
  const resolver = await resolve(ref.baseURL, { digest: ref.digest, signal });
  try {
    signal?.throwIfAborted();
    const view = stage.mount(
      target,
      { title: definition.title ?? definition.name, resolver },
      { quality, inputMode, onEvent },
    );
    view.setInputs({ host: publicInputs(resolver.manifest, hostInputs) });
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      view.dispose();
      resolver.dispose();
    };
    signal?.addEventListener("abort", dispose, { once: true });
    return {
      ...view,
      dispose() {
        signal?.removeEventListener("abort", dispose);
        dispose();
      },
    };
  } catch (error) {
    resolver.dispose();
    throw error;
  }
}

/** Assembly is display layout only; the members retain independent ownership and hit targets. */
export async function mountAssembly({
  stage,
  root,
  descriptor,
  resolve,
  interaction = {},
  missing = (member) => member.title ?? "Card unavailable",
  signal,
}) {
  ensure(
    descriptor.version === 1 &&
      Array.isArray(descriptor.members) &&
      descriptor.members.length <= 16,
    "ASSEMBLY",
    "Invalid assembly",
  );
  createAlbumMotion({
    members: descriptor.members.map((m) => ({
      ...m,
      motion: { ...(m.tilt ? { scale: m.tilt } : {}), ...m.motion },
    })),
    defaults: interaction.defaults,
  }).dispose();
  const views = [],
    slots = [],
    ids = new Set();
  try {
    for (const member of descriptor.members) {
      ensure(
        typeof member.id === "string" && !ids.has(member.id),
        "ASSEMBLY",
        "Duplicate member",
      );
      ids.add(member.id);
      const [x, y, width, height] = member.bounds;
      ensure(
        [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0,
        "ASSEMBLY",
        "Invalid member bounds",
      );
      const slot = document.createElement("div");
      Object.assign(slot.style, {
        position: "absolute",
        left: x + "%",
        top: y + "%",
        width: width + "%",
        height: height + "%",
      });
      slot.dataset.member = member.id;
      root.append(slot);
      slots.push(slot);
      if (!member.presentation) {
        slot.textContent = missing(member);
        continue;
      }
      const view = await mountPresentation({
        stage,
        target: slot,
        definition: member,
        inputMode: "host",
        resolve,
        signal,
      });
      views.push({ view, member });
    }
  } catch (error) {
    for (const { view } of views) view.dispose();
    slots.forEach((s) => s.remove());
    throw error;
  }
  const events = new AbortController();
  const controller = createAlbumMotion({
    members: views.map(({ member }) => ({
      ...member,
      motion: {
        ...(member.tilt ? { scale: member.tilt } : {}),
        ...member.motion,
      },
    })),
    defaults: interaction.defaults,
    onChange(id, value) {
      const entry = views.find((v) => v.member.id === id);
      entry.view.setInputs(value);
      const slot = slots.find((s) => s.dataset.member === id);
      if (
        interaction.rotate === true &&
        !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      )
        slot.style.transform = `perspective(1000px) rotateX(${value.rotation.x}deg) rotateY(${value.rotation.y}deg)`;
      interaction.onChange?.(id, value);
    },
  });
  for (const slot of slots) {
    if (
      !views.some((v) => v.member.id === slot.dataset.member) ||
      interaction.inputMode === "host"
    )
      continue;
    slot.tabIndex = 0;
    slot.setAttribute(
      "aria-label",
      "Card; use arrow keys to turn, Home to reset",
    );
    const set = (tilt) => controller.setInputs(slot.dataset.member, { tilt });
    const move = (e) => {
      const r = slot.getBoundingClientRect();
      if (r.width && r.height)
        set({
          x: ((e.clientX - r.left) / r.width) * 2 - 1,
          y: ((e.clientY - r.top) / r.height) * 2 - 1,
        });
    };
    slot.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType !== "touch" || e.buttons) move(e);
      },
      { signal: events.signal },
    );
    slot.addEventListener("pointerdown", move, { signal: events.signal });
    for (const event of ["pointerleave", "pointercancel", "blur"])
      slot.addEventListener(event, () => set({ x: 0, y: 0 }), {
        signal: events.signal,
      });
    slot.addEventListener(
      "keydown",
      (e) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(
            e.key,
          )
        )
          return;
        e.preventDefault();
        const tilt = controller.snapshot()[slot.dataset.member].tilt;
        if (e.key === "Home") tilt.x = tilt.y = 0;
        else
          tilt[e.key === "ArrowLeft" || e.key === "ArrowRight" ? "x" : "y"] += [
            "ArrowLeft",
            "ArrowUp",
          ].includes(e.key)
            ? -0.15
            : 0.15;
        set(tilt);
      },
      { signal: events.signal },
    );
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    events.abort();
    controller.dispose();
    views.forEach(({ view }) => view.dispose());
    slots.forEach((s) => s.remove());
    signal?.removeEventListener("abort", dispose);
  };
  signal?.addEventListener("abort", dispose, { once: true });
  if (signal?.aborted) dispose();
  return {
    views: views.map((x) => x.view),
    setInputs(input) {
      controller.setAll(input);
    },
    setMemberInputs(id, input) {
      controller.setInputs(id, input);
    },
    snapshot: controller.snapshot,
    dispose,
  };
}

/** Live public values have an explicit freshness state; offline snapshots are reproducible. */
export function connectedInputs(
  manifest,
  { maxAgeMs = 60000, clock = Date.now } = {},
) {
  let last = null;
  return {
    update(values, { at = clock() } = {}) {
      ensure(
        Number.isFinite(at) && at <= clock(),
        "FRESHNESS",
        "Invalid event time",
      );
      last = { at, values: publicInputs(manifest, values) };
    },
    read() {
      const fresh = last && clock() - last.at <= maxAgeMs;
      return {
        state: fresh ? "fresh" : last ? "stale" : "offline",
        at: last?.at ?? null,
        values: fresh ? { ...last.values } : publicInputs(manifest),
      };
    },
    snapshot() {
      return structuredClone(
        last ?? { at: null, values: publicInputs(manifest) },
      );
    },
  };
}
