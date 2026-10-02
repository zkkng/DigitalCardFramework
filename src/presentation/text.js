import { ensure } from "./data.js";
import { openFont } from "./font-engine.js";

export const FONT_TYPES = ["font/woff2", "font/woff", "font/ttf", "font/otf"];
export function fontHeader(bytes, type) {
  ensure(
    bytes instanceof Uint8Array &&
      bytes.length >= 12 &&
      bytes.length <= 8 * 1024 * 1024,
    "FONT",
    "Font must be at most 8 MiB",
  );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    magic = v.getUint32(0);
  const signatures = {
    "font/woff2": 0x774f4632,
    "font/woff": 0x774f4646,
    "font/ttf": 0x00010000,
    "font/otf": 0x4f54544f,
  };
  ensure(
    magic === signatures[type],
    "FONT",
    "Font signature does not match its format",
  );
  if (type === "font/woff2" || type === "font/woff")
    ensure(
      bytes.length > 48 &&
        v.getUint32(8) === bytes.length &&
        v.getUint16(12) <= 256 &&
        v.getUint32(16) <= 16 * 1024 * 1024,
      "FONT_LIMIT",
      "Font expansion or table limit exceeded",
    );
  else
    ensure(
      v.getUint16(4) <= 256 && 12 + v.getUint16(4) * 16 <= bytes.length,
      "FONT_LIMIT",
      "Font table directory is invalid",
    );
}
export function inspectFont(bytes, type) {
  fontHeader(bytes, type);
  let font;
  try {
    font = openFont(bytes);
  } catch {
    throw Object.assign(new Error("Font could not be decoded"), {
      code: "FONT",
    });
  }
  ensure(
    font.characterSet.length <= 200000,
    "FONT_LIMIT",
    "Font character map is too large",
  );
  return {
    font,
    info: {
      family: font.familyName ?? "Custom font",
      face: font.subfamilyName ?? "Regular",
      unitsPerEm: font.unitsPerEm,
      glyphs: font.numGlyphs,
      axes: font.variationAxes ?? {},
      codepoints: font.characterSet,
    },
  };
}
const ranges = {
  size: [1, 2000],
  minSize: [1, 2000],
  weight: [1, 1000],
  lineHeight: [0.5, 5],
  letterSpacing: [-100, 100],
  paragraphSpacing: [0, 1000],
  outlineWidth: [0, 100],
  shadowBlur: [0, 100],
  shadowX: [-200, 200],
  shadowY: [-200, 200],
};
export function validateTypography(node, assets) {
  const t = node.typography ?? {};
  const allowed = [
    ...Object.keys(ranges),
    "fontAsset",
    "style",
    "align",
    "verticalAlign",
    "overflow",
    "direction",
    "language",
    "outlineColor",
    "shadowColor",
    "axes",
    "color",
  ];
  ensure(
    t && typeof t === "object" && !Array.isArray(t),
    "TEXT",
    "Invalid typography",
  );
  for (const [key, value] of Object.entries(t)) {
    ensure(allowed.includes(key), "TEXT", "Unknown typography property " + key);
    if (ranges[key])
      ensure(
        Number.isFinite(value) &&
          value >= ranges[key][0] &&
          value <= ranges[key][1],
        "TEXT",
        "Invalid " + key,
      );
  }
  if (t.fontAsset)
    ensure(
      FONT_TYPES.includes(assets.get(t.fontAsset)?.mediaType),
      "FONT",
      "Unknown font asset",
    );
  for (const [key, values] of Object.entries({
    style: ["normal", "italic", "oblique"],
    align: ["left", "center", "right", "start", "end"],
    verticalAlign: ["top", "middle", "bottom"],
    overflow: ["wrap", "shrink", "ellipsis", "clip", "grow"],
    direction: ["ltr", "rtl", "auto"],
  }))
    if (t[key] !== undefined)
      ensure(values.includes(t[key]), "TEXT", "Invalid " + key);
  for (const key of ["outlineColor", "shadowColor", "color"])
    if (t[key] !== undefined)
      ensure(
        /^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(t[key]),
        "TEXT",
        "Invalid text color",
      );
  if (t.language !== undefined)
    ensure(
      typeof t.language === "string" && /^[a-zA-Z0-9-]{1,35}$/.test(t.language),
      "TEXT",
      "Invalid language",
    );
  if (t.axes) {
    ensure(Object.keys(t.axes).length <= 16, "FONT", "Too many axes");
    for (const [k, v] of Object.entries(t.axes))
      ensure(
        /^[A-Za-z]{4}$/.test(k) && Number.isFinite(v) && Math.abs(v) <= 10000,
        "FONT",
        "Invalid font axis",
      );
  }
  ensure(
    (t.minSize ?? 1) <= (t.size ?? node.height * 0.8),
    "TEXT",
    "Minimum size exceeds text size",
  );
  if (node.runs) {
    ensure(
      Array.isArray(node.runs) && node.runs.length <= 128,
      "TEXT",
      "Too many text spans",
    );
    let length = 0;
    for (const run of node.runs) {
      ensure(
        run &&
          Object.keys(run).every((k) =>
            ["text", "color", "weight", "style", "icon"].includes(k),
          ),
        "TEXT",
        "Invalid text span",
      );
      ensure(typeof run.text === "string", "TEXT", "Span text required");
      length += run.text.length;
      if (run.weight !== undefined)
        ensure(
          Number.isFinite(run.weight) && run.weight >= 1 && run.weight <= 1000,
          "TEXT",
          "Invalid span weight",
        );
      if (run.style !== undefined)
        ensure(
          ["normal", "italic", "oblique"].includes(run.style),
          "TEXT",
          "Invalid span style",
        );
      if (run.color)
        ensure(
          /^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(run.color),
          "TEXT",
          "Invalid span color",
        );
      if (run.icon)
        ensure(
          assets.get(run.icon)?.mediaType.startsWith("image/"),
          "TEXT",
          "Unknown inline icon",
        );
    }
    ensure(length <= 10000, "TEXT", "Text is too long");
  }
  if (node.stat) {
    ensure(
      Object.keys(node.stat).every((k) =>
        [
          "key",
          "scope",
          "label",
          "unit",
          "precision",
          "missing",
          "view",
          "minimum",
          "maximum",
          "locale",
        ].includes(k),
      ),
      "STAT",
      "Unknown binding property",
    );
    ensure(
      typeof node.stat.key === "string" &&
        /^[a-zA-Z][\w.-]{0,99}$/.test(node.stat.key),
      "STAT",
      "Invalid binding key",
    );
    ensure(
      ["card", "variant"].includes(node.stat.scope ?? "card"),
      "STAT",
      "Public art supports card or variant snapshots",
    );
    ensure(
      ["text", "badge", "bar"].includes(node.stat.view ?? "text"),
      "STAT",
      "Invalid stat view",
    );
    if (node.stat.precision !== undefined)
      ensure(
        Number.isInteger(node.stat.precision) &&
          node.stat.precision >= 0 &&
          node.stat.precision <= 8,
        "STAT",
        "Invalid precision",
      );
    for (const k of ["minimum", "maximum"])
      if (node.stat[k] !== undefined)
        ensure(Number.isFinite(node.stat[k]), "STAT", "Invalid bar range");
  }
  if (node.stat) {
    for (const key of ["label", "unit", "missing", "locale"])
      if (node.stat[key] !== undefined)
        ensure(
          typeof node.stat[key] === "string" && node.stat[key].length <= 200,
          "STAT",
          "Invalid binding text",
        );
    if (node.stat.locale)
      try {
        new Intl.NumberFormat(node.stat.locale);
      } catch {
        ensure(false, "STAT", "Invalid number locale");
      }
    if (node.stat.view === "bar")
      ensure(
        (node.stat.maximum ?? 100) > (node.stat.minimum ?? 0),
        "STAT",
        "Bar maximum must exceed its minimum",
      );
  }
  if (node.readingOrder !== undefined)
    ensure(
      Number.isInteger(node.readingOrder) &&
        Math.abs(node.readingOrder) <= 10000,
      "TEXT",
      "Invalid reading order",
    );
}
export function textValue(node, manifest) {
  if (!node.stat)
    return (
      node.runs?.map((r) => (r.icon ? "\ufffc" + r.text : r.text)).join("") ??
      node.text ??
      ""
    );
  const b = node.stat,
    v = manifest.authoring?.values?.[b.scope ?? "card"]?.[b.key];
  const rendered =
    v === undefined || v === null
      ? (b.missing ?? "—")
      : typeof v === "number"
        ? new Intl.NumberFormat(b.locale ?? "en", {
            maximumFractionDigits: b.precision ?? 8,
            minimumFractionDigits: b.precision ?? 0,
          }).format(v)
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
  return (
    (b.label ? b.label + " " : "") + rendered + (b.unit ? " " + b.unit : "")
  );
}
export function fontForNode(font, node) {
  const axes = { ...node.typography?.axes };
  const t = node.typography ?? {},
    available = font.variationAxes ?? {};
  if (available.wght && axes.wght === undefined && t.weight !== undefined)
    axes.wght = Math.max(
      available.wght.min,
      Math.min(available.wght.max, t.weight),
    );
  if (available.ital && axes.ital === undefined && t.style !== undefined)
    axes.ital = t.style === "italic" ? 1 : 0;
  if (available.slnt && axes.slnt === undefined && t.style === "oblique")
    axes.slnt = Math.max(available.slnt.min, Math.min(available.slnt.max, -12));
  for (const [key, value] of Object.entries(axes)) {
    const range = font.variationAxes?.[key];
    ensure(
      range && value >= range.min && value <= range.max,
      "FONT_AXIS",
      "Font axis outside its declared range",
    );
  }
  return Object.keys(axes).length ? font.getVariation(axes) : font;
}
export function layoutText(node, text, measure) {
  const t = node.typography ?? {},
    initial = t.size ?? node.height * 0.8,
    minimum = t.minSize ?? Math.min(8, initial);
  const make = (size) => {
    const lineHeight = size * (t.lineHeight ?? 1.2),
      lines = [];
    let y = 0,
      offset = 0;
    const push = (value, start) => {
      lines.push({ text: value.trimEnd(), start, y });
      y += lineHeight;
    };
    for (const paragraph of text.split("\n")) {
      if (t.overflow === "clip") {
        push(paragraph, offset);
        offset += paragraph.length + 1;
        y += t.paragraphSpacing ?? 0;
        continue;
      }
      let line = "",
        start = offset,
        position = offset;
      for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? [""]) {
        if (line && measure(line + token, size, start) > node.width) {
          push(line, start);
          line = "";
          start = position;
        }
        if (measure(token.trimEnd(), size, position) > node.width) {
          const segments =
            typeof Intl.Segmenter === "function"
              ? Array.from(
                  new Intl.Segmenter(t.language ?? "en", {
                    granularity: "grapheme",
                  }).segment(token),
                  (s) => s.segment,
                )
              : Array.from(token);
          for (const ch of segments) {
            if (line && measure(line + ch, size, start) > node.width) {
              push(line, start);
              line = "";
              start = position;
            }
            line += ch;
            position += ch.length;
          }
        } else {
          line += token;
          position += token.length;
        }
      }
      push(line, start);
      offset += paragraph.length + 1;
      y += t.paragraphSpacing ?? 0;
    }
    const height = Math.max(lineHeight, y - (t.paragraphSpacing ?? 0));
    return {
      lines,
      size,
      lineHeight,
      height,
      overflow:
        height > node.height + 0.01 ||
        lines.some((l) => measure(l.text, size, l.start) > node.width + 0.01),
    };
  };
  let result = make(initial);
  if (t.overflow === "shrink" && result.overflow) {
    let low = minimum,
      high = initial;
    result = make(low);
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2,
        next = make(mid);
      if (next.overflow) high = mid;
      else {
        low = mid;
        result = next;
      }
    }
  }
  const overflow = result.overflow;
  if (t.overflow === "ellipsis" && overflow) {
    result.lines = result.lines.slice(
      0,
      Math.max(1, Math.floor(node.height / result.lineHeight)),
    );
    const line = result.lines.at(-1);
    let chars = Array.from(line.text);
    while (
      chars.length &&
      measure(chars.join("") + "…", result.size, line.start) > node.width
    )
      chars.pop();
    line.text = chars.join("") + "…";
  }
  const offset =
    t.verticalAlign === "middle"
      ? Math.max(0, (node.height - result.height) / 2)
      : t.verticalAlign === "bottom"
        ? Math.max(0, node.height - result.height)
        : 0;
  const rtl =
    t.direction === "rtl" ||
    (t.direction === "auto" && /^[^A-Za-z]*[\u0590-\u08ff]/u.test(text));
  for (const line of result.lines) {
    line.width = measure(line.text, result.size, line.start);
    const align = t.align ?? "left";
    line.x =
      align === "center"
        ? (node.width - line.width) / 2
        : align === "right" ||
            (align === "end" && !rtl) ||
            (align === "start" && rtl)
          ? node.width - line.width
          : 0;
    line.y += offset;
  }
  return {
    ...result,
    overflow,
    renderHeight:
      t.overflow === "grow"
        ? Math.max(node.height, result.height)
        : node.height,
  };
}
function fragments(node, value, start = 0) {
  if (!node.runs || node.stat) return [{ text: value }];
  const spans = [];
  let offset = 0,
    end = start + value.length;
  for (const run of node.runs) {
    if (run.icon) {
      if (offset >= start && offset < end)
        spans.push({ ...run, text: "", icon: run.icon });
      offset++;
    }
    const a = Math.max(0, start - offset),
      b = Math.min(run.text.length, end - offset);
    if (b > a)
      spans.push({ ...run, icon: undefined, text: run.text.slice(a, b) });
    offset += run.text.length;
  }
  if (value.endsWith("…")) {
    const joined = spans.map((s) => (s.icon ? "\ufffc" : s.text)).join("");
    if (!joined.endsWith("…")) {
      let extra = joined.length - value.length + 1;
      while (extra > 0 && spans.length) {
        const last = spans.at(-1),
          remove = Math.min(extra, last.text.length);
        last.text = last.text.slice(0, last.text.length - remove);
        extra -= remove;
        if (!last.text && !last.icon) spans.pop();
        else break;
      }
      spans.push({ text: "…" });
    }
  }
  return spans;
}
const withSpan = (node, span) => ({
  ...node,
  typography: {
    ...node.typography,
    ...Object.fromEntries(
      ["weight", "style", "color"]
        .filter((k) => span[k] !== undefined)
        .map((k) => [k, span[k]]),
    ),
  },
});
function rawFontMeasure(font, node, value, size) {
  const active = fontForNode(font, node);
  return (
    (active
      .layout(
        value,
        undefined,
        undefined,
        node.typography?.language,
        node.typography?.direction === "auto"
          ? undefined
          : node.typography?.direction,
      )
      .positions.reduce((sum, p) => sum + p.xAdvance, 0) *
      size) /
      active.unitsPerEm +
    Math.max(0, Array.from(value).length - 1) *
      (node.typography?.letterSpacing ?? 0)
  );
}
export function fontMeasure(font, node) {
  return (value, size, start = 0) =>
    fragments(node, value, start).reduce(
      (total, span) =>
        total +
        (span.icon
          ? size
          : rawFontMeasure(font, withSpan(node, span), span.text, size)),
      0,
    );
}
export function textMeasure(ctx, node, font) {
  if (font) return fontMeasure(font, node);
  return (value, size, start = 0) =>
    fragments(node, value, start).reduce((total, span) => {
      if (span.icon) return total + size;
      const t = withSpan(node, span).typography;
      ctx.font =
        (t.style ?? "normal") +
        " " +
        (t.weight ?? 400) +
        " " +
        size +
        "px " +
        (node.font ?? "Georgia");
      ctx.letterSpacing = (t.letterSpacing ?? 0) + "px";
      return total + ctx.measureText(span.text).width;
    }, 0);
}
export function fontDiagnostics(font, node, text) {
  return Array.from(
    new Set(
      Array.from(text).filter(
        (c) =>
          !/[\s\ufffc]/u.test(c) &&
          !font.hasGlyphForCodePoint(c.codePointAt(0)),
      ),
    ),
  ).map((c) => ({
    code: "FONT_GLYPH",
    nodeId: node.id,
    message:
      "Font does not contain U+" + c.codePointAt(0).toString(16).toUpperCase(),
  }));
}
export function accessibleText(manifest, scene) {
  const flatten = (nodes) =>
    nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
  return flatten(scene?.nodes ?? [])
    .filter((n) => n.type === "text" && n.visible !== false)
    .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0))
    .map((n) => textValue(n, manifest).replaceAll("\ufffc", " "))
    .filter(Boolean)
    .join(". ");
}
export function drawText(ctx, node, manifest, font, icons = new Map()) {
  const t = node.typography ?? {},
    value = textValue(node, manifest),
    layout = layoutText(node, value, textMeasure(ctx, node, font));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, node.width, layout.renderHeight);
  ctx.clip();
  ctx.strokeStyle = t.outlineColor ?? "#000000";
  ctx.lineWidth = t.outlineWidth ?? 0;
  ctx.shadowColor = t.shadowColor ?? "#00000000";
  ctx.shadowBlur = t.shadowBlur ?? 0;
  ctx.shadowOffsetX = t.shadowX ?? 0;
  ctx.shadowOffsetY = t.shadowY ?? 0;
  if (node.stat?.view === "badge") {
    ctx.fillStyle = "#182030";
    ctx.fillRect(0, 0, node.width, node.height);
  }
  if (node.stat?.view === "bar") {
    const b = node.stat,
      n = manifest.authoring?.values?.[b.scope ?? "card"]?.[b.key],
      min = b.minimum ?? 0,
      max = b.maximum ?? 100;
    ctx.fillStyle = "#243247";
    ctx.fillRect(0, 0, node.width, node.height);
    ctx.fillStyle = t.color ?? node.color ?? "#80c4ff";
    ctx.fillRect(
      0,
      0,
      node.width *
        Math.max(0, Math.min(1, (Number(n) - min) / (max - min || 1))),
      node.height,
    );
  }
  for (const line of layout.lines) {
    let x = line.x;
    const spans = fragments(node, line.text, line.start);
    if (t.direction === "rtl") spans.reverse();
    for (const span of spans) {
      if (span.icon) {
        const bitmap = icons.get(span.icon);
        ensure(bitmap, "TEXT_ICON", "Inline icon could not be loaded");
        ctx.drawImage(bitmap, x, line.y, layout.size, layout.size);
        x += layout.size;
        continue;
      }
      const styled = withSpan(node, span),
        style = styled.typography,
        active = font ? fontForNode(font, styled) : null;
      ctx.fillStyle = span.color ?? t.color ?? node.color ?? "#ffffff";
      if (!active) {
        ctx.font =
          (style.style ?? "normal") +
          " " +
          (style.weight ?? 400) +
          " " +
          layout.size +
          "px " +
          (node.font ?? "Georgia");
        ctx.direction = t.direction === "rtl" ? "rtl" : "ltr";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.letterSpacing = (t.letterSpacing ?? 0) + "px";
        if (t.outlineWidth) ctx.strokeText(span.text, x, line.y);
        ctx.fillText(span.text, x, line.y);
        x += ctx.measureText(span.text).width;
        continue;
      }
      const scale = layout.size / active.unitsPerEm,
        run = active.layout(
          span.text,
          undefined,
          undefined,
          t.language,
          t.direction === "auto" ? undefined : t.direction,
        );
      const baseline = line.y + active.ascent * scale;
      for (let i = 0; i < run.glyphs.length; i++) {
        const glyph = run.glyphs[i],
          position = run.positions[i];
        ctx.save();
        ctx.translate(
          x + position.xOffset * scale,
          baseline - position.yOffset * scale,
        );
        ctx.scale(scale, -scale);
        ctx.beginPath();
        for (const command of glyph.path.commands) {
          ensure(
            [
              "moveTo",
              "lineTo",
              "quadraticCurveTo",
              "bezierCurveTo",
              "closePath",
            ].includes(command.command),
            "FONT",
            "Unsupported glyph command",
          );
          ctx[command.command](...command.args);
        }
        if (t.outlineWidth) {
          ctx.lineWidth = t.outlineWidth / scale;
          ctx.stroke();
        }
        ctx.fill();
        ctx.restore();
        x += position.xAdvance * scale + (t.letterSpacing ?? 0);
      }
    }
  }
  ctx.restore();
  return layout;
}
