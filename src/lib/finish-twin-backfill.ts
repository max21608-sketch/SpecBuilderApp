// A ONE-OFF pass: merge the finishes library's TWINS that projects already hold
// (Max, 2026-10-13). The runner is db/backfill-finish-twins.ts; the rules live
// here so a test can hold them.
//
// ============================================================================
// Two kinds of twin, each merged into its CANONICAL row:
//
//   * A ZONE TWIN (`findFinishByCode`, the rule the confirms now read): a bare
//     `MTL-01` beside the library's ONE `GR-MTL-01`. The canonical row is the
//     three-part one. A bare code two zones carry (`GR-MTL-01` and
//     `PL-MTL-01`) is never merged: which one it is, is a person's call.
//   * A `fabricOwnCode` TWIN: `GR-FAB-13 PL-FUR-04`, filed before 2026-10-05
//     with its item's code still on the end, beside `GR-FAB-13`. Stripped only
//     where EVERY item the row is used on carries that code, through
//     `fabricOwnCode` itself.
//
// Merging re-links the twin's active attributes to the canonical row (the
// attribute keeps its own words and its own `material_code`: what the document
// said), recomposes each affected record's answers, and takes one version per
// record, under ONE change set per project.
//
// A CONFLICT IS NEVER SETTLED HERE: a twin whose description, swatch or BW
// standard differs from a canonical row that has its own is skipped and named.
// A twin left with nothing on it — no description, no swatch, no standard —
// is RETIRED (reversible, the library hides it); anything else is left where
// it is and reported, because it still says something.
//
// SAFE TO RE-RUN: a merged twin has no active attributes left and is retired
// or reported; a second pass finds nothing to re-link.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { findFinishByCode, finishWordsOf, normaliseFinishCode, type Finish } from "@/lib/finishes";
import { fabricLineIsPlaceholder, fabricOwnCode } from "@/lib/boq-row-kinds";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";

export type LibraryRow = Finish & {
  /** The current swatch's stored pathname, or null. */
  swatch: string | null;
  /** The BW standard's value, or null. */
  standardValue: string | null;
  /** The item codes (`boq_code`, through a configuration's parent) its active attributes sit on. */
  itemCodes: string[];
  /** How many active attributes link to it. */
  uses: number;
  /** The names (first line) of the items it is used on, for the placeholder test. Optional. */
  itemNames?: string[];
};

export type FinishTwinMerge = {
  twin: { id: string; code: string; uses: number };
  canonical: { id: string; code: string };
  why: "zone" | "item_code";
  /** True where the twin will be empty afterwards and is retired. */
  retire: boolean;
};

export type FinishTwinProject = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  libraryCount: number;
  merges: FinishTwinMerge[];
  /** Twins found and NOT merged, in words. */
  skipped: string[];
  /** Twins merged and left in the library because they still hold something, in words. */
  leftInPlace: string[];
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

async function loadLibrary(txn: TxnSql, projectId: string): Promise<LibraryRow[]> {
  const rows = await txn`
    select f.id, f.code, f.code_norm, f.code_origin, f.description, f.state, f.standard_value,
           (select s.storage_path from attachments s
             where s.entity_type = 'project_finishes' and s.kind = 'finish_swatch' and s.superseded_at is null
               and s.entity_id = f.id
             order by s.created_at desc limit 1) as swatch,
           (select count(*)::int from record_attributes a where a.finish_id = f.id and a.status = 'active') as uses,
           (select coalesce(array_agg(distinct x.ref_value), '{}')
              from record_attributes a
              join spec_records r on r.id = a.record_id
              join spec_record_refs x on x.record_id = coalesce(r.parent_id, r.id) and x.ref_system = 'boq_code'
             where a.finish_id = f.id and a.status = 'active') as item_codes,
           (select coalesce(array_agg(distinct split_part(r.item_description, E'\n', 1)), '{}')
              from record_attributes a
              join spec_records r on r.id = a.record_id
             where a.finish_id = f.id and a.status = 'active') as item_names
    from project_finishes f
    where f.project_id = ${projectId} and f.status = 'active'
    order by f.code
  `;
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    codeNorm: String(row.code_norm),
    codeOrigin: row.code_origin === "internal" ? "internal" : "client",
    kind: null,
    description: text(row.description),
    supplierRaw: null,
    reference: null,
    colour: null,
    state: String(row.state) as Finish["state"],
    swatch: text(row.swatch),
    standardValue: text(row.standard_value),
    itemCodes: Array.isArray(row.item_codes) ? row.item_codes.map(String) : [],
    uses: Number(row.uses ?? 0),
    itemNames: Array.isArray(row.item_names) ? row.item_names.map(String) : [],
  }));
}

const TWO_PART = /^[A-Z]{2,4}-\d{1,4}[A-Z]?$/;

/** The canonical row for one library row, and why — or null where it has none. */
export function canonicalTwinOf(
  row: LibraryRow,
  library: readonly LibraryRow[],
): { canonical: LibraryRow; why: "zone" | "item_code" } | { ambiguous: string } | null {
  const others = library.filter((entry) => entry.id !== row.id);
  // A ZONE TWIN: only a bare row moves onto its zoned twin, never the reverse.
  if (TWO_PART.test(row.codeNorm)) {
    const zoned = others.filter((entry) => findFinishByCode(row.codeNorm, [entry])?.readAs);
    if (zoned.length === 1) return { canonical: zoned[0] as LibraryRow, why: "zone" };
    if (zoned.length > 1) return { ambiguous: `${row.code}: ${zoned.map((entry) => entry.code).join(" and ")} both carry it` };
    return null;
  }
  // A fabricOwnCode TWIN: every item it is used on agrees on the stripped code.
  if (row.itemCodes.length > 0 && /\s/.test(row.code.trim())) {
    const stripped = new Set(row.itemCodes.map((itemCode) => fabricOwnCode({ code: row.code, finishFor: { code: itemCode } })));
    if (stripped.size !== 1) return null;
    const own = [...stripped][0];
    if (!own || normaliseFinishCode(own) === row.codeNorm) return null;
    const canonical = others.find((entry) => entry.codeNorm === normaliseFinishCode(own));
    return canonical ? { canonical, why: "item_code" } : null;
  }
  return null;
}

