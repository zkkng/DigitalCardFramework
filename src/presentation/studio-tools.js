import {
  addText,
  configureAuthoring,
  setStat,
  addStatBlock,
  transformSelection,
  createLocalLibrary,
  saveTemplate,
  loadTemplate,
  saveMask,
  applyMask,
  saveTextStyle,
  applyTextStyle,
  previewTemplateMigration,
  applyTemplateMigration,
} from "./authoring-tools.js";
import { exportStatsCSV, importStatsCSV } from "./stats-csv.js";
import {
  flattenNodes,
  validateField,
  valueError,
  inspectCardPolicy,
} from "../card-policy.js";
import {
  textValue,
  inspectFont,
  fontMeasure,
  layoutText,
  fontDiagnostics,
} from "./text.js";
import { importPackage } from "./package.js";

const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
export function mountAuthoringTools({
  toolbar,
  getProject,
  getSide,
  getSelected,
  select,
  rebuild,
  open,
  report,
  library = createLocalLibrary(),
  policyProvider,
  context = {},
  panels = [],
}) {
  let entries = [],
    effective = null,
    clipboard = null,
    disposed = false,
    selection = new Set(),
    generation = 0;
  const root = el("section"),
    status = el("p");
  root.className = "dcs-authoring";
  status.setAttribute("role", "status");
  const pending = new Set();
  let mountedPanels = [];
  const disposePanels = () => {
    for (const panel of mountedPanels) panel.dispose?.();
    mountedPanels = [];
  };
  function run(fn) {
    const task = Promise.resolve()
      .then(fn)
      .catch((e) => report(e.message))
      .finally(() => pending.delete(task));
    pending.add(task);
    return task;
  }
  function button(parent, label, fn) {
    const b = el("button", label);
    b.type = "button";
    b.onclick = () => run(fn);
    parent.append(b);
    return b;
  }
  function input(
    parent,
    label,
    value,
    fn,
    { type = "text", choices, disabled = false } = {},
  ) {
    const wrap = el("label", label),
      e = el(choices ? "select" : type === "textarea" ? "textarea" : "input");
    e.setAttribute("aria-label", label);
    if (choices)
      for (const choice of choices) {
        const o = el("option", choice.name ?? String(choice));
        o.value = choice.id ?? String(choice);
        e.append(o);
      }
    else if (type !== "textarea") e.type = type;
    e.value = String(value ?? "");
    e.disabled = disabled;
    e.onchange = () =>
      run(async () => {
        await fn(e.value);
      });
    wrap.append(e);
    parent.append(wrap);
    return e;
  }
  function edit(fn) {
    const p = getProject();
    if (!p) throw new Error("Open a card first");
    p.edit(fn);
    return rebuild();
  }
  function chosen() {
    return selection.size ? [...selection] : [getSelected()].filter(Boolean);
  }
  async function loadEntries() {
    const n = ++generation;
    const list = await library.list();
    if (!disposed && n === generation) entries = list;
  }
  async function refreshPolicy() {
    const p = getProject();
    if (!p) return;
    if (policyProvider) {
      effective = await policyProvider({
        ...context,
        ...p.manifest.authoring?.context,
      });
      configureAuthoring(p, {
        policy: effective.policy,
        policyRevision: effective.revision,
        context: effective.context ?? {
          ...context,
          ...p.manifest.authoring?.context,
        },
      });
    }
    await rebuild();
  }
  button(toolbar, "Add text", async () => {
    select(
      addText(
        getProject(),
        getSide(),
        effective?.policy.defaults.typography
          ? { typography: effective.policy.defaults.typography }
          : {},
      ),
    );
    await rebuild();
  });
  button(toolbar, "Add custom font", async () => {
    const f = el("input");
    f.type = "file";
    f.accept = ".woff2,.woff,.ttf,.otf";
    f.onchange = () =>
      run(async () => {
        const file = f.files[0];
        if (!file) return;
        const a = await getProject().addFont(file);
        const n = flattenNodes(
          getProject().scenes.get(getProject().manifest.faces[getSide()].scene)
            .nodes,
        ).find((n) => n.id === getSelected());
        if (n?.type === "text")
          getProject().edit(() => {
            n.typography ??= {};
            n.typography.fontAsset = a.id;
          });
        await rebuild();
        report("Font added: " + a.font.family);
      });
    f.click();
  });
  button(toolbar, "Text, stats & templates", async () => {
    root.hidden = !root.hidden;
    if (!root.hidden) {
      await loadEntries();
      render();
    }
  });
  root.hidden = false;
  function render() {
    if (disposed) return;
    disposePanels();
    const p = getProject();
    root.replaceChildren(el("h2", "Text, stats & templates"));
    if (!p) {
      root.append(el("p", "Open a card to edit."));
      return;
    }
    const nodes = flattenNodes(
        p.scenes.get(p.manifest.faces[getSide()].scene).nodes,
      ),
      n = nodes.find((x) => x.id === getSelected());
    const layout = el("details");
    layout.append(el("summary", "Arrange layers"));
    root.append(layout);
    for (const node of nodes) {
      const label = el("label"),
        check = el("input");
      check.type = "checkbox";
      check.setAttribute(
        "aria-label",
        "Select " + (node.name ?? node.id) + " layer",
      );
      check.checked = selection.has(node.id);
      check.onchange = () =>
        check.checked ? selection.add(node.id) : selection.delete(node.id);
      label.append(check, el("span", node.name ?? node.id));
      layout.append(label);
    }
    for (const [label, cmd] of [
      ["Duplicate selected", "duplicate"],
      ["Move forward", "forward"],
      ["Move backward", "backward"],
      ["Group selected", "group"],
      ["Ungroup selected", "ungroup"],
      ["Align left", "left"],
      ["Align right", "right"],
      ["Align top", "top"],
      ["Align bottom", "bottom"],
      ["Center on card", "center"],
      ["Snap to 10-unit grid", "snap"],
      ["Lock selected", "lock"],
      ["Unlock selected", "unlock"],
      ["Delete selected", "delete"],
    ])
      button(layout, label, async () => {
        transformSelection(p, getSide(), chosen(), cmd);
        selection.clear();
        await rebuild();
      });
    if (n?.type === "text") {
      const box = el("fieldset");
      box.append(el("legend", "Typography"));
      root.append(box);
      const disabled = !!n.locked;
      const change = (key, value) =>
        edit(() => {
          if (n.locked) throw new Error("Unlock this layer to edit it");
          n.typography ??= {};
          n.typography[key] = value;
        });
      input(
        box,
        "Text content",
        n.text,
        (v) =>
          edit(() => {
            n.text = v;
            delete n.runs;
          }),
        { type: "textarea", disabled: disabled || !!n.stat },
      );
      input(
        box,
        "Font face",
        n.typography?.fontAsset ?? "",
        (v) =>
          edit(() => {
            n.typography ??= {};
            if (v) n.typography.fontAsset = v;
            else delete n.typography.fontAsset;
          }),
        {
          choices: [
            { id: "", name: "System font" },
            ...p.manifest.assets
              .filter((a) => a.role === "font")
              .map((a) => ({
                id: a.id,
                name: a.font?.family + " · " + (a.font?.face ?? a.id),
              })),
          ],
          disabled,
        },
      );
      input(
        box,
        "System font family",
        n.font ?? "Georgia",
        (v) => edit(() => (n.font = v)),
        { disabled },
      );
      for (const [key, label, defaultValue] of [
        ["size", "Font size", 48],
        ["minSize", "Minimum font size", 8],
        ["weight", "Font weight", 400],
        ["lineHeight", "Line height", 1.2],
        ["letterSpacing", "Letter spacing", 0],
        ["paragraphSpacing", "Paragraph spacing", 0],
        ["outlineWidth", "Outline width", 0],
        ["shadowBlur", "Shadow blur", 0],
        ["shadowX", "Shadow horizontal offset", 0],
        ["shadowY", "Shadow vertical offset", 0],
      ])
        input(
          box,
          label,
          n.typography?.[key] ?? defaultValue,
          (v) => change(key, Number(v)),
          { type: "number", disabled },
        );
      for (const [key, label, choices] of [
        ["style", "Font style", ["normal", "italic", "oblique"]],
        [
          "align",
          "Text alignment",
          ["left", "center", "right", "start", "end"],
        ],
        ["verticalAlign", "Vertical alignment", ["top", "middle", "bottom"]],
        [
          "overflow",
          "Text overflow",
          ["wrap", "shrink", "ellipsis", "clip", "grow"],
        ],
        ["direction", "Text direction", ["auto", "ltr", "rtl"]],
      ])
        input(
          box,
          label,
          n.typography?.[key] ?? choices[0],
          (v) => change(key, v),
          { choices, disabled },
        );
      for (const [key, label, defaultValue] of [
        ["color", "Text color", "#ffffff"],
        ["outlineColor", "Outline color", "#000000"],
        ["shadowColor", "Shadow color", "#000000"],
      ])
        input(
          box,
          label,
          n.typography?.[key] ?? defaultValue,
          (v) => change(key, v),
          { type: "color", disabled },
        );
      input(
        box,
        "Text language",
        n.typography?.language ?? "en",
        (v) => change("language", v),
        { disabled },
      );
      input(
        box,
        "Accessible reading order",
        n.readingOrder ?? 0,
        (v) => edit(() => (n.readingOrder = Number(v))),
        { type: "number", disabled },
      );
      const asset = p.manifest.assets.find(
        (a) => a.id === n.typography?.fontAsset,
      );
      for (const [axis, range] of Object.entries(asset?.font?.axes ?? {}))
        input(
          box,
          range.name + " (" + axis + ")",
          n.typography?.axes?.[axis] ?? range.default,
          (v) => change("axes", { ...n.typography?.axes, [axis]: Number(v) }),
          { type: "number", disabled },
        );
      button(box, "Copy text style", () => {
        clipboard = structuredClone(n.typography ?? {});
        report("Style copied.");
      });
      button(box, "Paste text style", () => {
        if (!clipboard) throw new Error("Copy a style first");
        return edit(() => (n.typography = structuredClone(clipboard)));
      });
      button(box, "Save reusable text style", async () => {
        await saveTextStyle(p, n, library, { name: n.name ?? "Text style" });
        await loadEntries();
        render();
      });
      const rich = el("details");
      rich.append(el("summary", "Styled text spans"));
      box.append(rich);
      input(
        rich,
        "Text spans (JSON)",
        JSON.stringify(n.runs ?? [{ text: n.text }], null, 2),
        (v) => edit(() => (n.runs = JSON.parse(v))),
        { type: "textarea", disabled },
      );
      rich.append(
        el(
          "p",
          "Each span can include text, color, weight, style and an image asset ID as icon.",
        ),
      );
      if (n.stat)
        input(
          box,
          "Stat appearance",
          n.stat.view ?? "text",
          (v) => edit(() => (n.stat.view = v)),
          { choices: ["text", "badge", "bar"], disabled },
        );
    }
    const stats = el("details");
    stats.open = true;
    stats.append(el("summary", "Card stats"));
    root.append(stats);
    const fields = p.manifest.authoring?.fields ?? [];
    if (!fields.length)
      stats.append(
        el("p", "Add a field or load the destination policy to begin."),
      );
    for (const f of fields.filter((f) => (f.scope ?? "card") !== "copy")) {
      const scope = f.scope ?? "card",
        value = p.manifest.authoring?.values?.[scope]?.[f.key],
        disabled =
          (f.source ?? "author") !== "author" || Object.hasOwn(f, "fixed");
      const error =
        value === undefined
          ? f.required
            ? "Required value is missing"
            : null
          : valueError(f, value);
      const choices = f.enum?.map((v) => ({
        id: JSON.stringify(v),
        name: String(v),
      }));
      input(
        stats,
        f.label + (f.required ? " *" : ""),
        choices
          ? JSON.stringify(value)
          : typeof value === "object"
            ? JSON.stringify(value)
            : value,
        (v) => {
          let parsed;
          if (choices) parsed = JSON.parse(v);
          else if (["number", "integer"].includes(f.type))
            parsed = v === "" ? undefined : Number(v);
          else if (f.type === "boolean") parsed = v === "true";
          else if (["object", "array"].includes(f.type)) parsed = JSON.parse(v);
          else parsed = v;
          setStat(p, f.key, parsed, scope);
          return rebuild();
        },
        {
          type: ["integer", "number"].includes(f.type)
            ? "number"
            : ["object", "array"].includes(f.type)
              ? "textarea"
              : "text",
          choices:
            choices ?? (f.type === "boolean" ? ["false", "true"] : undefined),
          disabled,
        },
      );
      if (error) stats.append(el("p", f.label + ": " + error));
      if (!disabled)
        button(stats, "Clear " + f.label, async () => {
          setStat(p, f.key, undefined, scope);
          await rebuild();
        });
      if ((f.visibility ?? "public") === "public")
        button(stats, "Add " + f.label + " to card", async () => {
          const ids = addStatBlock(p, getSide(), [f.key]);
          select(ids[0]);
          await rebuild();
        });
      else
        stats.append(
          el(
            "p",
            "This field is private and cannot be included in public card art.",
          ),
        );
    }
    button(stats, "Add all public stats as a table", async () => {
      addStatBlock(
        p,
        getSide(),
        fields
          .filter(
            (f) =>
              (f.visibility ?? "public") === "public" &&
              (f.scope ?? "card") !== "copy",
          )
          .map((f) => f.key),
        { columns: 2 },
      );
      await rebuild();
    });
    button(stats, "Export stats CSV", () => {
      const url = URL.createObjectURL(
          new Blob([exportStatsCSV(p)], { type: "text/csv" }),
        ),
        a = el("a");
      a.href = url;
      a.download = "card-stats.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    button(stats, "Import stats CSV", () => {
      const file = el("input");
      file.type = "file";
      file.accept = ".csv";
      file.onchange = () =>
        run(async () => {
          const f = file.files[0];
          if (!f || f.size > 262144)
            throw new Error("CSV must be below 256 KiB");
          importStatsCSV(p, await f.text());
          await rebuild();
        });
      file.click();
    });
    const fieldForm = el("details");
    fieldForm.append(el("summary", "Define a custom field"));
    stats.append(fieldForm);
    const draft = {
      key: "custom.value",
      label: "Value",
      type: "integer",
      required: false,
      scope: "card",
      visibility: "public",
      source: "author",
    };
    input(fieldForm, "Field key", draft.key, (v) => (draft.key = v));
    input(fieldForm, "Field label", draft.label, (v) => (draft.label = v));
    input(fieldForm, "Field type", draft.type, (v) => (draft.type = v), {
      choices: ["integer", "number", "string", "boolean", "array", "object"],
    });
    input(
      fieldForm,
      "Field requirement",
      "optional",
      (v) => (draft.required = v === "required"),
      { choices: ["optional", "required"] },
    );
    button(fieldForm, "Create field", async () => {
      validateField(draft);
      await edit(() => {
        p.manifest.authoring ??= { values: { card: {}, variant: {} } };
        p.manifest.authoring.fields ??= [];
        if (p.manifest.authoring.fields.some((f) => f.key === draft.key))
          throw new Error("Field key already exists");
        p.manifest.authoring.fields.push(structuredClone(draft));
      });
    });
    const libraries = el("details");
    libraries.open = true;
    libraries.append(el("summary", "Reusable library"));
    root.append(libraries);
    let libraryName = n?.name ?? p.manifest.title;
    input(
      libraries,
      "Library item name",
      libraryName,
      (v) => (libraryName = v),
    );
    button(libraries, "Save card as template", async () => {
      await saveTemplate(p, library, { name: libraryName });
      await loadEntries();
      render();
    });
    button(libraries, "Save clipping mask", async () => {
      await saveMask(p, getSide(), getSelected(), library, {
        name: libraryName,
        use: "clip",
      });
      await loadEntries();
      render();
    });
    button(libraries, "Save effect mask", async () => {
      await saveMask(p, getSide(), getSelected(), library, {
        name: libraryName,
        use: "effect",
      });
      await loadEntries();
      render();
    });
    if (n)
      button(libraries, "Use rectangle clipping mask", () =>
        edit(
          () =>
            (n.mask = {
              polygon: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            }),
        ),
      );
    let filter = "";
    const list = el("div");
    const paintList = () => {
      list.replaceChildren();
      for (const entry of entries.filter((e) =>
        (e.document.name + " " + (e.document.tags ?? []).join(" "))
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )) {
        const row = el("div");
        row.append(el("strong", entry.document.name + " · " + entry.kind));
        if (entry.kind !== "template-set")
          button(row, "Apply " + entry.document.name, async () => {
            const item = entry.shared
              ? await library.get(entry.key, true)
              : entry;
            if (item.kind === "template") {
              const preview = await previewTemplateMigration(p, item),
                dialog = el("dialog"),
                summary = el(
                  "p",
                  preview.changes.length +
                    " layers will be migrated. Review changes before applying.",
                ),
                details = el(
                  "pre",
                  preview.changes
                    .map((c) => c.face + " / " + c.nodeId + ": " + c.change)
                    .join("\n"),
                );
              dialog.append(summary, details);
              button(dialog, "Apply reviewed template", async () => {
                await applyTemplateMigration(p, preview);
                dialog.close();
                dialog.remove();
                await refreshPolicy();
              });
              button(dialog, "Cancel template update", () => {
                dialog.close();
                dialog.remove();
              });
              root.append(dialog);
              dialog.showModal();
              return;
            }
            if (item.kind === "mask")
              await applyMask(p, getSide(), getSelected(), item);
            if (item.kind === "style")
              await applyTextStyle(p, getSide(), getSelected(), item);
            await rebuild();
          });
        if (!entry.shared && library.share)
          button(row, "Share " + entry.document.name, async () => {
            await library.share(entry);
            await loadEntries();
            render();
            report("Shared library revision saved.");
          });
        button(row, "Export " + entry.document.name, async () => {
          const item = entry.shared
            ? await library.get(entry.key, true)
            : entry;
          const raw = {
            ...item,
            archive: item.archive ? Array.from(item.archive) : undefined,
          };
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(raw)], { type: "application/json" }),
          );
          const a = el("a");
          a.href = url;
          a.download = entry.key + ".dclibrary.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        list.append(row);
      }
    };
    input(libraries, "Search library", "", (v) => {
      filter = v;
      paintList();
    });
    libraries.append(list);
    paintList();
    button(libraries, "Import library item", () => {
      const file = el("input");
      file.type = "file";
      file.accept = ".json";
      file.onchange = () =>
        run(async () => {
          const f = file.files[0];
          if (!f || f.size > 32 * 1024 * 1024)
            throw new Error("Library import must be below 32 MiB");
          const value = JSON.parse(await f.text());
          if (value.archive) {
            value.archive = new Uint8Array(value.archive);
            await importPackage(value.archive);
          }
          if (
            !["mask", "template", "style"].includes(value.kind) ||
            typeof value.key !== "string" ||
            !value.document?.name
          )
            throw new Error("Invalid library item");
          await library.put(value);
          await loadEntries();
          render();
        });
      file.click();
    });
    const rules = el("details");
    rules.append(el("summary", "Card policy"));
    root.append(rules);
    if (policyProvider)
      button(rules, "Refresh destination policy", refreshPolicy);
    if (effective) {
      if (effective.policy.defaults.template)
        rules.append(
          el("p", "Default template: " + effective.policy.defaults.template),
        );
      rules.append(
        el(
          "p",
          "Policy revision " +
            effective.revision +
            " · " +
            effective.policy.references.join(", "),
        ),
      );
      const issues = inspectCardPolicy(effective.policy, {
        card: { ...context, stats: p.manifest.authoring?.values?.card ?? {} },
        variant: { stats: p.manifest.authoring?.values?.variant ?? {} },
        presentation: { manifest: p.manifest, scenes: p.scenes },
        templates:
          effective.resources
            ?.filter((r) => r.kind === "template")
            .map((r) => r.document) ?? [],
      });
      for (const issue of issues) {
        const b = button(rules, issue.path + ": " + issue.message, () => {
          select(issue.path.split(".")[0]);
          return rebuild();
        });
        b.className = "dcs-issue";
      }
    } else
      rules.append(
        el(
          "p",
          "No destination policy loaded. Server validation is required before publication.",
        ),
      );
    const diagnostics = el("div");
    root.append(diagnostics, status);
    for (const node of nodes.filter((n) => n.type === "text")) {
      const asset = p.manifest.assets.find(
        (a) => a.id === node.typography?.fontAsset,
      );
      if (!asset) continue;
      try {
        const { font } = inspectFont(p.assets.get(asset.path), asset.mediaType),
          text = textValue(node, p.manifest),
          layout = layoutText(node, text, fontMeasure(font, node));
        for (const d of fontDiagnostics(font, node, text))
          diagnostics.append(el("p", d.message));
        if (layout.overflow)
          diagnostics.append(
            el("p", (node.name ?? node.id) + ": text overflows its box."),
          );
      } catch (e) {
        diagnostics.append(el("p", e.message));
      }
    }
    for (const panel of panels) {
      const contribution = panel({
        project: p,
        selected: n,
        side: getSide(),
        edit,
        rebuild,
      });
      if (contribution instanceof HTMLElement) root.append(contribution);
      else if (contribution?.element instanceof HTMLElement) {
        mountedPanels.push(contribution);
        root.append(contribution.element);
      }
    }
  }
  const ready = loadEntries()
    .then(() => render())
    .catch((e) => report("Personal library: " + e.message));
  return {
    root,
    ready,
    render,
    refreshPolicy,
    async validate() {
      await Promise.all(pending);
      return effective;
    },
    dispose() {
      disposed = true;
      generation++;
      disposePanels();
      root.remove();
    },
  };
}
