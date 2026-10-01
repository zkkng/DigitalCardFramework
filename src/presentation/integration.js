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
  quality = "lite",
  hostInputs = {},
  onEvent,
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
      { quality, inputMode: "drag", onEvent },
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
  return {
    views: views.map((x) => x.view),
    setInputs(input) {
      for (const { view, member } of views) {
        const map = member.tilt ?? [1, 1];
        view.setInputs({
          ...input,
          tilt: {
            x: (input.tilt?.x ?? 0) * map[0],
            y: (input.tilt?.y ?? 0) * map[1],
          },
        });
      }
    },
    dispose() {
      views.forEach(({ view }) => view.dispose());
      slots.forEach((s) => s.remove());
    },
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
