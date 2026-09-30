// npm run bill:descriptions -- <bill.xlsx> [--layouts <file.json>] [--kinds <golden.json>] [--out <file>]
//
// ============================================================================
// READ ONLY. WHAT THE CONFIRM WILL WRITE FROM EACH ITEM'S DESCRIPTION CELL.
//
// A bill whose description cells are several lines — a name, then "Sizes
// (mm): …", "Finish: …", "Model Ref: …" — has each cell read at confirm by
// `bill-description.ts` into the record's name and its specifications. "It
// read fine" is an impression; this prints, per item line, the row, the code,
// the NAME, the composed dimension cell (`composeDimensionCell`, the one
// composer), every finish with the BWS field it lands in, and every note —
// through the REAL reader (`parseBoqSheets`) and the REAL plan
// (`planSheetDescriptions`), so what it prints is what the review screen shows
// and the confirm writes. Then the counts.
//
// The BWS field register is read out of `db/seed/0001_spec_fields.sql` as a
// FILE and the header synonyms out of `db/seed/0012_boq_column_aliases.sql`, so
// no database is needed and none is touched. `--layouts` is a saved layout as
// JSON (the `boq_layouts` row's name, header rows and mapping), for a bill the
// synonyms do not read. `--kinds` is a hand-checked golden (the `boq:gap`
// shape): its `finish_for` rows are applied as fabric lines under the item
// above them — standing in for the structure a person confirms on the review
// screen, because which item has a fabric line decides whether a fabric named
// in the description may claim a COM slot.
//
// Real bills never enter the repo; neither does this tool's output. `--out`
// writes the report to a file the caller names, which should be outside it.
// ============================================================================
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import { parseBoqSheets, type BoqAlias, type BoqLayout, type ParsedBoqSheet } from "@/lib/boq-import";
import { isBoqReadRole, isBoqRole, type BoqReadRole } from "@/lib/boq-roles";
import { planSheetDescriptions, type BillDescriptionPlan } from "@/lib/bill-description";
import type { SpecFieldEntry } from "@/lib/drawing-document";

function usage(): never {
  console.error("usage: npm run bill:descriptions -- <bill.xlsx> [--layouts <file.json>] [--kinds <golden.json>] [--out <file>]");
  process.exit(2);
}