/**
 * What a library row's description SAYS: null where it is only the code
 * (`finishWordsOf`) or a bill's placeholder for one of the items it is on
 * ("Fabric @ Desk Chair Technical Details TBC", `fabricLineIsPlaceholder`).
 */
function wordsOf(row: LibraryRow): string | null {
  const words = finishWordsOf(row.code, row.description);
  if (!words) return null;
  const names = row.itemNames && row.itemNames.length > 0 ? row.itemNames : [null];
  return names.some((name) => fabricLineIsPlaceholder(words, name)) ? null : words;
}

/** What one project's library would merge. Read only. */
export async function planFinishTwins(txn: TxnSql, projectFilter: string | null): Promise<FinishTwinProject[]> {
  const projects = projectFilter
    ? await txn`select id, bws_project_number, name from projects where id = ${projectFilter}`
    : await txn`select id, bws_project_number, name from projects order by bws_project_number`;
  const out: FinishTwinProject[] = [];
  for (const project of projects) {
    const projectId = String(project.id);
    const library = await loadLibrary(txn, projectId);
    const merges: FinishTwinMerge[] = [];
    const skipped: string[] = [];
    const leftInPlace: string[] = [];
    for (const row of library) {
      const found = canonicalTwinOf(row, library);
      if (!found) continue;
      if ("ambiguous" in found) {
        skipped.push(`${found.ambiguous} — a person decides which`);
        continue;
      }
      const { canonical, why } = found;
      // A description that is only the code (`SFT-01`, `GR SFT 01`) says
      // nothing — `finishWordsOf`, the rule the confirms read — and so does
      // one that repeats the canonical row's words: neither is a conflict,
      // and neither keeps the twin in the library.
      const twinWords = wordsOf(row);
      const canonicalWords = wordsOf(canonical);
      const clash: string[] = [];
      if (twinWords && canonicalWords && !same(twinWords, canonicalWords)) {
        clash.push(`its description ("${row.description}") is not ${canonical.code}'s ("${canonical.description}")`);
      }
      if (row.swatch && canonical.swatch && row.swatch !== canonical.swatch) clash.push(`its swatch is not ${canonical.code}'s`);
      if (row.standardValue && canonical.standardValue && !same(row.standardValue, canonical.standardValue)) {
        clash.push(`its BW standard is not ${canonical.code}'s`);
      }
      if (clash.length > 0) {
        skipped.push(`${row.code} → ${canonical.code}: ${clash.join("; ")} — a person decides`);
        continue;
      }
      const ownWords = twinWords !== null && !same(twinWords, canonicalWords);
      const retire = !ownWords && !row.swatch && !row.standardValue;
      merges.push({
        twin: { id: row.id, code: row.code, uses: row.uses },
        canonical: { id: canonical.id, code: canonical.code },
        why,
        retire,
      });
      if (!retire) {
        const holds = [ownWords ? "a description of its own" : null, row.swatch ? "a swatch" : null, row.standardValue ? "a BW standard" : null]
          .filter(Boolean)
          .join(" and ");
        leftInPlace.push(`${row.code}: its items now link to ${canonical.code}; left in the library because it holds ${holds}`);
      }
    }
    if (merges.length > 0 || skipped.length > 0) {
      out.push({
        projectId,
        projectNumber: String(project.bws_project_number ?? ""),
        projectName: String(project.name ?? ""),
        libraryCount: library.length,
        merges,
        skipped,
        leftInPlace,
      });
    }
  }
  return out;
}

/** Writes one project's merges inside the caller's transaction. Nothing, on a second run. */
export async function applyFinishTwins(
  txn: TxnSql,
  project: FinishTwinProject,
  actor: string,
): Promise<{ relinked: number; retired: number; records: number; changeSetId: string | null }> {
  if (project.merges.length === 0) return { relinked: 0, retired: 0, records: 0, changeSetId: null };
  const changeSetId = await openChangeSet(txn, {
    projectId: project.projectId,
    kind: "finish_link",
    reason:
      "Merged finish codes that are one finish: " +
      project.merges
        .map((merge) => `${merge.twin.code} into ${merge.canonical.code}${merge.why === "zone" ? " (the same code without its zone)" : " (its item's code taken off)"}`)
        .join("; ") +
      ".",
    actor,
  });
  const records = new Set<string>();
  let relinked = 0;
  let retired = 0;
  for (const merge of project.merges) {
    const moved = await txn`
      update record_attributes set finish_id = ${merge.canonical.id}, updated_by = ${actor}
      where finish_id = ${merge.twin.id} and status = 'active'
      returning id, record_id
    `;
    relinked += moved.length;
    for (const row of moved) records.add(String(row.record_id));
    if (merge.retire) {
      const gone = await txn`
        update project_finishes
           set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
         where id = ${merge.twin.id} and status = 'active'
           and not exists (select 1 from record_attributes a where a.finish_id = ${merge.twin.id} and a.status = 'active')
        returning id
      `;
      retired += gone.length;
    }
  }
  for (const recordId of records) await recomposeAnswers(txn, recordId, null, actor);
  await snapshotRecords(txn, [...records], changeSetId);
  return { relinked, retired, records: records.size, changeSetId };
}
