import { ensure } from "./data.js";
import { valueError, deriveStats } from "../card-policy.js";
/** Values use JSON inside CSV cells, preserving null, zero and absence. */
export function exportStatsCSV(project) {
  const rows = [["scope", "key", "value"]];
  for (const [scope, values] of Object.entries(
    project.manifest.authoring?.values ?? {},
  ))
    for (const [key, value] of Object.entries(values))
      rows.push([scope, key, JSON.stringify(value)]);
  return rows
    .map((row) => row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","))
    .join("\r\n");
}
export function parseStatsCSV(source) {
  ensure(
    typeof source === "string" && source.length <= 262144,
    "STAT_CSV",
    "CSV exceeds 256 KiB",
  );
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  ensure(!quoted, "STAT_CSV", "Unclosed quoted cell");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  ensure(
    JSON.stringify(rows.shift()) ===
      JSON.stringify(["scope", "key", "value"]) && rows.length <= 256,
    "STAT_CSV",
    "Use scope,key,value columns",
  );
  const seen = new Set();
  return rows.map(([scope, key, value, ...rest]) => {
    ensure(
      !rest.length &&
        ["card", "variant"].includes(scope) &&
        key &&
        !seen.has(scope + ":" + key),
      "STAT_CSV",
      "Invalid or duplicate row",
    );
    seen.add(scope + ":" + key);
    return { scope, key, value: value === "" ? undefined : JSON.parse(value) };
  });
}
export function importStatsCSV(project, source) {
  const rows = parseStatsCSV(source);
  project.edit((p) => {
    const a = p.manifest.authoring;
    ensure(a, "STAT", "Define stat fields first");
    for (const row of rows) {
      const f = a.fields?.find(
        (f) => f.key === row.key && (f.scope ?? "card") === row.scope,
      );
      ensure(
        f && (f.source ?? "author") === "author" && !Object.hasOwn(f, "fixed"),
        "STAT_AUTHORITY",
        "CSV field is unknown or managed",
      );
      if (row.value !== undefined)
        ensure(
          !valueError(f, row.value),
          "STAT_VALUE",
          "Invalid value for " + row.key,
        );
      a.values ??= {};
      a.values[row.scope] ??= {};
      if (row.value === undefined) delete a.values[row.scope][row.key];
      else a.values[row.scope][row.key] = row.value;
    }
    for (const scope of ["card", "variant"])
      a.values[scope] = deriveStats(a.fields, a.values[scope] ?? {}, scope);
  });
  return rows.length;
}
