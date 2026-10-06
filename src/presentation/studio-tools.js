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
  schedule,
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
  let taskTail = Promise.resolve();
  let fontsExpanded = false;
  const fontSamples = new Map();
  const expandedSpans = new Set();
  const expandedMasks = new Set();
  let mountedPanels = [];
  const disposePanels = () => {
    for (const panel of mountedPanels) panel.dispose?.();
    mountedPanels = [];
  };
  function run(fn) {
    const enqueue = schedule ?? (work => (taskTail = taskTail.catch(()=>{}).then(work)));
    const task = enqueue(() => disposed ? undefined : fn())
      .catch((e) => { if (!disposed) report(e.message); })
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
  async function edit(fn) {
    if (disposed) return;
    const p = getProject();
    if (!p) throw new Error("Open a card first");
    try {
      p.edit(fn);
    } catch (error) {
      await rebuild();
      throw error;
    }
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
        const project = getProject(), face = getSide(), selected = getSelected(), dialog = el("dialog");
        dialog.append(el("h3", "Embed custom font"), el("p", file.name + " · " + file.size + " bytes"),
          el("p", "Record the permitted usage terms or license identifier supplied with this font. The editor stores this declaration; it does not verify rights."));
        let license = "";
        const terms = input(dialog, "Font usage terms", "", (v)=>{
          license = v.trim();
          save.disabled = !license;
        }, {type:"textarea"});
        terms.maxLength = 2000;
        const save = button(dialog, "Embed font with declared terms", async()=>{
          if (!license || license.length > 2000) throw new Error("Enter font usage terms within 2000 characters");
          if (getProject() !== project) throw new Error("The card changed during font upload");
          const asset = await project.addFont(file,{license});
          if (disposed || getProject() !== project) return;
          const node = flattenNodes(project.scenes.get(project.manifest.faces[face].scene).nodes).find(n=>n.id===selected);
          if (node?.type === "text" && !node.locked) project.edit(()=>{
            node.typography ??= {};
            node.typography.fontAsset = asset.id;
          });
          dialog.close(); dialog.remove();
          await rebuild();
          report("Font added: " + asset.font.family + (node?.locked ? " · Locked layer kept its existing font." : ""));
        });
        save.disabled = true;
        button(dialog, "Cancel font upload", ()=>{dialog.close();dialog.remove();});
        root.append(dialog);
        dialog.showModal();
        terms.focus();
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
    const fontCache = new Map();
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
      const editText = (fn) => edit(() => {
        if (n.locked) throw new Error("Unlock this layer to edit it");
        fn();
      });
      const change = (key, value) =>
        editText(() => {
          n.typography ??= {};
          n.typography[key] = value;
        });
      input(
        box,
        "Text content",
        n.runs?.map(span=>span.text).join("") ?? n.text,
        (v) =>
          editText(() => {
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
          editText(() => {
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
        (v) => editText(() => (n.font = v)),
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
        (v) => editText(() => (n.readingOrder = Number(v))),
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
        return editText(() => (n.typography = structuredClone(clipboard)));
      });
      button(box, "Save reusable text style", async () => {
        await saveTextStyle(p, n, library, { name: n.name ?? "Text style" });
        await loadEntries();
        render();
      });
      const rich = el("details");
      rich.append(el("summary", "Styled text spans"));
      const spanPanelKey = getSide() + ":" + n.id;
      rich.open = expandedSpans.has(spanPanelKey);
      rich.ontoggle = () => rich.open ? expandedSpans.add(spanPanelKey) : expandedSpans.delete(spanPanelKey);
      box.append(rich);
      if (n.stat) {
        rich.append(el("p", "Bound text comes from its stat field. Use the stat formatting controls to change its display."));
      } else {
        const spans = n.runs ?? [{ text: n.text ?? "" }],
          changeSpan = (index, key, value) => editText(() => {
            n.runs ??= [{ text: n.text ?? "" }];
            if (value === undefined) delete n.runs[index][key];
            else n.runs[index][key] = value;
          });
        rich.append(el("p", "Spans contain plain text and optional overrides. Inherited properties follow the layer's typography. Image icons use embedded card assets."));
        for (const [index, span] of spans.entries()) {
          const row = el("fieldset"), number = index + 1;
          row.append(el("legend", "Span " + number));
          rich.append(row);
          input(row, "Span " + number + " text", span.text, v=>changeSpan(index, "text", v), { type: "textarea", disabled });
          input(row, "Span " + number + " weight", span.weight ?? "", v=>changeSpan(index, "weight", v === "" ? undefined : Number(v)), { type: "number", disabled });
          input(row, "Span " + number + " style", span.style ?? "", v=>changeSpan(index, "style", v || undefined), {
            choices: [{id:"",name:"Inherit style"}, "normal", "italic", "oblique"], disabled,
          });
          input(row, "Span " + number + " color", span.color ?? n.typography?.color ?? n.color ?? "#ffffff",
            v=>changeSpan(index, "color", v), { type: "color", disabled });
          input(row, "Span " + number + " icon", span.icon ?? "", v=>changeSpan(index, "icon", v || undefined), {
            choices: [{id:"",name:"No icon"}, ...p.manifest.assets.filter(a=>a.mediaType.startsWith("image/")).map(a=>({id:a.id,name:a.id}))], disabled,
          });
          button(row, "Reset span " + number + " formatting", () => editText(() => {
            n.runs ??= [{ text: n.text ?? "" }];
            for (const key of ["weight", "style", "color"]) delete n.runs[index][key];
          })).disabled = disabled;
          for (const [label, offset] of [["Move span " + number + " earlier", -1], ["Move span " + number + " later", 1]]) {
            button(row, label, () => editText(() => {
              n.runs ??= [{ text: n.text ?? "" }];
              const other = index + offset;
              [n.runs[index], n.runs[other]] = [n.runs[other], n.runs[index]];
            })).disabled = disabled || index + offset < 0 || index + offset >= spans.length;
          }
          button(row, "Remove span " + number, () => editText(() => {
            n.runs ??= [{ text: n.text ?? "" }];
            n.runs.splice(index, 1);
            if (!n.runs.length) { n.text = ""; delete n.runs; }
          })).disabled = disabled;
        }
        button(rich, "Add text span", () => editText(() => {
          n.runs ??= [{ text: n.text ?? "" }];
          if (n.runs.length >= 128) throw new Error("A text layer supports at most 128 spans");
          n.runs.push({ text: "" });
        })).disabled = disabled || spans.length >= 128;
        button(rich, "Convert spans to plain text", () => editText(() => {
          n.text = (n.runs ?? [{text:n.text ?? ""}]).map(span=>span.text).join("");
          delete n.runs;
        })).disabled = disabled || !n.runs;
        const advanced = el("details");
        advanced.append(el("summary", "Advanced span JSON"));
        rich.append(advanced);
        input(
        advanced,
        "Text spans (JSON)",
        JSON.stringify(n.runs ?? [{ text: n.text }], null, 2),
        (v) => editText(() => (n.runs = JSON.parse(v))),
        { type: "textarea", disabled },
      );
      rich.append(
        el(
          "p",
          "Each span can include text, color, weight, style and an image asset ID as icon.",
        ),
      );
      }
      if (n.stat) {
        input(
          box,
          "Stat appearance",
          n.stat.view ?? "text",
          (v) => editText(() => (n.stat.view = v)),
          { choices: ["text", "badge", "bar"], disabled },
        );
        const publicFields = (p.manifest.authoring?.fields ?? []).filter(
          (f) => (f.visibility ?? "public") === "public" && (f.scope ?? "card") !== "copy",
        );
        input(box, "Bound field", JSON.stringify([n.stat.scope ?? "card", n.stat.key]), (v) => {
          const [scope, key] = JSON.parse(v),
            field = publicFields.find((f) => f.key === key && (f.scope ?? "card") === scope);
          if (!field) throw new Error("Choose a public snapshot field");
          return editText(() => {
            n.stat.key = key;
            n.stat.scope = scope;
          });
        }, {
          choices: publicFields.map((f) => ({ id: JSON.stringify([f.scope ?? "card", f.key]), name: f.label + " · " + (f.scope ?? "card") + " / " + f.key })),
          disabled,
        });
        for (const [key, label, fallback] of [
          ["label", "Stat label", ""],
          ["unit", "Stat unit", ""],
          ["missing", "Missing stat text", "—"],
          ["locale", "Stat number locale", "en"],
          ["precision", "Stat decimal places", 8],
          ...(n.stat.view === "bar" ? [["minimum", "Bar minimum", 0], ["maximum", "Bar maximum", 100]] : []),
        ]) input(box, label, n.stat[key] ?? fallback, (v) => editText(() => {
          n.stat[key] = typeof fallback === "number" ? Number(v) : v;
        }), { type: typeof fallback === "number" ? "number" : "text", disabled });
      }
    }
    const fonts = el("details");
    fonts.append(el("summary", "Embedded font assets"));
    fonts.open = fontsExpanded;
    fonts.ontoggle = ()=>{fontsExpanded=fonts.open;};
    root.append(fonts);
    const fontAssets = p.manifest.assets.filter(asset=>asset.role === "font");
    if (!fontAssets.length) fonts.append(el("p", "Add custom font to embed a reproducible face."));
    for (const asset of fontAssets) {
      const row = el("fieldset");
      row.append(el("legend", asset.font.family + " · " + asset.font.face));
      fonts.append(row);
      row.append(el("p", "Asset: " + asset.id + " · Digest: sha256:" + asset.sha256));
      input(row, "Usage terms for " + asset.id, asset.font.license, (v)=>edit(()=>{
        const current = getProject().manifest.assets.find(a=>a.id===asset.id);
        if (!v.trim() || v.length > 2000) throw new Error("Enter font usage terms within 2000 characters");
        current.font.license = v.trim();
      }), {type:"textarea"}).maxLength = 2000;
      try {
        const {font,info} = inspectFont(p.assets.get(asset.path),asset.mediaType);
        fontCache.set(asset.id,font);
        row.append(el("p", "Decoded family: " + info.family + " · Face: " + info.face + " · Style: " + info.style +
          " · Weight: " + (info.weight ?? "unavailable") + " · Italic angle: " + info.italicAngle));
        row.append(el("p", "Glyphs: " + info.glyphs + " · Character-map entries: " + info.codepoints.length + " · Units per em: " + info.unitsPerEm));
        const axes = Object.entries(info.axes);
        row.append(el("p", axes.length ? "Variable axes: " + axes.map(([key,range])=>key+" ("+range.name+"): "+range.min+"–"+range.max+", default "+range.default).join("; ") : "Variable axes: none"));
        let sample = fontSamples.get(asset.sha256) ?? (n?.type === "text" ? textValue(n,p.manifest) : p.manifest.title);
        const updateCoverage = (v)=>{
          sample = v;
          fontSamples.set(asset.sha256,sample);
          const missing = [...new Set(Array.from(sample).filter(character=>!/[\r\n]/.test(character) && !font.hasGlyphForCodePoint(character.codePointAt(0))))];
          coverage.textContent = missing.length ? "Missing code points: " + missing.slice(0,32).map(character=>"U+"+character.codePointAt(0).toString(16).toUpperCase()).join(", ") + (missing.length>32?" …":"") : "All sample code points are mapped. This does not prove shaping quality.";
        };
        input(row, "Glyph coverage sample for " + asset.id, sample, updateCoverage).maxLength = 10000;
        const coverage = el("p");
        coverage.setAttribute("role","status");
        row.append(coverage);
        updateCoverage(sample);
      } catch (error) {
        row.append(el("p", "Font diagnostic: " + error.message));
      }
    }
    const stats = el("details");
    stats.open = true;
    stats.append(el("summary", "Card stats"));
    root.append(stats);
    const fields = p.manifest.authoring?.fields ?? [];
    const fieldControls = new Map();
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
      const control = input(
        stats,
        f.label + (f.required ? " *" : ""),
        choices
          ? JSON.stringify(value)
          : typeof value === "object"
            ? JSON.stringify(value)
            : value,
        (v) => {
          let parsed;
          if ((choices || f.type === "boolean") && v === "") parsed = undefined;
          else if (choices || f.type === "boolean") parsed = JSON.parse(v);
          else if (["number", "integer"].includes(f.type))
            parsed = v === "" ? undefined : Number(v);
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
            choices || f.type === "boolean"
              ? [{ id: "", name: "No value" },
                  ...(f.nullable && !f.enum?.includes(null) ? [{ id: "null", name: "Null" }] : []),
                  ...(choices ?? ["false", "true"])]
              : undefined,
          disabled,
        },
      );
      fieldControls.set(scope + ".stats." + f.key, control);
      const help = el("p", "Scope: " + scope + " · Source: " + (f.source ?? "author") +
        " · Visibility: " + (f.visibility ?? "public") +
        (f.unit ? " · Unit: " + f.unit : "") + (f.description ? " · " + f.description : "") +
        (["integer", "number"].includes(f.type) ? " · Range: " + (f.minimum ?? -1e12) + " to " + (f.maximum ?? 1e12) : "") +
        (f.precision !== undefined ? " · Decimal places: " + f.precision : "") +
        (f.type === "string" ? " · Text length: " + (f.minLength ?? 0) + " to " + (f.maxLength ?? 10000) : "") +
        (f.type === "array" ? " · List items: " + (f.minItems ?? 0) + " to " + (f.maxItems ?? 256) : ""));
      help.id = "dcs-field-help-" + crypto.randomUUID();
      control.setAttribute("aria-describedby", help.id);
      stats.append(help);
      if (["integer", "number"].includes(f.type)) {
        control.step = f.type === "integer" ? "1" : f.precision === undefined ? "any" : String(10 ** -f.precision);
        if (f.minimum !== undefined) control.min = String(f.minimum);
        if (f.maximum !== undefined) control.max = String(f.maximum);
      }
      if (error) {
        const message = el("p", f.label + ": " + error);
        message.id = "dcs-field-error-" + crypto.randomUUID();
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", help.id + " " + message.id);
        stats.append(message);
      }
      if (value === null) stats.append(el("p", f.label + ": null"));
      if (!disabled && f.nullable)
        button(stats, "Set " + f.label + " to null", async () => {
          setStat(p, f.key, null, scope);
          await rebuild();
        });
      if (!disabled)
        button(stats, "Clear " + f.label, async () => {
          setStat(p, f.key, undefined, scope);
          await rebuild();
        });
      if ((f.visibility ?? "public") === "public")
        button(stats, "Add " + f.label + " to card", async () => {
          const ids = addStatBlock(p, getSide(), [{ key: f.key, scope }]);
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
          .map((f) => ({ key: f.key, scope: f.scope ?? "card" })),
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
    input(fieldForm, "Field help", "", (v) => {
      if (v) draft.description = v;
      else delete draft.description;
    }, { type: "textarea" });
    input(fieldForm, "Field unit", "", (v) => {
      if (v) draft.unit = v;
      else delete draft.unit;
    });
    input(fieldForm, "Field scope", draft.scope, (v) => (draft.scope = v), { choices: ["card", "variant"] });
    input(fieldForm, "Field visibility", draft.visibility, (v) => (draft.visibility = v), { choices: ["public", "owner", "operator"] });
    input(fieldForm, "Field type", draft.type, (v) => {
      draft.type = v;
      for (const key of ["minimum", "maximum", "precision", "minLength", "maxLength", "minItems", "maxItems", "enum"]) delete draft[key];
      paintConstraints();
      paintChoices();
    }, {
      choices: ["integer", "number", "string", "boolean", "array", "object"],
    });
    input(
      fieldForm,
      "Field requirement",
      "optional",
      (v) => (draft.required = v === "required"),
      { choices: ["optional", "required"] },
    );
    input(fieldForm, "Allow null", "no", (v) => (draft.nullable = v === "yes"), { choices: ["no", "yes"] });
    const constraints = el("fieldset"), enumForm = el("fieldset");
    fieldForm.append(constraints, enumForm);
    function paintConstraints() {
      constraints.replaceChildren(el("legend", "Value bounds"));
      const bounds = ["integer", "number"].includes(draft.type)
        ? [["minimum", "Field minimum"], ["maximum", "Field maximum"], ...(draft.type === "number" ? [["precision", "Field decimal places"]] : [])]
        : draft.type === "string" ? [["minLength", "Minimum text length"], ["maxLength", "Maximum text length"]]
        : draft.type === "array" ? [["minItems", "Minimum list items"], ["maxItems", "Maximum list items"]] : [];
      if (!bounds.length) constraints.append(el("p", "This type has no size or numeric bounds in this form."));
      for (const [key, label] of bounds) input(constraints, label, draft[key] ?? "", (v) => {
        if (v === "") delete draft[key];
        else draft[key] = Number(v);
      }, { type: "number" });
      constraints.append(el("p", "Blank bounds use the field contract defaults. List item and nested object schemas require a policy or API definition."));
    }
    function paintChoices() {
      enumForm.replaceChildren(el("legend", "Allowed choices"));
      if (["array", "object"].includes(draft.type)) {
        enumForm.append(el("p", "Structured enumeration values require a policy or API definition."));
        return;
      }
      enumForm.append(el("p", "No choices means any value allowed by the bounds. Changing type resets choices and bounds."));
      for (const [index, value] of (draft.enum ?? []).entries()) {
        input(enumForm, "Allowed choice " + (index + 1), value, (v) => {
          draft.enum[index] = draft.type === "boolean" ? v === "true" : ["integer", "number"].includes(draft.type) ? Number(v) : v;
        }, { type: ["integer", "number"].includes(draft.type) ? "number" : "text", choices: draft.type === "boolean" ? ["false", "true"] : undefined });
        button(enumForm, "Remove allowed choice " + (index + 1), () => {
          draft.enum.splice(index, 1);
          if (!draft.enum.length) delete draft.enum;
          paintChoices();
        });
      }
      button(enumForm, "Add allowed choice", () => {
        draft.enum ??= [];
        if (draft.enum.length >= 128) throw new Error("A field supports at most 128 choices");
        draft.enum.push(draft.type === "boolean" ? false : ["integer", "number"].includes(draft.type) ? 0 : "");
        paintChoices();
      }).disabled = (draft.enum?.length ?? 0) >= 128;
    }
    paintConstraints();
    paintChoices();
    button(fieldForm, "Create field", async () => {
      validateField(draft);
      await edit(() => {
        p.manifest.authoring ??= { values: { card: {}, variant: {} } };
        p.manifest.authoring.fields ??= [];
        if (p.manifest.authoring.fields.some((f) => f.key === draft.key && (f.scope ?? "card") === draft.scope))
          throw new Error("Field key already exists in this scope");
        p.manifest.authoring.fields.push(structuredClone(draft));
      });
    });
    if (n && n.type !== "group") {
      const maskSide = getSide(), panelKey = maskSide + ":" + n.id,
        masks = el("details"), disabled = !!n.locked,
        editMask = (fn) => edit(() => {
          const project = getProject(), target = flattenNodes(project.scenes.get(project.manifest.faces[maskSide].scene).nodes).find(node=>node.id===n.id);
          if (!target || target.locked) throw new Error("Choose an unlocked layer to edit its mask");
          fn(target);
          if (target.mask?.rect || target.mask?.transform || target.material?.mask) {
            if (!project.manifest.capabilities.required.includes("dc.mask-layout@0.2")) project.manifest.capabilities.required.push("dc.mask-layout@0.2");
          }
          if (project.manifest.authoring?.masks) delete project.manifest.authoring.masks[panelKey];
        });
      masks.append(el("summary", "Clipping mask properties"));
      masks.open = expandedMasks.has(panelKey);
      masks.ontoggle = () => masks.open ? expandedMasks.add(panelKey) : expandedMasks.delete(panelKey);
      root.append(masks);
      masks.append(el("p", "Clipping masks limit artwork and text. Polygon coordinates run from 0 to 1 within the layer and follow its transforms. Image masks use alpha coverage. Editing creates a local mask and clears its library reference; saved versions remain unchanged."));
      input(masks, "Clipping mask source", n.mask?.asset ? "image:" + n.mask.asset : n.mask?.polygon ? "polygon" : "none", (v)=>editMask(target=>{
        if (v === "none") delete target.mask;
        else target.mask = v === "polygon" ? {polygon:[[0,0],[1,0],[1,1],[0,1]]} : {asset:v.slice(6)};
      }), { choices: [{id:"none",name:"No clipping mask"}, {id:"polygon",name:"Polygon"},
        ...p.manifest.assets.filter(asset=>asset.mediaType.startsWith("image/")).map(asset=>({id:"image:"+asset.id,name:"Image alpha: "+asset.id}))], disabled });
      if (n.mask) {
        input(masks, "Invert clipping mask", n.mask.invert ? "yes" : "no", (v)=>editMask(target=>{target.mask.invert = v === "yes";}), {choices:["no","yes"],disabled});
        button(masks, "Remove clipping mask", ()=>editMask(target=>{delete target.mask;})).disabled = disabled;
      }
      const layoutControls = (container, mask, use) => {
        if (!mask) return;
        const label = use === "clip" ? "Clipping" : "Effect",
          update = fn => editMask(target => {
            if (use === "effect" && !target.material.mask) {
              target.material.mask = {asset:target.material.maskAsset};
              delete target.material.maskAsset;
            }
            fn(use === "clip" ? target.mask : target.material.mask);
          });
        container.append(el("p", "Mask translations and pivots use layer fractions; rotation uses degrees and preserves the layer's pixel aspect ratio. Negative scales mirror coverage."));
        for (const [key, fallback] of [["x",0],["y",0],["scaleX",1],["scaleY",1],["rotation",0],["pivotX",0.5],["pivotY",0.5]]) {
          const control = input(container,label + " mask " + key,mask.transform?.[key] ?? fallback,v=>update(current=>{
            current.transform ??= {}; current.transform[key] = Number(v);
          }),{type:"number",disabled});
          control.min = key === "rotation" ? "-360000" : "-100";
          control.max = key === "rotation" ? "360000" : "100"; control.step = "any";
        }
        button(container,"Reset " + label.toLowerCase() + " mask transform",()=>update(current=>{delete current.transform;})).disabled = disabled;
        if (mask.asset) {
          const asset = p.manifest.assets.find(a=>a.id===mask.asset), crop = mask.rect ?? [0,0,asset.width,asset.height];
          for (const [index,key] of ["x","y","width","height"].entries()) {
            const control = input(container,label + " mask crop " + key,crop[index],v=>update(current=>{
              current.rect ??= [...crop]; current.rect[index] = Number(v);
            }),{type:"number",disabled});
            control.min = index < 2 ? "0" : "0.001"; control.max = String(index%2 ? asset.height : asset.width); control.step = "any";
          }
          button(container,"Reset " + label.toLowerCase() + " mask crop",()=>update(current=>{delete current.rect;})).disabled = disabled;
        }
      };
      layoutControls(masks,n.mask,"clip");
      if (n.material) {
        const effects = el("fieldset"), effectMask = n.material.mask ?? (n.material.maskAsset ? {asset:n.material.maskAsset} : undefined);
        effects.append(el("legend","Effect mask properties")); masks.append(effects);
        input(effects,"Effect mask source",effectMask?.asset ? "image:"+effectMask.asset : effectMask?.polygon ? "polygon" : "none",v=>editMask(target=>{
          delete target.material.maskAsset;
          if (v === "none") delete target.material.mask;
          else target.material.mask = v === "polygon" ? {polygon:[[0,0],[1,0],[1,1],[0,1]]} : {asset:v.slice(6)};
        }),{choices:[{id:"none",name:"No effect mask"},{id:"polygon",name:"Polygon"},...p.manifest.assets.filter(a=>a.mediaType.startsWith("image/")).map(a=>({id:"image:"+a.id,name:"Image alpha: "+a.id}))],disabled});
        if (effectMask) {
          input(effects,"Invert effect mask",effectMask.invert ? "yes" : "no",v=>editMask(target=>{
            target.material.mask ??= {asset:target.material.maskAsset}; delete target.material.maskAsset;
            target.material.mask.invert = v === "yes";
          }),{choices:["no","yes"],disabled});
          layoutControls(effects,effectMask,"effect");
          for (const [index,point] of (effectMask.polygon ?? []).entries()) {
            const row=el("fieldset");row.append(el("legend","Effect mask vertex "+(index+1)));effects.append(row);
            for (const [component,axis] of ["x","y"].entries()) {
              const control=input(row,"Effect mask vertex "+(index+1)+" "+axis,point[component],v=>editMask(target=>{target.material.mask.polygon[index][component]=Number(v);}),{type:"number",disabled});
              control.min="0";control.max="1";control.step="any";
            }
            button(row,"Insert effect mask vertex after "+(index+1),()=>editMask(target=>{
              const points=target.material.mask.polygon;
              if(points.length>=64)throw new Error("A mask supports at most 64 vertices");
              const next=points[(index+1)%points.length];points.splice(index+1,0,[(point[0]+next[0])/2,(point[1]+next[1])/2]);
            })).disabled=disabled || effectMask.polygon.length>=64;
            button(row,"Remove effect mask vertex "+(index+1),()=>editMask(target=>{
              if(target.material.mask.polygon.length<=3)throw new Error("A mask needs at least 3 vertices");
              target.material.mask.polygon.splice(index,1);
            })).disabled=disabled || effectMask.polygon.length<=3;
          }
        }
      }
      if (n.mask?.polygon) {
        masks.append(el("p", "A polygon has 3 to 64 vertices. Add inserts a midpoint after the selected vertex; remove preserves the minimum vertex count."));
        for (const [index, point] of n.mask.polygon.entries()) {
          const row = el("fieldset");
          row.append(el("legend", "Mask vertex " + (index+1)));
          masks.append(row);
          for (const [axis, component] of [["x",0],["y",1]]) {
            const control = input(row, "Mask vertex " + (index+1) + " " + axis, point[component], v=>editMask(target=>{
              target.mask.polygon[index][component] = Number(v);
            }), {type:"number",disabled});
            control.min = "0"; control.max = "1"; control.step = "any";
          }
          button(row, "Insert mask vertex after " + (index+1), ()=>editMask(target=>{
            const points = target.mask.polygon;
            if (points.length >= 64) throw new Error("A mask supports at most 64 vertices");
            const current = points[index], next = points[(index+1)%points.length];
            points.splice(index+1,0,[(current[0]+next[0])/2,(current[1]+next[1])/2]);
          })).disabled = disabled || n.mask.polygon.length >= 64;
          button(row, "Remove mask vertex " + (index+1), ()=>editMask(target=>{
            if (target.mask.polygon.length <= 3) throw new Error("A mask needs at least 3 vertices");
            target.mask.polygon.splice(index,1);
          })).disabled = disabled || n.mask.polygon.length <= 3;
        }
      }
      button(masks, "Upload clipping mask image", ()=>{
        const file = el("input");
        file.type = "file"; file.accept = ".png,.jpg,.jpeg,.webp";
        file.onchange = ()=>run(async()=>{
          const source = file.files[0];
          if (!source) return;
          if (n.locked) throw new Error("Choose an unlocked layer to edit its mask");
          const project = getProject(), asset = await project.addImage(source,{role:"mask"});
          if (getProject() !== project) throw new Error("The card changed during mask upload");
          await editMask(target=>{target.mask={asset:asset.id};});
        });
        file.click();
      }).disabled = disabled;
    }
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
        edit(() => {
          if (n.locked) throw new Error("Choose an unlocked layer to edit its mask");
          n.mask = {
              polygon: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            };
          if (p.manifest.authoring?.masks) delete p.manifest.authoring.masks[getSide()+":"+n.id];
        }),
      ).disabled = !!n.locked || n.type === "group";
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
    const layouts = {}, textDiagnostics = [];
    for (const [face, definition] of Object.entries(p.manifest.faces)) {
      for (const node of flattenNodes(p.scenes.get(definition.scene).nodes).filter(n=>n.type === "text")) {
        const asset = p.manifest.assets.find(a=>a.id === node.typography?.fontAsset);
        if (!asset) continue;
        try {
          if (!fontCache.has(asset.id)) fontCache.set(asset.id, inspectFont(p.assets.get(asset.path), asset.mediaType).font);
          const font = fontCache.get(asset.id), text = textValue(node, p.manifest),
            layout = layoutText(node, text, fontMeasure(font, node));
          layouts[face + ":" + node.id] = { ...layout, nodeId: node.id, face };
          for (const issue of fontDiagnostics(font, node, text)) textDiagnostics.push({ face, node, message: issue.message });
          if (layout.overflow) textDiagnostics.push({ face, node, message: "Text overflows its box." });
        } catch (error) {
          textDiagnostics.push({ face, node, message: error.message });
        }
      }
    }
    const focusField = (control) => {
      stats.open = true;
      const target = control.disabled ? control.parentElement : control;
      if (control.disabled) target.tabIndex = -1;
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    };
    const navigateIssue = async (issue) => {
      const control = fieldControls.get(issue.path);
      if (control) return focusField(control);
      const faces = [...new Set([issue.face, getSide(), ...Object.keys(p.manifest.faces)].filter(Boolean))];
      const candidates = faces.flatMap(face => flattenNodes(p.scenes.get(p.manifest.faces[face].scene).nodes).map(node=>({ face, node })));
      const exact = candidates.filter(({node})=>issue.path === node.id);
      const matches = exact.length ? exact : candidates.filter(({node})=>issue.path.startsWith(node.id + "."))
        .sort((a,b)=>b.node.id.length-a.node.id.length);
      const chosen = issue.face ? matches.find(candidate=>candidate.face===issue.face) : matches[0];
      const navigate = async ({ node, face }) => {
        select(node.id, face);
        await rebuild();
        root.querySelector("fieldset input:not(:disabled), fieldset textarea:not(:disabled), fieldset select:not(:disabled)")?.focus();
      };
      if (!issue.face && chosen && matches.filter(candidate=>candidate.node.id===chosen.node.id).length > 1) {
        const dialog = el("dialog");
        dialog.append(el("p", "This layer ID is used on multiple faces. Choose the layer to inspect."));
        for (const candidate of matches.filter(candidate=>candidate.node.id===chosen.node.id))
          button(dialog, "Inspect " + candidate.face + " / " + (candidate.node.name ?? candidate.node.id), async () => {
            dialog.close();
            dialog.remove();
            await navigate(candidate);
          });
        button(dialog, "Cancel layer selection", () => { dialog.close(); dialog.remove(); });
        root.append(dialog);
        dialog.showModal();
        return;
      }
      if (chosen) return navigate(chosen);
      report(issue.message + " · Rule: " + (issue.rule ?? issue.code));
    };
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
        presentation: { manifest: p.manifest, scenes: p.scenes, layouts },
        templates:
          effective.resources
            ?.filter((r) => r.kind === "template")
            .map((r) => r.document) ?? [],
      });
      const projected = issues.flatMap(issue => issue.code === "TEXT_OVERFLOW"
        ? Object.values(layouts).filter(layout=>layout.nodeId===issue.path && layout.overflow).map(layout=>({ ...issue, face: layout.face }))
        : [issue]);
      const shown = new Set();
      for (const issue of projected) {
        const key = JSON.stringify([issue.code, issue.path, issue.rule, issue.face]);
        if (shown.has(key)) continue;
        shown.add(key);
        const b = button(rules, (issue.face ? issue.face + " / " : "") + issue.path + ": " + issue.message, () => navigateIssue(issue));
        b.className = "dcs-issue";
        rules.append(el("p", "Rule: " + issue.rule + " · Policies: " + issue.policies.join(", ")));
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
    for (const diagnostic of textDiagnostics)
      button(diagnostics, diagnostic.face + " / " + (diagnostic.node.name ?? diagnostic.node.id) + ": " + diagnostic.message,
        () => navigateIssue({ path: diagnostic.node.id, ...diagnostic }));
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
