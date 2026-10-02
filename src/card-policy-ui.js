import { validatePolicy } from "./card-policy.js";
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
export function mountCardPolicyAdmin(root, { client }) {
  root.classList.add("dcs-policy-admin");
  let registry,
    preview,
    disposed = false,
    version = 0;
  const events = new AbortController(),
    status = el("p"),
    editor = el("textarea"),
    assignments = el("textarea"),
    selection = el("select"),
    history = el("div"),
    impact = el("div"),
    review = el("input");
  status.setAttribute("role", "status");
  editor.rows = 20;
  assignments.rows = 5;
  editor.setAttribute("aria-label", "Policy document");
  assignments.setAttribute("aria-label", "Policy assignments");
  selection.setAttribute("aria-label", "Saved policy revision");
  review.type = "checkbox";
  const checkbox = el("label");
  checkbox.append(
    review,
    el("span", "I reviewed the policy changes and affected cards."),
  );
  const activate = el("button", "Activate reviewed policy");
  activate.type = "button";
  activate.disabled = true;
  const draft = () => ({
    schemaVersion: 1,
    id: "cards.standard",
    revision: 1,
    name: "Standard cards",
    inherits: [],
    defaults: {},
    fields: [
      {
        key: "custom.value",
        label: "Value",
        type: "integer",
        scope: "card",
        visibility: "public",
        source: "author",
        required: true,
        minimum: 0,
        maximum: 999,
      },
    ],
    requirements: { allowUnknownStats: true },
  });
  const parse = () => validatePolicy(JSON.parse(editor.value));
  const invalidate = () => {
    version++;
    preview = null;
    review.checked = false;
    activate.disabled = true;
    impact.replaceChildren();
  };
  function action(fn) {
    return async () => {
      try {
        status.textContent = "Working…";
        await fn();
      } catch (e) {
        if (!disposed) status.textContent = e.message;
      }
    };
  }
  function button(label, fn) {
    const b = el("button", label);
    b.type = "button";
    b.addEventListener("click", action(fn), { signal: events.signal });
    return b;
  }
  async function refresh() {
    registry = await client.cardPolicies();
    if (disposed) return;
    selection.replaceChildren(el("option", "Choose saved policy"));
    for (const row of registry.documents) {
      const d = row.document,
        o = el(
          "option",
          d.name + " · " + d.id + "@" + d.revision + " · " + row.state,
        );
      o.value = d.id + "@" + d.revision;
      selection.append(o);
    }
    assignments.value = JSON.stringify(registry.assignments, null, 2);
    history.replaceChildren(el("h3", "Policy history"));
    for (const row of registry.history.slice(-20).reverse())
      history.append(
        el("p", "Revision " + row.revision + " · " + row.type + " · " + row.at),
      );
    status.textContent = "Policy library revision " + registry.revision;
    libraryRows.replaceChildren();
    for (const item of registry.resources) {
      const row = el(
        "p",
        item.document.name +
          " · " +
          item.kind +
          " · " +
          item.document.id +
          "@" +
          item.document.revision +
          " ",
      );
      row.append(
        button(
          item.retired ? "Restore resource" : "Retire resource",
          async () => {
            await client[
              item.retired ? "restoreCardResource" : "retireCardResource"
            ]({
              key: crypto.randomUUID(),
              expectedRevision: registry.revision,
              kind: item.kind,
              reference: item.document.id + "@" + item.document.revision,
            });
            invalidate();
            await refresh();
          },
        ),
      );
      libraryRows.append(row);
    }
  }
  root.append(
    el("h2", "Administrator card policies"),
    el(
      "p",
      "Defaults start a draft. Required rules and fixed values are enforced when cards are published.",
    ),
    selection,
    editor,
    el("h3", "Assignments"),
    el(
      "p",
      "Assign an active revision to installation, line, cardType or variant scope. Use priority to resolve same-scope defaults.",
    ),
    assignments,
  );
  selection.addEventListener(
    "change",
    () => {
      const row = registry.documents.find(
        (x) => x.document.id + "@" + x.document.revision === selection.value,
      );
      if (row) {
        editor.value = JSON.stringify(row.document, null, 2);
        invalidate();
      }
    },
    { signal: events.signal },
  );
  for (const e of [editor, assignments])
    e.addEventListener("input", invalidate, { signal: events.signal });
  review.addEventListener(
    "change",
    () => (activate.disabled = !preview || !review.checked),
    { signal: events.signal },
  );
  root.append(
    button("New policy draft", () => {
      editor.value = JSON.stringify(draft(), null, 2);
      invalidate();
      status.textContent = "New draft. Choose a unique policy ID.";
    }),
    button("Create next revision", () => {
      const d = parse();
      d.revision =
        Math.max(
          ...registry.documents
            .filter((r) => r.document.id === d.id)
            .map((r) => r.document.revision),
          d.revision,
        ) + 1;
      editor.value = JSON.stringify(d, null, 2);
      invalidate();
      status.textContent = "New revision prepared.";
    }),
    button("Validate policy document", () => {
      parse();
      status.textContent =
        "Document structure is valid. Impact preview checks assignments and inherited rules.";
    }),
    button("Save policy draft", async () => {
      const d = parse();
      await client.saveCardPolicy({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        document: d,
      });
      invalidate();
      await refresh();
      selection.value = d.id + "@" + d.revision;
    }),
    button("Preview policy impact", async () => {
      const d = parse();
      const saved = registry.documents.find(
        (r) => r.document.id === d.id && r.document.revision === d.revision,
      );
      if (JSON.stringify(saved?.document) !== JSON.stringify(d))
        throw new Error(
          "Save the current document before previewing its activation",
        );
      const previous = registry.documents
        .filter(
          (r) => r.document.id === d.id && r.document.revision < d.revision,
        )
        .sort((a, b) => b.document.revision - a.document.revision)[0]?.document;
      const current = version,
        result = await client.previewCardPolicy({
          expectedRevision: registry.revision,
          policy: d.id + "@" + d.revision,
          assignments: JSON.parse(assignments.value),
        });
      if (disposed || current !== version) return;
      preview = result;
      impact.replaceChildren(
        el(
          "h3",
          result.affected.length +
            " existing card variants need changes for a future revision",
        ),
        el(
          "p",
          "Existing published cards and owned copies retain their recorded content.",
        ),
      );
      const diff = el(
        "pre",
        ["defaults", "fields", "requirements", "inherits"]
          .filter((k) => JSON.stringify(previous?.[k]) !== JSON.stringify(d[k]))
          .map(
            (k) =>
              k +
              "\nBefore: " +
              JSON.stringify(previous?.[k] ?? null) +
              "\nAfter: " +
              JSON.stringify(d[k] ?? null),
          )
          .join("\n\n"),
      );
      impact.append(diff);
      for (const item of result.affected) {
        const details = el("details");
        details.append(el("summary", item.cardId + " · " + item.variantId));
        for (const issue of item.issues)
          details.append(el("p", issue.path + ": " + issue.message));
        impact.append(details);
      }
      status.textContent = "Review the impact before activation.";
    }),
    checkbox,
    activate,
    button("Retire selected revision", async () => {
      const d = parse();
      await client.retireCardPolicy({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        policy: d.id + "@" + d.revision,
        reason: "Retired through policy administration",
      });
      invalidate();
      await refresh();
    }),
    button("Restore retired revision", async () => {
      const d = parse();
      await client.restoreCardPolicy({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        policy: d.id + "@" + d.revision,
      });
      invalidate();
      await refresh();
    }),
    button("Export policy document", () => {
      const d = parse(),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
        ),
        a = el("a");
      a.href = url;
      a.download = d.id + "-" + d.revision + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
    button("Import policy as draft", () => {
      const input = el("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = action(async () => {
        const file = input.files[0];
        if (!file || file.size > 262144)
          throw new Error("Policy import must be below 256 KiB");
        const d = validatePolicy(JSON.parse(await file.text()));
        editor.value = JSON.stringify(d, null, 2);
        invalidate();
        status.textContent =
          "Imported for review. Save the draft before activation.";
      });
      input.click();
    }),
    button("Reload policies", refresh),
    status,
    impact,
    history,
  );
  activate.addEventListener(
    "click",
    action(async () => {
      if (!preview || !review.checked)
        throw new Error("Review the current impact first");
      await client.activateCardPolicy({
        ...preview,
        key: crypto.randomUUID(),
        reason: "Activated after impact review",
      });
      invalidate();
      await refresh();
    }),
    { signal: events.signal },
  );
  const libraryRows = el("div"),
    resourceEditor = el("textarea");
  resourceEditor.rows = 8;
  resourceEditor.setAttribute("aria-label", "Shared library resource document");
  resourceEditor.value = JSON.stringify(
    {
      kind: "template-set",
      document: {
        id: "frames.standard",
        revision: 1,
        name: "Standard frames",
        templates: ["portrait@1"],
        default: "portrait@1",
      },
    },
    null,
    2,
  );
  root.append(
    el("h3", "Shared template sets and resources"),
    el(
      "p",
      "Save templates, masks and styles from the editor, then group approved template revisions into a set. Retired resources retain their content.",
    ),
    resourceEditor,
    button("Save shared resource revision", async () => {
      await client.saveCardResource({
        key: crypto.randomUUID(),
        expectedRevision: registry.revision,
        resource: JSON.parse(resourceEditor.value),
      });
      invalidate();
      await refresh();
    }),
    libraryRows,
  );
  editor.value = JSON.stringify(draft(), null, 2);
  const ready = refresh().catch((e) => (status.textContent = e.message));
  return {
    ready,
    dispose() {
      disposed = true;
      version++;
      events.abort();
      root.replaceChildren();
    },
  };
}
