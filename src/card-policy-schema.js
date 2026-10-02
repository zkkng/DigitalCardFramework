const str = { type: "string" },
  bool = { type: "boolean" },
  num = { type: "number" },
  integer = { type: "integer" },
  ref = (name) => ({ $ref: "#/components/schemas/" + name });
const object = (properties, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const array = (items, maxItems = 128) => ({ type: "array", items, maxItems });
const revision = { type: "integer", minimum: 1, maximum: 999999999 },
  reference = {
    type: "string",
    pattern: "^[a-zA-Z][a-zA-Z0-9._-]{0,99}@[1-9][0-9]{0,8}$",
  };
export const policyDefinitions = {};
const schemas = policyDefinitions;
schemas.CardStatField = object(
  {
    key: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9._-]{0,99}$" },
    label: { type: "string", minLength: 1, maxLength: 200 },
    description: str,
    type: {
      enum: ["integer", "number", "string", "boolean", "array", "object"],
    },
    scope: { enum: ["card", "variant", "copy"] },
    visibility: { enum: ["public", "owner", "operator"] },
    source: { enum: ["author", "admin", "provider", "calculated"] },
    required: bool,
    nullable: bool,
    default: {},
    fixed: {},
    minimum: num,
    maximum: num,
    minLength: integer,
    maxLength: integer,
    minItems: integer,
    maxItems: integer,
    enum: array({}, 128),
    precision: { type: "integer", minimum: 0, maximum: 8 },
    unit: str,
    group: str,
    order: integer,
    requiredWhen: {
      description:
        "Bounded expression: field, exists, not, eq, comparisons, and/or, arithmetic.",
    },
    calculate: {
      description: "Bounded numeric expression; source must be calculated.",
    },
    items: {
      type: "object",
      description: "Nested field constraints; key and label are optional.",
    },
    properties: { type: "object", additionalProperties: { type: "object" } },
    additionalProperties: bool,
  },
  ["key", "label", "type"],
);
schemas.CardPolicyRequirements = object({
  templates: array(reference),
  templateSets: array(reference),
  fonts: array(str),
  requiredBindings: array(str),
  minimumFontSize: { type: "number", minimum: 1, maximum: 1000 },
  rejectOverflow: bool,
  allowUnknownStats: bool,
  embeddedFonts: bool,
});
schemas.CardTypography = object({
  fontAsset: str,
  size: num,
  minSize: num,
  weight: num,
  style: { enum: ["normal", "italic", "oblique"] },
  lineHeight: num,
  letterSpacing: num,
  paragraphSpacing: num,
  align: { enum: ["left", "center", "right", "start", "end"] },
  verticalAlign: { enum: ["top", "middle", "bottom"] },
  overflow: { enum: ["wrap", "shrink", "ellipsis", "clip", "grow"] },
  direction: { enum: ["auto", "ltr", "rtl"] },
  language: str,
  color: str,
  outlineColor: str,
  outlineWidth: num,
  shadowColor: str,
  shadowBlur: num,
  shadowX: num,
  shadowY: num,
  axes: { type: "object", additionalProperties: num },
});
schemas.CardPolicyDefaults = object({
  template: reference,
  stats: { type: "object" },
  typography: ref("CardTypography"),
});
schemas.CardPolicy = object(
  {
    schemaVersion: { const: 1 },
    id: str,
    revision,
    name: str,
    description: str,
    inherits: array(reference, 16),
    defaults: ref("CardPolicyDefaults"),
    fields: array(ref("CardStatField")),
    requirements: ref("CardPolicyRequirements"),
  },
  ["schemaVersion", "id", "revision", "name"],
);
schemas.CardPolicyAssignment = object(
  {
    policy: reference,
    scope: { enum: ["installation", "cardType", "line", "variant"] },
    target: str,
    priority: { type: "integer", minimum: -1000, maximum: 1000 },
  },
  ["policy", "scope"],
);
schemas.CardPolicyIssue = object(
  {
    code: str,
    path: str,
    message: str,
    rule: str,
    policies: array(str),
    severity: { const: "error" },
    nodeId: str,
  },
  ["code", "message"],
);
schemas.CardPolicyEffective = object(
  {
    schemaVersion: { const: 1 },
    references: array(reference),
    defaults: ref("CardPolicyDefaults"),
    fields: array(ref("CardStatField")),
    requirements: ref("CardPolicyRequirements"),
    provenance: {
      type: "object",
      additionalProperties: { oneOf: [str, array(str)] },
    },
  },
  [
    "schemaVersion",
    "references",
    "defaults",
    "fields",
    "requirements",
    "provenance",
  ],
);
schemas.CardLibraryResource = object(
  {
    kind: { enum: ["template", "template-set", "mask", "style"] },
    document: {
      type: "object",
      required: ["id", "revision", "name"],
      properties: {
        id: str,
        revision,
        name: str,
        packageDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        canvas: { type: "object" },
        slots: array({ type: "object" }, 512),
        structure: { type: "object" },
        assetDigests: { type: "object", additionalProperties: str },
        tags: array(str),
        templates: array(reference),
        default: reference,
        mask: { type: "object" },
        use: { enum: ["clip", "effect"] },
        typography: ref("CardTypography"),
      },
    },
    retired: bool,
  },
  ["kind", "document"],
);
schemas.CardPolicyRegistry = object(
  {
    revision: { type: "integer", minimum: 0 },
    documents: array(
      object(
        {
          document: ref("CardPolicy"),
          state: { enum: ["draft", "active", "superseded", "retired"] },
        },
        ["document", "state"],
      ),
      1024,
    ),
    assignments: array(ref("CardPolicyAssignment")),
    resources: array(ref("CardLibraryResource"), 4096),
    history: array({ type: "object" }, 100000),
  },
  ["revision", "documents", "assignments", "resources", "history"],
);
const expectedRevision = { type: "integer", minimum: 0 },
  key = { type: "string", minLength: 1, maxLength: 128 },
  reason = { type: "string", maxLength: 2000 };
