import { FrameworkError, check } from "./catalog.js";
import { safeData } from "./data.js";
import { contentDigest } from "./importer.js";
import { hasPermission } from "./access.js";
import {
  validatePolicy,
  resolveCardPolicy,
  inspectCardPolicy,
  reference,
  exact,
  flattenNodes,
  publicStats,
  deriveStats,
  policyDefaults,
} from "./card-policy.js";
import { Worker } from "node:worker_threads";
import { validateTypography } from "./presentation/text.js";

const empty = () => ({
  revision: 0,
  documents: [],
  assignments: [],
  resources: [],
  presentations: {},
  history: [],
});
const state = (s) => s.cardAuthoring ?? empty();
const ref = (d) => d.id + "@" + d.revision;
const clean = (v) =>
  safeData(v, { maxBytes: 8 * 1024 * 1024, maxDepth: 24, maxNodes: 100000 });
const allowed = (actor, permission) =>
  check(
    hasPermission(actor, permission),
    "FORBIDDEN",
    "Authority required: " + permission,
    403,
  );
function domain(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof FrameworkError) throw e;
    throw new FrameworkError(e.code ?? "CARD_POLICY", e.message, 400);
  }
}
function effective(registry, context) {
  return domain(() =>
    resolveCardPolicy(
      registry.documents
        .filter((r) => r.state !== "draft")
        .map((r) => r.document),
      registry.assignments,
      context,
      { resources: registry.resources },
    ),
  );
}
function context(card, variant) {
  return {
    lineId: card.lineId,
    type: card.type ?? "collectible",
    variantId: variant?.id,
  };
}
function validateAssignment(a) {
  exact(a, ["policy", "scope", "target", "priority"]);
  check(
    reference(a.policy) &&
      ["installation", "line", "cardType", "variant"].includes(a.scope),
    "POLICY_SCHEMA",
    "Invalid policy assignment",
  );
  check(
    a.scope === "installation"
      ? a.target === undefined
      : typeof a.target === "string" && a.target.length <= 100,
    "POLICY_SCHEMA",
    "Invalid assignment target",
  );
  check(
    Number.isInteger(a.priority ?? 0) && Math.abs(a.priority ?? 0) <= 1000,
    "POLICY_SCHEMA",
    "Invalid assignment priority",
  );
}
function validateResolution(registry, catalog) {
  const lines = new Set([
    "",
    ...(catalog?.lines ?? []).map((x) => x.id),
    ...registry.assignments
      .filter((a) => a.scope === "line")
      .map((a) => a.target),
  ]);
  const types = new Set([
    "collectible",
    ...(catalog?.cardTypes ?? []).map((x) => x.id),
    ...registry.assignments
      .filter((a) => a.scope === "cardType")
      .map((a) => a.target),
  ]);
  check(
    lines.size * types.size <= 10000,
    "POLICY_LIMIT",
    "Too many policy scope combinations",
  );
  for (const lineId of lines)
    for (const type of types) effective(registry, { lineId, type });
  for (const card of catalog?.cards ?? [])
    for (const variant of (catalog.variants ?? []).filter(
      (v) => v.cardId === card.id,
    ))
      effective(registry, context(card, variant));
}
function issuesFor(registry, card, variant) {
  const policy = effective(registry, context(card, variant)),
    presentation =
      registry.presentations[
        (variant?.presentation ?? card.presentation)?.digest
      ];
  const issues = domain(() =>
    inspectCardPolicy(policy, {
      card,
      variant,
      presentation,
      templates: registry.resources
        .filter((r) => r.kind === "template" && !r.retired)
        .map((r) => r.document),
    }),
  );
  if (presentation)
    for (const problem of presentation.textIssues ?? []) {
      if (
        problem.code === "FONT_GLYPH" ||
        problem.code === "FONT_AXIS" ||
        (policy.requirements.rejectOverflow &&
          ["TEXT_OVERFLOW", "TEXT_UNMEASURED"].includes(problem.code))
      )
        issues.push({
          ...problem,
          path: problem.nodeId,
          policies: policy.references,
          severity: "error",
        });
    }
  return { policy, issues };
}
export function validateGovernedCatalog(
  s,
  catalog,
  { actor, previous = s.catalog } = {},
) {
  const registry = state(s),
    evidence = {};
  for (const card of catalog.cards) {
    const old = previous?.cards.find((c) => c.id === card.id);
    const variants = catalog.variants.filter((v) => v.cardId === card.id);
    for (const variant of variants.length ? variants : [null]) {
      const oldVariant = previous?.variants.find((v) => v.id === variant?.id);
      const unchanged =
        old &&
        contentDigest(old) === contentDigest(card) &&
        (!variant ||
          (oldVariant && contentDigest(oldVariant) === contentDigest(variant)));
      if (unchanged) continue;
      const { policy, issues } = issuesFor(registry, card, variant);
      for (const f of s.cardValidation?.[variant?.id ?? card.id]?.fields ?? [])
        if (
          (f.visibility ?? "public") !== "public" &&
          (f.scope ?? "card") !== "copy"
        ) {
          const subject = f.scope === "variant" ? variant : card,
            next = policy.fields.find(
              (n) =>
                n.key === f.key && (n.scope ?? "card") === (f.scope ?? "card"),
            );
          if (
            Object.hasOwn(subject?.stats ?? {}, f.key) &&
            (next?.visibility ?? "public") === "public"
          )
            issues.push({
              code: "STAT_VISIBILITY",
              path: f.key,
              message:
                "Remove retained private values before publishing under a public or undefined field",
              severity: "error",
            });
        }
      for (const [scope, subject, prior] of [
        ["card", card, old],
        ["variant", variant, oldVariant],
      ])
        if (subject)
          for (const field of policy.fields.filter(
            (f) => (f.scope ?? "card") === scope,
          )) {
            if (
              ["admin", "provider"].includes(field.source) &&
              !hasPermission(
                actor,
                field.source === "admin"
                  ? "card-policies.manage"
                  : "card-stats.provide",
              ) &&
              contentDigest({ v: subject.stats?.[field.key] ?? null }) !==
                contentDigest({ v: prior?.stats?.[field.key] ?? null })
            )
              issues.push({
                code: "STAT_AUTHORITY",
                path: scope + ".stats." + field.key,
                message: "Field is managed by an authorized " + field.source,
                severity: "error",
              });
          }
      check(
        !issues.length,
        "CARD_POLICY",
        issues
          .slice(0, 8)
          .map((x) => x.path + ": " + x.message)
          .join("; "),
        409,
      );
      evidence[variant?.id ?? card.id] = {
        policyRevision: registry.revision,
        policies: policy.references,
        policyDigest: contentDigest(policy),
        cardDigest: contentDigest(card),
        variantDigest: variant ? contentDigest(variant) : null,
        presentationDigest:
          (variant?.presentation ?? card.presentation)?.digest ?? null,
        fields: policy.fields,
      };
    }
  }
  return evidence;
}
export function redactGovernedCard(
  s,
  card,
  scope = "card",
  visibility = "public",
  fields,
) {
  const evidence = Object.values(s.cardValidation ?? {})
    .filter((e) => e.cardDigest === contentDigest(card))
    .flatMap((e) => e.fields ?? []);
  const levels = { public: 0, owner: 1, operator: 2 };
  const p =
    fields ??
    [...evidence, ...effective(state(s), context(card)).fields].sort(
      (a, b) =>
        levels[b.visibility ?? "public"] - levels[a.visibility ?? "public"],
    );
  if (Object.hasOwn(card, "stats"))
    card.stats = publicStats(card.stats, p, scope, visibility);
  return card;
}
export class CardPolicyService {
  constructor({ read, operate, clock }) {
    this.read = read;
    this.operate = operate;
    this.clock = clock;
  }
  get(actor) {
    allowed(actor, "card-policies.read");
    return this.read((s) => {
      const r = state(s);
      return {
        revision: r.revision,
        documents: r.documents,
        assignments: r.assignments,
        resources: r.resources,
        history: r.history,
      };
    });
  }
  effective(actor, input) {
    allowed(actor, "catalog.preview");
    return this.read((s) => {
      const card =
        s.catalog?.cards.find((c) => c.id === input.cardId) ??
        (s.catalog?.lines.some((l) => l.id === input.lineId)
          ? { lineId: input.lineId, type: input.type ?? "collectible" }
          : null);
      check(card, "NOT_FOUND", "Choose an existing card or line", 404);
      const variant = input.variantId
        ? s.catalog?.variants.find(
            (v) => v.id === input.variantId && v.cardId === input.cardId,
          )
        : null;
      check(!input.variantId || variant, "NOT_FOUND", "Variant not found", 404);
      const registry = state(s),
        policy = effective(registry, context(card, variant));
      const visible = structuredClone(policy);
      if (!hasPermission(actor, "card-policies.manage"))
        for (const f of visible.fields)
          if ((f.visibility ?? "public") === "operator") {
            delete f.default;
            delete f.fixed;
            delete visible.defaults.stats?.[f.key];
          }
      return {
        revision: registry.revision,
        digest: contentDigest(policy),
        policy: visible,
        context: {
          cardId: card.id,
          lineId: card.lineId,
          type: card.type ?? "collectible",
          ...(variant ? { variantId: variant.id } : {}),
        },
        resources: registry.resources.filter((r) => !r.retired),
      };
    });
  }
  mutate(actor, key, type, input, fn, permission = "card-policies.manage") {
    return this.operate(actor, key, permission, type, input, (s) => {
      const r = (s.cardAuthoring ??= empty());
      check(
        r.revision === input.expectedRevision,
        "POLICY_CHANGED",
        "Policy library changed; reload and review again",
        409,
      );
      const result = domain(() => fn(r, s));
      r.revision++;
      r.history.push({
        revision: r.revision,
        type,
        actorId: actor.userId ?? null,
        at: this.clock(),
        reason: input.reason ?? "",
      });
      return { ...result, revision: r.revision };
    });
  }
  save(actor, input) {
    const document = domain(() => validatePolicy(clean(input.document)));
    return this.mutate(
      actor,
      input.key,
      "card-policy.saved",
      { ...input, document },
      (r) => {
        const old = r.documents.find((x) => ref(x.document) === ref(document));
        check(
          !old || old.state === "draft",
          "POLICY_IMMUTABLE",
          "Create a new revision to change an active policy",
          409,
        );
        if (old) old.document = document;
        else {
          check(
            r.documents.length < 1024,
            "POLICY_LIMIT",
            "Policy revision limit reached",
          );
          r.documents.push({ document, state: "draft" });
        }
        return { document, state: "draft" };
      },
    );
  }
  prepare(s, input) {
    const r = structuredClone(state(s));
    check(
      r.revision === input.expectedRevision,
      "POLICY_CHANGED",
      "Policy library changed; preview again",
      409,
    );
    const row = r.documents.find((x) => ref(x.document) === input.policy);
    check(
      row && row.state !== "retired",
      "POLICY_MISSING",
      "Policy revision is unavailable",
      404,
    );
    const assignments = clean(input.assignments);
    check(
      Array.isArray(assignments) && assignments.length <= 128,
      "POLICY_LIMIT",
      "At most 128 assignments",
    );
    for (const a of assignments) {
      domain(() => validateAssignment(a));
      const pool =
        a.scope === "line"
          ? s.catalog?.lines
          : a.scope === "cardType"
            ? s.catalog?.cardTypes
            : a.scope === "variant"
              ? s.catalog?.variants
              : null;
      check(
        a.scope === "installation" ||
          (a.scope === "cardType" && a.target === "collectible") ||
          pool?.some((x) => x.id === a.target),
        "POLICY_SCOPE",
        "Assignment target does not exist",
      );
    }
    check(
      new Set(assignments.map((a) => JSON.stringify(a))).size ===
        assignments.length,
      "POLICY_SCHEMA",
      "Duplicate assignment",
    );
    row.state = "active";
    for (const a of assignments)
      check(
        r.documents.some(
          (x) =>
            ref(x.document) === a.policy &&
            ["active", "superseded"].includes(x.state),
        ),
        "POLICY_MISSING",
        "Assigned policy is not active",
      );
    r.assignments = assignments;
    validateResolution(r, s.catalog);
    for (const a of assignments) {
      const p = effective(r, {
        lineId: a.scope === "line" ? a.target : "",
        type: a.scope === "cardType" ? a.target : "collectible",
        variantId: a.scope === "variant" ? a.target : undefined,
      });
      for (const template of [
        ...(p.requirements.templates ?? []),
        ...(p.defaults.template ? [p.defaults.template] : []),
      ])
        check(
          r.resources.some(
            (x) =>
              x.kind === "template" &&
              !x.retired &&
              ref(x.document) === template,
          ),
          "TEMPLATE_MISSING",
          "Policy references an unavailable template",
        );
    }
    const affected = [];
    for (const card of s.catalog?.cards ?? [])
      for (const variant of s.catalog.variants.filter(
        (v) => v.cardId === card.id,
      )) {
        const { issues } = issuesFor(r, card, variant);
        if (issues.length)
          affected.push({ cardId: card.id, variantId: variant.id, issues });
      }
    return {
      registry: r,
      preview: {
        expectedRevision: input.expectedRevision,
        policy: input.policy,
        assignments,
        affected,
        grandfathered: true,
        digest: contentDigest({
          revision: input.expectedRevision,
          catalog: s.catalog,
          policy: input.policy,
          assignments,
          documents: r.documents,
          resources: r.resources,
        }),
      },
    };
  }
  preview(actor, input) {
    allowed(actor, "card-policies.manage");
    return this.read((s) => this.prepare(s, input).preview);
  }
  activate(actor, input) {
    return this.mutate(
      actor,
      input.key,
      "card-policy.activated",
      input,
      (r, s) => {
        const result = this.prepare(s, input);
        check(
          result.preview.digest === input.digest,
          "POLICY_REVIEW_CHANGED",
          "Review the current impact before activation",
          409,
        );
        r.assignments = result.registry.assignments;
        r.documents = result.registry.documents;
        for (const row of r.documents)
          if (
            row.state === "active" &&
            !r.assignments.some((a) => a.policy === ref(row.document))
          )
            row.state = "superseded";
        return { policy: input.policy, affected: result.preview.affected };
      },
    );
  }
  retire(actor, input) {
    return this.mutate(actor, input.key, "card-policy.retired", input, (r) => {
      const row = r.documents.find((x) => ref(x.document) === input.policy);
      check(row, "NOT_FOUND", "Policy not found", 404);
      check(
        !r.assignments.some((a) => a.policy === input.policy),
        "POLICY_IN_USE",
        "Remove active assignments before retiring",
        409,
      );
      const uses = (key, seen = new Set()) => {
        if (key === input.policy) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return r.documents
          .find((x) => ref(x.document) === key)
          ?.document.inherits?.some((k) => uses(k, seen));
      };
      check(
        !r.assignments.some((a) => uses(a.policy)),
        "POLICY_IN_USE",
        "An assigned policy inherits this revision",
        409,
      );
      row.state = "retired";
      return { policy: input.policy, state: "retired" };
    });
  }
  resource(actor, input) {
    const resource = clean(input.resource);
    return this.mutate(actor, input.key, "card-library.saved", input, (r) => {
      exact(resource, ["kind", "document", "retired"]);
      check(
        ["template", "mask", "style", "template-set"].includes(resource.kind),
        "LIBRARY_SCHEMA",
        "Invalid library resource",
      );
      const d = resource.document;
      check(
        d &&
          reference(ref(d)) &&
          typeof d.name === "string" &&
          d.name.length <= 200,
        "LIBRARY_SCHEMA",
        "Resource identity, revision and name required",
      );
      check(
        !r.resources.some(
          (x) => x.kind === resource.kind && ref(x.document) === ref(d),
        ),
        "LIBRARY_IMMUTABLE",
        "Library revisions are immutable",
        409,
      );
      if (resource.kind === "template") {
        exact(d, [
          "id",
          "revision",
          "name",
          "packageDigest",
          "canvas",
          "slots",
          "assetDigests",
          "structure",
          "tags",
        ]);
        const pkg = r.presentations[d.packageDigest];
        check(
          pkg,
          "PRESENTATION_REQUIRED",
          "Register the template package before saving the template",
        );
        check(
          contentDigest(d.canvas) === contentDigest(pkg.manifest.canvas),
          "TEMPLATE_GEOMETRY",
          "Template canvas differs from its package",
        );
        if (d.structure) {
          const shape = (nodes) =>
            nodes.map((n) => ({
              id: n.id,
              ...(n.children ? { children: shape(n.children) } : {}),
            }));
          for (const [face, structure] of Object.entries(d.structure))
            check(
              pkg.manifest.faces[face] &&
                contentDigest(
                  shape(pkg.scenes[pkg.manifest.faces[face].scene].nodes),
                ) === contentDigest(structure),
              "TEMPLATE_STRUCTURE",
              "Layer structure differs from its package",
            );
        }
        check(
          Array.isArray(d.slots) && d.slots.length <= 512,
          "LIBRARY_SCHEMA",
          "Invalid template slots",
        );
        for (const slot of d.slots) {
          exact(slot, ["face", "nodeId", "fixed", "bounds"]);
          check(
            ["front", "back"].includes(slot.face ?? "front"),
            "LIBRARY_SCHEMA",
            "Invalid face",
          );
          const node = flattenNodes(
            pkg.scenes[pkg.manifest.faces[slot.face ?? "front"].scene].nodes,
          ).find((n) => n.id === slot.nodeId);
          check(node, "TEMPLATE_SLOT", "Template slot is missing");
          for (const [k, v] of Object.entries(slot.fixed ?? {}))
            check(
              contentDigest({ v: node[k] ?? null }) ===
                contentDigest({ v: v ?? null }),
              "TEMPLATE_SLOT",
              "Fixed property differs from template source",
            );
        }
        for (const [id, digest] of Object.entries(d.assetDigests ?? {}))
          check(
            pkg.manifest.assets.some((a) => a.id === id && a.sha256 === digest),
            "TEMPLATE_ASSET",
            "Protected asset differs from source",
          );
      } else if (resource.kind === "template-set") {
        exact(d, ["id", "revision", "name", "templates", "default", "tags"]);
        check(
          Array.isArray(d.templates) &&
            d.templates.length > 0 &&
            d.templates.length <= 128 &&
            d.templates.every((x) =>
              r.resources.some(
                (t) =>
                  t.kind === "template" && ref(t.document) === x && !t.retired,
              ),
            ),
          "LIBRARY_SCHEMA",
          "Invalid template members",
        );
        check(
          !d.default || d.templates.includes(d.default),
          "LIBRARY_SCHEMA",
          "Default template is not a member",
        );
      } else if (resource.kind === "mask") {
        exact(d, [
          "id",
          "revision",
          "name",
          "packageDigest",
          "mask",
          "use",
          "tags",
        ]);
        check(
          ["clip", "effect"].includes(d.use),
          "LIBRARY_SCHEMA",
          "Mask use must be clip or effect",
        );
        const pkg = r.presentations[d.packageDigest];
        check(pkg, "PRESENTATION_REQUIRED", "Register mask content first");
        check(
          d.mask &&
            (d.mask.polygon ||
              pkg.manifest.assets.some(
                (a) =>
                  a.id === d.mask.asset && a.mediaType.startsWith("image/"),
              )),
          "LIBRARY_SCHEMA",
          "Invalid mask reference",
        );
      } else {
        exact(d, [
          "id",
          "revision",
          "name",
          "typography",
          "packageDigest",
          "tags",
        ]);
        const pkg = r.presentations[d.packageDigest];
        check(pkg, "PRESENTATION_REQUIRED", "Register style content first");
        domain(() =>
          validateTypography(
            { type: "text", height: 100, typography: d.typography },
            new Map(pkg.manifest.assets.map((a) => [a.id, a])),
          ),
        );
      }
      check(
        r.resources.length < 4096,
        "LIBRARY_LIMIT",
        "Library limit reached",
      );
      r.resources.push({ ...resource, retired: false });
      return { resource };
    });
  }
  retireResource(actor, input) {
    return this.mutate(actor, input.key, "card-library.retired", input, (r) => {
      const row = r.resources.find(
        (x) => ref(x.document) === input.reference && x.kind === input.kind,
      );
      check(row, "NOT_FOUND", "Resource not found", 404);
      const active = new Set();
      const visit = (key) => {
        if (active.has(key)) return;
        active.add(key);
        for (const parent of r.documents.find((x) => ref(x.document) === key)
          ?.document.inherits ?? [])
          visit(parent);
      };
      r.assignments.forEach((a) => visit(a.policy));
      check(
        !r.documents.some(
          (x) =>
            active.has(ref(x.document)) &&
            (x.document.requirements?.templates?.includes(input.reference) ||
              x.document.requirements?.templateSets?.includes(
                input.reference,
              ) ||
              x.document.defaults?.template === input.reference),
        ),
        "LIBRARY_IN_USE",
        "An assigned policy requires this resource",
        409,
      );
      check(
        !r.resources.some(
          (x) =>
            !x.retired &&
            x.kind === "template-set" &&
            x.document.templates.includes(input.reference),
        ),
        "LIBRARY_IN_USE",
        "Retire referencing template sets first",
        409,
      );
      row.retired = true;
      return { reference: input.reference, retired: true };
    });
  }
  restore(actor, input) {
    return this.mutate(actor, input.key, "card-policy.restored", input, (r) => {
      const row = r.documents.find((x) => ref(x.document) === input.policy);
      check(
        row?.state === "retired",
        "POLICY_STATE",
        "Choose a retired revision",
      );
      row.state = "superseded";
      return { policy: input.policy, state: row.state };
    });
  }
  restoreResource(actor, input) {
    return this.mutate(
      actor,
      input.key,
      "card-library.restored",
      input,
      (r) => {
        const row = r.resources.find(
          (x) => ref(x.document) === input.reference && x.kind === input.kind,
        );
        check(row, "NOT_FOUND", "Resource not found", 404);
        if (row.kind === "template-set")
          check(
            row.document.templates.every((key) =>
              r.resources.some(
                (x) =>
                  x.kind === "template" &&
                  ref(x.document) === key &&
                  !x.retired,
              ),
            ),
            "LIBRARY_IN_USE",
            "Restore template members first",
          );
        row.retired = false;
        return { reference: input.reference, retired: false };
      },
    );
  }
  updateCopyStats(actor, input) {
    return this.operate(
      actor,
      input.key,
      "card-stats.provide",
      "card-stats.updated",
      input,
      (s) => {
        const copy = s.copies[input.copyId];
        check(copy, "NOT_FOUND", "Card copy not found", 404);
        check(
          copy.version === input.expectedVersion,
          "STALE_VERSION",
          "Card changed; reload before editing",
          409,
        );
        const fields = copy.cardPolicy?.fields ?? [],
          values = clean(input.values),
          prior = copy.stats ?? {};
        check(
          values && typeof values === "object" && !Array.isArray(values),
          "STAT_VALUE",
          "Values must be an object",
        );
        for (const [key, value] of Object.entries(values)) {
          const field = fields.find((f) => f.key === key && f.scope === "copy");
          check(field, "STAT_UNKNOWN", "Unknown copy field");
          check(
            field.source !== "calculated" && !Object.hasOwn(field, "fixed"),
            "STAT_AUTHORITY",
            "Field cannot be edited",
          );
          allowed(
            actor,
            field.source === "admin"
              ? "card-policies.manage"
              : "card-stats.provide",
          );
          prior[key] = value;
        }
        const stats = domain(() => deriveStats(fields, prior, "copy"));
        const issues = inspectCardPolicy(
          {
            fields,
            references: copy.cardPolicy?.policies ?? [],
            provenance: {},
            requirements: {},
          },
          { copy: { stats } },
        );
        check(
          !issues.length,
          "STAT_VALUE",
          issues.map((x) => x.path + ": " + x.message).join("; "),
          409,
        );
        copy.stats = stats;
        copy.statsUpdatedAt = this.clock();
        copy.version++;
        return { copyId: copy.id, version: copy.version };
      },
    );
  }
  async registerPresentation(actor, archive) {
    allowed(actor, "art.publish");
    check(
      archive instanceof Uint8Array && archive.byteLength <= 64 * 1024 * 1024,
      "PRESENTATION_LIMIT",
      "Presentation exceeds 64 MiB",
    );
    const record = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./card-policy-worker.js", import.meta.url),
        {
          workerData: archive,
          resourceLimits: {
            maxOldGenerationSizeMb: 128,
            maxYoungGenerationSizeMb: 32,
          },
        },
      );
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () =>
          finish(
            new FrameworkError(
              "PRESENTATION_TIMEOUT",
              "Presentation text analysis exceeded its time budget",
              400,
            ),
          ),
        15000,
      );
      worker.once("message", (result) =>
        finish(
          result.error
            ? new FrameworkError(result.error.code, result.error.message, 400)
            : null,
          result.record,
        ),
      );
      worker.once("error", () =>
        finish(
          new FrameworkError(
            "PRESENTATION_ANALYSIS",
            "Presentation analysis exceeded its resource budget or failed",
            400,
          ),
        ),
      );
      worker.once("exit", () => {
        if (!settled)
          finish(
            new FrameworkError(
              "PRESENTATION_ANALYSIS",
              "Presentation analysis ended before validation",
              400,
            ),
          );
      });
    });
    const pkg = { digest: record.digest },
      textIssues = record.textIssues;
    return this.operate(
      actor,
      "presentation:" + pkg.digest,
      "art.publish",
      "card-presentation.registered",
      { digest: pkg.digest },
      (s) => {
        const r = (s.cardAuthoring ??= empty());
        check(
          Object.keys(r.presentations).length < 10000 ||
            r.presentations[pkg.digest],
          "LIBRARY_LIMIT",
          "Presentation registration limit reached",
        );
        r.presentations[pkg.digest] = record;
        return { digest: pkg.digest, textIssues };
      },
    );
  }
}
