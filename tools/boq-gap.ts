// npm run boq:gap -- <folder> [--golden <dir>] [--layouts <file.json>]
//
// ============================================================================
// READ ONLY. WHAT THE BILL READER MAKES OF EVERY BILL IN A FOLDER, AS A NUMBER.
//
// Plan any-bill, Step 2.6. "The bill read fine" is an impression; this is the
// count. For every .xlsx / .csv / .tsv in the folder it runs the REAL reader
// (`parseBoqSheets`), with the header synonyms the database is seeded with —
// read here from `db/seed/0012_boq_column_aliases.sql` as a FILE, so no database
// is needed and none is touched — plus any saved layouts given as JSON, and
// prints per sheet:
//
//   * how the header was found (a layout, the synonyms, or not at all);
//   * the column map, role ← heading (letter);
//   * lines, lines with no code, lines with no quantity, the quantity sum;
//   * the row kinds the BRACKET RULE gives on its own — which is all the reader
//     does without a model or a person — and the rows it flagged.
//
// With --golden, each file is compared against a hand-checked expectation kept
// OUTSIDE the repo (`~/dev/localstack/boq-golden/`, matched on the JSON's own
// `file` field, or `<name>.json`): the line count, every code, every quantity,
// every row kind and every fabric line's item, and one accuracy line per file.
// A sheet the reader could not map compares as nothing, and says so: the
// golden check of a bill in an unknown layout is run with its layout, or after
// the model's reading has been saved as one.
//
// Real bills never enter the repo; neither does this tool's output. It writes
// nothing anywhere.
// ============================================================================
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import { intakeSourceKind } from "@/lib/intake-source-types";
import { parseBoqSheets, type BoqAlias, type BoqLayout, type ParsedBoqSheet } from "@/lib/boq-import";
import { BOQ_ROLE_LABELS, columnLetter, isBoqReadRole, isBoqRole, type BoqReadRole } from "@/lib/boq-roles";

type GoldenLine = {
  row: number;
  kind: string;
  code: string | null;
  qty: number | null;
  parentCode?: string | null;
};
type Golden = { file: string; sheet: string; lineCount: number; lines: GoldenLine[] };

function usage(): never {
  console.error("usage: npm run boq:gap -- <folder> [--golden <dir>] [--layouts <file.json>]");
  process.exit(2);
}