schemas.CardPolicySave = object(
  { key, expectedRevision, reason, document: ref("CardPolicy") },
  ["key", "expectedRevision", "document"],
);
schemas.CardPolicyPreview = object(
  {
    expectedRevision,
    policy: reference,
    assignments: array(ref("CardPolicyAssignment")),
  },
  ["expectedRevision", "policy", "assignments"],
);
schemas.CardPolicyImpact = object(
  {
    ...schemas.CardPolicyPreview.properties,
    affected: array(
      object({
        cardId: str,
        variantId: str,
        issues: array(ref("CardPolicyIssue"), 2048),
      }),
      20000,
    ),
    grandfathered: { const: true },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  [
    "expectedRevision",
    "policy",
    "assignments",
    "affected",
    "grandfathered",
    "digest",
  ],
);
schemas.CardPolicyActivation = object(
  { ...schemas.CardPolicyImpact.properties, key, reason },
  ["key", "expectedRevision", "policy", "assignments", "digest"],
);
schemas.CardPolicyLifecycle = object(
  { key, expectedRevision, policy: reference, reason },
  ["key", "expectedRevision", "policy"],
);
schemas.CardLibrarySave = object(
  { key, expectedRevision, resource: ref("CardLibraryResource"), reason },
  ["key", "expectedRevision", "resource"],
);
schemas.CardLibraryLifecycle = object(
  {
    key,
    expectedRevision,
    reference,
    kind: { enum: ["template", "template-set", "mask", "style"] },
    reason,
  },
  ["key", "expectedRevision", "reference", "kind"],
);
schemas.CardCopyStats = object(
  {
    key,
    copyId: str,
    expectedVersion: revision,
    values: { type: "object", maxProperties: 128 },
  },
  ["key", "copyId", "expectedVersion", "values"],
);
export const cardPolicySchema = JSON.parse(
  JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://digital-card.invalid/schema/card-policy-1.json",
    ...ref("CardPolicy"),
    $defs: schemas,
  }).replaceAll("#/components/schemas/", "#/$defs/"),
);
