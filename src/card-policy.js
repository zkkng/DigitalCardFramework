import { canonical, ensure } from "./presentation/data.js";

export const POLICY_VERSION = 1;
const own = (o, k) => Object.hasOwn(o, k);
const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);
const identifier = /^[a-zA-Z][a-zA-Z0-9._-]{0,99}$/;
export const reference = (v) =>
  typeof v === "string" &&
  /^[a-zA-Z][a-zA-Z0-9._-]{0,99}@[1-9][0-9]{0,8}$/.test(v);
export const flattenNodes = (nodes) =>
  nodes.flatMap((n) => [n, ...flattenNodes(n.children ?? [])]);
export function exact(value, keys, name = "object") {
  ensure(plain(value), "POLICY_SCHEMA", "Expected " + name);
  for (const key of Object.keys(value))
    ensure(
      keys.includes(key),
      "POLICY_SCHEMA",
      "Unknown " + name + " property: " + key,
    );
}
function bounded(v, min, max, name) {
  ensure(
    Number.isFinite(v) && v >= min && v <= max,
    "POLICY_SCHEMA",
    "Invalid " + name,
  );
}
function string(v, max, name) {
  ensure(
    typeof v === "string" && v.length > 0 && v.length <= max,
    "POLICY_SCHEMA",
    "Invalid " + name,
  );
}
export function validateExpression(
  expr,
  { depth = 0, count = { value: 0 } } = {},
) {
  ensure(
    depth <= 12 && ++count.value <= 128,
    "EXPRESSION_LIMIT",
    "Expression is too complex",
  );
  if (typeof expr === "number") {
    bounded(expr, -1e12, 1e12, "expression number");
    return;
  }
  if (typeof expr === "string" || typeof expr === "boolean" || expr === null)
    return;
  ensure(
    Array.isArray(expr) && expr.length >= 2 && expr.length <= 9,
    "EXPRESSION",
    "Invalid expression",
  );
  const arities = {
    field: [1, 1],
    exists: [1, 1],
    not: [1, 1],
    eq: [2, 2],
    gt: [2, 2],
    gte: [2, 2],
    lt: [2, 2],
    lte: [2, 2],
    and: [2, 8],
    or: [2, 8],
    add: [2, 8],
    sub: [2, 2],
    mul: [2, 8],
    div: [2, 2],
    min: [2, 8],
    max: [2, 8],
  };
  const limits = arities[expr[0]];
  ensure(
    limits && expr.length - 1 >= limits[0] && expr.length - 1 <= limits[1],
    "EXPRESSION",
    "Unknown expression operation or arity",
  );
  if (["field", "exists"].includes(expr[0])) {
    ensure(
      typeof expr[1] === "string" && identifier.test(expr[1]),
      "EXPRESSION",
      "Invalid field reference",
    );
    return;
  }
  for (const arg of expr.slice(1))
    validateExpression(arg, { depth: depth + 1, count });
}
export function expression(expr, values) {
  validateExpression(expr);
  const run = (e) => {
    if (!Array.isArray(e)) return e;
    const [op, ...args] = e;
    if (op === "field") {
      ensure(
        own(values, args[0]),
        "STAT_DEPENDENCY",
        "Missing calculation input",
      );
      return values[args[0]];
    }
    if (op === "exists") return own(values, args[0]);
    if (op === "and") return args.every((a) => run(a) === true);
    if (op === "or") return args.some((a) => run(a) === true);
    if (op === "not") return !run(args[0]);
    const a = args.map(run);
    if (op === "eq") return equal(a[0], a[1]);
    ensure(
      a.every(Number.isFinite),
      "STAT_CALCULATION",
      "Numeric expression requires finite numbers",
    );
    let result;
    if (op === "gt") return a[0] > a[1];
    if (op === "gte") return a[0] >= a[1];
    if (op === "lt") return a[0] < a[1];
    if (op === "lte") return a[0] <= a[1];
    if (op === "add") result = a.reduce((x, y) => x + y);
    if (op === "sub") result = a[0] - a[1];
    if (op === "mul") result = a.reduce((x, y) => x * y);
    if (op === "div") {
      ensure(a[1] !== 0, "STAT_CALCULATION", "Division by zero");
      result = a[0] / a[1];
    }
    if (op === "min") result = Math.min(...a);
    if (op === "max") result = Math.max(...a);
    ensure(
      Number.isFinite(result) && Math.abs(result) <= 1e12,
      "STAT_CALCULATION",
      "Calculation exceeds numeric bounds",
    );
    return result;
  };
  return run(expr);
}
export function validateField(f, depth = 0) {
  ensure(depth <= 8, "POLICY_LIMIT", "Nested field schema is too deep");
  exact(f, [
    "key",
    "label",
    "description",
    "type",
    "scope",
    "visibility",
    "source",
    "required",
    "nullable",
    "default",
    "fixed",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "enum",
    "precision",
    "unit",
    "group",
    "order",
    "requiredWhen",
    "calculate",
    "items",
    "properties",
    "additionalProperties",
  ]);
  ensure(identifier.test(f.key), "POLICY_SCHEMA", "Invalid field key");
  string(f.label, 200, "field label");
  ensure(
    ["integer", "number", "string", "boolean", "array", "object"].includes(
      f.type,
    ),
    "POLICY_SCHEMA",
    "Invalid field type",
  );
  ensure(
    ["card", "variant", "copy"].includes(f.scope ?? "card"),
    "POLICY_SCHEMA",
    "Invalid field scope",
  );
  ensure(
    ["public", "owner", "operator"].includes(f.visibility ?? "public"),
    "POLICY_SCHEMA",
    "Invalid field visibility",
  );
  ensure(
    ["author", "admin", "provider", "calculated"].includes(
      f.source ?? "author",
    ),
    "POLICY_SCHEMA",
    "Invalid field source",
  );
  for (const k of ["required", "nullable", "additionalProperties"])
    if (f[k] !== undefined)
      ensure(typeof f[k] === "boolean", "POLICY_SCHEMA", "Invalid " + k);
  for (const k of ["minimum", "maximum"])
    if (f[k] !== undefined) bounded(f[k], -1e12, 1e12, k);
  for (const k of [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "precision",
    "order",
  ])
    if (f[k] !== undefined) {
      bounded(f[k], 0, k === "precision" ? 8 : 10000, k);
      ensure(
        Number.isInteger(f[k]),
        "POLICY_SCHEMA",
        "Integer " + k + " required",
      );
    }
  for (const [lo, hi] of [
    ["minimum", "maximum"],
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
  ])
    ensure(
      (f[lo] ?? -Infinity) <= (f[hi] ?? Infinity),
      "POLICY_CONFLICT",
      "Invalid field range",
    );
  if (f.enum !== undefined)
    ensure(
      Array.isArray(f.enum) && f.enum.length > 0 && f.enum.length <= 128,
      "POLICY_SCHEMA",
      "Invalid enumeration",
    );
  if (f.enum)
    for (const value of f.enum)
      ensure(
        !valueError({ ...f, enum: undefined, fixed: undefined }, value),
        "POLICY_SCHEMA",
        "Enumeration contains an invalid value",
      );
  if (f.requiredWhen !== undefined) validateExpression(f.requiredWhen);
  if (f.calculate !== undefined) {
    validateExpression(f.calculate);
    ensure(
      f.source === "calculated",
      "POLICY_SCHEMA",
      "Calculated fields need calculated source",
    );
  }
  ensure(
    f.source !== "calculated" || f.calculate !== undefined,
    "POLICY_SCHEMA",
    "Missing calculation",
  );
  if (f.items)
    validateField({ key: "item", label: "Item", ...f.items }, depth + 1);
  if (f.properties) {
    ensure(
      plain(f.properties) && Object.keys(f.properties).length <= 64,
      "POLICY_SCHEMA",
      "Invalid object fields",
    );
    for (const [key, sub] of Object.entries(f.properties))
      validateField({ key, label: key, ...sub }, depth + 1);
  }
  for (const k of ["default", "fixed"])
    if (own(f, k))
      ensure(!valueError(f, f[k]), "POLICY_SCHEMA", "Invalid field " + k);
  return f;
}
export function valueError(f, v) {
  if (v === null) return f.nullable ? null : "Null is not allowed";
  const type = f.type;
  if (
    type === "integer"
      ? !Number.isSafeInteger(v)
      : type === "number"
        ? !Number.isFinite(v)
        : type === "array"
          ? !Array.isArray(v)
          : type === "object"
            ? !plain(v)
            : typeof v !== type
  )
    return "Wrong value type";
  if (f.enum && !f.enum.some((x) => equal(x, v)))
    return "Value is not in the allowed choices";
  if (own(f, "fixed") && f.fixed !== undefined && !equal(f.fixed, v))
    return "Value is fixed by policy";
  if (typeof v === "number") {
    if (v < (f.minimum ?? -1e12) || v > (f.maximum ?? 1e12))
      return "Value is outside the permitted range";
    if (
      f.precision !== undefined &&
      Math.abs(v * 10 ** f.precision - Math.round(v * 10 ** f.precision)) > 1e-6
    )
      return "Too many decimal places";
  }
  if (
    typeof v === "string" &&
    (Array.from(v).length < (f.minLength ?? 0) ||
      Array.from(v).length > (f.maxLength ?? 10000))
  )
    return "Text length is outside the permitted range";
  if (Array.isArray(v)) {
    if (v.length < (f.minItems ?? 0) || v.length > (f.maxItems ?? 256))
      return "List length is outside the permitted range";
    if (f.items)
      for (const item of v) {
        const error = valueError(f.items, item);
        if (error) return error;
      }
  }
  if (plain(v)) {
    if (Object.keys(v).length > 64) return "Too many object fields";
    for (const [key, sub] of Object.entries(f.properties ?? {}))
      if (own(v, key) ? valueError(sub, v[key]) : sub.required)
        return "Invalid or missing object field";
    if (
      f.additionalProperties !== true &&
      Object.keys(v).some((k) => !own(f.properties ?? {}, k))
    )
      return "Unknown object field";
  }
  return null;
}
export function validatePolicy(document) {
  ensure(
    canonical(document).length <= 262144,
    "POLICY_LIMIT",
    "Policy exceeds 256 KiB",
  );
  exact(document, [
    "schemaVersion",
    "id",
    "revision",
    "name",
    "description",
    "inherits",
    "defaults",
    "fields",
    "requirements",
  ]);
  ensure(
    document.schemaVersion === 1 &&
      identifier.test(document.id) &&
      Number.isSafeInteger(document.revision) &&
      document.revision > 0,
    "POLICY_SCHEMA",
    "Invalid policy identity/version",
  );
  string(document.name, 200, "policy name");
  ensure(
    Array.isArray(document.inherits ?? []) &&
      (document.inherits ?? []).length <= 16 &&
      (document.inherits ?? []).every(reference),
    "POLICY_SCHEMA",
    "Invalid parent policies",
  );
  ensure(
    Array.isArray(document.fields ?? []) &&
      (document.fields ?? []).length <= 128,
    "POLICY_SCHEMA",
    "Too many fields",
  );
  const ids = new Set();
  for (const f of document.fields ?? []) {
    validateField(f);
    const k = (f.scope ?? "card") + ":" + f.key;
    ensure(!ids.has(k), "POLICY_SCHEMA", "Duplicate field");
    ids.add(k);
  }
  if (document.defaults) {
    exact(document.defaults, ["template", "stats", "typography"]);
    if (document.defaults.template)
      ensure(
        reference(document.defaults.template),
        "POLICY_SCHEMA",
        "Invalid default template",
      );
  }
  const r = document.requirements ?? {};
  exact(r, [
    "templates",
    "templateSets",
    "fonts",
    "requiredBindings",
    "minimumFontSize",
    "rejectOverflow",
    "allowUnknownStats",
    "embeddedFonts",
  ]);
  for (const k of ["templates", "templateSets", "fonts", "requiredBindings"])
    if (r[k] !== undefined)
      ensure(
        Array.isArray(r[k]) &&
          r[k].length > 0 &&
          r[k].length <= 128 &&
          r[k].every((v) => typeof v === "string" && v.length <= 150),
        "POLICY_SCHEMA",
        "Invalid " + k,
      );
  for (const k of ["templates", "templateSets"])
    if (r[k])
      ensure(
        r[k].every(reference),
        "POLICY_SCHEMA",
        "Library revisions required",
      );
  if (r.minimumFontSize !== undefined)
    bounded(r.minimumFontSize, 1, 1000, "minimumFontSize");
  for (const k of ["rejectOverflow", "allowUnknownStats", "embeddedFonts"])
    if (r[k] !== undefined)
      ensure(typeof r[k] === "boolean", "POLICY_SCHEMA", "Invalid " + k);
  return structuredClone(document);
}
function mergeField(a, b) {
  if (!a) return structuredClone(b);
  ensure(
    a.type === b.type &&
      (a.visibility ?? "public") === (b.visibility ?? "public") &&
      (a.source ?? "author") === (b.source ?? "author"),
    "POLICY_CONFLICT",
    "Incompatible field definition " + b.key,
  );
  const n = {
    ...a,
    ...b,
    required: !!(a.required || b.required),
    nullable: !!(a.nullable && b.nullable),
  };
  for (const k of ["minimum", "minLength", "minItems"])
    if (a[k] !== undefined || b[k] !== undefined)
      n[k] = Math.max(a[k] ?? -Infinity, b[k] ?? -Infinity);
  for (const k of ["maximum", "maxLength", "maxItems", "precision"])
    if (a[k] !== undefined || b[k] !== undefined)
      n[k] = Math.min(a[k] ?? Infinity, b[k] ?? Infinity);
  if (a.enum && b.enum)
    n.enum = a.enum.filter((x) => b.enum.some((y) => equal(x, y)));
  else if (a.enum) n.enum = a.enum;
  for (const k of ["fixed", "calculate", "requiredWhen", "items", "properties"])
    if (own(a, k)) {
      ensure(
        !own(b, k) || equal(a[k], b[k]),
        "POLICY_CONFLICT",
        "Conflicting protected field rule " + b.key,
      );
      n[k] = a[k];
    }
  if (a.additionalProperties === false) n.additionalProperties = false;
  validateField(n);
  return n;
}
const rank = { installation: 0, cardType: 1, line: 2, variant: 3 };
export function resolveCardPolicy(
  documents,
  assignments,
  context,
  { resources = [] } = {},
) {
  const byRef = new Map(
    documents.map((d) => [d.id + "@" + d.revision, validatePolicy(d)]),
  );
  const applicable = assignments.filter(
    (a) =>
      a.scope === "installation" ||
      (a.scope === "line" && a.target === context.lineId) ||
      (a.scope === "cardType" && a.target === context.type) ||
      (a.scope === "variant" && a.target === context.variantId),
  );
  applicable.sort(
    (a, b) =>
      rank[a.scope] - rank[b.scope] ||
      (a.priority ?? 0) - (b.priority ?? 0) ||
      a.policy.localeCompare(b.policy),
  );
  const result = {
    schemaVersion: 1,
    references: [],
    defaults: {},
    fields: [],
    requirements: {},
    provenance: {},
  };
  const seen = new Set(),
    stack = new Set(),
    fields = new Map(),
    defaultsAt = new Map();
  function visit(ref, tier) {
    ensure(!stack.has(ref), "POLICY_CYCLE", "Policy inheritance cycle");
    const visitKey=ref+":"+tier;
    if (seen.has(visitKey)) return;
    const d = byRef.get(ref);
    ensure(d, "POLICY_MISSING", "Missing policy revision " + ref);
    stack.add(ref);
    if (d.requirements?.templateSets) {
      const members = d.requirements.templateSets.flatMap((key) => {
        const set = resources.find(
          (r) =>
            r.kind === "template-set" &&
            !r.retired &&
            r.document.id + "@" + r.document.revision === key,
        );
        ensure(set, "TEMPLATE_MISSING", "Unknown template set");
        return set.document.templates;
      });
      d.requirements.templates = d.requirements.templates
        ? d.requirements.templates.filter((x) => members.includes(x))
        : [...new Set(members)];
      ensure(
        d.requirements.templates.length,
        "POLICY_CONFLICT",
        "No common templates",
      );
      delete d.requirements.templateSets;
    }
    for (const p of d.inherits ?? []) visit(p, tier - 0.001);
    stack.delete(ref);
    seen.add(visitKey);
    if(!result.references.includes(ref))result.references.push(ref);
    for (const [k, v] of Object.entries(d.defaults ?? {})) {
      const collision = tier + ":" + k;
      ensure(
        !defaultsAt.has(collision) || equal(defaultsAt.get(collision), v),
        "POLICY_CONFLICT",
        "Conflicting defaults; choose explicit assignment priorities",
      );
      defaultsAt.set(collision, v);
      result.defaults[k] = structuredClone(v);
      result.provenance["defaults." + k] = ref;
    }
    for (const field of d.fields ?? []) {
      const key = (field.scope ?? "card") + ":" + field.key;
      fields.set(key, mergeField(fields.get(key), field));
      (result.provenance[key] ??= []).push(ref);
    }
    const r = result.requirements;
    for (const [k, v] of Object.entries(d.requirements ?? {})) {
      if (k === "templates" || k === "fonts") {
        r[k] = r[k] ? r[k].filter((x) => v.includes(x)) : [...v];
        ensure(r[k].length, "POLICY_CONFLICT", "No common allowed " + k);
      } else if (k === "requiredBindings")
        r[k] = [...new Set([...(r[k] ?? []), ...v])];
      else if (k === "minimumFontSize") r[k] = Math.max(r[k] ?? 0, v);
      else if (k === "allowUnknownStats") r[k] = (r[k] ?? true) && v;
      else r[k] = !!(r[k] || v);
      (result.provenance["requirements." + k] ??= []).push(ref);
    }
  }
  for (const a of applicable)
    visit(a.policy, rank[a.scope] * 100000 + (a.priority ?? 0));
  result.fields = [...fields.values()];
  if (result.defaults.template && result.requirements.templates)
    ensure(
      result.requirements.templates.includes(result.defaults.template),
      "POLICY_CONFLICT",
      "Default template is not allowed",
    );
  for (const scope of ["card", "variant", "copy"]) {
    const byKey = new Map(
      result.fields
        .filter((f) => (f.scope ?? "card") === scope)
        .map((f) => [f.key, f]),
    );
    const visiting = new Set(),
      done = new Set();
    function deps(e) {
      return Array.isArray(e)
        ? e[0] === "field"
          ? [e[1]]
          : e.slice(1).flatMap(deps)
        : [];
    }
    function checkCycle(k) {
      if (done.has(k)) return;
      ensure(!visiting.has(k), "POLICY_CYCLE", "Calculated stat cycle");
      visiting.add(k);
      for (const dep of deps(byKey.get(k)?.calculate)) {
        ensure(
          byKey.has(dep),
          "STAT_DEPENDENCY",
          "Unknown calculation dependency",
        );
        const access = { public: 0, owner: 1, operator: 2 };
        ensure(
          access[byKey.get(dep).visibility ?? "public"] <=
            access[byKey.get(k).visibility ?? "public"],
          "PRIVATE_CALCULATION",
          "Calculated field cannot expose a private dependency",
        );
        checkCycle(dep);
      }
      visiting.delete(k);
      done.add(k);
    }
    for (const key of byKey.keys()) checkCycle(key);
  }
  return result;
}
export function deriveStats(fields, values, scope = "card") {
  const output = structuredClone(values),
    pending = new Map(
      fields
        .filter(
          (f) => (f.scope ?? "card") === scope && f.calculate !== undefined,
        )
        .map((f) => [f.key, f]),
    );
  for (const key of pending.keys()) delete output[key];
  for (let pass = 0; pending.size && pass <= fields.length; pass++)
    for (const [key, f] of pending) {
      try {
        let v = expression(f.calculate, output);
        if (f.precision !== undefined) v = Number(v.toFixed(f.precision));
        output[key] = v;
        pending.delete(key);
      } catch (error) {
        if (error.code !== "STAT_DEPENDENCY") throw error;
      }
    }
  ensure(!pending.size, "STAT_DEPENDENCY", "Unresolved calculated fields");
  return output;
}
export function policyDefaults(policy, scope = "card") {
  const values = { ...(scope === "card" ? (policy.defaults.stats ?? {}) : {}) };
  for (const f of policy.fields.filter((f) => (f.scope ?? "card") === scope)) {
    if (own(f, "fixed")) values[f.key] = structuredClone(f.fixed);
    else if ((f.source ?? "author") === "author" && own(f, "default"))
      values[f.key] = structuredClone(f.default);
  }
  return values;
}
export function publicStats(
  values,
  fields,
  scope = "card",
  visibility = "public",
) {
  const level = { public: 0, owner: 1, operator: 2 };
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(
      ([key]) =>
        level[
          fields.find((f) => f.key === key && (f.scope ?? "card") === scope)
            ?.visibility ?? "public"
        ] <= level[visibility],
    ),
  );
}
export function inspectCardPolicy(
  policy,
  { card, variant, copy, presentation, templates = [] },
) {
  const issues = [];
  const issue = (code, path, message, rule) =>
    issues.push({
      code,
      path,
      message,
      rule,
      policies: policy.provenance[rule] ?? policy.references,
      severity: "error",
    });
  for (const [scope, subject] of [
    ["card", card],
    ["variant", variant],
    ["copy", copy],
  ]) {
    if (!subject) continue;
    const fields = policy.fields.filter((f) => (f.scope ?? "card") === scope),
      values = subject.stats ?? {};
    for (const f of fields) {
      const path = scope + ".stats." + f.key;
      let required = !!f.required;
      try {
        if (f.requiredWhen)
          required ||= expression(f.requiredWhen, values) === true;
      } catch {
        issue(
          "STAT_CONDITION",
          path,
          "Conditional field inputs are invalid",
          scope + ":" + f.key,
        );
      }
      if (!own(values, f.key)) {
        if (required)
          issue(
            "STAT_REQUIRED",
            path,
            "Required field is missing",
            scope + ":" + f.key,
          );
        continue;
      }
      const error = valueError(f, values[f.key]);
      if (error) issue("STAT_VALUE", path, error, scope + ":" + f.key);
      if (f.calculate)
        try {
          const expected = deriveStats(fields, values, scope)[f.key];
          if (!equal(expected, values[f.key]))
            issue(
              "STAT_CALCULATED",
              path,
              "Calculated value does not match its inputs",
              scope + ":" + f.key,
            );
        } catch {
          issue(
            "STAT_CALCULATED",
            path,
            "Calculation could not be evaluated",
            scope + ":" + f.key,
          );
        }
    }
    if (policy.requirements.allowUnknownStats === false)
      for (const key of Object.keys(values))
        if (!fields.some((f) => f.key === key))
          issue(
            "STAT_UNKNOWN",
            scope + ".stats." + key,
            "Unknown stat field",
            "requirements.allowUnknownStats",
          );
  }
  if (copy && !card && !variant) return issues;
  const r = policy.requirements;
  const needsArt =
    r.templates ||
    r.fonts ||
    r.embeddedFonts ||
    r.requiredBindings ||
    r.minimumFontSize ||
    r.rejectOverflow;
  if (!presentation) {
    if (needsArt)
      issue(
        "PRESENTATION_REQUIRED",
        "card.presentation",
        "A verified presentation is required",
        "presentation",
      );
    return issues;
  }
  const m = presentation.manifest,
    scenes =
      presentation.scenes instanceof Map
        ? presentation.scenes
        : new Map(Object.entries(presentation.scenes));
  const nodes = Object.values(m.faces).flatMap((face) =>
    flattenNodes(scenes.get(face.scene)?.nodes ?? []),
  );
  const templateRef = m.authoring?.template;
  if (r.templates && !r.templates.includes(templateRef))
    issue(
      "TEMPLATE_REQUIRED",
      "card.presentation",
      "Choose an approved template revision",
      "requirements.templates",
    );
  if (templateRef) {
    const template = templates.find(
      (t) => t.id + "@" + t.revision === templateRef,
    );
    if (!template)
      issue(
        "TEMPLATE_MISSING",
        "card.presentation",
        "Template revision is unavailable",
        "requirements.templates",
      );
    else {
      if (!equal(template.canvas, m.canvas))
        issue(
          "TEMPLATE_GEOMETRY",
          "card.presentation",
          "Template canvas changed",
          "requirements.templates",
        );
      for (const [face, structure] of Object.entries(
        template.structure ?? {},
      )) {
        const scene = scenes.get(m.faces[face]?.scene);
        const shape = (nodes) =>
          nodes.map((n) => ({
            id: n.id,
            ...(n.children ? { children: shape(n.children) } : {}),
          }));
        if (!equal(shape(scene?.nodes ?? []), structure))
          issue(
            "TEMPLATE_STRUCTURE",
            face,
            "Protected layer order or nesting changed",
            "requirements.templates",
          );
      }
      for (const slot of template.slots ?? []) {
        const face = m.faces[slot.face ?? "front"],
          node = flattenNodes(scenes.get(face?.scene)?.nodes ?? []).find(
            (n) => n.id === slot.nodeId,
          );
        if (!node) {
          issue(
            "TEMPLATE_SLOT",
            slot.nodeId,
            "Required template layer is missing",
            "requirements.templates",
          );
          continue;
        }
        for (const [key, value] of Object.entries(slot.fixed ?? {}))
          if (!equal(node[key], value))
            issue(
              "TEMPLATE_FIXED",
              slot.nodeId + "." + key,
              "Protected template property changed",
              "requirements.templates",
            );
        for (const [key, range] of Object.entries(slot.bounds ?? {}))
          if (
            !Number.isFinite(node[key]) ||
            node[key] < range[0] ||
            node[key] > range[1]
          )
            issue(
              "TEMPLATE_BOUNDS",
              slot.nodeId + "." + key,
              "Template property is outside its bounds",
              "requirements.templates",
            );
      }
      for (const [id, digest] of Object.entries(template.assetDigests ?? {}))
        if (m.assets.find((a) => a.id === id)?.sha256 !== digest)
          issue(
            "TEMPLATE_ASSET",
            id,
            "Protected template asset changed",
            "requirements.templates",
          );
    }
  }
  for (const [scope, values] of Object.entries(m.authoring?.values ?? {}))
    for (const key of Object.keys(values)) {
      const f = policy.fields.find(
        (f) => f.key === key && (f.scope ?? "card") === scope,
      );
      if (f && (f.visibility ?? "public") !== "public")
        issue(
          "PRIVATE_SNAPSHOT",
          scope + "." + key,
          "Private values cannot be stored in public presentation metadata",
          "binding",
        );
    }
  for (const node of nodes) {
    if (node.type !== "text") continue;
    const style = node.typography ?? {};
    if (
      r.minimumFontSize &&
      Math.min(
        style.size ?? node.height * 0.8,
        style.overflow === "shrink" ? (style.minSize ?? 8) : Infinity,
      ) < r.minimumFontSize
    )
      issue(
        "TEXT_SIZE",
        node.id,
        "Text is below the minimum size",
        "requirements.minimumFontSize",
      );
    if (
      r.rejectOverflow &&
      Object.values(presentation.layouts ?? {}).some(
        (l) => l.nodeId === node.id && l.overflow,
      )
    )
      issue(
        "TEXT_OVERFLOW",
        node.id,
        "Text overflows its box",
        "requirements.rejectOverflow",
      );
    if (
      r.fonts &&
      !r.fonts.includes(
        style.fontAsset
          ? "sha256:" + m.assets.find((a) => a.id === style.fontAsset)?.sha256
          : (node.font ?? "Georgia"),
      )
    )
      issue(
        "FONT_REQUIRED",
        node.id,
        "Font is not allowed",
        "requirements.fonts",
      );
    if (r.embeddedFonts && !style.fontAsset)
      issue(
        "FONT_REQUIRED",
        node.id,
        "Embed an approved font",
        "requirements.embeddedFonts",
      );
    if (node.stat) {
      const find = (f) =>
        f.key === node.stat.key &&
        (f.scope ?? "card") === (node.stat.scope ?? "card");
      const f =
        policy.fields.find(find) ??
        (r.allowUnknownStats !== false
          ? m.authoring?.fields?.find(
              (f) => find(f) && (f.source ?? "author") === "author",
            )
          : null);
      if (!f)
        issue(
          "STAT_BINDING",
          node.id,
          "Binding uses an undefined field",
          "binding",
        );
      else if (
        (f.visibility ?? "public") !== "public" ||
        (f.scope ?? "card") === "copy"
      )
        issue(
          "PRIVATE_BINDING",
          node.id,
          "Private or copy data cannot be embedded in public art",
          "binding",
        );
      else {
        const value = (node.stat.scope === "variant" ? variant : card)?.stats?.[
          node.stat.key
        ];
        if (
          !equal(
            m.authoring?.values?.[node.stat.scope ?? "card"]?.[node.stat.key],
            value,
          )
        )
          issue(
            "STAT_SNAPSHOT",
            node.id,
            "Presentation stat snapshot differs from the catalog",
            "binding",
          );
      }
    }
  }
  for (const key of r.requiredBindings ?? [])
    if (!nodes.some((n) => n.stat?.key === key))
      issue(
        "STAT_BINDING_REQUIRED",
        key,
        "Required stat display is missing",
        "requirements.requiredBindings",
      );
  return issues;
}
