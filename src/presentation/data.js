/** Portable data primitives shared by the browser player and server importer. */
export class PresentationError extends Error {
  constructor(code, message, path = "") {
    super(message);
    this.name = "PresentationError";
    this.code = code;
    this.path = path;
  }
}
export function ensure(ok, code, message, path = "") {
  if (!ok) throw new PresentationError(code, message, path);
}
export function safePath(path) {
  ensure(
    typeof path === "string" &&
      path.length <= 240 &&
      /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(
        path,
      ),
    "PATH",
    "Invalid package path",
    String(path),
  );
  ensure(
    !path
      .split("/")
      .some(
        (p) =>
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) ||
          p.endsWith("."),
      ),
    "PATH",
    "Reserved package path",
    path,
  );
  return path;
}
function validUnicode(text) {
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const m = text.charCodeAt(++i);
      ensure(m >= 0xdc00 && m <= 0xdfff, "JSON", "Unpaired Unicode surrogate");
    } else
      ensure(n < 0xdc00 || n > 0xdfff, "JSON", "Unpaired Unicode surrogate");
  }
}
/** Duplicate-key-aware JSON parser, bounded before constructing large graphs. */
export function parseJSON(
  text,
  { maxBytes = 8 * 1024 * 1024, maxDepth = 48, maxNodes = 100000 } = {},
) {
  ensure(
    typeof text === "string" &&
      new TextEncoder().encode(text).length <= maxBytes,
    "LIMIT",
    "JSON exceeds byte limit",
  );
  let p = 0,
    nodes = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(text[p] ?? "!")) p++;
  };
  function str() {
    const begin = p++;
    let escaped = false;
    while (p < text.length) {
      const c = text[p++];
      if (c === '"' && !escaped) {
        let out;
        try {
          out = JSON.parse(text.slice(begin, p));
        } catch {
          throw new PresentationError("JSON", "Invalid JSON string");
        }
        validUnicode(out);
        return out;
      }
      if (c === "\\" && !escaped) escaped = true;
      else escaped = false;
    }
    throw new PresentationError("JSON", "Unterminated JSON string");
  }
  function value(depth) {
    ensure(
      depth <= maxDepth && ++nodes <= maxNodes,
      "LIMIT",
      "JSON complexity limit",
    );
    ws();
    const c = text[p];
    if (c === '"') return str();
    if (c === "{" || c === "[") {
      p++;
      const object = c === "{",
        out = object ? Object.create(null) : [],
        seen = new Set();
      ws();
      if (text[p] === (object ? "}" : "]")) {
        p++;
        return out;
      }
      for (;;) {
        ws();
        if (object) {
          ensure(text[p] === '"', "JSON", "Expected object key");
          const key = str();
          ensure(!seen.has(key), "JSON", "Duplicate object key: " + key);
          seen.add(key);
          ws();
          ensure(text[p++] === ":", "JSON", "Expected colon");
          out[key] = value(depth + 1);
        } else out.push(value(depth + 1));
        ws();
        const next = text[p++];
        if (next === (object ? "}" : "]")) return out;
        ensure(next === ",", "JSON", "Expected comma");
      }
    }
    for (const [word, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ])
      if (text.startsWith(word, p)) {
        p += word.length;
        return result;
      }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(p),
    );
    ensure(match, "JSON", "Invalid value at " + p);
    p += match[0].length;
    const number = Number(match[0]);
    ensure(Number.isFinite(number), "JSON", "Nonfinite number");
    return number;
  }
  const result = value(0);
  ws();
  ensure(p === text.length, "JSON", "Trailing JSON data");
  return result;
}
/** RFC 8785 serialization for the validated JSON value domain (no exotic objects). */
export function canonical(value) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    ensure(Number.isFinite(value), "JSON", "Nonfinite value");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    validUnicode(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  ensure(
    value &&
      typeof value === "object" &&
      [null, Object.prototype].includes(Object.getPrototypeOf(value)),
    "JSON",
    "Expected plain JSON data",
  );
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => {
        validUnicode(key);
        return JSON.stringify(key) + ":" + canonical(value[key]);
      })
      .join(",") +
    "}"
  );
}
export const utf8 = (value) => new TextEncoder().encode(value);
export const text = (bytes) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
