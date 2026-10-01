import { ensure, clamp } from "./data.js";

/** Headless, deterministic group interaction. Inputs normalized [-1,1]; rotation in degrees. */
export function createAlbumMotion({
  members,
  defaults = {},
  onChange = () => {},
}) {
  ensure(
    Array.isArray(members) && members.length <= 1000,
    "ALBUM_MOTION",
    "Invalid members",
  );
  const config = new Map(),
    state = new Map();
  let disposed = false;
  for (const member of members) {
    ensure(
      typeof member.id === "string" && !config.has(member.id),
      "ALBUM_MOTION",
      "Duplicate or missing member ID",
    );
    const c = {
      enabled: true,
      limits: { x: [-1, 1], y: [-1, 1] },
      scale: [1, 1],
      maxRotation: [8, 12],
      syncGroup: null,
      ...defaults,
      ...member.motion,
    };
    ensure(
      typeof c.enabled === "boolean" &&
        (c.syncGroup === null || typeof c.syncGroup === "string"),
      "ALBUM_MOTION",
      "Invalid motion configuration",
    );
    for (const axis of ["x", "y"])
      ensure(
        Array.isArray(c.limits?.[axis]) &&
          c.limits[axis].length === 2 &&
          c.limits[axis].every(Number.isFinite) &&
          c.limits[axis][0] >= -1 &&
          c.limits[axis][1] <= 1 &&
          c.limits[axis][0] <= 0 &&
          c.limits[axis][1] >= 0,
        "ALBUM_MOTION",
        "Limits must include neutral and lie within [-1,1]",
      );
    for (const field of ["scale", "maxRotation"])
      ensure(
        Array.isArray(c[field]) &&
          c[field].length === 2 &&
          c[field].every(
            (v) =>
              Number.isFinite(v) &&
              Math.abs(v) <= (field === "scale" ? 10 : 45),
          ),
        "ALBUM_MOTION",
        "Invalid " + field,
      );
    config.set(member.id, structuredClone(c));
    state.set(member.id, { tilt: { x: 0, y: 0 }, rotation: { x: 0, y: 0 } });
  }
  function apply(id, input) {
    const c = config.get(id),
      tilt = {};
    for (const [i, axis] of ["x", "y"].entries()) {
      const v = input.tilt?.[axis] ?? 0;
      ensure(Number.isFinite(v), "ALBUM_MOTION", "Input must be finite");
      tilt[axis] = c.enabled
        ? clamp(clamp(v, -1, 1) * c.scale[i], ...c.limits[axis])
        : 0;
    }
    const value = {
      ...input,
      tilt,
      rotation: { x: -tilt.y * c.maxRotation[0], y: tilt.x * c.maxRotation[1] },
    };
    state.set(id, structuredClone(value));
    onChange(id, structuredClone(value));
  }
  return {
    setInputs(id, input) {
      if (disposed) return;
      ensure(config.has(id), "ALBUM_MOTION", "Unknown member");
      ensure(
        ["x", "y"].every((a) => Number.isFinite(input.tilt?.[a] ?? 0)),
        "ALBUM_MOTION",
        "Input must be finite",
      );
      const group = config.get(id).syncGroup;
      for (const [target, c] of config)
        if (target === id || (group !== null && group === c.syncGroup))
          apply(target, input);
    },
    setAll(input) {
      if (!disposed) for (const id of config.keys()) apply(id, input);
    },
    snapshot() {
      return Object.fromEntries(
        [...state].map(([id, value]) => [id, structuredClone(value)]),
      );
    },
    dispose() {
      disposed = true;
      config.clear();
      state.clear();
    },
  };
}