/** The seeded synonyms, read out of the seed file's VALUES list. */
async function seededAliases(): Promise<BoqAlias[]> {
  const file = path.join(process.cwd(), "db/seed/0012_boq_column_aliases.sql");
  const sqlText = await readFile(file, "utf8");
  const aliases: BoqAlias[] = [];
  for (const match of sqlText.matchAll(/\(\s*'([A-Za-z]+)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) {
    const role = match[1] ?? "";
    if (isBoqRole(role)) aliases.push({ role, term: (match[2] ?? "").replace(/''/g, "'") });
  }
  if (aliases.length === 0) throw new Error(`No aliases found in ${file}.`);
  return aliases;
}

async function layoutsFrom(file: string | null): Promise<BoqLayout[]> {
  if (!file) return [];
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.flatMap((entry, index) => {
    const value = entry as { id?: unknown; name?: unknown; headerRows?: unknown; mapping?: unknown };
    const mapping: Partial<Record<BoqReadRole, string>> = {};
    for (const [role, heading] of Object.entries((value.mapping ?? {}) as Record<string, unknown>)) {
      if (isBoqReadRole(role) && typeof heading === "string" && heading.trim()) mapping[role] = heading;
    }
    if (Object.keys(mapping).length === 0) return [];
    return [
      {
        id: String(value.id ?? `layout-${index + 1}`),
        name: String(value.name ?? `layout ${index + 1}`),
        headerRows: value.headerRows === 2 ? (2 as const) : (1 as const),
        mapping,
      },
    ];
  });
}

async function goldens(dir: string | null): Promise<Map<string, Golden>> {
  const out = new Map<string, Golden>();
  if (!dir) return out;
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const golden = JSON.parse(await readFile(path.join(dir, name), "utf8")) as Golden;
    out.set(golden.file ?? name, golden);
    out.set(name.replace(/\.json$/, ""), golden);
  }
  return out;
}

const fold = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const pct = (hit: number, of: number) => (of === 0 ? "—" : `${hit}/${of} (${((100 * hit) / of).toFixed(1)}%)`);

function describeSheet(sheet: ParsedBoqSheet): string[] {
  const out: string[] = [];
  const how = sheet.needsColumns
    ? `NOT MAPPED — ${sheet.columnsNote ?? "no header found"}`
    : sheet.mappingSource === "layout"
      ? `layout “${sheet.layout?.name ?? "?"}”, header row ${sheet.headerRow}${sheet.headerRows === 2 ? " (two rows)" : ""}`
      : `${sheet.mappingSource ?? "synonyms"}, header row ${sheet.headerRow}${sheet.headerRows === 2 ? " (two rows)" : ""}`;
  out.push(`  header: ${how}${sheet.ignored ? `   [ignored: ${sheet.ignoredReason ?? ""}]` : ""}`);
  const columns = Object.entries(sheet.columns ?? {}) as [BoqReadRole, { index: number; heading: string }][];
  if (columns.length > 0) {
    out.push(
      `  columns: ${columns
        .sort((a, b) => a[1].index - b[1].index)
        .map(([role, ref]) => `${BOQ_ROLE_LABELS[role]} ← “${ref.heading}” (${columnLetter(ref.index)})`)
        .join(" · ")}`,
    );
  }
  if (sheet.needsColumns) return out;
  const lines = sheet.lines;
  const fabric = lines.filter((line) => line.rowKind === "finish_for");
  const items = lines.filter((line) => line.rowKind !== "finish_for");
  const flagged = lines.filter((line) => line.rowKindFlag);
  const qtySum = items.reduce((total, line) => total + (line.qty ?? 0), 0);
  out.push(
    `  lines: ${lines.length} · no code ${lines.filter((line) => !line.code).length} · no qty ${
      lines.filter((line) => line.qty === null).length
    } · qty sum (items) ${qtySum} · skipped rows ${sheet.skippedRows}`,
  );
  out.push(`  row kinds by the bracket rule: ${fabric.length} fabric line(s), ${items.length} other, ${flagged.length} flagged`);
  for (const line of flagged.slice(0, 12)) out.push(`    row ${line.lineNo} ${line.code ?? ""}: ${line.rowKindFlag}`);
  if (flagged.length > 12) out.push(`    … and ${flagged.length - 12} more`);
  return out;
}

function compare(sheet: ParsedBoqSheet | undefined, golden: Golden): string[] {
  if (!sheet) return [`  golden: no sheet called “${golden.sheet}” was read.`];
  if (sheet.needsColumns) {
    return [
      `  golden: “${golden.sheet}” is not mapped, so nothing compares (0/${golden.lineCount}). Give its layout with --layouts.`,
    ];
  }
  const ours = new Map(sheet.lines.map((line) => [line.lineNo, line]));
  const wantByRow = new Map(golden.lines.map((line) => [line.row, line]));
  // THE ITEM A FABRIC LINE BELONGS TO, by the golden's own kinds: the nearest
  // item row above it. The golden's `parentCode` is the bracket's text, which
  // on the real bill is not always an item's code.
  const expectedParent = new Map<number, number>();
  let lastItem: number | null = null;
  for (const line of [...golden.lines].sort((a, b) => a.row - b.row)) {
    if (line.kind === "item") lastItem = line.row;
    else if (line.kind === "finish_for" && lastItem !== null) expectedParent.set(line.row, lastItem);
  }

  let codes = 0;
  let qtys = 0;
  let kinds = 0;
  let parents = 0;
  const misses: string[] = [];
  for (const want of golden.lines) {
    const got = ours.get(want.row);
    if (!got) {
      misses.push(`row ${want.row}: missing (golden ${want.code ?? "no code"})`);
      continue;
    }
    if (fold(got.code) === fold(want.code)) codes += 1;
    else misses.push(`row ${want.row}: code “${got.code ?? ""}”, golden “${want.code ?? ""}”`);
    if ((got.qty ?? null) === (want.qty ?? null)) qtys += 1;
    else misses.push(`row ${want.row}: qty ${got.qty ?? "none"}, golden ${want.qty ?? "none"}`);
    const gotKind = got.rowKind ?? "item";
    if (gotKind === want.kind) kinds += 1;
    if (want.kind === "finish_for" && got.finishFor && got.finishFor.row === expectedParent.get(want.row)) parents += 1;
  }
  const extra = sheet.lines.filter((line) => !wantByRow.has(line.lineNo));
  for (const line of extra.slice(0, 10)) misses.push(`row ${line.lineNo}: not in the golden (${line.code ?? "no code"})`);
  const fabricWanted = golden.lines.filter((line) => line.kind === "finish_for").length;
  const out = [
    `  ACCURACY  lines ${sheet.lines.length}/${golden.lineCount}${extra.length ? ` (+${extra.length} not in golden)` : ""} · ` +
      `codes ${pct(codes, golden.lines.length)} · quantities ${pct(qtys, golden.lines.length)} · ` +
      `row kinds ${pct(kinds, golden.lines.length)} · fabric lines on the right item ${pct(parents, fabricWanted)}`,
  ];
  for (const miss of misses.slice(0, 15)) out.push(`    ${miss}`);
  if (misses.length > 15) out.push(`    … and ${misses.length - 15} more`);
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const folder = args.find((arg, index) => !arg.startsWith("--") && !["--golden", "--layouts"].includes(args[index - 1] ?? ""));
  if (!folder) usage();
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? (args[at + 1] ?? usage()) : null;
  };
  const aliases = await seededAliases();
  const layouts = await layoutsFrom(option("--layouts"));
  const golden = await goldens(option("--golden"));

  console.log(`boq:gap — ${folder} · ${aliases.length} seeded synonyms · ${layouts.length} layout(s)${golden.size ? " · golden" : ""}`);
  const names = (await readdir(folder)).filter((name) => ["xlsx", "csv", "tsv"].includes(intakeSourceKind(name, ""))).sort();
  if (names.length === 0) console.log("  no .xlsx, .csv or .tsv file in the folder.");
  for (const name of names) {
    console.log(`\n${name}`);
    let sheets;
    try {
      sheets = await readSpreadsheetSheets(await readFile(path.join(folder, name)), name, "");
    } catch (cause) {
      console.log(`  could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    const result = parseBoqSheets(sheets, { aliases, layouts });
    if (!result.sheets || result.sheets.length === 0) {
      console.log(`  ${result.ok ? "no sheets" : result.error}`);
      continue;
    }
    for (const sheet of result.sheets) {
      console.log(` sheet “${sheet.sheetName}”`);
      for (const line of describeSheet(sheet)) console.log(line);
    }
    const expected = golden.get(name) ?? golden.get(name.replace(/\.[^.]+$/, ""));
    if (expected) {
      console.log(` golden “${expected.sheet}”`);
      for (const line of compare(result.sheets.find((sheet) => sheet.sheetName === expected.sheet), expected)) console.log(line);
    } else if (golden.size > 0) {
      console.log("  golden: none for this file.");
    }
  }
}

await main();
