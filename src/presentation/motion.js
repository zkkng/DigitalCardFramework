import { ensure, clamp } from "./data.js";
const arities = {
  add: [2, 8],
  mul: [2, 8],
  sub: [2, 2],
  div: [2, 2],
  sin: [1, 1],
  cos: [1, 1],
  abs: [1, 1],
  min: [2, 8],
  max: [2, 8],
  pow: [2, 2],
  exp: [1, 1],
  clamp: [3, 3],
  smooth: [3, 3],
  mix: [3, 3],
  mod: [2, 2],
  input: [1, 1],
  curve: [2, 2],
};
const inputs = new Set([
  "tilt.x",
  "tilt.y",
  "angle",
  "time.active",
  "reveal.progress",
  "flip.progress",
  "pointer.x",
  "pointer.y",
  "pressed",
  "focused",
]);
export function validateExpression(
  expr,
  { maxNodes = 256, maxDepth = 16, hostInputs = [] } = {},
) {
  let count = 0;
  const permitted = new Set([...inputs, ...hostInputs]);
  function visit(e, depth) {
    ensure(
      ++count <= maxNodes && depth <= maxDepth,
      "GRAPH_LIMIT",
      "Motion graph too complex",
    );
    if (typeof e === "number") {
      ensure(Number.isFinite(e), "GRAPH", "Nonfinite constant");
      return;
    }
    ensure(
      Array.isArray(e) && arities[e[0]],
      "GRAPH",
      "Unknown motion operation",
    );
    const [op, ...args] = e,
      [lo, hi] = arities[op];
    ensure(
      args.length >= lo && args.length <= hi,
      "GRAPH",
      "Wrong argument count for " + op,
    );
    if (op === "input") {
      ensure(
        permitted.has(args[0]),
        "INPUT",
        "Undeclared motion input " + args[0],
      );
      return;
    }
    if (op === "curve") {
      visit(args[0], depth + 1);
      ensure(
        Array.isArray(args[1]) && args[1].length >= 2 && args[1].length <= 64,
        "GRAPH",
        "Invalid curve",
      );
      let last = -Infinity;
      for (const point of args[1]) {
        ensure(
          Array.isArray(point) &&
            point.length === 2 &&
            point.every(Number.isFinite) &&
            point[0] > last,
          "GRAPH",
          "Curve keys must increase",
        );
        last = point[0];
      }
      return;
    }
    args.forEach((x) => visit(x, depth + 1));
  }
  visit(expr, 0);
  return count;
}
export function evaluate(expr, inputs = {}, budget = { remaining: 4096 }) {
  ensure(
    --budget.remaining >= 0,
    "GRAPH_LIMIT",
    "Motion operation budget exceeded",
  );
  if (typeof expr === "number") return expr;
  const [op, ...args] = expr;
  if (op === "input") return Number(inputs[args[0]] ?? 0);
  if (op === "curve") {
    const t = evaluate(args[0], inputs, budget),
      keys = args[1];
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++)
      if (t <= keys[i][0]) {
        const [a, av] = keys[i - 1],
          [b, bv] = keys[i];
        return av + ((bv - av) * (t - a)) / (b - a);
      }
    return keys.at(-1)[1];
  }
  const v = args.map((x) => evaluate(x, inputs, budget));
  let result;
  switch (op) {
    case "add":
      result = v.reduce((a, b) => a + b, 0);
      break;
    case "mul":
      result = v.reduce((a, b) => a * b, 1);
      break;
    case "sub":
      result = v[0] - v[1];
      break;
    case "div":
      result = v[1] === 0 ? 0 : v[0] / v[1];
      break;
    case "sin":
      result = Math.sin(v[0]);
      break;
    case "cos":
      result = Math.cos(v[0]);
      break;
    case "abs":
      result = Math.abs(v[0]);
      break;
    case "min":
      result = Math.min(...v);
      break;
    case "max":
      result = Math.max(...v);
      break;
    case "pow":
      result = Math.pow(v[0], v[1]);
      break;
    case "exp":
      result = Math.exp(v[0]);
      break;
    case "clamp":
      result = clamp(v[0], v[1], v[2]);
      break;
    case "mod":
      result = v[1] === 0 ? 0 : ((v[0] % v[1]) + v[1]) % v[1];
      break;
    case "mix":
      result = v[0] + (v[1] - v[0]) * v[2];
      break;
    case "smooth": {
      const t =
        v[0] === v[1]
          ? v[2] >= v[1]
            ? 1
            : 0
          : clamp((v[2] - v[0]) / (v[1] - v[0]));
      result = t * t * (3 - 2 * t);
      break;
    }
    default:
      throw new Error("Unvalidated motion operation " + op);
  }
  return Number.isFinite(result) ? result : 0;
}
export function selectFrame(animation, inputs, budget) {
  const total = animation.frames.reduce((s, f) => s + f.duration, 0);
  let progress = evaluate(animation.progress, inputs, budget);
  progress = animation.loop ? ((progress % 1) + 1) % 1 : clamp(progress);
  let cursor = progress * total;
  for (const frame of animation.frames) {
    if (cursor < frame.duration) return frame;
    cursor -= frame.duration;
  }
  return animation.frames.at(-1);
}
export function normalizedInputs(input = {}) {
  const x = clamp(Number(input.tilt?.x) || 0, -1, 1),
    y = clamp(Number(input.tilt?.y) || 0, -1, 1);
  const host = Object.fromEntries(
    Object.entries(input.host ?? {}).filter(
      ([key, value]) =>
        /^host\.[a-z][\w.-]+$/.test(key) &&
        ((typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "boolean"),
    ),
  );
  return {
    "tilt.x": x,
    "tilt.y": y,
    angle: clamp(
      Number.isFinite(input.angle) ? input.angle : (x + y * 0.24 + 1) / 2,
    ),
    "time.active": Math.max(0, Number(input.time) || 0),
    "reveal.progress": clamp(input.revealProgress ?? 1),
    "flip.progress": clamp(input.flipProgress ?? 0),
    "pointer.x": clamp(input.pointer?.x ?? 0.5),
    "pointer.y": clamp(input.pointer?.y ?? 0.5),
    pressed: input.pressed ? 1 : 0,
    focused: input.focused ? 1 : 0,
    ...host,
  };
}