async function seededAliases(): Promise<BoqAlias[]> {
  const file = path.join(process.cwd(), "db/seed/0012_boq_column_aliases.sql");
  const text = await readFile(file, "utf8");
  const aliases: BoqAlias[] = [];
  for (const match of text.matchAll(/\(\s*'([A-Za-z]+)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) {
    const role = match[1] ?? "";
    if (isBoqRole(role)) aliases.push({ role, term: (match[2] ?? "").replace(/''/g, "'") });
  }
  return aliases;
}

/** The 56 BWS fields, from the seed file. The id is the json id, which is all the plan compares. */
async function seededFields(): Promise<SpecFieldEntry[]> {
  const file = path.join(process.cwd(), "db/seed/0001_spec_fields.sql");
  const text = await readFile(file, "utf8");
  const fields: SpecFieldEntry[] = [];
  for (const match of text.matchAll(/\(\s*(\d+)\s*,\s*'[A-Z]+'\s*,\s*'((?:[^']|'')*)'/g)) {
    fields.push({ id: `json:${match[1]}`, jsonId: Number(match[1]), name: (match[2] ?? "").replace(/''/g, "'") });
  }
  if (fields.length === 0) throw new Error(`No spec fields found in ${file}.`);
  return fields;
}

async function layoutsFrom(file: string | null): Promise<BoqLayout[]> {
  if (!file) return [];
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.flatMap((entry, index) => {
    const value = entry as { id?: unknown; name?: unknown; headerRows?: unknown; header_rows?: unknown; mapping?: unknown };
    const mapping: Partial<Record<BoqReadRole, string>> = {};
    for (const [role, heading] of Object.entries((value.mapping ?? {}) as Record<string, unknown>)) {
      if (isBoqReadRole(role) && typeof heading === "string" && heading.trim()) mapping[role] = heading;
    }
    if (Object.keys(mapping).length === 0) return [];
    const rows = value.headerRows ?? value.header_rows;
    return [
      {
        id: String(value.id ?? `layout-${index + 1}`),
        name: String(value.name ?? `layout ${index + 1}`),
        headerRows: rows === 2 ? (2 as const) : (1 as const),
        mapping,
      },
    ];
  });
}

/** The golden's fabric lines applied as the reviewer's structure: each under the item row above it. */
async function applyKinds(sheet: ParsedBoqSheet, file: string | null): Promise<number> {
  if (!file) return 0;
  const golden = JSON.parse(await readFile(file, "utf8")) as { lines: { row: number; kind: string }[] };
  const kinds = new Map(golden.lines.map((line) => [line.row, line.kind]));
  let lastItem: { row: number; code: string | null } | null = null;
  let applied = 0;
  for (const line of [...sheet.lines].sort((a, b) => a.lineNo - b.lineNo)) {
    const kind = kinds.get(line.lineNo);
    if (kind === "item") {
      lastItem = { row: line.lineNo, code: line.code };
      if (line.rowKind === "finish_for") {
        line.rowKind = "item";
        line.finishFor = null;
      }
    } else if (kind === "finish_for" && lastItem) {
      if (line.rowKind !== "finish_for" || line.finishFor?.row !== lastItem.row) applied += 1;
      line.rowKind = "finish_for";
      line.finishFor = { row: lastItem.row, code: lastItem.code };
    }
  }
  return applied;
}

function describe(line: ParsedBoqSheet["lines"][number], plan: BillDescriptionPlan | undefined): string[] {
  const out = [`row ${line.lineNo} · ${line.code ?? "(no code)"} · ${plan ? plan.name : line.itemDescription}`];
  if (!plan) {
    out.push("    (single-line description: its own name, nothing read)");
    return out;
  }
  out.push(`    dimensions: ${plan.dimensionCell || "—"}`);
  const converted = plan.attributes.find((attribute) => attribute.attrGroup === "dimension" && attribute.why);
  if (converted?.why) out.push(`          ${converted.why}`);
  for (const attribute of plan.attributes) {
    if (attribute.attrGroup === "dimension") continue;
    if (attribute.attrGroup === "note") {
      out.push(`    note  ${attribute.label}: ${attribute.value}${attribute.state === "tbc" ? "  [TBC]" : ""}`);
    } else {
      out.push(
        `    finish ${attribute.materialCode ?? "(no code)"} → ${attribute.specFieldName ?? "no field"}  (${attribute.label}: ${attribute.value})`,
      );
    }
    if (attribute.why) out.push(`          ${attribute.why}`);
  }
  for (const caution of plan.cautions) out.push(`    CAUTION ${caution}`);
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? (args[at + 1] ?? usage()) : null;
  };
  const file = args.find(
    (arg, index) => !arg.startsWith("--") && !["--layouts", "--kinds", "--out"].includes(args[index - 1] ?? ""),
  );
  if (!file) usage();

  const [aliases, fields, layouts] = await Promise.all([seededAliases(), seededFields(), layoutsFrom(option("--layouts"))]);
  const sheets = await readSpreadsheetSheets(await readFile(file), path.basename(file), "");
  const result = parseBoqSheets(sheets, { aliases, layouts });
  const report: string[] = [`bill:descriptions — ${path.basename(file)} · ${layouts.length} layout(s)`];
  if (!result.sheets) {
    report.push(`  ${result.ok ? "no sheets" : result.error}`);
  }
  for (const sheet of result.sheets ?? []) {
    report.push("", `sheet “${sheet.sheetName}”${sheet.needsColumns ? " — NOT MAPPED" : ""}${sheet.ignored ? " — ignored" : ""}`);
    if (sheet.needsColumns || sheet.ignored) continue;
    const applied = await applyKinds(sheet, option("--kinds"));
    if (applied > 0) report.push(`  ${applied} fabric line(s) placed from the golden's kinds, as a reviewer would`);
    const staged = sheet.lines.map((line, index) => ({ ...line, index, ignored: false }));
    const plans = planSheetDescriptions(staged, fields);
    const items = staged.filter((line) => line.rowKind !== "finish_for");

    const counts = { items: items.length, read: 0, withDimensions: 0, slots: 0, finishes: 0, placed: 0, noField: 0, notes: 0, tbcNotes: 0, cautioned: 0 };
    for (const line of items) {
      const plan = plans.get(line.index);
      report.push(...describe(line, plan));
      if (!plan) continue;
      counts.read += 1;
      if (plan.dimensionCell) counts.withDimensions += 1;
      if (plan.cautions.length > 0) counts.cautioned += 1;
      for (const attribute of plan.attributes) {
        if (attribute.attrGroup === "dimension") counts.slots += 1;
        else if (attribute.attrGroup === "note") {
          counts.notes += 1;
          if (attribute.state === "tbc") counts.tbcNotes += 1;
        } else {
          counts.finishes += 1;
          if (attribute.specFieldId) counts.placed += 1;
          else counts.noField += 1;
        }
      }
    }
    report.push(
      "",
      `  COUNTS  items ${counts.items} · descriptions read ${counts.read} · with dimensions ${counts.withDimensions} (${counts.slots} slots) · ` +
        `finishes ${counts.finishes} (${counts.placed} in a BWS field, ${counts.noField} in none) · notes ${counts.notes} (${counts.tbcNotes} TBC) · ` +
        `items with a caution ${counts.cautioned}`,
    );
  }

  const out = option("--out");
  if (out) {
    await writeFile(out, `${report.join("\n")}\n`, "utf8");
    console.log(`written to ${out}`);
  } else {
    console.log(report.join("\n"));
  }
}

await main();
